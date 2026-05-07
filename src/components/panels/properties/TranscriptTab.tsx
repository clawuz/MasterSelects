import { useState, useCallback, useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { TranscriptWord } from '../../../types';
import type { SrtEntry } from '../../../services/nextjsApi';

const LANGUAGES = [
  { code: 'auto', name: 'Auto-Detect' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

function formatTimeShort(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function groupWordsToSubtitles(words: TranscriptWord[]): SrtEntry[] {
  if (!words.length) return [];
  const subtitles: SrtEntry[] = [];
  let group: TranscriptWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    group.push(word);
    const text = group.map(w => w.text).join(' ');
    const duration = word.end - group[0].start;
    const gap = next ? next.start - word.end : Infinity;

    if (duration >= 6 || text.length > 60 || gap > 0.5 || !next) {
      subtitles.push({ start: group[0].start, end: word.end, text });
      group = [];
    }
  }
  return subtitles;
}

function secondsToSrtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function wordsToSrt(words: TranscriptWord[]): string {
  const subtitles = groupWordsToSubtitles(words);
  return subtitles
    .map((s, i) => `${i + 1}\n${secondsToSrtTime(s.start)} --> ${secondsToSrtTime(s.end)}\n${s.text}`)
    .join('\n\n');
}

interface TranscriptTabProps {
  clipId: string;
  transcript: TranscriptWord[];
  transcriptStatus: 'none' | 'transcribing' | 'ready' | 'error';
  transcriptProgress: number;
  clipStartTime: number;
  inPoint: number;
  outPoint: number;
}

export function TranscriptTab({ clipId, transcript, transcriptStatus, transcriptProgress, clipStartTime, inPoint, outPoint }: TranscriptTabProps) {
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const { setPlayheadPosition } = useTimelineStore.getState();
  const [language, setLanguage] = useState(() => localStorage.getItem('transcriptLanguage') || 'tr');
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const clipLocalTime = playheadPosition - clipStartTime + inPoint;

  const currentWordId = useMemo(() => {
    if (clipLocalTime < 0 || transcript.length === 0) return null;
    for (const word of transcript) {
      if (clipLocalTime >= word.start && clipLocalTime <= word.end) return word.id;
    }
    return null;
  }, [transcript, clipLocalTime]);

  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return transcript;
    const query = searchQuery.toLowerCase();
    return transcript.filter(w => w.text.toLowerCase().includes(query));
  }, [transcript, searchQuery]);

  const clipCoverage = useMemo(() => {
    if (!transcript.length) return 0;
    const clipDuration = outPoint - inPoint;
    if (clipDuration <= 0) return 0;
    const clip = useTimelineStore.getState().clips.find(c => c.id === clipId);
    const mediaFileId = clip?.source?.mediaFileId || clip?.mediaFileId;
    const mediaFile = mediaFileId ? useMediaStore.getState().files.find(f => f.id === mediaFileId) : null;
    const ranges = mediaFile?.transcribedRanges ?? [];
    if (ranges.length > 0) {
      let covered = 0;
      for (const [rs, re] of ranges) {
        const s = Math.max(rs, inPoint);
        const e = Math.min(re, outPoint);
        if (s < e) covered += e - s;
      }
      return Math.min(1, covered / clipDuration);
    }
    const wordsInRange = transcript.filter(w => w.end > inPoint && w.start < outPoint);
    if (!wordsInRange.length) return 0;
    const minStart = Math.max(inPoint, Math.min(...wordsInRange.map(w => w.start)));
    const maxEnd = Math.min(outPoint, Math.max(...wordsInRange.map(w => w.end)));
    return Math.min(1, (maxEnd - minStart) / clipDuration);
  }, [transcript, inPoint, outPoint, clipId]);

  const isPartial = transcriptStatus === 'ready' && clipCoverage > 0 && clipCoverage < 0.98;

  const handleWordClick = useCallback((sourceTime: number) => {
    const timelinePosition = clipStartTime + (sourceTime - inPoint);
    setPlayheadPosition(Math.max(0, timelinePosition));
  }, [clipStartTime, inPoint, setPlayheadPosition]);

  const handleWordEditSave = useCallback((wordId: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const store = useTimelineStore.getState();
    const updatedClips = store.clips.map(clip => {
      if (clip.id !== clipId) return clip;
      return {
        ...clip,
        transcript: (clip.transcript || []).map(w => w.id === wordId ? { ...w, text: trimmed } : w),
      };
    });
    useTimelineStore.setState({ clips: updatedClips });
    setEditingWordId(null);
  }, [clipId]);

  const handleAddSubtitles = useCallback(async () => {
    if (!transcript.length) return;
    const { addSubtitlesToTimeline } = await import('../../../services/subtitleTrackBuilder');
    // Convert source-relative word times to timeline-absolute positions
    const timelineOffset = clipStartTime - inPoint;
    await addSubtitlesToTimeline(groupWordsToSubtitles(transcript), timelineOffset);
  }, [transcript, clipStartTime, inPoint]);

  const handleDownloadSrt = useCallback(() => {
    if (!transcript.length) return;
    const srt = wordsToSrt(transcript);
    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript.srt';
    a.click();
    URL.revokeObjectURL(url);
  }, [transcript]);

  const handleTranscribe = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language);
  }, [clipId, language]);

  const handleContinue = useCallback(async () => {
    const { transcribeClip } = await import('../../../services/clipTranscriber');
    await transcribeClip(clipId, language, { continueMode: true });
  }, [clipId, language]);

  const handleCancel = useCallback(async () => {
    const { cancelTranscription } = await import('../../../services/clipTranscriber');
    cancelTranscription();
  }, []);

  const handleDelete = useCallback(async () => {
    const { clearClipTranscript } = await import('../../../services/clipTranscriber');
    clearClipTranscript(clipId);
    setIsEditing(false);
  }, [clipId]);

  const handleLanguageChange = useCallback((newLanguage: string) => {
    setLanguage(newLanguage);
    localStorage.setItem('transcriptLanguage', newLanguage);
  }, []);

  return (
    <div className="properties-tab-content transcript-tab">
      {/* Language and actions */}
      <div className="properties-section">
        <div className="control-row">
          <label>Language</label>
          <select value={language} onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={transcriptStatus === 'transcribing'}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </div>
        <div className="transcript-tab-actions">
          {transcriptStatus !== 'ready' && transcriptStatus !== 'transcribing' && (
            <button className="btn btn-sm" onClick={handleTranscribe}>Transcribe</button>
          )}
          {transcriptStatus === 'transcribing' && (
            <button className="btn btn-sm btn-danger" onClick={handleCancel}>Cancel</button>
          )}
          {transcriptStatus === 'ready' && (
            <>
              {isPartial && (
                <button className="btn btn-sm btn-accent" onClick={handleContinue}>Continue ({Math.round(clipCoverage * 100)}%)</button>
              )}
              <button className="btn btn-sm" onClick={handleTranscribe}>Re-transcribe</button>
              <button className="btn btn-sm btn-danger" onClick={handleDelete}>Delete</button>
            </>
          )}
        </div>

        {/* Subtitle / Edit / SRT actions */}
        {transcriptStatus === 'ready' && transcript.length > 0 && (
          <div className="transcript-tab-actions" style={{ marginTop: 'var(--sp-1)' }}>
            <button className="btn btn-sm btn-accent" onClick={handleAddSubtitles} title="Transkripti altyazı olarak timeline'a ekle">
              + Altyazı Ekle
            </button>
            <button
              className={`btn btn-sm ${isEditing ? 'btn-accent' : ''}`}
              onClick={() => { setIsEditing(e => !e); setEditingWordId(null); }}
              title="Transcript kelimelerini düzenle"
            >
              {isEditing ? 'Düzenlemeyi Bitir' : 'Düzenle'}
            </button>
            <button className="btn btn-sm" onClick={handleDownloadSrt} title="SRT dosyası olarak indir">
              SRT İndir
            </button>
          </div>
        )}

        {/* Coverage bar */}
        {transcriptStatus === 'ready' && clipCoverage > 0 && (
          <div className="coverage-bar" style={{ marginTop: '4px' }}>
            <div className="coverage-bar-bg">
              <div className="coverage-bar-fill transcript-fill" style={{ width: `${Math.round(clipCoverage * 100)}%` }} />
            </div>
            <span className="coverage-bar-text">{Math.round(clipCoverage * 100)}% transcribed</span>
          </div>
        )}
      </div>

      {/* Progress */}
      {transcriptStatus === 'transcribing' && (
        <div className="properties-section">
          <div className="transcript-progress-bar">
            <div className="transcript-progress-fill" style={{ width: `${transcriptProgress}%` }} />
          </div>
          <span className="transcript-progress-text">{transcriptProgress}%</span>
        </div>
      )}

      {/* Search */}
      {transcript.length > 0 && (
        <div className="properties-section">
          <input type="text" placeholder="Search transcript..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)} className="transcript-search-input" />
        </div>
      )}

      {/* Edit mode hint */}
      {isEditing && (
        <div className="properties-section">
          <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)' }}>
            Düzenleme modu: kelimeye tıklayın, düzeltin, Enter'a basın.
          </span>
        </div>
      )}

      {/* Transcript content */}
      <div className="transcript-content-embedded" ref={containerRef}>
        {transcript.length === 0 ? (
          <div className="transcript-empty-state">
            {transcriptStatus === 'transcribing' ? 'Transcribing...' : 'No transcript. Click "Transcribe" to generate.'}
          </div>
        ) : (
          <div className="transcript-words-flow">
            {filteredWords.map(word => {
              if (isEditing && editingWordId === word.id) {
                return (
                  <input
                    key={word.id}
                    autoFocus
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={() => { handleWordEditSave(word.id, editingText); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); handleWordEditSave(word.id, editingText); }
                      if (e.key === 'Escape') setEditingWordId(null);
                    }}
                    className="transcript-word-edit-input"
                    style={{ width: `${Math.max(editingText.length + 1, 4)}ch` }}
                  />
                );
              }
              return (
                <span
                  key={word.id}
                  className={`transcript-word-inline ${word.id === currentWordId ? 'active' : ''} ${searchQuery && word.text.toLowerCase().includes(searchQuery.toLowerCase()) ? 'highlighted' : ''} ${isEditing ? 'editable' : ''}`}
                  onClick={() => {
                    if (isEditing) {
                      setEditingWordId(word.id);
                      setEditingText(word.text);
                    } else {
                      handleWordClick(word.start);
                    }
                  }}
                  title={isEditing ? 'Düzenlemek için tıklayın' : formatTimeShort(word.start)}
                >
                  {word.text}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Status */}
      {transcriptStatus === 'ready' && (
        <div className="transcript-status-bar">
          {transcript.length} words · {groupWordsToSubtitles(transcript).length} subtitles
        </div>
      )}
    </div>
  );
}
