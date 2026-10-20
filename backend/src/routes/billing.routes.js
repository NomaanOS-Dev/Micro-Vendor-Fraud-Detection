import { Router } from 'express';
import { createOrder, getBilling, simulateSubscription, startSubscription, stopSubscription, verifyPayment } from '../controllers/billing.controller.js';
import { requireAuth } from '../middleware/require-auth.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);
billingRouter.get('/billing', getBilling);
billingRouter.post('/billing/subscription', startSubscription);
billingRouter.post('/billing/subscription/cancel', stopSubscription);
billingRouter.post('/billing/orders', createOrder);
billingRouter.post('/billing/payments/verify', verifyPayment);
billingRouter.post('/billing/dev/simulate-subscription-activation', simulateSubscription);
