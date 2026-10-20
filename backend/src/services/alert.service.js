import { prisma } from '../config/database.js';

function notFoundError() {
  const error = new Error('Alert was not found.');
  error.status = 404;
  error.code = 'ALERT_NOT_FOUND';
  return error;
}

const alertRelations = {
  transaction: {
    select: {
      id: true,
      utr: true,
      amount: true,
      occurredAt: true,
      riskScore: true,
      riskLevel: true,
      status: true,
    },
  },
};

export async function listAlerts(vendorId, { cursor, limit, alertType, reviewed }) {
  const where = {
    vendorId,
    ...(alertType ? { alertType } : {}),
    ...(reviewed === undefined ? {} : { reviewedAt: reviewed ? { not: null } : null }),
  };
  const rows = await prisma.fraudAlert.findMany({
    where,
    include: alertRelations,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1).id : null };
}

export async function getAlert(vendorId, alertId) {
  const alert = await prisma.fraudAlert.findFirst({
    where: { id: alertId, vendorId },
    include: alertRelations,
  });
  if (!alert) throw notFoundError();
  return alert;
}

export async function acknowledgeAlert(vendorId, alertId) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.fraudAlert.findFirst({ where: { id: alertId, vendorId } });
    if (!existing) throw notFoundError();
    if (existing.reviewedAt) return existing;

    const reviewedAt = new Date();
    const changed = await tx.fraudAlert.updateMany({
      where: { id: alertId, vendorId, reviewedAt: null },
      data: { reviewedAt },
    });
    if (changed.count > 0) {
      await tx.auditLog.create({
        data: {
          vendorId,
          actorType: 'vendor',
          action: 'fraud_alert.acknowledged',
          entityType: 'fraud_alert',
          entityId: alertId,
        },
      });
    }
    return tx.fraudAlert.findFirst({ where: { id: alertId, vendorId }, include: alertRelations });
  });
}

