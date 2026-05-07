import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';

const MAX_TRANSCRIPT_CHARS = 200;
const MAX_MEDIA_ITEMS = 50;

interface ContextClip {
  id: string;
  name: string;
  trackId: string;
  startTime: number;
  endTime: number;
  duration: number;
  inPoint: number;
  hasTranscript: boolean;
  transcript?: string;
}

interface ContextTrack {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  muted: boolean;
  clips: ContextClip[];
}

interface ContextMediaItem {
  id: string;
  name: string;
  type: string;
  duration?: number;
}

interface Context {
  timeline: {
    playheadPosition: number;
    duration: number;
    tracks: ContextTrack[];
  };
  mediaLibrary: ContextMediaItem[];
}

function buildTranscriptText(clip: { transcript?: Array<{ text: string }> }): string | undefined {
  if (!clip.transcript?.length) return undefined;
  const full = clip.transcript.map((w) => w.text).join(' ');
  return full.length > MAX_TRANSCRIPT_CHARS ? full.slice(0, MAX_TRANSCRIPT_CHARS) + '…' : full;
}

export function buildContext(): string {
  const timeline = useTimelineStore.getState();
  const media = useMediaStore.getState();

  const tracks: ContextTrack[] = timeline.tracks.map((track) => {
    const trackClips = timeline.clips.filter((c) => c.trackId === track.id);
    return {
      id: track.id,
      name: track.name,
      type: track.type,
      visible: track.visible,
      muted: track.muted,
      clips: trackClips.map((clip) => {
        const hasTranscript =
          clip.transcriptStatus === 'ready' || (clip.transcript?.length ?? 0) > 0;
        const contextClip: ContextClip = {
          id: clip.id,
          name: clip.name,
          trackId: clip.trackId,
          startTime: clip.startTime,
          endTime: clip.startTime + clip.duration,
          duration: clip.duration,
          inPoint: clip.inPoint ?? 0,
          hasTranscript,
        };
        if (hasTranscript) {
          contextClip.transcript = buildTranscriptText(clip);
        }
        return contextClip;
      }),
    };
  });

  const mediaLibrary: ContextMediaItem[] = media.files
    .slice(0, MAX_MEDIA_ITEMS)
    .map((file) => ({
      id: file.id,
      name: file.name,
      type: file.type,
      ...(file.duration !== undefined && { duration: file.duration }),
    }));

  const context: Context = {
    timeline: {
      playheadPosition: timeline.playheadPosition,
      duration: timeline.duration,
      tracks,
    },
    mediaLibrary,
  };

  return JSON.stringify(context);
}
