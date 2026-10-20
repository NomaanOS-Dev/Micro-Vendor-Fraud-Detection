import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

const JWT_ISSUER = 'micro-vendor-fraud-api';
const JWT_AUDIENCE = 'micro-vendor-fraud-client';
const PASSWORD_COST = 12;

function issueAccessToken(vendorId) {
  return jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: vendorId,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: '15m',
  });
}

export async function registerVendor({ name, email, phone, password }) {
  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);
  try {
    const vendor = await prisma.$transaction(async (tx) => {
      const createdVendor = await tx.vendor.create({
        data: { name, email: email.toLowerCase(), phone: phone || null, passwordHash },
        select: { id: true, name: true, email: true, phone: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          vendorId: createdVendor.id,
          actorType: 'vendor',
          action: 'auth.registered',
          entityType: 'vendor',
          entityId: createdVendor.id,
        },
      });
      return createdVendor;
    });
    return { vendor, accessToken: issueAccessToken(vendor.id), tokenType: 'Bearer', expiresIn: 900 };
  } catch (error) {
    if (error.code === 'P2002') {
      const conflict = new Error('A vendor with that email or phone already exists.');
      conflict.status = 409;
      conflict.code = 'VENDOR_EXISTS';
      throw conflict;
    }
    throw error;
  }
}

export async function loginVendor({ identifier, password, ip, device }) {
  const normalized = identifier.toLowerCase();
  const vendor = await prisma.vendor.findFirst({
    where: { OR: [{ email: normalized }, { phone: identifier }] },
  });

  const passwordMatches = vendor ? await bcrypt.compare(password, vendor.passwordHash) : false;
  if (!vendor || !passwordMatches) {
    const error = new Error('Invalid credentials.');
    error.status = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  await prisma.$transaction([
    prisma.loginLog.create({ data: { vendorId: vendor.id, ip, device } }),
    prisma.auditLog.create({
      data: { vendorId: vendor.id, actorType: 'vendor', action: 'auth.login_succeeded', entityType: 'vendor', entityId: vendor.id },
    }),
  ]);

  return {
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email, phone: vendor.phone },
    accessToken: issueAccessToken(vendor.id),
    tokenType: 'Bearer',
    expiresIn: 900,
  };
}

