// Auto Reframe Panel — analyzes a selected video clip and generates a composition
// with position keyframes to reframe it for vertical/square aspect ratios.

import { useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { analyzeClipForReframe } from '../../services/reframeAnalyzer';
import {
  buildCropPath,
  type TargetAspectRatio,
  type SmoothingLevel,
  type CropPath,
} from '../../services/reframeCropPathBuilder';
import type { ReframeAnalysis } from '../../types/index';
import './AutoReframePanel.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const RATIO_LABELS: { value: TargetAspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '1:1',  label: '1:1'  },
  { value: '4:5',  label: '4:5'  },
];

const SMOOTHING_LABELS: { value: SmoothingLevel; label: string }[] = [
  { value: 'low',    label: 'Az'   },
  { value: 'medium', label: 'Orta' },
  { value: 'high',   label: 'Çok'  },
];

// ─── Mini SVG crop-path preview ───────────────────────────────────────────────

interface CropPathSvgProps {
  cropPath: CropPath;
  duration: number;
}

function CropPathSvg({ cropPath, duration }: CropPathSvgProps) {
  const W = 200;
  const H = 32;
  const kfs = cropPath.keyframes;

  if (kfs.length === 0) return null;

  const xs = kfs.map(k => (duration > 0 ? (k.time / duration) * W : 0));
  const allX = kfs.map(k => k.positionX);
  const minX = Math.min(...allX);
  const maxX = Math.max(...allX);
  const range = maxX - minX || 1;
  const ys = allX.map(x => H - 2 - ((x - minX) / range) * (H - 4));

  const points = kfs
    .map((_, i) => `${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" height={H}>
      <polyline
        points={points}
        fill="none"
        stroke="#e94560"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {kfs.map((_, i) => (
        <circle key={i} cx={xs[i]} cy={ys[i]} r="2" fill="#e94560" />
      ))}
    </svg>
  );
}

// ─── Crop overlay (shows the crop window on a 16:9 placeholder) ──────────────

interface CropOverlayProps {
  cropPath: CropPath;
  currentTime: number;
  sourceWidth: number;
  sourceHeight: number;
  targetRatio: TargetAspectRatio;
}

const TARGET_DIMS: Record<TargetAspectRatio, { w: number; h: number }> = {
  '9:16': { w: 1080, h: 1920 },
  '1:1':  { w: 1080, h: 1080 },
  '4:5':  { w: 1080, h: 1350 },
};

function interpolateCropX(cropPath: CropPath, time: number): number {
  const kfs = cropPath.keyframes;
  if (kfs.length === 0) return 0;
  if (time <= kfs[0].time) return kfs[0].positionX;
  if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].positionX;

  for (let i = 1; i < kfs.length; i++) {
    if (time < kfs[i].time) {
      const t = (time - kfs[i - 1].time) / (kfs[i].time - kfs[i - 1].time);
      return kfs[i - 1].positionX + t * (kfs[i].positionX - kfs[i - 1].positionX);
    }
  }
  return kfs[kfs.length - 1].positionX;
}

function CropOverlay({ cropPath, currentTime, sourceWidth, sourceHeight, targetRatio }: CropOverlayProps) {
  const { w: compW, h: compH } = TARGET_DIMS[targetRatio];
  const scale = (sourceWidth / sourceHeight) / (compW / compH); // sourceAspect / outputAspect
  const visibleFraction = 1 / scale; // fraction of source width visible

  // positionX is a UV offset: attentionX = 0.5 − posX
  const posX = interpolateCropX(cropPath, currentTime);
  const attentionX = 0.5 - posX;

  const leftPct = (attentionX - visibleFraction / 2) * 100;
  const widthPct = visibleFraction * 100;

  return (
    <div
      className="arp-crop-overlay"
      style={{
        left: `${leftPct.toFixed(2)}%`,
        width: `${widthPct.toFixed(2)}%`,
      }}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type CorrectionSide = 'left' | 'center' | 'right';

export function AutoReframePanel() {
  // ── Store subscriptions ────────────────────────────────────────────────────
  const { primarySelectedClipId, selectedClipIds, clips, playheadPosition } = useTimelineStore(
    useShallow(s => ({
      primarySelectedClipId: s.primarySelectedClipId,
      selectedClipIds: s.selectedClipIds,
      clips: s.clips,
      playheadPosition: s.playheadPosition,
    }))
  );

  const { files } = useMediaStore(
    useShallow(s => ({
      files: s.files,
    }))
  );

  // ── Local state ────────────────────────────────────────────────────────────
  const [targetRatio, setTargetRatio] = useState<TargetAspectRatio>('9:16');
  const [smoothing, setSmoothing] = useState<SmoothingLevel>('medium');
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState<ReframeAnalysis | null>(null);
  const [cropPath, setCropPath] = useState<CropPath | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedClipId, setAppliedClipId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionOverride, setCorrectionOverride] = useState<CorrectionSide | null>(null);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [modalSmoothing, setModalSmoothing] = useState<SmoothingLevel>('medium');
  const [modalIntensity, setModalIntensity] = useState(1.0);
  const [reapplying, setReapplying] = useState(false);
  // Source dims captured at analysis time so re-apply works even when clip is deselected
  const [analysisSrcDims, setAnalysisSrcDims] = useState<{ w: number; h: number } | null>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  // Use primarySelectedClipId so linked audio clips don't block resolution
  const selectedClipId = useMemo(() => {
    if (primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)) return primarySelectedClipId;
    return selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
  }, [primarySelectedClipId, selectedClipIds]);

  const selectedClip = useMemo(
    () => (selectedClipId ? clips.find(c => c.id === selectedClipId) ?? null : null),
    [selectedClipId, clips]
  );

  const mediaFile = useMemo(() => {
    if (!selectedClip) return null;
    const mfId = selectedClip.mediaFileId ?? selectedClip.source?.mediaFileId;
    if (!mfId) return null;
    return files.find(f => f.id === mfId) ?? null;
  }, [selectedClip, files]);

  const isVideoFile = mediaFile?.type === 'video';
  const srcW = mediaFile?.width ?? 1920;
  const srcH = mediaFile?.height ?? 1080;
  const clipDuration = selectedClip ? (selectedClip.outPoint - selectedClip.inPoint) : 0;

  // Recompute crop path when ratio or smoothing change (if analysis available)
  const recomputedCropPath = useMemo(() => {
    if (!analysis) return null;
    return buildCropPath(analysis, srcW, srcH, targetRatio, smoothing);
  }, [analysis, srcW, srcH, targetRatio, smoothing]);

  // Keep cropPath state in sync when recomputed
  const effectiveCropPath = recomputedCropPath ?? cropPath;

  // ── Analyze ────────────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!mediaFile || !isVideoFile) return;
    setError(null);
    setAnalyzing(true);
    setProgress(0);
    setAnalysis(null);
    setCropPath(null);
    setAppliedClipId(null);
    setCorrectionOverride(null);
    setAnalysisSrcDims(null);

    try {
      const result = await analyzeClipForReframe(mediaFile.id, pct => setProgress(pct));
      setAnalysis(result);
      setAnalysisSrcDims({ w: srcW, h: srcH });
      const path = buildCropPath(result, srcW, srcH, targetRatio, smoothing);
      setCropPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }, [mediaFile, isVideoFile, srcW, srcH, targetRatio, smoothing]);

  // ── Quick correction (insert/replace keyframe at playhead) ─────────────────
  const handleCorrection = useCallback((side: CorrectionSide) => {
    if (!effectiveCropPath || !selectedClipId || !selectedClip) return;
    setCorrectionOverride(side);

    // Compute override positionX in UV space
    const { w: compW, h: compH } = TARGET_DIMS[targetRatio];
    const scale = (srcW / srcH) / (compW / compH);
    const maxPan = Math.max(0, 0.5 - 1 / (2 * scale));

    let overrideX: number;
    if (side === 'left')  overrideX = maxPan;   // pan left (positive UV offset)
    else if (side === 'right') overrideX = -maxPan; // pan right (negative UV offset)
    else overrideX = 0;

    // Time relative to clip
    const clipLocalTime = Math.max(
      0,
      Math.min(playheadPosition - selectedClip.startTime + selectedClip.inPoint, selectedClip.outPoint)
    );

    // Deduplicate: remove any existing keyframe on position.x within 0.05s of the playhead
    const DEDUP_THRESHOLD = 0.05;
    const ts = useTimelineStore.getState();
    const clipKfs = ts.clipKeyframes.get(selectedClipId) ?? [];
    const duplicates = clipKfs.filter(
      kf =>
        kf.property === 'position.x' &&
        Math.abs(kf.time - clipLocalTime) < DEDUP_THRESHOLD
    );
    for (const dup of duplicates) {
      ts.removeKeyframe(dup.id);
    }

    useTimelineStore.getState().addKeyframe(
      selectedClipId,
      'position.x',
      overrideX,
      clipLocalTime,
      'ease-in-out'
    );
  }, [effectiveCropPath, selectedClipId, selectedClip, targetRatio, srcW, srcH, playheadPosition]);

  // ── Apply: write scale + position keyframes directly onto the selected clip ──
  const handleApply = useCallback(() => {
    if (!effectiveCropPath || !selectedClipId) return;
    setError(null);
    setApplying(true);

    try {
      const ts = useTimelineStore.getState();

      // Remove any existing position.x keyframes from a previous apply
      const existing = (ts.clipKeyframes.get(selectedClipId) ?? []).filter(
        kf => kf.property === 'position.x'
      );
      for (const kf of existing) ts.removeKeyframe(kf.id);

      // Set scale so the source fills the output height for the target ratio
      ts.updateClipTransform(selectedClipId, {
        scale: { x: effectiveCropPath.scale, y: effectiveCropPath.scale },
      });

      // Write position.x keyframes
      for (const kf of effectiveCropPath.keyframes) {
        useTimelineStore.getState().addKeyframe(
          selectedClipId, 'position.x', kf.positionX, kf.time, kf.easing
        );
      }

      setAppliedClipId(selectedClipId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [effectiveCropPath, selectedClipId]);

  // ── Open adjustment modal ──────────────────────────────────────────────────
  const handleOpenAdjustModal = useCallback(() => {
    setModalSmoothing(smoothing);
    setModalIntensity(1.0);
    setShowAdjustModal(true);
  }, [smoothing]);

  // ── Re-apply keyframes with new smoothing + intensity ─────────────────────
  const handleReapply = useCallback(() => {
    if (!appliedClipId || !analysis || !analysisSrcDims) return;
    setReapplying(true);

    try {
      const newPath = buildCropPath(
        analysis, analysisSrcDims.w, analysisSrcDims.h,
        targetRatio, modalSmoothing, modalIntensity
      );

      const ts = useTimelineStore.getState();

      // Remove previous position.x keyframes on the clip
      const existing = (ts.clipKeyframes.get(appliedClipId) ?? []).filter(
        kf => kf.property === 'position.x'
      );
      for (const kf of existing) ts.removeKeyframe(kf.id);

      // Update scale in case targetRatio changed since initial apply
      ts.updateClipTransform(appliedClipId, {
        scale: { x: newPath.scale, y: newPath.scale },
      });

      // Write new keyframes
      for (const kf of newPath.keyframes) {
        useTimelineStore.getState().addKeyframe(
          appliedClipId, 'position.x', kf.positionX, kf.time, kf.easing
        );
      }

      // Sync panel preview with what was just applied
      setCropPath(newPath);
      setSmoothing(modalSmoothing);
      setShowAdjustModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReapplying(false);
    }
  }, [appliedClipId, analysis, analysisSrcDims, targetRatio, modalSmoothing, modalIntensity]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const canAnalyze = isVideoFile && !analyzing;
  const hasResult = effectiveCropPath !== null && analysis !== null;

  // Current playhead time relative to clip
  const clipLocalTime = selectedClip
    ? Math.max(0, playheadPosition - selectedClip.startTime + selectedClip.inPoint)
    : 0;

  return (
    <div className="auto-reframe-panel">
      {/* ── Target ratio ── */}
      <div>
        <div className="arp-section-label">Hedef Oran</div>
        <div className="arp-pills">
          {RATIO_LABELS.map(r => (
            <button
              key={r.value}
              className={`arp-pill${targetRatio === r.value ? ' active' : ''}`}
              onClick={() => setTargetRatio(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Smoothing ── */}
      <div>
        <div className="arp-section-label">Yumuşatma</div>
        <div className="arp-pills">
          {SMOOTHING_LABELS.map(s => (
            <button
              key={s.value}
              className={`arp-pill${smoothing === s.value ? ' active' : ''}`}
              onClick={() => setSmoothing(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Analyze button ── */}
      <div>
        <button
          className="arp-analyze-btn"
          disabled={!canAnalyze}
          onClick={handleAnalyze}
        >
          {analyzing ? `Analiz Ediliyor… %${progress}` : 'Analiz Et'}
        </button>
        {!selectedClip && (
          <div className="arp-hint">Önce bir video klibi seçin</div>
        )}
        {selectedClip && !isVideoFile && (
          <div className="arp-hint">Yalnızca video klipleri desteklenir</div>
        )}
        {selectedClip && isVideoFile && !analyzing && !hasResult && (() => {
          const frameCount = Math.ceil((clipDuration * 1000) / 500);
          const estimatedSec = Math.round(frameCount * 0.033);
          return (
            <div className="arp-hint">~{estimatedSec}s · {frameCount} frame</div>
          );
        })()}
      </div>

      {/* ── Progress bar ── */}
      {analyzing && (
        <div className="arp-progress-wrap">
          <div className="arp-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}

      {/* ── Error ── */}
      {error && <div className="arp-error">{error}</div>}

      {/* ── Preview + crop path ── */}
      {hasResult && effectiveCropPath && (
        <>
          {/* Split preview: 16:9 placeholder with crop window + narrow result box */}
          <div>
            <div className="arp-section-label">Önizleme</div>
            <div className="arp-preview-row">
              <div className="arp-preview-orig">
                <div className="arp-preview-orig-label">Kaynak (16:9)</div>
                <div className="arp-preview-orig-frame">
                  <CropOverlay
                    cropPath={effectiveCropPath}
                    currentTime={clipLocalTime}
                    sourceWidth={srcW}
                    sourceHeight={srcH}
                    targetRatio={targetRatio}
                  />
                </div>
              </div>
              <div className="arp-preview-result-wrap">
                <div className="arp-preview-result-label">Sonuç</div>
                <div
                  className="arp-preview-result-frame"
                  style={{
                    aspectRatio: targetRatio === '9:16' ? '9/16' : targetRatio === '1:1' ? '1/1' : '4/5',
                  }}
                />
              </div>
            </div>
          </div>

          {/* SVG crop path timeline */}
          <div>
            <div className="arp-section-label">Kırpma Yolu</div>
            <div className="arp-crop-path">
              <CropPathSvg cropPath={effectiveCropPath} duration={clipDuration || (mediaFile?.duration ?? 60)} />
            </div>
            <div className="arp-time-labels">
              <span>0:00</span>
              <span>
                {(() => {
                  const d = clipDuration || (mediaFile?.duration ?? 0);
                  const m = Math.floor(d / 60);
                  const s = Math.floor(d % 60);
                  return `${m}:${s.toString().padStart(2, '0')}`;
                })()}
              </span>
            </div>
          </div>

          {/* Quick correction buttons */}
          <div className="arp-correction">
            <div className="arp-correction-label">
              Anlık Düzeltme
              {' — '}
              <span className="arp-correction-source">
                {analysis.frames[0]?.attentionSource === 'face' ? 'Yüz Algılama' : 'Hareket Analizi'}
              </span>
            </div>
            <div className="arp-correction-buttons">
              {(['left', 'center', 'right'] as CorrectionSide[]).map(side => (
                <button
                  key={side}
                  className={correctionOverride === side ? 'active' : ''}
                  onClick={() => handleCorrection(side)}
                >
                  {side === 'left' ? 'Sol' : side === 'center' ? 'Orta' : 'Sağ'}
                </button>
              ))}
            </div>
          </div>

          {/* Apply button */}
          <button
            className="arp-apply-btn"
            disabled={applying || !selectedClipId}
            onClick={handleApply}
          >
            {applying ? 'Uygulanıyor…' : 'Kadrajı Uygula'}
          </button>

          {/* Post-apply: adjust settings */}
          {appliedClipId && (
            <div className="arp-post-create-row">
              <button className="arp-adjust-btn" onClick={handleOpenAdjustModal}>
                Ayarları Düzenle
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Adjustment modal ── */}
      {showAdjustModal && (
        <div className="arp-modal-overlay" onClick={() => setShowAdjustModal(false)}>
          <div className="arp-modal" onClick={e => e.stopPropagation()}>
            <div className="arp-modal-title">Kadraj Ayarları</div>

            <div className="arp-section-label">Yumuşatma</div>
            <div className="arp-pills">
              {SMOOTHING_LABELS.map(s => (
                <button
                  key={s.value}
                  className={`arp-pill${modalSmoothing === s.value ? ' active' : ''}`}
                  onClick={() => setModalSmoothing(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="arp-section-label" style={{ marginTop: 12 }}>
              Hareket Sınırı — %{Math.round(modalIntensity * 100)}
            </div>
            <input
              type="range"
              className="arp-intensity-slider"
              min={0}
              max={100}
              value={Math.round(modalIntensity * 100)}
              onChange={e => setModalIntensity(Number(e.target.value) / 100)}
            />
            <div className="arp-intensity-labels">
              <span>Sabit</span>
              <span>Tam Hareket</span>
            </div>

            <div className="arp-modal-actions">
              <button
                className="arp-apply-btn"
                disabled={reapplying}
                onClick={handleReapply}
              >
                {reapplying ? 'Uygulanıyor…' : 'Uygula'}
              </button>
              <button
                className="arp-cancel-btn"
                disabled={reapplying}
                onClick={() => setShowAdjustModal(false)}
              >
                İptal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AutoReframePanel;
