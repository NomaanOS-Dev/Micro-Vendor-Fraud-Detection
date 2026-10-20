import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.js';
import { checkByPhone, create, get, list, update } from '../controllers/customer.controller.js';

export const customerRouter = Router();

customerRouter.use(requireAuth);
customerRouter.post('/customer/create', create);
customerRouter.get('/customer/check', checkByPhone);
customerRouter.get('/customers', list);
customerRouter.post('/customers', create);
customerRouter.get('/customers/:customerId', get);
customerRouter.patch('/customers/:customerId', update);

