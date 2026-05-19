import { Logger } from './logger';

const log = Logger.create('GroqTranslation');

const BATCH_SIZE = 200;

export interface TranslationEntry {
  start: number;
  end: number;
  text: string;
}

export const TRANSLATION_LANGUAGES: { code: string; name: string }[] = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'pl', name: 'Polski' },
  { code: 'sv', name: 'Svenska' },
  { code: 'no', name: 'Norsk' },
  { code: 'da', name: 'Dansk' },
  { code: 'fi', name: 'Suomi' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ro', name: 'Română' },
  { code: 'hu', name: 'Magyar' },
  { code: 'uk', name: 'Українська' },
  { code: 'th', name: 'ภาษาไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Bahasa Melayu' },
];

export async function translateSubtitles(
  entries: TranslationEntry[],
  targetLanguage: string,
  targetLanguageName: string,
  apiKey: string,
  onProgress?: (pct: number) => void,
): Promise<TranslationEntry[]> {
  if (entries.length === 0) return [];

  const batches: TranslationEntry[][] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    batches.push(entries.slice(i, i + BATCH_SIZE));
  }

  const translatedTexts: string[] = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const texts = batch.map(e => e.text);

    log.info(`Translating batch ${b + 1}/${batches.length} (${texts.length} entries) to ${targetLanguageName}`);

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{
          role: 'user',
          content: `Translate the following subtitle texts to ${targetLanguageName} (language code: ${targetLanguage}).
Return a JSON object with key "translations" containing an array of translated strings.
Same count and order as input. Do not add explanations or change timing.

Input: ${JSON.stringify(texts)}`,
        }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Groq hatası: ${detail}`);
    }

    const aiData = await response.json() as { choices: [{ message: { content: string } }] };
    const content = JSON.parse(aiData.choices[0].message.content) as { translations?: string[] };
    const translated: string[] = content.translations ?? (Object.values(content) as unknown as string[]);

    if (!Array.isArray(translated) || translated.length !== batch.length) {
      throw new Error(`Çeviri sayısı eşleşmedi (beklenen ${batch.length}, alınan ${translated?.length ?? 0})`);
    }

    translatedTexts.push(...translated);
    onProgress?.(Math.round(((b + 1) / batches.length) * 100));
  }

  return entries.map((entry, i) => ({
    ...entry,
    text: translatedTexts[i] ?? entry.text,
  }));
}
