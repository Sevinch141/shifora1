import { insert } from '../db/index.js';

/**
 * Append-only audit trail. Every write that touches clinical data or access
 * control should call this; reads of a patient record are logged too, because
 * "who looked at this chart" is part of healthcare accountability.
 */
export function audit(req, action, entityType, entityId, meta) {
  insert(
    `INSERT INTO audit_logs (user_id, hospital_id, action, entity_type, entity_id, meta_json, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    req?.user?.id ?? null,
    req?.user?.hospital_id ?? null,
    action,
    entityType ?? null,
    entityId ?? null,
    meta ? JSON.stringify(meta) : null,
    req?.ip ?? null,
  );
}
