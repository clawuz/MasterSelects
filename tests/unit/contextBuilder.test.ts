import { describe, it, expect, vi } from 'vitest';
import { buildContext } from '../../src/services/contextBuilder';

vi.mock('../../src/stores/timeline', () => ({
  useTimelineStore: {
    getState: () => ({
      tracks: [{ id: 'track_1', name: 'Main', type: 'video', visible: true, muted: false }],
      clips: [{
        id: 'clip_1', trackId: 'track_1', name: 'intro.mp4',
        startTime: 0, duration: 10, inPoint: 0,
        transcriptStatus: 'ready',
        transcript: Array.from({ length: 120 }, (_, i) => ({ id: `word_${i}`, text: `word${i}`, start: i * 0.5, end: i * 0.5 + 0.4 })),
      }],
      playheadPosition: 2.5,
      duration: 10,
    }),
  },
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: {
    getState: () => ({
      files: [
        { id: 'media_1', name: 'intro.mp4', type: 'video', duration: 30 },
        { id: 'media_2', name: 'logo.png', type: 'image' },
      ],
    }),
  },
}));

describe('buildContext', () => {
  it('includes timeline track and clip info', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.timeline.tracks).toHaveLength(1);
    expect(parsed.timeline.tracks[0].clips[0].id).toBe('clip_1');
  });

  it('includes media library files', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.mediaLibrary).toHaveLength(2);
    expect(parsed.mediaLibrary[0].name).toBe('intro.mp4');
  });

  it('truncates long transcripts to 500 chars', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    const clip = parsed.timeline.tracks[0].clips[0];
    expect(typeof clip.transcript).toBe('string');
    // Truncation adds ellipsis, so max is 501 chars (500 + '…')
    expect(clip.transcript.length).toBeLessThanOrEqual(501);
    expect(clip.transcript.endsWith('…')).toBe(true);
  });

  it('includes playhead position and total duration', () => {
    const ctx = buildContext();
    const parsed = JSON.parse(ctx);
    expect(parsed.timeline.playheadPosition).toBe(2.5);
    expect(parsed.timeline.duration).toBe(10);
  });
});
