import { timingSafeEqual, createHmac } from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

export async function enqueueVendorFraudAlert(tx, vendor, transaction, risk) {
  if (!vendor.whatsappAlertsEnabled || !vendor.phoneVerifiedAt || !vendor.phone || risk.risk_level !== 'high_risk') return;
  await tx.notificationJob.create({
    data: {
      vendorId: vendor.id,
      channel: 'whatsapp',
      payload: {
        utrLast4: transaction.utr.slice(-4),
        riskScore: risk.risk_score,
        factorCount: risk.factors.length,
      },
    },
  });
}

async function deliverWhatsApp(job) {
  const vendor = await prisma.vendor.findUnique({ where: { id: job.vendorId }, select: { phone: true, phoneVerifiedAt: true, whatsappAlertsEnabled: true } });
  if (!vendor?.whatsappAlertsEnabled || !vendor.phoneVerifiedAt || !vendor.phone) return false;
  if (env.WHATSAPP_PROVIDER === 'mock') return;
  if (env.WHATSAPP_PROVIDER !== 'meta' || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WhatsApp provider is not configured.');
  }
  const url = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: vendor.phone.replace('+', ''),
      type: 'template',
      template: {
        name: env.WHATSAPP_ALERT_TEMPLATE,
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: job.payload.utrLast4 },
          { type: 'text', text: String(job.payload.riskScore) },
          { type: 'text', text: String(job.payload.factorCount) },
        ] }],
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`WhatsApp delivery failed (${response.status}).`);
  return true;
}

export async function drainNotificationQueue() {
  const candidates = await prisma.notificationJob.findMany({
    where: { status: 'pending', availableAt: { lte: new Date() }, attempts: { lt: 5 } },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });
  for (const job of candidates) {
    const claimed = await prisma.notificationJob.updateMany({ where: { id: job.id, status: 'pending' }, data: { status: 'sending', attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    try {
      const sent = await deliverWhatsApp(job);
      await prisma.notificationJob.update({ where: { id: job.id }, data: { status: sent === false ? 'cancelled' : 'sent', lastError: null } });
    } catch (error) {
      const attempts = job.attempts + 1;
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: {
          status: attempts >= 5 ? 'failed' : 'pending',
          availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
          lastError: error.message.slice(0, 500),
        },
      });
    }
  }
}

export async function getNotificationSettings(vendorId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { phone: true, phoneVerifiedAt: true, whatsappAlertsEnabled: true, whatsappOptedInAt: true } });
  return { phone: vendor?.phone ?? null, phoneVerified: Boolean(vendor?.phoneVerifiedAt), whatsappAlertsEnabled: vendor?.whatsappAlertsEnabled ?? false, whatsappOptedInAt: vendor?.whatsappOptedInAt ?? null, provider: env.WHATSAPP_PROVIDER };
}

export async function setWhatsAppConsent(vendorId, enabled) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { phone: true, phoneVerifiedAt: true } });
  if (enabled && (!vendor?.phone || !vendor.phoneVerifiedAt)) {
    const error = new Error('Verify a phone number before enabling WhatsApp alerts.');
    error.status = 409;
    error.code = 'PHONE_VERIFICATION_REQUIRED';
    throw error;
  }
  if (enabled && env.WHATSAPP_PROVIDER === 'disabled') {
    const error = new Error('WhatsApp notifications are not configured.');
    error.status = 503;
    error.code = 'WHATSAPP_DISABLED';
    throw error;
  }
  const updated = await prisma.vendor.update({
    where: { id: vendorId },
    data: { whatsappAlertsEnabled: enabled, whatsappOptedInAt: enabled ? new Date() : null },
    select: { whatsappAlertsEnabled: true, whatsappOptedInAt: true },
  });
  await prisma.auditLog.create({ data: { vendorId, actorType: 'vendor', action: enabled ? 'notifications.whatsapp_opted_in' : 'notifications.whatsapp_opted_out', entityType: 'vendor', entityId: vendorId } });
  return updated;
}

export function verifyWhatsAppWebhookSignature(rawBody, signature) {
  if (!env.WHATSAPP_APP_SECRET || !signature?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
