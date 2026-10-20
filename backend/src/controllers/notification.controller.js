import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { getNotificationSettings, setWhatsAppConsent, verifyWhatsAppWebhookSignature } from '../services/notification.service.js';

export async function getSettings(req, res, next) {
  try { return res.status(200).json({ data: await getNotificationSettings(req.auth.vendorId) }); }
  catch (error) { return next(error); }
}

export async function updateSettings(req, res, next) {
  const parsed = z.object({ whatsapp_alerts_enabled: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) {
    const error = new Error('Notification settings are invalid.');
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    return next(error);
  }
  try { return res.status(200).json({ data: await setWhatsAppConsent(req.auth.vendorId, parsed.data.whatsapp_alerts_enabled) }); }
  catch (error) { return next(error); }
}

export function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || !env.WHATSAPP_VERIFY_TOKEN || !challenge) {
    return res.sendStatus(403);
  }
  const expected = Buffer.from(env.WHATSAPP_VERIFY_TOKEN);
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.sendStatus(403);
  return res.status(200).type('text/plain').send(challenge);
}

export function receiveMetaWebhook(req, res) {
  if (!Buffer.isBuffer(req.body) || !verifyWhatsAppWebhookSignature(req.body, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  try {
    JSON.parse(req.body.toString('utf8'));
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(400);
  }
}
