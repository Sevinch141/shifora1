/**
 * Conversation storage and the context window.
 *
 * A patient has one running conversation. Recent turns are passed verbatim so
 * short references resolve — "Endi tushibdi." only means something next to the
 * glucose exchange before it. Older turns are folded into a rolling summary
 * rather than dropped, so context stays bounded without losing what was
 * established.
 *
 * Without Gemini there is no summariser; the oldest turns are then simply
 * outside the window. The conversation is never silently rewritten.
 */
import { all, get, insert, run } from '../db/index.js';
import { summarise } from './gemini.js';
import { geminiAvailable } from './gemini.js';

/** Turns kept verbatim. Older ones are summarised. */
const VERBATIM_TURNS = 12;
/** Summarising is triggered once the tail grows past this. */
const SUMMARISE_AFTER = 24;

export async function currentConversation(patientId) {
  const existing = await get(
    'SELECT * FROM chat_conversations WHERE patient_id = ? ORDER BY id DESC LIMIT 1',
    patientId,
  );
  if (existing) return existing;
  const id = await insert(
    'INSERT INTO chat_conversations (patient_id, title) VALUES (?, ?)',
    patientId,
    'Hamshira AI',
  );
  return get('SELECT * FROM chat_conversations WHERE id = ?', id);
}

export async function addMessage({
  conversationId, patientId, role, kind = 'text', content,
  mediaId = null, language = 'uz', answered = null, refusalReason = null,
  questionId = null, sources = null,
}) {
  const id = await insert(
    `INSERT INTO chat_messages
       (conversation_id, patient_id, role, kind, content, media_id, language,
        answered, refusal_reason, question_id, sources_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    conversationId, patientId, role, kind, content, mediaId, language,
    answered === null ? null : (answered ? 1 : 0),
    refusalReason, questionId,
    sources ? JSON.stringify(sources) : null,
  );
  await run(
    `UPDATE chat_conversations SET last_message_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    conversationId,
  );
  return id;
}

export async function messages(conversationId, limit = 200) {
  return all(
    `SELECT id, role, kind, content, media_id, answered, refusal_reason,
            question_id, sources_json, created_at
       FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY id ASC
      LIMIT ?`,
    conversationId,
    limit,
  );
}

/**
 * Builds the context handed to the model: the rolling summary plus the most
 * recent turns, as plain text.
 */
export async function buildContext(conversation) {
  const recent = await all(
    `SELECT role, kind, content FROM chat_messages
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    conversation.id,
    VERBATIM_TURNS,
  );
  const lines = recent.reverse().map(
    (m) => `${m.role === 'patient' ? 'Bemor' : 'Hamshira AI'}: ${m.content}`,
  );
  const parts = [];
  if (conversation.summary) parts.push(`AVVALGI SUHBAT XULOSASI:\n${conversation.summary}`);
  if (lines.length > 0) parts.push(lines.join('\n'));
  return parts.join('\n\n');
}

/**
 * Folds everything older than the verbatim window into the summary.
 *
 * Runs after a reply is stored, so it never delays the patient's answer.
 */
export async function maybeSummarise(conversation) {
  if (!geminiAvailable()) return;
  const count = await get(
    'SELECT COUNT(*)::int AS c FROM chat_messages WHERE conversation_id = ?',
    conversation.id,
  );
  if ((count?.c ?? 0) < SUMMARISE_AFTER) return;

  const cutoff = await get(
    `SELECT id FROM chat_messages WHERE conversation_id = ?
      ORDER BY id DESC LIMIT 1 OFFSET ?`,
    conversation.id,
    VERBATIM_TURNS,
  );
  if (!cutoff) return;
  if (conversation.summarised_upto && conversation.summarised_upto >= cutoff.id) return;

  const older = await all(
    `SELECT role, content FROM chat_messages
      WHERE conversation_id = ? AND id <= ?
      ORDER BY id ASC`,
    conversation.id,
    cutoff.id,
  );
  if (older.length === 0) return;

  const text = [
    conversation.summary ? `Oldingi xulosa: ${conversation.summary}` : '',
    ...older.map((m) => `${m.role === 'patient' ? 'Bemor' : 'Hamshira AI'}: ${m.content}`),
  ].filter(Boolean).join('\n');

  try {
    const summary = await summarise(text);
    if (summary) {
      await run(
        `UPDATE chat_conversations
            SET summary = ?, summarised_upto = ?, updated_at = datetime('now')
          WHERE id = ?`,
        summary,
        cutoff.id,
        conversation.id,
      );
    }
  } catch {
    // Leaving the summary as it was is correct: the window simply stays wider.
  }
}
