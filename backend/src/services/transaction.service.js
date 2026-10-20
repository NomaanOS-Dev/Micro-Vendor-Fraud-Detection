import { prisma } from '../config/database.js';
import { scoreTransaction } from './fraud-engine.client.js';
import { enqueueVendorFraudAlert } from './notification.service.js';

export async function ingestTransaction(vendorId, input) {
  return prisma.$transaction(async (tx) => {
    // Serialize one vendor's small-volume intake so duplicate and structuring
    // checks see the preceding committed submissions before this one is scored.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${vendorId})) IS NULL AS acquired`;

    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, timezone: true, phone: true, phoneVerifiedAt: true, whatsappAlertsEnabled: true },
    });
    if (!vendor) {
      const error = new Error('Vendor account was not found.');
      error.status = 401;
      error.code = 'VENDOR_NOT_FOUND';
      throw error;
    }

    const subscription = await tx.subscription.findUnique({ where: { vendorId } });
    const paid = subscription?.status === 'active' && (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > new Date());
    const planLimit = paid
      ? ({ basic: 500, pro: 5_000, enterprise: Infinity }[subscription.planCode] ?? 100)
      : 100;
    if (Number.isFinite(planLimit)) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const used = await tx.transaction.count({ where: { vendorId, createdAt: { gte: monthStart } } });
      if (used >= planLimit) {
        const error = new Error('This workspace reached its monthly transaction limit. Upgrade its plan to continue.');
        error.status = 402;
        error.code = 'PLAN_LIMIT_REACHED';
        throw error;
      }
    }

    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, vendorId },
        select: { id: true },
      });
      if (!customer) {
        const error = new Error('Customer was not found for this vendor.');
        error.status = 404;
        error.code = 'CUSTOMER_NOT_FOUND';
        throw error;
      }
    }

    const existingCount = await tx.transaction.count({ where: { vendorId, utr: input.utr } });
    const isDuplicate = existingCount > 0;
    const now = new Date();
    const recentSmallTransactions = await tx.transaction.count({
      where: {
        vendorId,
        amount: { lt: '500.00' },
        createdAt: { gte: new Date(now.getTime() - 10 * 60_000) },
      },
    });
    const rules = await tx.riskRule.findMany({
      where: { enabled: true },
      select: { ruleCode: true, score: true },
    });
    const risk = await scoreTransaction({
      utr: input.utr,
      amount: input.amount,
      expected_amount: input.expectedAmount ?? null,
      occurred_at: input.occurredAt.toISOString(),
      now: now.toISOString(),
      timezone: vendor.timezone,
      duplicate_utr: isDuplicate,
      recent_small_transaction_count: recentSmallTransactions + (Number(input.amount) < 500 ? 1 : 0),
      // The engine contract predates explicit upload state. For a transaction
      // with no upload, supply neutral markers so legacy running engines do
      // not mistake absent optional evidence for missing file metadata.
      screenshot_metadata: input.evidencePath ? (input.screenshotMetadata ?? {}) : { captured_at: 'not-provided', device: 'not-provided' },
      rules: rules.map((rule) => ({ rule_code: rule.ruleCode, score: rule.score })),
    });

    const transaction = await tx.transaction.create({
      data: {
        vendorId,
        customerId: input.customerId ?? null,
        utr: input.utr,
        amount: input.amount,
        occurredAt: input.occurredAt,
        expectedAmount: input.expectedAmount ?? null,
        screenshotUrl: input.screenshotUrl ?? null,
        screenshotMetadata: input.screenshotMetadata,
        evidencePath: input.evidencePath ?? null,
        evidenceMimeType: input.evidenceMimeType ?? null,
        evidenceSize: input.evidenceSize ?? null,
        riskScore: risk.risk_score,
        riskLevel: risk.risk_level,
        riskFactors: risk.factors,
        scoredAt: now,
        status: risk.transaction_status,
      },
    });

    if (risk.factors.length > 0) {
      await tx.fraudAlert.createMany({
        data: risk.factors.map((factor) => ({
          transactionId: transaction.id,
          vendorId,
          alertType: factor.rule_code,
          description: factor.description,
          score: factor.score,
        })),
      });
    }

    await enqueueVendorFraudAlert(tx, vendor, transaction, risk);

    let customerReputation = null;
    if (input.customerId && risk.factors.length > 0) {
      await tx.$executeRaw`
        UPDATE "customers"
        SET "reputation_score" = GREATEST("reputation_score" - 10, 0),
            "flagged_count" = "flagged_count" + 1
        WHERE "id" = ${input.customerId}::uuid AND "vendor_id" = ${vendorId}::uuid
      `;
      customerReputation = await tx.customer.findFirst({
        where: { id: input.customerId, vendorId },
        select: { reputationScore: true, flaggedCount: true },
      });
      await tx.auditLog.create({
        data: {
          vendorId,
          actorType: 'system',
          action: 'customer.reputation_adjusted',
          entityType: 'customer',
          entityId: input.customerId,
          metadata: { transactionId: transaction.id, riskScore: risk.risk_score, change: -10 },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        vendorId,
        actorType: 'vendor',
        action: isDuplicate ? 'transaction.duplicate_submitted' : 'transaction.ingested',
        entityType: 'transaction',
        entityId: transaction.id,
        metadata: {
          duplicateUtr: isDuplicate,
          riskScore: risk.risk_score,
          riskLevel: risk.risk_level,
          rules: risk.factors.map((factor) => factor.rule_code),
        },
      },
    });

    return {
      transaction: (() => {
        const { evidencePath, ...record } = transaction;
        return { ...record, evidenceUrl: evidencePath ? `/api/v1/transactions/${record.id}/evidence` : null };
      })(),
      risk,
      customerReputation,
      validation: {
        valid: !isDuplicate,
        code: isDuplicate ? 'duplicate_utr' : 'valid',
        isDuplicate,
      },
    };
  // READ COMMITTED gives the post-lock count query a fresh snapshot after a
  // concurrent transaction holding the same lock has committed.
  }, { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 10_000 });
}

export async function listTransactions(vendorId, { cursor, limit }) {
  const rows = await prisma.transaction.findMany({
    where: { vendorId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { alerts: { select: { id: true, alertType: true, description: true, score: true, createdAt: true, reviewedAt: true } } },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data: data.map(({ evidencePath, ...transaction }) => ({
      ...transaction,
      evidenceUrl: evidencePath ? `/api/v1/transactions/${transaction.id}/evidence` : null,
    })),
    nextCursor: hasMore ? data.at(-1).id : null,
  };
}

