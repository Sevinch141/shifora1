/**
 * The approved document library.
 *
 * Hospital admins upload official PDFs (WHO, ADA, IDF, NHS, Uzbekistan MoH, or
 * their own protocols). The file is split into passages, embedded, and searched
 * semantically. No guideline text is ever written into this repository — the
 * only way clinical wording enters the system is through an upload a person
 * approved.
 *
 * Embeddings are stored as JSON arrays and compared in process. pgvector is the
 * natural upgrade, but it is not available on every deployment, and a hospital
 * corpus is small enough that cosine over the candidate set costs little. The
 * search signature hides the choice, so swapping storage changes nothing above.
 *
 * Without a Gemini key there are no embeddings; search falls back to keyword
 * overlap over the same chunks. Degraded, but real — never invented.
 */
import { all, get, insert, run } from '../db/index.js';
import { extractPdfText } from '../lib/pdfText.js';
import { embed, readImage, geminiAvailable } from './gemini.js';

const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;
/** Below this many characters per page the text layer is treated as absent. */
const OCR_THRESHOLD_PER_PAGE = 120;

/** Splits on paragraph boundaries, keeping a little overlap for context. */
export function chunkText(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < clean.length) {
    let end = Math.min(cursor + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf('. ', end);
      if (boundary > cursor + CHUNK_CHARS * 0.5) end = boundary + 1;
    }
    chunks.push(clean.slice(cursor, end).trim());
    if (end >= clean.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }
  return chunks.filter((c) => c.length > 40);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Takes an uploaded PDF from bytes to searchable passages.
 *
 * If the file has no usable text layer it is sent to the vision model, which
 * reads the pages. If neither yields text the document is marked failed rather
 * than stored as an empty, silently unsearchable entry.
 */
export async function ingestDocument({ documentId, buffer, mimeType }) {
  try {
    let text = '';
    let pages = 0;

    if (mimeType === 'application/pdf') {
      const extracted = extractPdfText(buffer);
      text = extracted.text;
      pages = extracted.pages;
    } else {
      text = buffer.toString('utf8');
    }

    const thin = pages > 0 && text.length / pages < OCR_THRESHOLD_PER_PAGE;
    if ((!text || thin) && geminiAvailable()) {
      text = await readImage(buffer.toString('base64'), mimeType);
    }

    if (!text || text.trim().length < 80) {
      await run(
        `UPDATE guidance_documents
            SET status = 'failed',
                error = 'Hujjatdan matn ajratib bo‘lmadi. Skanerlangan bo‘lsa, Gemini kaliti kerak.',
                updated_at = datetime('now')
          WHERE id = ?`,
        documentId,
      );
      return { ok: false, chunks: 0 };
    }

    const chunks = chunkText(text);
    let embedded = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      let vector = null;
      if (geminiAvailable()) {
        try {
          vector = await embed(chunks[i]);
          if (vector) embedded += 1;
        } catch {
          vector = null; // keyword search still covers this chunk
        }
      }
      await insert(
        `INSERT INTO guidance_chunks (document_id, chunk_index, content, embedding)
         VALUES (?, ?, ?, ?)`,
        documentId,
        i,
        chunks[i],
        vector ? JSON.stringify(vector) : null,
      );
    }

    await run(
      `UPDATE guidance_documents
          SET status = 'ready', page_count = ?, chunk_count = ?, embedded = ?,
              error = NULL, updated_at = datetime('now')
        WHERE id = ?`,
      pages || null,
      chunks.length,
      embedded,
      documentId,
    );
    return { ok: true, chunks: chunks.length, embedded };
  } catch (err) {
    await run(
      `UPDATE guidance_documents SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
      String(err.message).slice(0, 300),
      documentId,
    );
    return { ok: false, chunks: 0, error: err.message };
  }
}

function keywordScore(question, content) {
  const words = String(question).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3);
  if (words.length === 0) return 0;
  const haystack = content.toLowerCase();
  return words.filter((w) => haystack.includes(w)).length / words.length;
}

/**
 * Semantic search across approved documents.
 *
 * Only documents that are ready AND approved by a person are searchable — an
 * upload alone does not make a source citable.
 */
export async function searchDocuments(question, hospitalId, { limit = 3, threshold = 0.35 } = {}) {
  const rows = await all(
    `SELECT c.id, c.content, c.section_title, c.embedding, c.page_from,
            d.id AS document_id, d.source_org, d.title
       FROM guidance_chunks c
       JOIN guidance_documents d ON d.id = c.document_id
      WHERE d.status = 'ready'
        AND d.approved_by IS NOT NULL
        AND (d.hospital_id IS NULL OR d.hospital_id = ?)`,
    hospitalId ?? null,
  );
  if (rows.length === 0) return { matches: [], score: 0, mode: 'none' };

  let queryVector = null;
  if (geminiAvailable()) {
    try { queryVector = await embed(question); } catch { queryVector = null; }
  }

  const usable = queryVector ? rows.filter((r) => r.embedding) : [];
  const mode = usable.length > 0 ? 'semantic' : 'keyword';

  const scored = (mode === 'semantic' ? usable : rows).map((row) => ({
    row,
    score: mode === 'semantic'
      ? cosine(queryVector, JSON.parse(row.embedding))
      : keywordScore(question, row.content),
  }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    mode,
    score: scored.length > 0 ? Math.round(scored[0].score * 100) / 100 : 0,
    matches: scored.map((entry) => ({
      kind: 'document',
      chunk_id: entry.row.id,
      document_id: entry.row.document_id,
      source_org: entry.row.source_org,
      title: entry.row.title,
      section: entry.row.section_title,
      content: entry.row.content,
      citation: entry.row.section_title
        ? `${entry.row.title} — ${entry.row.section_title}`
        : entry.row.title,
      score: Math.round(entry.score * 100) / 100,
    })),
  };
}

export async function listDocuments(hospitalId) {
  return all(
    `SELECT d.id, d.source_org, d.title, d.filename, d.status, d.error,
            d.page_count, d.chunk_count, d.embedded, d.created_at,
            d.approved_at, u.full_name AS approved_by_name
       FROM guidance_documents d
       LEFT JOIN users u ON u.id = d.approved_by
      WHERE d.hospital_id IS NULL OR d.hospital_id = ?
      ORDER BY d.created_at DESC`,
    hospitalId ?? null,
  );
}

export async function approveDocument(documentId, userId) {
  await run(
    `UPDATE guidance_documents
        SET approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
    userId,
    documentId,
  );
  return get('SELECT * FROM guidance_documents WHERE id = ?', documentId);
}
