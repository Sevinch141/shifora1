/**
 * Gemini access: transcription, vision OCR, embeddings, and reply drafting.
 *
 * Everything here is optional. Without GEMINI_API_KEY the module reports itself
 * unavailable and callers fall back to something honest rather than something
 * invented: voice and image are refused with a clear message, and retrieval
 * uses keyword matching instead of embeddings. Nothing degrades into made-up
 * clinical content.
 *
 * The model is never the source of medical facts. It transcribes, reads text
 * out of an image, embeds passages, and phrases a reply from passages that were
 * retrieved — it is not asked what a reading means.
 */
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_EMBED_MODEL } from '../config.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiAvailable() {
  return Boolean(GEMINI_API_KEY);
}

async function call(path, body) {
  if (!geminiAvailable()) throw new Error('GEMINI_API_KEY sozlanmagan.');
  const response = await fetch(`${BASE}/${path}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json();
}

function firstText(payload) {
  return payload?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
}

/** Speech to text. Returns the transcript only — no interpretation. */
export async function transcribe(base64Audio, mimeType) {
  const payload = await call(`models/${GEMINI_MODEL}:generateContent`, {
    contents: [{
      parts: [
        { text: 'Transcribe this audio verbatim. Return only the transcript, no commentary. The speaker may use Uzbek, Russian or English.' },
        { inline_data: { mime_type: mimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { temperature: 0 },
  });
  return firstText(payload);
}

/**
 * Reads text and visible details out of a photograph.
 *
 * Constrained to describing what is legible — a meter reading, a label, a
 * printed value. It is explicitly told not to interpret findings, because that
 * judgement belongs to the retrieval pipeline and ultimately to a clinician.
 */
export async function readImage(base64Image, mimeType) {
  const payload = await call(`models/${GEMINI_MODEL}:generateContent`, {
    contents: [{
      parts: [
        {
          text:
            'Extract the text and visible readings from this medical photograph '
            + '(glucose meter, lab report, medication box, insulin pen or prescription). '
            + 'List what is legible: numbers, units, medication names, doses, dates. '
            + 'Do not interpret the findings, do not give advice, do not diagnose. '
            + 'If the image is unreadable, say exactly: UNREADABLE',
        },
        { inline_data: { mime_type: mimeType, data: base64Image } },
      ],
    }],
    generationConfig: { temperature: 0 },
  });
  return firstText(payload);
}

/** Embedding for one passage. Returns null when Gemini is not configured. */
export async function embed(text) {
  if (!geminiAvailable()) return null;
  const payload = await call(`models/${GEMINI_EMBED_MODEL}:embedContent`, {
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
  });
  return payload?.embedding?.values ?? null;
}

/**
 * Phrases a reply from retrieved passages.
 *
 * The passages are the only permitted source. The instruction forbids adding
 * clinical knowledge, and the caller has already decided the question may be
 * answered at all — this step is wording, not judgement.
 */
export async function draftReply({ question, passages, facts, language, history }) {
  const context = passages
    .map((p, i) => `[${i + 1}] ${p.source_org ?? p.kind}: ${p.content ?? p.answer}`)
    .join('\n\n');

  const payload = await call(`models/${GEMINI_MODEL}:generateContent`, {
    system_instruction: {
      parts: [{
        text: [
          'You are Hamshira AI, a clinical patient-support assistant inside Shifora.',
          'Tone: formal, calm, professional. No emojis. No jokes. Short readable paragraphs.',
          `Reply in the patient's language (${language}).`,
          'You may only use the SOURCES and PATIENT FACTS given below.',
          'You must not diagnose, prescribe, change a dose, or state a reference range that is not in the sources.',
          'You must not invent citations.',
          'If the sources do not cover the question, reply with exactly: INSUFFICIENT',
        ].join(' '),
      }],
    },
    contents: [{
      parts: [{
        text: [
          history ? `CONVERSATION SO FAR:\n${history}` : '',
          facts ? `PATIENT FACTS:\n${facts}` : '',
          `SOURCES:\n${context}`,
          `QUESTION: ${question}`,
        ].filter(Boolean).join('\n\n'),
      }],
    }],
    generationConfig: { temperature: 0.2 },
  });
  return firstText(payload);
}

/** Condenses older turns so context stays bounded. */
export async function summarise(text) {
  const payload = await call(`models/${GEMINI_MODEL}:generateContent`, {
    contents: [{
      parts: [{
        text:
          'Summarise this patient-assistant conversation in at most 120 words. '
          + 'Keep concrete facts the patient mentioned (readings, symptoms, medication names, dates). '
          + 'Do not add anything that was not said.\n\n' + text,
      }],
    }],
    generationConfig: { temperature: 0 },
  });
  return firstText(payload);
}
