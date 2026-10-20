ALTER TABLE "vendors"
  ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6),
  ADD COLUMN "whatsapp_alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whatsapp_opted_in_at" TIMESTAMPTZ(6);

CREATE TABLE "otp_challenges" (
  "id" UUID NOT NULL,
  "vendor_id" UUID NOT NULL,
  "phone" VARCHAR(32) NOT NULL,
  "provider_ref" VARCHAR(160),
  "code_hash" VARCHAR(128),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "otp_challenges_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "otp_challenges_vendor_id_created_at_idx" ON "otp_challenges"("vendor_id", "created_at" DESC);

CREATE TABLE "subscriptions" (
  "id" UUID NOT NULL,
  "vendor_id" UUID NOT NULL,
  "plan_code" VARCHAR(40) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'inactive',
  "provider_subscription_id" VARCHAR(100),
  "current_period_end" TIMESTAMPTZ(6),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "subscriptions_vendor_id_key" ON "subscriptions"("vendor_id");
CREATE UNIQUE INDEX "subscriptions_provider_subscription_id_key" ON "subscriptions"("provider_subscription_id");

CREATE TABLE "billing_payments" (
  "id" UUID NOT NULL,
  "vendor_id" UUID NOT NULL,
  "provider_order_id" VARCHAR(100) NOT NULL,
  "provider_payment_id" VARCHAR(100),
  "amount" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
  "status" VARCHAR(32) NOT NULL DEFAULT 'created',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "billing_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "billing_payments_provider_order_id_key" ON "billing_payments"("provider_order_id");
CREATE UNIQUE INDEX "billing_payments_provider_payment_id_key" ON "billing_payments"("provider_payment_id");
CREATE INDEX "billing_payments_vendor_id_created_at_idx" ON "billing_payments"("vendor_id", "created_at" DESC);

CREATE TABLE "razorpay_webhook_events" (
  "event_id" VARCHAR(100) NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "razorpay_webhook_events_pkey" PRIMARY KEY ("event_id")
);

CREATE TABLE "notification_jobs" (
  "id" UUID NOT NULL,
  "vendor_id" UUID NOT NULL,
  "channel" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_jobs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "notification_jobs_status_available_at_idx" ON "notification_jobs"("status", "available_at");
