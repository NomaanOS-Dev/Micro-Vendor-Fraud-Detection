import { Router } from 'express';
import { prisma } from '../config/database.js';
import { fraudEngineIsReady } from '../services/fraud-engine.client.js';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'vendor-fraud-api' });
});

healthRouter.get('/ready', async (_req, res) => {
  const checks = { database: 'unavailable', fraudEngine: 'unavailable' };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {}
  if (await fraudEngineIsReady()) checks.fraudEngine = 'ok';
  const ready = checks.database === 'ok' && checks.fraudEngine === 'ok';
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});

