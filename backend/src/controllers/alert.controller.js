import { z } from 'zod';
import { acknowledgeAlert, getAlert, listAlerts } from '../services/alert.service.js';

function invalidRequest(error) {
  const result = new Error('Alert request is invalid.');
  result.status = 400;
  result.code = 'VALIDATION_ERROR';
  result.details = error.flatten();
  return result;
}

function alertIdFrom(req) {
  const parsed = z.string().uuid().safeParse(req.params.alertId);
  return parsed.success ? parsed.data : null;
}

function invalidId() {
  const error = new Error('Alert ID must be a valid UUID.');
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

export async function list(req, res, next) {
  const schema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    alert_type: z.string().trim().min(1).max(80).optional(),
    reviewed: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  }).strict();
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    return res.status(200).json(await listAlerts(req.auth.vendorId, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      alertType: parsed.data.alert_type,
      reviewed: parsed.data.reviewed,
    }));
  } catch (error) {
    return next(error);
  }
}

export async function get(req, res, next) {
  const alertId = alertIdFrom(req);
  if (!alertId) return next(invalidId());
  try {
    return res.status(200).json({ data: await getAlert(req.auth.vendorId, alertId) });
  } catch (error) {
    return next(error);
  }
}

export async function acknowledge(req, res, next) {
  const alertId = alertIdFrom(req);
  if (!alertId) return next(invalidId());
  try {
    return res.status(200).json({ data: await acknowledgeAlert(req.auth.vendorId, alertId) });
  } catch (error) {
    return next(error);
  }
}

