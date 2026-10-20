import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgresql://')),
  JWT_SECRET: z.string().min(32),
  FRAUD_ENGINE_URL: z.string().url().default('http://127.0.0.1:8000'),
  FRAUD_ENGINE_API_KEY: z.string().min(32),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  OTP_PROVIDER: z.enum(['disabled', 'mock', 'msg91']).default(process.env.NODE_ENV === 'development' ? 'mock' : 'disabled'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  WHATSAPP_PROVIDER: z.enum(['disabled', 'mock', 'meta']).default(process.env.NODE_ENV === 'development' ? 'mock' : 'disabled'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSAPP_ALERT_TEMPLATE: z.string().default('fraud_alert'),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),
  RAZORPAY_MODE: z.enum(['disabled', 'mock', 'live']).default(process.env.NODE_ENV === 'development' ? 'mock' : 'disabled'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLAN_BASIC: z.string().optional(),
  RAZORPAY_PLAN_PRO: z.string().optional(),
  RAZORPAY_PLAN_ENTERPRISE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && [parsed.data.OTP_PROVIDER, parsed.data.WHATSAPP_PROVIDER, parsed.data.RAZORPAY_MODE].includes('mock')) {
  console.error('Mock integrations are not allowed in production.');
  process.exit(1);
}

export const env = Object.freeze({
  ...parsed.data,
  CORS_ORIGINS: parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
});

