import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, register, requestPhoneOtp, verifyPhoneOtp } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/require-auth.js';

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } },
});

authRouter.post('/auth/register', authLimiter, register);
authRouter.post('/auth/login', authLimiter, login);
authRouter.post('/auth/phone-otp/request', requireAuth, authLimiter, requestPhoneOtp);
authRouter.post('/auth/phone-otp/verify', requireAuth, authLimiter, verifyPhoneOtp);

