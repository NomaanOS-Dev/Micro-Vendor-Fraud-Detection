import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';

process.env.NODE_ENV = 'development';
process.env.OTP_PROVIDER = 'mock';
process.env.WHATSAPP_PROVIDER = 'mock';
process.env.RAZORPAY_MODE = 'mock';
process.env.RAZORPAY_KEY_SECRET = 'integration-test-payment-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'integration-test-webhook-secret';
process.env.WHATSAPP_VERIFY_TOKEN = 'integration-test-whatsapp-verify';
process.env.WHATSAPP_APP_SECRET = 'integration-test-whatsapp-secret';
const testSchema = `test_${randomUUID().replaceAll('-', '')}`;
const testDatabaseUrl = new URL(process.env.DATABASE_URL);
testDatabaseUrl.searchParams.set('schema', testSchema);
process.env.DATABASE_URL = testDatabaseUrl.toString();
try {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: process.cwd(), env: process.env, stdio: 'ignore' });
} catch {
  throw new Error('Could not prepare an isolated PostgreSQL schema for integration tests.');
}

const { app } = await import('../src/app.js');
const { prisma } = await import('../src/config/database.js');
const { drainNotificationQueue } = await import('../src/services/notification.service.js');

let server;
let baseUrl;
const vendorIds = [];
const testPhone = `+1202555${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;

async function api(path, token, options = {}) {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...options,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
}

async function expectStatus(response, status) {
  if (response.status !== status) throw new Error(`Expected HTTP ${status}, received ${response.status}: ${await response.text()}`);
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (vendorIds.length) await Promise.all(vendorIds.map((id) => rm(`uploads/${id}`, { recursive: true, force: true })));
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma.$executeRawUnsafe(`DROP SCHEMA "${testSchema}" CASCADE`);
  await prisma.$disconnect();
});

test('vendor transaction, evidence, OTP, consent, notifications, and billing stay scoped and provider-safe', async () => {
  const suffix = randomUUID();
  const register = async (name) => {
    const response = await api('/auth/register', null, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, email: `${name}.${suffix}@example.test`, password: 'Strong-Test-Password-123!' }),
    });
    await expectStatus(response, 201);
    const account = (await response.json()).data;
    vendorIds.push(account.vendor.id);
    return account;
  };
  const owner = await register('EvidenceOwner');
  const other = await register('OtherVendor');
  const validLogin = await api('/auth/login', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: owner.vendor.email, password: 'Strong-Test-Password-123!' }) });
  await expectStatus(validLogin, 200);
  const failedLogin = await api('/auth/login', null, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: owner.vendor.email, password: 'not-the-password' }) });
  assert.equal(failedLogin.status, 401);
  const transactionPayload = { utr: `TEST${suffix.replaceAll('-', '').slice(0, 12)}`, amount: '200.00', expected_amount: '200.00', date: new Date(Date.now() - 60_000).toISOString() };

  const initialResponse = await api('/transaction/validate', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(transactionPayload) });
  await expectStatus(initialResponse, 201);
  const initial = (await initialResponse.json()).data;
  assert.equal(initial.validation.isDuplicate, false);
  assert.equal(initial.risk.factors.some((factor) => factor.rule_code === 'metadata_missing'), false, 'optional absent evidence must not add a risk factor');
  const ownerTransactionId = initial.transaction.id;
  assert.equal(initial.transaction.paymentVerificationStatus, 'unverified');

  const customerResponse = await api('/customers', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Tenant Test Customer', phone: '+12025550001' }) });
  await expectStatus(customerResponse, 201);
  const customer = (await customerResponse.json()).data;
  const crossTenantCustomer = await api(`/customers/${customer.id}`, other.accessToken);
  assert.equal(crossTenantCustomer.status, 404);
  const otherTransactions = await api('/transactions?limit=100', other.accessToken);
  assert.equal((await otherTransactions.json()).data.some((item) => item.id === ownerTransactionId), false);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const form = new FormData();
  form.set('utr', `IMAGE${suffix.replaceAll('-', '').slice(0, 12)}`);
  form.set('amount', '500.00');
  form.set('date', new Date(Date.now() - 60_000).toISOString());
  form.set('evidence', new Blob([png], { type: 'image/png' }), 'payment.png');
  const uploadResponse = await api('/transaction/validate', owner.accessToken, { method: 'POST', body: form });
  await expectStatus(uploadResponse, 201);
  const uploaded = (await uploadResponse.json()).data.transaction;
  assert.ok(uploaded.evidencePath === undefined, 'absolute storage path must never be returned');
  const listed = await api('/transactions?limit=100', owner.accessToken);
  assert.equal(listed.status, 200);
  const uploadedListed = (await listed.json()).data.find((item) => item.id === uploaded.id);
  assert.ok(uploadedListed.evidenceUrl);
  const image = await api(uploadedListed.evidenceUrl.replace('/api/v1', ''), owner.accessToken);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const crossTenant = await api(uploadedListed.evidenceUrl.replace('/api/v1', ''), other.accessToken);
  assert.equal(crossTenant.status, 404);

  const invalidForm = new FormData();
  invalidForm.set('utr', `BAD${suffix.replaceAll('-', '').slice(0, 12)}`);
  invalidForm.set('amount', '100');
  invalidForm.set('date', new Date().toISOString());
  invalidForm.set('evidence', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
  const invalidUpload = await api('/transaction/validate', owner.accessToken, { method: 'POST', body: invalidForm });
  assert.equal(invalidUpload.status, 400);

  const otpRequest = await api('/auth/phone-otp/request', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: testPhone }) });
  await expectStatus(otpRequest, 202);
  const challengeId = (await otpRequest.json()).data.challengeId;
  const badOtp = await api('/auth/phone-otp/verify', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, code: '000000' }) });
  assert.equal(badOtp.status, 400);
  const goodOtp = await api('/auth/phone-otp/verify', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge_id: challengeId, code: '123456' }) });
  await expectStatus(goodOtp, 200);
  const consent = await api('/notification-settings', owner.accessToken, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whatsapp_alerts_enabled: true }) });
  await expectStatus(consent, 200);

  const duplicate = await api('/transaction/validate', owner.accessToken, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...transactionPayload, expected_amount: '250.00' }),
  });
  await expectStatus(duplicate, 201);
  const duplicateResult = (await duplicate.json()).data;
  assert.equal(duplicateResult.validation.isDuplicate, true);
  assert.ok(duplicateResult.risk.factors.some((factor) => factor.rule_code === 'duplicate_utr'));
  assert.ok(duplicateResult.risk.factors.some((factor) => factor.rule_code === 'amount_mismatch'));
  const ownerAlertsResponse = await api('/alerts?limit=100', owner.accessToken);
  const ownerAlerts = (await ownerAlertsResponse.json()).data;
  assert.ok(ownerAlerts.length > 0);
  const privateAlertId = ownerAlerts[0].id;
  const crossTenantAlert = await api(`/alerts/${privateAlertId}`, other.accessToken);
  assert.equal(crossTenantAlert.status, 404);
  const crossTenantReview = await api(`/alerts/${privateAlertId}/acknowledge`, other.accessToken, { method: 'POST' });
  assert.equal(crossTenantReview.status, 404);
  await drainNotificationQueue();
  const notification = await prisma.notificationJob.findFirst({ where: { vendorId: owner.vendor.id } });
  assert.equal(notification?.status, 'sent');
  assert.equal(await prisma.notificationJob.count({ where: { vendorId: other.vendor.id } }), 0);
  const pendingHighRisk = await api('/transaction/validate', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...transactionPayload, expected_amount: '300.00' }) });
  await expectStatus(pendingHighRisk, 201);
  const optOut = await api('/notification-settings', owner.accessToken, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ whatsapp_alerts_enabled: false }) });
  await expectStatus(optOut, 200);
  await drainNotificationQueue();
  const notificationJobs = await prisma.notificationJob.findMany({ where: { vendorId: owner.vendor.id }, orderBy: { createdAt: 'desc' } });
  assert.equal(notificationJobs[0].status, 'cancelled', 'queued alerts are suppressed if consent is withdrawn before delivery');

  const plan = await api('/billing/subscription', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'pro' }) });
  await expectStatus(plan, 201);
  let access = await api('/billing', owner.accessToken);
  assert.equal((await access.json()).data.paidAccess, false, 'creating a subscription must not grant paid access');
  const activation = await api('/billing/dev/simulate-subscription-activation', owner.accessToken, { method: 'POST' });
  await expectStatus(activation, 200);
  access = await api('/billing', owner.accessToken);
  assert.equal((await access.json()).data.paidAccess, true, 'only the mock signed provider event activates the plan');

  const cancel = await api('/billing/subscription/cancel', owner.accessToken, { method: 'POST' });
  await expectStatus(cancel, 200);
  const otherBilling = await api('/billing', other.accessToken);
  assert.equal((await otherBilling.json()).data.paidAccess, false, 'another vendor cannot see or inherit the paid plan');

  const orderResponse = await api('/billing/orders', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount_inr: 5 }) });
  await expectStatus(orderResponse, 201);
  const order = (await orderResponse.json()).data;
  const paymentId = `pay_test_${randomUUID().replaceAll('-', '')}`;
  const paymentSignature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${order.orderId}|${paymentId}`).digest('hex');
  const badPayment = await api('/billing/payments/verify', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: order.orderId, payment_id: paymentId, signature: '0'.repeat(64) }) });
  assert.equal(badPayment.status, 400);
  const validPayment = await api('/billing/payments/verify', owner.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: order.orderId, payment_id: paymentId, signature: paymentSignature }) });
  await expectStatus(validPayment, 200);
  assert.equal((await validPayment.json()).data.status, 'signature_verified');
  const crossTenantPayment = await api('/billing/payments/verify', other.accessToken, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_id: order.orderId, payment_id: paymentId, signature: paymentSignature }) });
  assert.equal(crossTenantPayment.status, 404);
  const capturedEvent = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: order.orderId, amount: 500, currency: 'INR' } } } }));
  const webhookSignature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(capturedEvent).digest('hex');
  const webhookHeaders = { 'content-type': 'application/json', 'x-razorpay-signature': webhookSignature, 'x-razorpay-event-id': `evt_${randomUUID()}` };
  const capturedWebhook = await api('/billing/razorpay/webhook', null, { method: 'POST', headers: webhookHeaders, body: capturedEvent });
  await expectStatus(capturedWebhook, 200);
  assert.equal((await prisma.billingPayment.findUnique({ where: { providerOrderId: order.orderId } })).status, 'captured');
  const duplicateWebhook = await api('/billing/razorpay/webhook', null, { method: 'POST', headers: webhookHeaders, body: capturedEvent });
  await expectStatus(duplicateWebhook, 200);
  assert.equal((await duplicateWebhook.json()).duplicate, true);
  const invalidSignatureWebhook = await api('/billing/razorpay/webhook', null, { method: 'POST', headers: { ...webhookHeaders, 'x-razorpay-event-id': `evt_bad_${randomUUID()}`, 'x-razorpay-signature': '0'.repeat(64) }, body: capturedEvent });
  assert.equal(invalidSignatureWebhook.status, 401);

  const metaVerify = await api('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=integration-test-whatsapp-verify&hub.challenge=abc123', null);
  assert.equal(metaVerify.status, 200);
  assert.equal(await metaVerify.text(), 'abc123');
  const metaPayload = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
  const metaSignature = `sha256=${createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(metaPayload).digest('hex')}`;
  const metaWebhook = await api('/whatsapp/webhook', null, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': metaSignature }, body: metaPayload });
  assert.equal(metaWebhook.status, 200);

  const own = await api(`/transactions/${ownerTransactionId}/evidence`, owner.accessToken);
  assert.equal(own.status, 404, 'transaction without uploaded image must not return evidence');
});
