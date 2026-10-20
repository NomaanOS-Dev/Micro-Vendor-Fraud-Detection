import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { transactionRouter } from './routes/transaction.routes.js';
import { customerRouter } from './routes/customer.routes.js';
import { alertRouter } from './routes/alert.routes.js';
import { notificationRouter } from './routes/notification.routes.js';
import { receiveMetaWebhook, verifyMetaWebhook } from './controllers/notification.controller.js';
import { razorpayWebhook } from './controllers/billing.controller.js';
import { billingRouter } from './routes/billing.routes.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
app.get('/api/v1/whatsapp/webhook', verifyMetaWebhook);
app.post('/api/v1/whatsapp/webhook', express.raw({ type: 'application/json', limit: '1mb' }), receiveMetaWebhook);
app.post('/api/v1/billing/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhook);
app.use(express.json({ limit: '1mb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));

app.use('/api/v1', healthRouter);
app.use('/api/v1', authRouter);
app.use('/api/v1', transactionRouter);
app.use('/api/v1', customerRouter);
app.use('/api/v1', alertRouter);
app.use('/api/v1', notificationRouter);
app.use('/api/v1', billingRouter);
app.use(notFoundHandler);
app.use(errorHandler);

