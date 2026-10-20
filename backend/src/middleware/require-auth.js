import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const tokenOptions = {
  algorithms: ['HS256'],
  issuer: 'micro-vendor-fraud-api',
  audience: 'micro-vendor-fraud-client',
};

export function requireAuth(req, res, next) {
  const [scheme, token, ...extra] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token || extra.length > 0) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'A bearer token is required.' } });
  }

  try {
    const claims = jwt.verify(token, env.JWT_SECRET, tokenOptions);
    if (typeof claims !== 'object' || typeof claims.sub !== 'string') throw new Error('Invalid subject');
    req.auth = Object.freeze({ vendorId: claims.sub });
    return next();
  } catch {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'The bearer token is invalid or expired.' } });
  }
}

