import crypto from 'crypto';
import { FeedbackStatus } from '../../shared/appEnums.js';
import { sqlEnum } from '../sql.js';
import { firstRow, query, rows } from './pool.js';

export async function createFeedback({ userId, type, message, pageUrl, userAgent }) {
  const id = crypto.randomUUID();

  await query(
    `INSERT INTO feedback (id, user_id, type, message, page_url, user_agent, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, ${sqlEnum(FeedbackStatus.Open)}, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`,
    [id, userId, type, message, pageUrl || null, userAgent || null],
  );

  return {
    id,
    userId,
    type,
    message,
    pageUrl: pageUrl || null,
    status: FeedbackStatus.Open,
  };
}

function mapFeedback(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || null,
    type: row.type,
    message: row.message,
    pageUrl: row.page_url || null,
    userAgent: row.user_agent || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getFeedbackList({ type, status } = {}) {
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`f.type = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`f.status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await rows(
    `SELECT
       f.id, f.user_id, u.user_name, f.type, f.message,
       f.page_url, f.user_agent, f.status, f.created_at, f.updated_at
     FROM feedback f
     LEFT JOIN users u ON u.user_id = f.user_id
     ${where}
     ORDER BY f.created_at DESC
     LIMIT 500`,
    params,
  );

  return result.map(mapFeedback);
}

export async function updateFeedbackStatus(id, status) {
  const result = await query(
    `UPDATE feedback
     SET status = $1, updated_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $2`,
    [status, id],
  );

  return result.rowCount > 0;
}

export async function getFeedbackCounts() {
  const row = await firstRow(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = ${sqlEnum(FeedbackStatus.Open)})::int AS open
     FROM feedback`,
  );

  return { total: row?.total || 0, open: row?.open || 0 };
}
