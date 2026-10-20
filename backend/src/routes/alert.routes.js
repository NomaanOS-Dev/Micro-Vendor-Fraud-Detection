import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { acknowledge, get, list } from '../controllers/alert.controller.js';

export const alertRouter = Router();

alertRouter.use(requireAuth);
alertRouter.get('/alerts', list);
alertRouter.get('/alerts/:alertId', get);
alertRouter.post('/alerts/:alertId/acknowledge', acknowledge);

