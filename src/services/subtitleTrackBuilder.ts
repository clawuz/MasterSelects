import type { SrtEntry } from './nextjsApi';
import { useTimelineStore } from '../stores/timeline';
import { useSettingsStore } from '../stores/settingsStore';
import { Logger } from './logger';

const log = Logger.create('SubtitleTrackBuilder');

const SUBTITLE_TRACK_NAME = 'Subtitles';

interface SubtitleSafeArea {
  paddingBottom: number;
  paddingX: number;
}

function getSubtitleSafeArea(): SubtitleSafeArea {
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

function buildSubtitleTextProps() {
  const { paddingBottom, paddingX } = getSubtitleSafeArea();
  return {
    fontFamily: 'Roboto',
    fontSize: 64,
    fontWeight: 700,
    color: '#ffffff',
    textAlign: 'center' as const,
    verticalAlign: 'bottom' as const,
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

export async function addSubtitlesToTimeline(entries: SrtEntry[]): Promise<void> {
  if (entries.length === 0) return;

  const store = useTimelineStore.getState();

  let trackId = store.tracks.find(t => t.type === 'video' && t.name === SUBTITLE_TRACK_NAME)?.id;
  if (!trackId) {
    trackId = store.addTrack('video');
    store.renameTrack(trackId, SUBTITLE_TRACK_NAME);
  }

  const subtitleTextProps = buildSubtitleTextProps();
  log.info(`Adding ${entries.length} subtitle clips to track "${SUBTITLE_TRACK_NAME}" (paddingBottom=${subtitleTextProps.paddingBottom}px)`);

  for (const entry of entries) {
    const duration = Math.max(0.1, entry.end - entry.start);
    const clipId = await useTimelineStore.getState().addTextClip(trackId!, entry.start, duration, true);
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
