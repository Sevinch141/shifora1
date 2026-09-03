/**
 * Hamshira AI chat: text, voice, images, usage, and the admin document library.
 *
 * Limits and visibility are enforced here and in the services below, never by
 * the client. The patient is always resolved from the session.
 */
import { Router } from 'express';
import express from 'express';
import { get } from '../db/index.js';
import { badRequest, forbidden, notFound, validate, wrap, ApiError } from '../lib/http.js';
import { requireAuth, requireHospitalStaff } from '../middleware/auth.js';
import { patientForUser } from '../services/access.js';
import { ask } from '../services/assistant.js';
import { addMessage, buildContext, currentConversation, maybeSummarise, messages } from '../services/chat.js';
import { consume, usageToday, LIMIT_MESSAGE } from '../services/aiUsage.js';
import { transcribe, readImage, geminiAvailable } from '../services/gemini.js';
import { approveDocument, ingestDocument, listDocuments } from '../services/documentLibrary.js';
import { insert, run } from '../db/index.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(requireAuth);

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 20 * 1024 * 1024;

async function selfPatient(req) {
  const patient = await patientForUser(req.user.id);
  if (!patient) throw forbidden('Hisobingiz bemor kartasiga bog‘lanmagan.');
  return patient;
}

/** Runs one turn: store the question, answer it, store the reply. */
async function turn({ req, patient, text, kind, mediaId }) {
  const conversation = await currentConversation(patient.id);
  const language = patient.language ?? 'uz';

  await addMessage({
    conversationId: conversation.id,
    patientId: patient.id,
    role: 'patient',
    kind,
    content: text,
    mediaId,
    language,
  });

  const history = await buildContext(conversation);
  const result = await ask({ patient, user: req.user, question: text, req, history, language });

  await addMessage({
    conversationId: conversation.id,
    patientId: patient.id,
    role: 'assistant',
    kind: 'text',
    content: result.message,
    language,
    answered: result.answered,
    refusalReason: result.refusal_reason ?? null,
    questionId: result.question_id ?? null,
    sources: result.sources ?? null,
  });

  await maybeSummarise(conversation);
  await audit(req, 'assistant.turn', 'patient', patient.id, {
    kind, intent: result.intent, answered: result.answered,
  });

  return { ...result, conversation_id: conversation.id, usage: await usageToday(patient.id) };
}

router.get(
  '/conversation',
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    const conversation = await currentConversation(patient.id);
    res.json({
      conversation: { id: conversation.id, summary: conversation.summary },
      messages: (await messages(conversation.id)).map((m) => ({
        ...m,
        sources: m.sources_json ? JSON.parse(m.sources_json) : [],
        sources_json: undefined,
      })),
      usage: await usageToday(patient.id),
      voice_enabled: geminiAvailable(),
      image_enabled: geminiAvailable(),
    });
  }),
);

router.get(
  '/usage',
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    res.json(await usageToday(patient.id));
  }),
);

router.post(
  '/message',
  wrap(async (req, res) => {
    const { text } = validate(req.body, { text: { required: true, message: 'Savolingizni yozing.' } });
    if (String(text).trim().length < 2) throw badRequest('Savol juda qisqa.');
    const patient = await selfPatient(req);
    res.json(await turn({ req, patient, text: String(text).trim(), kind: 'text', mediaId: null }));
  }),
);

/**
 * Voice note. The allowance is spent before transcription, so a failed
 * transcription cannot be retried for free — and cannot be replayed to bypass
 * the cap either.
 */
router.post(
  '/voice',
  express.raw({ type: ['audio/*', 'application/octet-stream'], limit: MAX_MEDIA_BYTES }),
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    if (!geminiAvailable()) throw new ApiError(503, 'Ovozli xabar hozircha sozlanmagan.');
    if (!req.body?.length) throw badRequest('Audio fayl bo‘sh.');

    await consume(patient.id, 'voice');

    const mime = req.get('content-type')?.split(';')[0] ?? 'audio/webm';
    const mediaId = await insert(
      `INSERT INTO patient_media (patient_id, kind, mime_type, byte_size, content)
       VALUES (?, 'voice', ?, ?, ?)`,
      patient.id, mime, req.body.length, req.body,
    );
    await run('UPDATE patient_media SET storage_path = ? WHERE id = ?', `/api/chat/media/${mediaId}`, mediaId);

    let transcript = '';
    try {
      transcript = await transcribe(req.body.toString('base64'), mime);
    } catch (err) {
      throw new ApiError(502, 'Ovozni matnga aylantirib bo‘lmadi. Iltimos matn orqali yozing.');
    }
    if (!transcript) throw badRequest('Ovozdan matn ajratib bo‘lmadi. Iltimos matn orqali yozing.');

    await run('UPDATE patient_media SET transcript = ? WHERE id = ?', transcript, mediaId);
    res.json({ ...(await turn({ req, patient, text: transcript, kind: 'voice', mediaId })), transcript });
  }),
);

