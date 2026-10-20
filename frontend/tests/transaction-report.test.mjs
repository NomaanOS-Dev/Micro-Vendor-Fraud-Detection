import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransactionReport } from '../lib/transaction-report.mjs';

test('transaction PDF contains risk, review history, and an unverified-payment disclaimer', () => {
  const report = createTransactionReport([{
    utr: 'TESTUTR12345678',
    amount: '200.00',
    occurredAt: '2026-10-19T12:00:00.000Z',
    riskLevel: 'medium_risk',
    riskScore: 40,
    status: 'suspicious',
    paymentVerificationStatus: 'unverified',
    riskFactors: [{ description: 'Amount differs from expected total.' }],
    alerts: [{ alertType: 'amount_mismatch', reviewedAt: '2026-10-19T12:05:00.000Z' }],
    evidenceUrl: null,
  }], 'Integration Test Shop', new Date('2026-10-19T12:10:00.000Z'));
  const bytes = new Uint8Array(report.output('arraybuffer'));
  const content = new TextDecoder().decode(bytes);
  assert.equal(content.startsWith('%PDF-'), true);
  assert.equal(content.includes('Transaction review report'), true);
  assert.equal(content.includes('Risk indicators support review'), true);
  assert.equal(content.includes('reviewed'), true);
  assert.equal(content.includes('unverified'), true);
});
