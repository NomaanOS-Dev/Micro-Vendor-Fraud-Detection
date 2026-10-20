import { env } from '../config/env.js';
import { z } from 'zod';

const scoreTimeoutMs = 2_500;
const scoreResponseSchema = z.object({
  risk_score: z.number().int().min(0).max(2_147_483_647),
  risk_level: z.enum(['low_risk', 'medium_risk', 'high_risk']),
  transaction_status: z.enum(['valid', 'suspicious']),
  factors: z.array(z.object({
    rule_code: z.string().min(1).max(80),
    score: z.number().int().min(1).max(32_767),
    description: z.string().min(1).max(1000),
  }).strict()),
}).strict();

function serviceError(message, code = 'FRAUD_ENGINE_UNAVAILABLE', status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function request(path, options = {}) {
  try {
    return await fetch(new URL(path, env.FRAUD_ENGINE_URL), {
      ...options,
      signal: AbortSignal.timeout(scoreTimeoutMs),
    });
  } catch {
    throw serviceError('Fraud scoring is temporarily unavailable. Please retry.');
  }
}

export async function scoreTransaction(payload) {
  const response = await request('/v1/score', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fraud-engine-key': env.FRAUD_ENGINE_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw serviceError('Fraud scoring could not process this transaction.', 'FRAUD_ENGINE_ERROR', 502);
  }
  try {
    const result = scoreResponseSchema.parse(await response.json());
    if (result.factors.reduce((total, factor) => total + factor.score, 0) !== result.risk_score) {
      throw new Error('Score does not match factors');
    }
    const expectedLevel = result.risk_score > 60
      ? 'high_risk'
      : result.risk_score > 30 ? 'medium_risk' : 'low_risk';
    const expectedStatus = result.factors.length > 0 ? 'suspicious' : 'valid';
    if (result.risk_level !== expectedLevel || result.transaction_status !== expectedStatus) {
      throw new Error('Risk classification does not match score');
    }
    return result;
  } catch {
    throw serviceError('Fraud scoring returned an invalid response.', 'FRAUD_ENGINE_ERROR', 502);
  }
}

export async function fraudEngineIsReady() {
  try {
    const response = await request('/v1/health', {
      headers: { 'x-fraud-engine-key': env.FRAUD_ENGINE_API_KEY },
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