/** Photograph of a meter, label, prescription or report. */
router.post(
  '/image',
  express.raw({ type: ['image/*'], limit: MAX_MEDIA_BYTES }),
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    if (!geminiAvailable()) throw new ApiError(503, 'Rasm tahlili hozircha sozlanmagan.');
    if (!req.body?.length) throw badRequest('Rasm bo‘sh.');

    await consume(patient.id, 'image');

    const mime = req.get('content-type')?.split(';')[0] ?? 'image/jpeg';
    const mediaId = await insert(
      `INSERT INTO patient_media (patient_id, kind, mime_type, byte_size, content)
       VALUES (?, 'image', ?, ?, ?)`,
      patient.id, mime, req.body.length, req.body,
    );
    await run('UPDATE patient_media SET storage_path = ? WHERE id = ?', `/api/chat/media/${mediaId}`, mediaId);

    let extracted = '';
    try {
      extracted = await readImage(req.body.toString('base64'), mime);
    } catch {
      throw new ApiError(502, 'Rasmni o‘qib bo‘lmadi.');
    }
    await run('UPDATE patient_media SET ocr_text = ? WHERE id = ?', extracted, mediaId);

    if (/^UNREADABLE/i.test(extracted.trim())) {
      return res.json({
        answered: false,
        message: 'Rasmni o‘qib bo‘lmadi. Iltimos aniqroq surat yuboring yoki qiymatni matn bilan yozing.',
        usage: await usageToday(patient.id),
      });
    }

    const caption = String(req.get('x-caption') ?? '').trim();
    const text = caption
      ? `${caption}\n\nRasmdan o‘qildi: ${extracted}`
      : `Rasmdan o‘qildi: ${extracted}`;
    res.json({ ...(await turn({ req, patient, text, kind: 'image', mediaId })), extracted });
  }),
);

/** Media bytes. A patient may fetch only their own. */
router.get(
  '/media/:id',
  wrap(async (req, res) => {
    const patient = await selfPatient(req);
    const media = await get(
      'SELECT * FROM patient_media WHERE id = ? AND patient_id = ?',
      Number(req.params.id),
      patient.id,
    );
    if (!media) throw notFound('Fayl topilmadi.');
    res.setHeader('Content-Type', media.mime_type);
    res.send(media.content);
  }),
);

// ------------------------------------------------------- admin document library

router.get(
  '/documents',
  requireHospitalStaff,
  wrap(async (req, res) => {
    res.json({ documents: await listDocuments(req.user.hospital_id), gemini: geminiAvailable() });
  }),
);

router.post(
  '/documents',
  requireHospitalStaff,
  express.raw({ type: ['application/pdf', 'text/plain'], limit: MAX_DOC_BYTES }),
  wrap(async (req, res) => {
    if (!req.body?.length) throw badRequest('Fayl bo‘sh.');
    const sourceOrg = String(req.get('x-source-org') ?? '').trim();
    const title = String(req.get('x-title') ?? '').trim();
    if (!sourceOrg || !title) throw badRequest('Manba tashkiloti va sarlavha kerak.');

    const mime = req.get('content-type')?.split(';')[0] ?? 'application/pdf';
    const documentId = await insert(
      `INSERT INTO guidance_documents
         (hospital_id, source_org, title, filename, mime_type, byte_size, content, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.hospital_id, sourceOrg, title,
      req.get('x-filename') ?? null, mime, req.body.length, req.body, req.user.id,
    );

    const result = await ingestDocument({ documentId, buffer: req.body, mimeType: mime });
    await audit(req, 'guidance.uploaded', 'guidance_document', documentId, { sourceOrg, chunks: result.chunks });
    res.json({ document: await get('SELECT id, status, chunk_count, embedded, error FROM guidance_documents WHERE id = ?', documentId) });
  }),
);

/** An upload is not citable until a person approves it. */
router.post(
  '/documents/:id/approve',
  requireHospitalStaff,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const doc = await get('SELECT * FROM guidance_documents WHERE id = ?', id);
    if (!doc) throw notFound('Hujjat topilmadi.');
    if (doc.hospital_id && doc.hospital_id !== req.user.hospital_id) throw forbidden();
    if (doc.status !== 'ready') throw badRequest('Hujjat hali tayyor emas.');
    await approveDocument(id, req.user.id);
    await audit(req, 'guidance.approved', 'guidance_document', id);
    res.json({ ok: true });
  }),
);

export default router;
