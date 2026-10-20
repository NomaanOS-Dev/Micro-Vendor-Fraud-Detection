import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

const MOCK_OTP = '123456';
const phonePattern = /^\+[1-9]\d{7,14}$/;

function digest(value) {
  return createHmac('sha256', env.JWT_SECRET).update(value).digest();
}

async function providerSend(phone) {
  if (env.OTP_PROVIDER === 'mock') return { providerRef: `mock:${Date.now()}` };
  if (env.OTP_PROVIDER !== 'msg91' || !env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID) {
    const error = new Error('Phone verification is not configured.');
    error.status = 503;
    error.code = 'OTP_UNAVAILABLE';
    throw error;
  }
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('template_id', env.MSG91_TEMPLATE_ID);
  url.searchParams.set('mobile', phone.replace('+', ''));
  const response = await fetch(url, {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.request_id) {
    const error = new Error('Could not send a verification code. Try again later.');
    error.status = 502;
    error.code = 'OTP_PROVIDER_ERROR';
    throw error;
  }
  return { providerRef: String(data.request_id) };
}

async function providerVerify(challenge, code) {
  if (env.OTP_PROVIDER === 'mock') {
    const supplied = digest(code);
    const expected = digest(MOCK_OTP);
    return timingSafeEqual(supplied, expected);
  }
  if (env.OTP_PROVIDER !== 'msg91' || !env.MSG91_AUTH_KEY) return false;
  const url = new URL('https://control.msg91.com/api/v5/otp');
  url.searchParams.set('otp', code);
  url.searchParams.set('mobile', challenge.phone.replace('+', ''));
  const response = await fetch(url, {
    headers: { authkey: env.MSG91_AUTH_KEY },
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok && String(data.type || '').toLowerCase() === 'success';
}

export async function requestPhoneVerification(vendorId, phone) {
  if (!phonePattern.test(phone)) {
    const error = new Error('Enter the phone number in international format, for example +919876543210.');
    error.status = 400;
    error.code = 'INVALID_PHONE';
    throw error;
  }
  if (env.OTP_PROVIDER === 'disabled') {
    const error = new Error('Phone verification is disabled until an OTP provider is configured.');
    error.status = 503;
    error.code = 'OTP_DISABLED';
    throw error;
  }
  const recent = await prisma.otpChallenge.count({ where: { vendorId, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
  if (recent >= 5) {
    const error = new Error('Too many verification codes requested. Try again later.');
    error.status = 429;
    error.code = 'OTP_RATE_LIMITED';
    throw error;
  }
  const sentRecently = await prisma.otpChallenge.findFirst({ where: { vendorId, consumedAt: null, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (sentRecently) {
    const error = new Error('Wait one minute before requesting another verification code.');
    error.status = 429;
    error.code = 'OTP_COOLDOWN';
    throw error;
  }
  const provider = await providerSend(phone);
  const challenge = await prisma.otpChallenge.create({
    data: {
      vendorId,
      phone,
      providerRef: provider.providerRef,
      codeHash: env.OTP_PROVIDER === 'mock' ? digest(MOCK_OTP).toString('hex') : null,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
    select: { id: true, expiresAt: true },
  });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, provider: env.OTP_PROVIDER };
}

export async function verifyPhoneCode(vendorId, challengeId, code) {
  const challenge = await prisma.otpChallenge.findFirst({ where: { id: challengeId, vendorId } });
  const fail = () => {
    const error = new Error('The verification code is invalid or expired.');
    error.status = 400;
    error.code = 'OTP_INVALID';
    throw error;
  };
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.attempts >= 5) fail();
  const counted = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, vendorId, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
    data: { attempts: { increment: 1 } },
  });
  if (!counted.count) fail();
  const valid = await providerVerify(challenge, code);
  if (!valid) fail();
  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, attempts: { lte: 5 } }, data: { consumedAt: new Date() } });
      if (!consumed.count) fail();
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { phone: true } });
      const changedPhone = vendor?.phone !== challenge.phone;
      await tx.vendor.update({ where: { id: vendorId }, data: { phone: challenge.phone, phoneVerifiedAt: new Date(), ...(changedPhone ? { whatsappAlertsEnabled: false, whatsappOptedInAt: null } : {}) } });
      await tx.auditLog.create({ data: { vendorId, actorType: 'vendor', action: 'auth.phone_verified', entityType: 'vendor', entityId: vendorId } });
    });
  } catch (error) {
    if (error.code === 'P2002') {
      const conflict = new Error('That phone number is already linked to another vendor.');
      conflict.status = 409;
      conflict.code = 'PHONE_IN_USE';
      throw conflict;
    }
    throw error;
  }
  return { verified: true, phone: challenge.phone };
}
