import { getCurrentUser, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler, Env } from '../../lib/env';

interface CloudflareAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface EnvWithAI extends Env {
  AI: CloudflareAI;
}

interface WhisperResult {
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && (
    origin.includes('localhost') ||
    origin.includes('masterselects')
  );
  return allowed ? {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  } : {};
}

function json(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const origin = context.request.headers.get('origin');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  const user = getCurrentUser(context);
  if (!user) {
    return json({ error: 'Unauthorized' }, 401, origin);
  }

  const ai = (context.env as EnvWithAI).AI;
  if (!ai) {
    return json({ error: 'AI binding not available' }, 500, origin);
  }

  let audioData: ArrayBuffer;
  try {
    audioData = await context.request.arrayBuffer();
  } catch {
    return json({ error: 'Failed to read audio data' }, 400, origin);
  }

  if (!audioData || audioData.byteLength === 0) {
    return json({ error: 'Empty audio data' }, 400, origin);
  }

  // CF Workers AI whisper expects PCM16 Float32 array
  // Max chunk: ~10s at 16kHz = 160000 samples to stay within 30s worker timeout
  const CHUNK_SAMPLES = 160_000;
  const float32 = new Float32Array(audioData);
  const allWords: Array<{ word: string; start: number; end: number }> = [];
  let fullText = '';

  const chunkCount = Math.ceil(float32.length / CHUNK_SAMPLES);

  for (let i = 0; i < chunkCount; i++) {
    const chunkStart = i * CHUNK_SAMPLES;
    const chunkEnd = Math.min(chunkStart + CHUNK_SAMPLES, float32.length);
    const chunk = float32.slice(chunkStart, chunkEnd);
    const offsetSec = chunkStart / 16000;

    let result: WhisperResult;
    try {
      result = await ai.run('@cf/openai/whisper', {
        audio: Array.from(chunk),
      }) as WhisperResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: `AI.run failed on chunk ${i}: ${msg}` }, 500, origin);
    }

    if (result.text) {
      fullText += (fullText ? ' ' : '') + result.text.trim();
    }

    if (result.words) {
      for (const w of result.words) {
        allWords.push({
          word: w.word,
          start: w.start + offsetSec,
          end: w.end + offsetSec,
        });
      }
    }
  }

  return json({ text: fullText, words: allWords }, 200, origin);
};
