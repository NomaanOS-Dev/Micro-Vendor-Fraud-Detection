import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import { ingestTransaction, listTransactions } from '../services/transaction.service.js';
import { saveEvidence } from '../services/evidence.service.js';

const dateSchema = z.string().trim().min(1).max(40).refine((value) => {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const isoDateTimeWithZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;
  if (!isoDate.test(value) && !isoDateTimeWithZone.test(value)) return false;
  const datePart = value.slice(0, 10);
  const dateCheck = new Date(`${datePart}T00:00:00.000Z`);
  if (Number.isNaN(dateCheck.getTime()) || dateCheck.toISOString().slice(0, 10) !== datePart) return false;
  return isoDate.test(value) || !Number.isNaN(new Date(value).getTime());
}, 'Use a valid YYYY-MM-DD date or ISO 8601 datetime with a timezone.');

const amountSchema = z.union([z.string(), z.number()]).transform((value) => String(value)).refine((value) => {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return false;
  return Number(value) > 0;
}, 'Amount must be positive with at most 2 decimal places.');

const ingestSchema = z.object({
  utr: z.string().trim().min(12).max(22).regex(/^[a-zA-Z0-9]+$/, 'UTR must contain only letters and numbers.'),
  amount: amountSchema,
  expected_amount: amountSchema.optional(),
  date: dateSchema,
  customer_id: z.string().uuid().optional(),
  screenshot_url: z.string().url().max(2048).optional(),
  screenshot_metadata: z.record(z.unknown()).optional(),
}).strict();

function invalidRequest(error) {
  const result = new Error('Transaction request is invalid.');
  result.status = 400;
  result.code = 'VALIDATION_ERROR';
  result.details = error.flatten();
  return result;
}

export async function validateAndIngest(req, res, next) {
  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) return next(invalidRequest(parsed.error));

  let evidence = null;
  try {
    if (req.file) evidence = await saveEvidence(req.auth.vendorId, req.file);
  } catch (error) {
    return next(error);
  }

  const input = {
    utr: parsed.data.utr.toUpperCase(),
    amount: parsed.data.amount,
    expectedAmount: parsed.data.expected_amount,
    occurredAt: parsed.data.date.length === 10
      ? new Date(`${parsed.data.date}T00:00:00.000Z`)
      : new Date(parsed.data.date),
    customerId: parsed.data.customer_id,
    screenshotUrl: evidence ? null : parsed.data.screenshot_url,
    screenshotMetadata: evidence?.metadata ?? null,
    evidencePath: evidence?.relativePath ?? null,
    evidenceMimeType: evidence?.mimeType ?? null,
    evidenceSize: evidence?.size ?? null,
  };

  try {
    const result = await ingestTransaction(req.auth.vendorId, input);
    return res.status(201).json({ data: result });
  } catch (error) {
    if (evidence?.path) await unlink(evidence.path).catch(() => {});
    return next(error);
  }
}

export async function getTransactions(req, res, next) {
  const querySchema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).strict();
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    const result = await listTransactions(req.auth.vendorId, parsed.data);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

