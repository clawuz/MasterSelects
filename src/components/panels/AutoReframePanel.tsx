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
  { value: 'low',    label: 'Düşük'  },
  { value: 'medium', label: 'Orta'   },
  { value: 'high',   label: 'Yüksek' },
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
  const { w: targetW, h: targetH } = TARGET_DIMS[targetRatio];
  const scale = targetH / sourceHeight;
  const scaledSrcW = sourceWidth * scale;
  const cropW = targetW; // in scaled space

  // positionX is offset from center in scaled pixels
  const posX = interpolateCropX(cropPath, currentTime);
  // Center offset → left edge in scaled space
  const leftScaled = scaledSrcW / 2 + posX - cropW / 2;

  // Map to percentage of source width
  const leftPct = (leftScaled / scaledSrcW) * 100;
  const widthPct = (cropW / scaledSrcW) * 100;

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
  const { selectedClipIds, clips, playheadPosition } = useTimelineStore(
    useShallow(s => ({
      selectedClipIds: s.selectedClipIds,
      clips: s.clips,
      playheadPosition: s.playheadPosition,
    }))
  );

  const { files, compositions } = useMediaStore(
    useShallow(s => ({
      files: s.files,
      compositions: s.compositions,
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
  const [createdCompId, setCreatedCompId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [correctionOverride, setCorrectionOverride] = useState<CorrectionSide | null>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  const selectedClipId = useMemo(() => {
    const ids = Array.from(selectedClipIds);
    return ids.length === 1 ? ids[0] : null;
  }, [selectedClipIds]);

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
    setCreatedCompId(null);
    setCorrectionOverride(null);

    try {
      const result = await analyzeClipForReframe(mediaFile.id, pct => setProgress(pct));
      setAnalysis(result);
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

    // Compute override positionX based on side
    const { w: targetW, h: targetH } = TARGET_DIMS[targetRatio];
    const scale = targetH / srcH;
    const scaledSrcW = srcW * scale;
    const maxOffset = (scaledSrcW - targetW) / 2;

    let overrideX: number;
    if (side === 'left')  overrideX = -maxOffset;
    else if (side === 'right') overrideX = maxOffset;
    else overrideX = 0;

    // Time relative to clip
    const clipLocalTime = Math.max(
      0,
      Math.min(playheadPosition - selectedClip.startTime + selectedClip.inPoint, selectedClip.outPoint)
    );

    useTimelineStore.getState().addKeyframe(
      selectedClipId,
      'position.x',
      overrideX,
      clipLocalTime,
      'ease-in-out'
    );
  }, [effectiveCropPath, selectedClipId, selectedClip, targetRatio, srcW, srcH, playheadPosition]);

  // ── Apply: create composition with keyframes ───────────────────────────────
  const handleApply = useCallback(async () => {
    if (!effectiveCropPath || !selectedClip || !mediaFile) return;
    setError(null);
    setApplying(true);

    try {
      const mediaState = useMediaStore.getState();
      const previousCompId = mediaState.activeCompositionId;

      // 1. Create new composition sized to target ratio
      const { w: compW, h: compH } = TARGET_DIMS[targetRatio];
      const compName = `${mediaFile.name.replace(/\.[^.]+$/, '')} – Reframe ${targetRatio}`;
      const comp = mediaState.createComposition(compName, {
        width: compW,
        height: compH,
        duration: clipDuration || mediaFile.duration || 60,
      });

      // 2. Open and activate the new composition (skip animation for speed)
      useMediaStore.setState(s => ({
        openCompositionIds: s.openCompositionIds.includes(comp.id)
          ? s.openCompositionIds
          : [...s.openCompositionIds, comp.id],
      }));
      mediaState.setActiveComposition(comp.id);

      // Wait for timeline to reload into the new composition
      await new Promise<void>(resolve => setTimeout(resolve, 200));

      // 3. Add source clip to composition timeline
      const ts = useTimelineStore.getState();
      const videoTrack = ts.tracks.find(t => t.type === 'video');
      if (!videoTrack) throw new Error('No video track found in new composition');

      if (mediaFile.file) {
        await ts.addClip(
          videoTrack.id,
          mediaFile.file,
          0,
          mediaFile.duration ?? clipDuration,
          mediaFile.id
        );
      }

      // 4. Find the added clip (most recently added on the video track)
      const addedClip = useTimelineStore
        .getState()
        .clips
        .filter(c => c.trackId === videoTrack.id)
        .sort((a, b) => b.startTime - a.startTime)[0];

      if (addedClip) {
        // 5. Set scale so source fills the composition height
        useTimelineStore.getState().updateClipTransform(addedClip.id, {
          scale: { x: effectiveCropPath.scale, y: effectiveCropPath.scale },
        });

        // 6. Write position.x keyframes
        for (const kf of effectiveCropPath.keyframes) {
          useTimelineStore.getState().addKeyframe(
            addedClip.id,
            'position.x',
            kf.positionX,
            kf.time,
            kf.easing
          );
        }
      }

      // 7. Serialize timeline state back into the composition
      const timelineData = useTimelineStore.getState().getSerializableState();
      useMediaStore.setState(s => ({
        compositions: s.compositions.map(c =>
          c.id === comp.id ? { ...c, timelineData } : c
        ),
      }));

      // 8. Restore previous composition
      if (previousCompId && previousCompId !== comp.id) {
        useMediaStore.getState().setActiveComposition(previousCompId);
        await new Promise<void>(resolve => setTimeout(resolve, 60));
      }

      // 9. Add comp clip to main timeline at the selected clip's position
      const mainTs = useTimelineStore.getState();
      const mainVideoTrack = mainTs.tracks.find(t => t.type === 'video');
      if (mainVideoTrack) {
        mainTs.addCompClip(mainVideoTrack.id, comp, selectedClip.startTime);
      }

      setCreatedCompId(comp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }, [effectiveCropPath, selectedClip, mediaFile, targetRatio, clipDuration]);

  // ── Open created composition ───────────────────────────────────────────────
  const handleOpenComp = useCallback(() => {
    if (!createdCompId) return;
    useMediaStore.getState().openCompositionTab(createdCompId);
  }, [createdCompId]);

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
            disabled={applying || !selectedClip || !mediaFile?.file}
            onClick={handleApply}
          >
            {applying ? 'Oluşturuluyor…' : 'Kompozisyon Oluştur'}
          </button>

          {/* Open created composition */}
          {createdCompId && (
            <button className="arp-open-comp-btn" onClick={handleOpenComp}>
              Kompozisyonda Aç —{' '}
              {compositions.find(c => c.id === createdCompId)?.name ?? createdCompId}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default AutoReframePanel;
