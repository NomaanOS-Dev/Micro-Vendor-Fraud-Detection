import { prisma } from '../config/database.js';

function conflictError() {
  const error = new Error('A customer with this phone number already exists for this vendor.');
  error.status = 409;
  error.code = 'CUSTOMER_EXISTS';
  return error;
}

function notFoundError() {
  const error = new Error('Customer was not found.');
  error.status = 404;
  error.code = 'CUSTOMER_NOT_FOUND';
  return error;
}

export async function createCustomer(vendorId, input) {
  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          vendorId,
          name: input.name,
          phone: input.phone ?? null,
          email: input.email?.toLowerCase() ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          vendorId,
          actorType: 'vendor',
          action: 'customer.created',
          entityType: 'customer',
          entityId: customer.id,
        },
      });
      return customer;
    });
  } catch (error) {
    if (error.code === 'P2002') throw conflictError();
    throw error;
  }
}

export async function findCustomerByPhone(vendorId, phone) {
  const customer = await prisma.customer.findFirst({
    where: { vendorId, phone },
    select: { id: true, name: true, phone: true, reputationScore: true, flaggedCount: true, createdAt: true },
  });
  return { exists: Boolean(customer), customer };
}

export async function listCustomers(vendorId, { cursor, limit, search, reputationBelow }) {
  const where = {
    vendorId,
    ...(reputationBelow !== undefined ? { reputationScore: { lt: reputationBelow } } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ],
    } : {}),
  };
  const rows = await prisma.customer.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1).id : null };
}

export async function getCustomer(vendorId, customerId) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, vendorId },
    include: {
      transactions: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          utr: true,
          amount: true,
          occurredAt: true,
          riskScore: true,
          riskLevel: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });
  if (!customer) throw notFoundError();
  const { transactions, ...profile } = customer;
  return { customer: profile, recentTransactions: transactions };
}

export async function updateCustomer(vendorId, customerId, input) {
  const data = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.email !== undefined) data.email = input.email?.toLowerCase() ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      const result = await tx.customer.updateMany({ where: { id: customerId, vendorId }, data });
      if (result.count === 0) throw notFoundError();
      const customer = await tx.customer.findFirst({ where: { id: customerId, vendorId } });
      await tx.auditLog.create({
        data: {
          vendorId,
          actorType: 'vendor',
          action: 'customer.updated',
          entityType: 'customer',
          entityId: customerId,
          metadata: { fields: Object.keys(data) },
        },
      });
      return customer;
    });
  } catch (error) {
    if (error.code === 'P2002') throw conflictError();
    throw error;
  }
}

