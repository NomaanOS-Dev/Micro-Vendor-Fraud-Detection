ALTER TABLE "transactions"
  ADD COLUMN "evidence_path" VARCHAR(512),
  ADD COLUMN "evidence_mime_type" VARCHAR(80),
  ADD COLUMN "evidence_size" INTEGER;
ALTER TABLE "transactions"
  ADD COLUMN "payment_verification_status" VARCHAR(32) NOT NULL DEFAULT 'unverified';
