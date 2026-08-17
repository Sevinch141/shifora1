import { insert } from '../db/index.js';

/**
 * Notification delivery.
 *
 * MVP delivers in-app only (the client polls and, where permitted, mirrors the
 * message to a browser notification). Additional channels register themselves
 * here, so adding SMS / Telegram / push later does not touch the callers.
 */
const channels = new Map();

export function registerChannel(name, deliver) {
  channels.set(name, deliver);
}

registerChannel('in_app', (payload) => {
  insert(
    `INSERT INTO notifications (user_id, patient_id, channel, type, title, body, entity_type, entity_id)
     VALUES (?, ?, 'in_app', ?, ?, ?, ?, ?)`,
    payload.userId,
    payload.patientId ?? null,
    payload.type,
    payload.title,
    payload.body,
    payload.entityType ?? null,
    payload.entityId ?? null,
  );
});

export function notify(payload) {
  const targets = payload.channels ?? ['in_app'];
  for (const name of targets) {
    const deliver = channels.get(name);
    if (deliver) deliver(payload);
  }
}
