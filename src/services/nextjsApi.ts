import { Logger } from './logger';

const log = Logger.create('NextjsApi');

export interface SrtEntry {
  start: number;
  end: number;
  text: string;
}

export interface ServerTranscribeSegment {
  word: string;
  startMs: number;
  endMs: number;
}

export interface ServerTranscribeResult {
  segments: ServerTranscribeSegment[];
  subtitles: { startMs: number; endMs: number; text: string }[];
}

export async function transcribeAudio(
  wavBlob: Blob,
  language: string = 'tr',
): Promise<ServerTranscribeResult> {
  const fd = new FormData();
  fd.append('audio', wavBlob, 'audio.wav');
  fd.append('language', language === 'auto' ? 'tr' : language);
  const CF_BASE = (import.meta.env.VITE_NEXTJS_API_URL as string | undefined) ?? '';
  const res = await fetch(`${CF_BASE}/api/transcribe-audio`, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    log.error(`CF transcribe-audio ${res.status}`, { body: body.slice(0, 500) });
    let errMsg = res.statusText;
    try { errMsg = (JSON.parse(body) as { error?: string }).error ?? errMsg; } catch { /* not json */ }
    throw new Error(errMsg);
  }
  return res.json() as Promise<ServerTranscribeResult>;
}
