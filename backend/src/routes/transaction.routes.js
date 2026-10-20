import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/require-auth.js';
import { getTransactions, validateAndIngest } from '../controllers/transaction.controller.js';
import { streamEvidence } from '../controllers/evidence.controller.js';

export const transactionRouter = Router();

transactionRouter.use(requireAuth);
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
transactionRouter.post('/transaction/validate', evidenceUpload.single('evidence'), validateAndIngest);
transactionRouter.post('/transactions', evidenceUpload.single('evidence'), validateAndIngest);
transactionRouter.get('/transactions', getTransactions);
transactionRouter.get('/transactions/:transactionId/evidence', streamEvidence);

