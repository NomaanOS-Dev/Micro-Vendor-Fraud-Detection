import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

export const SUBSCRIPTION_PLANS = Object.freeze({
  basic: { label: 'Basic', amountPaise: 49_900, transactionLimit: 500 },
  pro: { label: 'Pro', amountPaise: 99_900, transactionLimit: 5_000 },
  enterprise: { label: 'Enterprise', amountPaise: 499_900, transactionLimit: null },
});

function unavailable() {
  const error = new Error('Razorpay billing is not enabled. Configure RAZORPAY_MODE and provider credentials.');
  error.status = 503;
  error.code = 'BILLING_DISABLED';
  return error;
}

async function razorpayRequest(method, path, body) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) throw unavailable();
  const credentials = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { authorization: `Basic ${credentials}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Razorpay could not process this billing request.');
    error.status = 502;
    error.code = 'RAZORPAY_PROVIDER_ERROR';
    throw error;
  }
  return result;
}

export async function createSubscription(vendorId, planCode) {
  const plan = SUBSCRIPTION_PLANS[planCode];
  if (!plan) {
    const error = new Error('Choose one of the available subscription plans.');
    error.status = 400;
    error.code = 'INVALID_PLAN';
    throw error;
  }
  if (env.RAZORPAY_MODE === 'disabled') throw unavailable();
  const existing = await prisma.subscription.findUnique({ where: { vendorId } });
  if (existing?.providerSubscriptionId && !['cancelled', 'completed', 'expired'].includes(existing.status)) {
    const error = new Error('A subscription is already active or awaiting payment.');
    error.status = 409;
    error.code = 'SUBSCRIPTION_EXISTS';
    throw error;
  }

  let providerSubscriptionId;
  let checkoutUrl = null;
  if (env.RAZORPAY_MODE === 'mock') {
    providerSubscriptionId = `sub_mock_${randomUUID().replaceAll('-', '')}`;
  } else {
    const planId = env[`RAZORPAY_PLAN_${planCode.toUpperCase()}`];
    if (!planId) {
      const error = new Error(`Set RAZORPAY_PLAN_${planCode.toUpperCase()} before enabling this plan.`);
      error.status = 503;
      error.code = 'RAZORPAY_PLAN_NOT_CONFIGURED';
      throw error;
    }
    const result = await razorpayRequest('POST', '/subscriptions', {
      plan_id: planId,
      total_count: 120,
      quantity: 1,
      customer_notify: 1,
      notes: { vendor_id: vendorId, plan_code: planCode },
    });
    providerSubscriptionId = result.id;
    checkoutUrl = result.short_url ?? null;
  }
  const subscription = await prisma.subscription.upsert({
    where: { vendorId },
    create: { vendorId, planCode, status: 'created', providerSubscriptionId },
    update: { planCode, status: 'created', providerSubscriptionId, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    select: { id: true, planCode: true, status: true, providerSubscriptionId: true, currentPeriodEnd: true },
  });
  return { subscription, checkoutUrl, monthlyPriceInr: plan.amountPaise / 100, providerMode: env.RAZORPAY_MODE };
}

export async function cancelSubscription(vendorId) {
  const subscription = await prisma.subscription.findUnique({ where: { vendorId } });
  if (!subscription || !subscription.providerSubscriptionId || ['cancelled', 'completed', 'expired'].includes(subscription.status)) {
    const error = new Error('There is no active subscription to cancel.');
    error.status = 404;
    error.code = 'SUBSCRIPTION_NOT_FOUND';
    throw error;
  }
  if (env.RAZORPAY_MODE === 'live') {
    await razorpayRequest('POST', `/subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}/cancel`, { cancel_at_cycle_end: 1 });
  }
  return prisma.subscription.update({ where: { vendorId }, data: { cancelAtPeriodEnd: true }, select: { planCode: true, status: true, cancelAtPeriodEnd: true, currentPeriodEnd: true } });
}

export async function getBillingAccess(vendorId) {
  const subscription = await prisma.subscription.findUnique({ where: { vendorId }, select: { planCode: true, status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } });
  const paid = Boolean(subscription && subscription.status === 'active' && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > new Date()));
  const plan = paid ? SUBSCRIPTION_PLANS[subscription.planCode] : null;
  const transactionLimit = paid ? plan?.transactionLimit ?? null : 100;
  const usage = transactionLimit !== null
    ? await prisma.transaction.count({ where: { vendorId, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } })
    : 0;
  return {
    subscription: subscription ?? { planCode: 'free', status: 'inactive', currentPeriodEnd: null, cancelAtPeriodEnd: false },
    paidAccess: paid,
    transactionLimit,
    transactionsUsedThisMonth: usage,
    providerMode: env.RAZORPAY_MODE,
    plans: Object.entries(SUBSCRIPTION_PLANS).map(([code, value]) => ({ code, name: value.label, monthlyPriceInr: value.amountPaise / 100, transactionLimit: value.transactionLimit })),
  };
}

export async function createBillingOrder(vendorId, amountInr) {
  if (env.RAZORPAY_MODE === 'disabled') throw unavailable();
  const amount = Math.round(amountInr * 100);
  const order = env.RAZORPAY_MODE === 'mock'
    ? { id: `order_mock_${randomUUID().replaceAll('-', '')}`, currency: 'INR' }
    : await razorpayRequest('POST', '/orders', { amount, currency: 'INR', receipt: randomUUID().slice(0, 40), notes: { vendor_id: vendorId, purpose: 'vendor_fraud_saas_payment' } });
  await prisma.billingPayment.create({ data: { vendorId, providerOrderId: order.id, amount, currency: 'INR', status: 'created' } });
  return { orderId: order.id, amountInr, currency: order.currency, keyId: env.RAZORPAY_MODE === 'live' ? env.RAZORPAY_KEY_ID : null };
}

export async function verifyBillingPayment(vendorId, { orderId, paymentId, signature }) {
  const payment = await prisma.billingPayment.findFirst({ where: { vendorId, providerOrderId: orderId } });
  if (!payment) {
    const error = new Error('Billing order was not found for this vendor.');
    error.status = 404;
    error.code = 'BILLING_ORDER_NOT_FOUND';
    throw error;
  }
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET || 'local-mock-payment-secret').update(`${orderId}|${paymentId}`).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'hex'); } catch { supplied = Buffer.alloc(0); }
  const valid = env.RAZORPAY_MODE === 'mock'
    ? timingSafeEqual(expected, supplied.length === expected.length ? supplied : Buffer.alloc(expected.length))
    : Boolean(env.RAZORPAY_KEY_SECRET && supplied.length === expected.length && timingSafeEqual(expected, supplied));
  if (!valid) {
    const error = new Error('Payment signature is invalid.');
    error.status = 400;
    error.code = 'PAYMENT_SIGNATURE_INVALID';
    throw error;
  }
  await prisma.billingPayment.updateMany({ where: { id: payment.id, status: 'created' }, data: { providerPaymentId: paymentId, status: 'signature_verified' } });
  const current = await prisma.billingPayment.findUnique({ where: { id: payment.id }, select: { status: true } });
  return { verified: true, status: current.status, note: 'Capture is confirmed only by a verified Razorpay webhook.' };
}

export function makeMockPaymentSignature(orderId, paymentId) {
  return createHmac('sha256', env.RAZORPAY_KEY_SECRET || 'local-mock-payment-secret').update(`${orderId}|${paymentId}`).digest('hex');
}

export function verifyRazorpayWebhookSignature(rawBody, signature) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET || (env.NODE_ENV === 'development' && env.RAZORPAY_MODE === 'mock' ? 'local-mock-billing-secret' : '');
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'hex'); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

export async function simulateMockSubscriptionActivation(vendorId) {
  if (env.NODE_ENV !== 'development' || env.RAZORPAY_MODE !== 'mock') {
    const error = new Error('The billing simulator is only available in local development.');
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  const subscription = await prisma.subscription.findUnique({ where: { vendorId } });
  if (!subscription?.providerSubscriptionId) {
    const error = new Error('Create a mock subscription before simulating activation.');
    error.status = 404;
    error.code = 'SUBSCRIPTION_NOT_FOUND';
    throw error;
  }
  const body = Buffer.from(JSON.stringify({
    event: 'subscription.charged',
    payload: { subscription: { entity: { id: subscription.providerSubscriptionId, current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 } } },
  }));
  const signature = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET || 'local-mock-billing-secret').update(body).digest('hex');
  return processRazorpayWebhook(body, signature, `evt_mock_${randomUUID()}`);
}

export async function processRazorpayWebhook(rawBody, signature, eventId) {
  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    const error = new Error('Webhook signature is invalid.');
    error.status = 401;
    error.code = 'WEBHOOK_SIGNATURE_INVALID';
    throw error;
  }
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch {
    const error = new Error('Webhook payload is invalid.');
    error.status = 400;
    error.code = 'WEBHOOK_INVALID';
    throw error;
  }
  if (!eventId || typeof event.event !== 'string') {
    const error = new Error('Webhook event identifier is missing.');
    error.status = 400;
    error.code = 'WEBHOOK_INVALID';
    throw error;
  }
  const alreadyReceived = await prisma.razorpayWebhookEvent.findUnique({ where: { eventId }, select: { eventId: true } });
  if (alreadyReceived) return { received: true, duplicate: true };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.razorpayWebhookEvent.create({ data: { eventId, eventType: event.event } });
      if (['payment.captured', 'payment.failed'].includes(event.event)) {
        const payment = event.payload?.payment?.entity;
        if (payment?.order_id) {
          const stored = await tx.billingPayment.findUnique({ where: { providerOrderId: payment.order_id }, select: { amount: true, currency: true } });
          if (!stored) return;
          const amountMatches = payment.amount === stored.amount && payment.currency === stored.currency;
          await tx.billingPayment.updateMany({
            where: { providerOrderId: payment.order_id },
            data: {
              ...(payment.id ? { providerPaymentId: payment.id } : {}),
              status: !amountMatches ? 'amount_mismatch' : (event.event === 'payment.captured' ? 'captured' : 'failed'),
            },
          });
        }
      }
      const subscriptionEventStatus = {
        'subscription.activated': 'authorized',
        'subscription.charged': 'active',
        'subscription.halted': 'halted',
        'subscription.cancelled': 'cancelled',
        'subscription.completed': 'completed',
        'subscription.paused': 'paused',
        'subscription.resumed': 'active',
      }[event.event];
      if (subscriptionEventStatus) {
        const item = event.payload?.subscription?.entity;
        if (item?.id) {
          await tx.subscription.updateMany({
            where: { providerSubscriptionId: item.id },
            data: {
              status: subscriptionEventStatus,
              currentPeriodEnd: item.current_end ? new Date(item.current_end * 1000) : undefined,
              cancelAtPeriodEnd: subscriptionEventStatus === 'cancelled',
            },
          });
        }
      }
    });
    return { received: true, duplicate: false };
  } catch (error) {
    if (error.code === 'P2002') return { received: true, duplicate: true };
    throw error;
  }
}
