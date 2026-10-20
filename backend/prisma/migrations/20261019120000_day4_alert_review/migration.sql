ALTER TABLE "fraud_alerts"
ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);

CREATE INDEX "fraud_alerts_vendor_id_reviewed_at_created_at_idx"
ON "fraud_alerts"("vendor_id", "reviewed_at", "created_at" DESC);
