import { z } from 'zod';
import { cancelSubscription, createBillingOrder, createSubscription, getBillingAccess, processRazorpayWebhook, simulateMockSubscriptionActivation, verifyBillingPayment } from '../services/billing.service.js';

export async function getBilling(req, res, next) {
  try { return res.status(200).json({ data: await getBillingAccess(req.auth.vendorId) }); }
  catch (error) { return next(error); }
}

export async function startSubscription(req, res, next) {
  const parsed = z.object({ plan: z.enum(['basic', 'pro', 'enterprise']) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_PLAN', message: 'Choose basic, pro, or enterprise.' } });
  try { return res.status(201).json({ data: await createSubscription(req.auth.vendorId, parsed.data.plan) }); }
  catch (error) { return next(error); }
}

export async function stopSubscription(req, res, next) {
  try { return res.status(200).json({ data: await cancelSubscription(req.auth.vendorId) }); }
  catch (error) { return next(error); }
}

export async function createOrder(req, res, next) {
  const parsed = z.object({ amount_inr: z.number().finite().min(1).max(100_000).refine((value) => Number.isInteger(value * 100)) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_AMOUNT', message: 'Amount must be between INR 1 and INR 100,000.' } });
  try { return res.status(201).json({ data: await createBillingOrder(req.auth.vendorId, parsed.data.amount_inr) }); }
  catch (error) { return next(error); }
}

export async function verifyPayment(req, res, next) {
  const parsed = z.object({ order_id: z.string().min(8).max(100), payment_id: z.string().min(8).max(100), signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_PAYMENT_CALLBACK', message: 'Payment verification details are invalid.' } });
  try { return res.status(200).json({ data: await verifyBillingPayment(req.auth.vendorId, { orderId: parsed.data.order_id, paymentId: parsed.data.payment_id, signature: parsed.data.signature }) }); }
  catch (error) { return next(error); }
}

export async function razorpayWebhook(req, res, next) {
  if (!Buffer.isBuffer(req.body)) return res.sendStatus(400);
  try {
    const result = await processRazorpayWebhook(req.body, req.get('x-razorpay-signature'), req.get('x-razorpay-event-id'));
    return res.status(200).json(result);
  } catch (error) { return next(error); }
}

export async function simulateSubscription(req, res, next) {
  try {
    const result = await simulateMockSubscriptionActivation(req.auth.vendorId);
    return res.status(200).json({ data: { ...result, simulated: true } });
  } catch (error) { return next(error); }
}
