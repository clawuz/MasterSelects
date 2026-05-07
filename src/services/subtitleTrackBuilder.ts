import type { SrtEntry } from './nextjsApi';
import { useTimelineStore } from '../stores/timeline';
import { useSettingsStore } from '../stores/settingsStore';
import { Logger } from './logger';

const log = Logger.create('SubtitleTrackBuilder');

const SUBTITLE_TRACK_NAME = 'Subtitles';

export interface SubtitlePositionPreset {
  id: string;
  label: string;
  paddingBottom: number;
  paddingX: number;
  fontSize: number;
  verticalAlign: 'top' | 'middle' | 'bottom';
}

export const SUBTITLE_PRESETS: SubtitlePositionPreset[] = [
  { id: 'auto',    label: 'Otomatik',       paddingBottom: -1,  paddingX: -1,  fontSize: 64, verticalAlign: 'bottom' },
  { id: 'tiktok',  label: 'TikTok / Reels', paddingBottom: 280, paddingX: 160, fontSize: 58, verticalAlign: 'bottom' },
  { id: '16x9',    label: 'YouTube (16:9)', paddingBottom: 54,  paddingX: 96,  fontSize: 64, verticalAlign: 'bottom' },
  { id: '1x1',     label: 'Kare (1:1)',     paddingBottom: 108, paddingX: 96,  fontSize: 60, verticalAlign: 'bottom' },
  { id: '4x5',     label: '4:5',            paddingBottom: 130, paddingX: 96,  fontSize: 60, verticalAlign: 'bottom' },
  { id: 'center',  label: 'Ortada',         paddingBottom: 0,   paddingX: 96,  fontSize: 64, verticalAlign: 'middle' },
  { id: 'custom',  label: 'Özel',           paddingBottom: 100, paddingX: 96,  fontSize: 64, verticalAlign: 'bottom' },
];

function getAutoSafeArea(): { paddingBottom: number; paddingX: number } {
  const { width, height } = useSettingsStore.getState().outputResolution;
  const ar = width / height;
  if (ar < 0.8) {
    return { paddingBottom: Math.round(1080 * 0.15), paddingX: Math.round(1920 * 0.05) };
  } else if (ar > 1.4) {
    return { paddingBottom: Math.round(1080 * 0.05), paddingX: Math.round(1920 * 0.05) };
  } else {
    return { paddingBottom: Math.round(1080 * 0.10), paddingX: Math.round(1920 * 0.05) };
  }
}

function buildSubtitleTextProps(preset?: SubtitlePositionPreset) {
  let paddingBottom: number;
  let paddingX: number;
  let fontSize = 64;
  let verticalAlign: 'top' | 'middle' | 'bottom' = 'bottom';

  if (preset && preset.id !== 'auto') {
    paddingBottom = preset.paddingBottom;
    paddingX = preset.paddingX;
    fontSize = preset.fontSize;
    verticalAlign = preset.verticalAlign;
  } else {
    const safe = getAutoSafeArea();
    paddingBottom = safe.paddingBottom;
    paddingX = safe.paddingX;
  }

  return {
    fontFamily: 'Roboto',
    fontSize,
    fontWeight: 700,
    color: '#ffffff',
    textAlign: 'center' as const,
    verticalAlign,
    paddingBottom,
    paddingX,
    strokeEnabled: true,
    strokeColor: '#000000',
    strokeWidth: 3,
    shadowEnabled: true,
    shadowColor: 'rgba(0,0,0,0.8)',
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    shadowBlur: 6,
  };
}

export async function addSubtitlesToTimeline(entries: SrtEntry[], timelineOffset: number = 0, preset?: SubtitlePositionPreset): Promise<void> {
  if (entries.length === 0) return;

  const store = useTimelineStore.getState();

  let trackId = store.tracks.find(t => t.type === 'video' && t.name === SUBTITLE_TRACK_NAME)?.id;
  if (!trackId) {
    trackId = store.addTrack('video');
    store.renameTrack(trackId, SUBTITLE_TRACK_NAME);
  }

  const subtitleTextProps = buildSubtitleTextProps(preset);
  log.info(`Adding ${entries.length} subtitle clips to track "${SUBTITLE_TRACK_NAME}" (paddingBottom=${subtitleTextProps.paddingBottom}px, offset=${timelineOffset}s, preset=${preset?.id ?? 'auto'})`);

  for (const entry of entries) {
    const duration = Math.max(0.1, entry.end - entry.start);
    const startTime = Math.max(0, entry.start + timelineOffset);
    const clipId = await useTimelineStore.getState().addTextClip(trackId!, startTime, duration, true);
    if (!clipId) {
      log.warn('Failed to create text clip for entry', entry);
      continue;
    }
    useTimelineStore.getState().updateTextProperties(clipId, {
      ...subtitleTextProps,
      text: entry.text,
    });
  }

  log.info('Subtitles added to timeline');
}
