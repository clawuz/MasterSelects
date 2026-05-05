import type { AppContext, AppRouteHandler } from '../lib/env';

const MODEL = '@cf/openai/whisper';

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperResult {
  text?: string;
  vtt?: string;
  words?: WhisperWord[];
}

function vttTimeToSeconds(t: string): number {
  const parts = t.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function parseVtt(vtt: string): { text: string; start: number; end: number }[] {
  const cues: { text: string; start: number; end: number }[] = [];
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find(l => l.includes('-->'));
    if (!timeLine) continue;
    const [startStr, endStr] = timeLine.split('-->').map(s => s.trim().split(' ')[0]);
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    cues.push({ text, start: vttTimeToSeconds(startStr), end: vttTimeToSeconds(endStr) });
  }
  return cues;
}

function cueToWordSegments(
  cue: { text: string; start: number; end: number },
): { word: string; start: number; end: number }[] {
  const words = cue.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const duration = cue.end - cue.start;
  const step = duration / words.length;
  return words.map((word, i) => ({
    word,
    start: cue.start + i * step,
    end: cue.start + (i + 1) * step,
  }));
}

export const onRequestPost: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const { env, request } = context;

  if (!env.AI) {
    return new Response(JSON.stringify({ error: 'AI binding not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let audioBuffer: ArrayBuffer;
  let language = 'tr';

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    const lang = formData.get('language');
    if (lang && typeof lang === 'string' && lang !== 'auto') language = lang;
    if (!audioFile || typeof audioFile === 'string') {
      return new Response(JSON.stringify({ error: 'audio field missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    audioBuffer = await (audioFile as File).arrayBuffer();
  } else {
    audioBuffer = await request.arrayBuffer();
  }

  const audioArray = [...new Uint8Array(audioBuffer)];

  let raw: WhisperResult;
  try {
    raw = await env.AI.run(MODEL, {
      audio: audioArray,
      language,
    }) as WhisperResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `AI.run failed: ${msg}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let wordSegments: { word: string; start: number; end: number }[] = [];

  if (raw.words && raw.words.length > 0) {
    wordSegments = raw.words;
  } else if (raw.vtt) {
    const cues = parseVtt(raw.vtt);
    for (const cue of cues) {
      wordSegments.push(...cueToWordSegments(cue));
    }
  } else if (raw.text) {
    wordSegments = [{ word: raw.text, start: 0, end: 0 }];
  }

  const subtitles: { startMs: number; endMs: number; text: string }[] = [];
  if (raw.vtt) {
    for (const cue of parseVtt(raw.vtt)) {
      subtitles.push({ startMs: Math.round(cue.start * 1000), endMs: Math.round(cue.end * 1000), text: cue.text });
    }
  } else {
    let chunk: typeof wordSegments = [];
    for (const w of wordSegments) {
      chunk.push(w);
      const chunkDuration = (chunk[chunk.length - 1].end ?? 0) - (chunk[0].start ?? 0);
      if (chunkDuration >= 5 || chunk.length >= 12) {
        subtitles.push({
          startMs: Math.round((chunk[0].start ?? 0) * 1000),
          endMs: Math.round((chunk[chunk.length - 1].end ?? 0) * 1000),
          text: chunk.map(w => w.word).join(' '),
        });
        chunk = [];
      }
    }
    if (chunk.length > 0) {
      subtitles.push({
        startMs: Math.round((chunk[0].start ?? 0) * 1000),
        endMs: Math.round((chunk[chunk.length - 1].end ?? 0) * 1000),
        text: chunk.map(w => w.word).join(' '),
      });
    }
  }

  const result = {
    segments: wordSegments.map(w => ({
      word: w.word,
      startMs: Math.round((w.start ?? 0) * 1000),
      endMs: Math.round((w.end ?? 0) * 1000),
    })),
    subtitles,
  };

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};
