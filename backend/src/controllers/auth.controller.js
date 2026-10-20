import { z } from 'zod';
import { loginVendor, registerVendor } from '../services/auth.service.js';
import { requestPhoneVerification, verifyPhoneCode } from '../services/otp.service.js';

const emailSchema = z.string().trim().email().max(320);
const passwordSchema = z.string().min(12).max(128);

const registerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: emailSchema,
  phone: z.string().trim().min(7).max(32).optional(),
  password: passwordSchema,
}).strict();

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
}).strict();

function validationError(error) {
  const result = new Error('Request body is invalid.');
  result.status = 400;
  result.code = 'VALIDATION_ERROR';
  result.details = error.flatten();
  return result;
}

export async function register(req, res, next) {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return next(validationError(parsed.error));
  try {
    return res.status(201).json({ data: await registerVendor(parsed.data) });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return next(validationError(parsed.error));
  try {
    const data = await loginVendor({
      ...parsed.data,
      ip: req.ip,
      device: req.get('user-agent')?.slice(0, 512),
    });
    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
}

export async function requestPhoneOtp(req, res, next) {
  const parsed = z.object({ phone: z.string().trim().min(9).max(16) }).strict().safeParse(req.body);
  if (!parsed.success) return next(validationError(parsed.error));
  try {
    const result = await requestPhoneVerification(req.auth.vendorId, parsed.data.phone);
    return res.status(202).json({ data: result });
  } catch (error) { return next(error); }
}

export async function verifyPhoneOtp(req, res, next) {
  const parsed = z.object({ challenge_id: z.string().uuid(), code: z.string().regex(/^\d{4,8}$/) }).strict().safeParse(req.body);
  if (!parsed.success) return next(validationError(parsed.error));
  try {
    const result = await verifyPhoneCode(req.auth.vendorId, parsed.data.challenge_id, parsed.data.code);
    return res.status(200).json({ data: result });
  } catch (error) { return next(error); }
}

