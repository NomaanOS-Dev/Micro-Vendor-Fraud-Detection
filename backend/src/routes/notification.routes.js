import { Router } from 'express';
import { getSettings, updateSettings } from '../controllers/notification.controller.js';
import { requireAuth } from '../middleware/require-auth.js';

export const notificationRouter = Router();
notificationRouter.use(requireAuth);
notificationRouter.get('/notification-settings', getSettings);
notificationRouter.patch('/notification-settings', updateSettings);
