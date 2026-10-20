import { z } from 'zod';
import {
  createCustomer,
  findCustomerByPhone,
  getCustomer,
  listCustomers,
  updateCustomer,
} from '../services/customer.service.js';

const phoneSchema = z.string().trim().min(7).max(32).regex(/^\+?[0-9][0-9()\-\s]{5,30}$/, 'Enter a valid phone number.');
const emailSchema = z.string().trim().email().max(320);

function normalizePhone(phone) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  return `${trimmed.startsWith('+') ? '+' : ''}${digits}`;
}

function invalidRequest(error) {
  const result = new Error('Customer request is invalid.');
  result.status = 400;
  result.code = 'VALIDATION_ERROR';
  result.details = error.flatten();
  return result;
}

function customerIdFrom(req) {
  const parsed = z.string().uuid().safeParse(req.params.customerId);
  return parsed.success ? parsed.data : null;
}

function invalidId() {
  const error = new Error('Customer ID must be a valid UUID.');
  error.status = 400;
  error.code = 'VALIDATION_ERROR';
  return error;
}

export async function create(req, res, next) {
  const schema = z.object({
    name: z.string().trim().min(1).max(160),
    phone: phoneSchema.optional(),
    email: emailSchema.optional(),
  }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    const input = {
      ...parsed.data,
      phone: parsed.data.phone ? normalizePhone(parsed.data.phone) : undefined,
      email: parsed.data.email?.toLowerCase(),
    };
    return res.status(201).json({ data: await createCustomer(req.auth.vendorId, input) });
  } catch (error) {
    return next(error);
  }
}

export async function checkByPhone(req, res, next) {
  const parsed = z.object({ phone: phoneSchema }).strict().safeParse(req.query);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    const phone = normalizePhone(parsed.data.phone);
    return res.status(200).json({ data: await findCustomerByPhone(req.auth.vendorId, phone) });
  } catch (error) {
    return next(error);
  }
}

export async function list(req, res, next) {
  const schema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(100).optional(),
    reputation_below: z.coerce.number().int().min(0).max(100).optional(),
  }).strict();
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    return res.status(200).json(await listCustomers(req.auth.vendorId, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
      search: parsed.data.search,
      reputationBelow: parsed.data.reputation_below,
    }));
  } catch (error) {
    return next(error);
  }
}

export async function get(req, res, next) {
  const customerId = customerIdFrom(req);
  if (!customerId) return next(invalidId());
  try {
    return res.status(200).json({ data: await getCustomer(req.auth.vendorId, customerId) });
  } catch (error) {
    return next(error);
  }
}

export async function update(req, res, next) {
  const customerId = customerIdFrom(req);
  if (!customerId) return next(invalidId());
  const schema = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: phoneSchema.nullable().optional(),
    email: emailSchema.nullable().optional(),
  }).strict().refine((data) => Object.keys(data).length > 0, 'Provide at least one field to update.');
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return next(invalidRequest(parsed.error));
  try {
    const input = {
      ...parsed.data,
      phone: parsed.data.phone ? normalizePhone(parsed.data.phone) : parsed.data.phone,
      email: parsed.data.email?.toLowerCase() ?? parsed.data.email,
    };
    return res.status(200).json({ data: await updateCustomer(req.auth.vendorId, customerId, input) });
  } catch (error) {
    return next(error);
  }
}

