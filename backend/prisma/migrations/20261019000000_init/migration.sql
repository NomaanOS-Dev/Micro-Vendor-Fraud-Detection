-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('valid', 'suspicious', 'fraud');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low_risk', 'medium_risk', 'high_risk');

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32),
    "password_hash" VARCHAR(255) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "email" VARCHAR(320),
    "reputation_score" SMALLINT NOT NULL DEFAULT 100,
    "flagged_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "customer_id" UUID,
    "utr" VARCHAR(64) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "expected_amount" DECIMAL(14,2),
    "screenshot_url" VARCHAR(2048),
    "screenshot_metadata" JSONB,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'low_risk',
    "risk_factors" JSONB,
    "scored_at" TIMESTAMPTZ(6),
    "status" "TransactionStatus" NOT NULL DEFAULT 'valid',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_alerts" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "alert_type" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "ip" VARCHAR(64),
    "device" VARCHAR(512),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_rules" (
    "id" UUID NOT NULL,
    "rule_name" VARCHAR(120) NOT NULL,
    "rule_code" VARCHAR(80) NOT NULL,
    "score" SMALLINT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "risk_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "vendor_id" UUID,
    "actor_type" VARCHAR(40) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(80),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_email_key" ON "vendors"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_phone_key" ON "vendors"("phone");

-- CreateIndex
CREATE INDEX "customers_vendor_id_email_idx" ON "customers"("vendor_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_vendor_id_phone_key" ON "customers"("vendor_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_vendor_id_id_key" ON "customers"("vendor_id", "id");

-- CreateIndex
CREATE INDEX "transactions_vendor_id_utr_idx" ON "transactions"("vendor_id", "utr");

-- CreateIndex
CREATE INDEX "transactions_vendor_id_occurred_at_idx" ON "transactions"("vendor_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_vendor_id_status_created_at_idx" ON "transactions"("vendor_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "transactions_customer_id_occurred_at_idx" ON "transactions"("customer_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_vendor_id_id_key" ON "transactions"("vendor_id", "id");

-- CreateIndex
CREATE INDEX "fraud_alerts_vendor_id_created_at_idx" ON "fraud_alerts"("vendor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fraud_alerts_transaction_id_idx" ON "fraud_alerts"("transaction_id");

-- CreateIndex
CREATE INDEX "login_logs_vendor_id_created_at_idx" ON "login_logs"("vendor_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "risk_rules_rule_code_key" ON "risk_rules"("rule_code");

-- CreateIndex
CREATE INDEX "audit_logs_vendor_id_created_at_idx" ON "audit_logs"("vendor_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_vendor_id_customer_id_fkey" FOREIGN KEY ("vendor_id", "customer_id") REFERENCES "customers"("vendor_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_vendor_id_transaction_id_fkey" FOREIGN KEY ("vendor_id", "transaction_id") REFERENCES "transactions"("vendor_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_alerts" ADD CONSTRAINT "fraud_alerts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the deterministic rule catalog used by the fraud intelligence service.
INSERT INTO "risk_rules" ("id", "rule_name", "rule_code", "score", "description", "enabled", "updated_at") VALUES
  ('82000000-0000-4000-8000-000000000001', 'Duplicate UTR', 'duplicate_utr', 60, 'The same UTR was previously submitted by this vendor.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000002', 'Amount mismatch', 'amount_mismatch', 40, 'Submitted amount differs from the expected amount.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000003', 'Future transaction date', 'future_date', 20, 'Transaction date is later than the current time.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000004', 'Small transaction structuring', 'structuring', 30, 'Five or more transactions below INR 500 were ingested within ten minutes.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000005', 'Suspicious transaction time', 'odd_time', 20, 'Transaction occurred between 1:00 AM and 4:00 AM in vendor local time.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000006', 'Screenshot metadata tampered', 'metadata_tampered', 50, 'Screenshot metadata indicates editing or an integrity failure.', true, CURRENT_TIMESTAMP),
  ('82000000-0000-4000-8000-000000000007', 'Screenshot metadata missing', 'metadata_missing', 50, 'Required screenshot metadata is missing.', true, CURRENT_TIMESTAMP);

-- Keep the evidence trail append-only at the database boundary as well as in application code.
CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

