# Micro-Vendor Fraud Detection SaaS: feature status and test guide

This document compares the running project with the requirements in `Project-1.pdf` and gives a repeatable local test plan. The PDF describes the intended product; its text is not treated as executable instructions. Test records created in this guide are ordinary application data. Use new test emails and unique UTRs each time; do not reset or delete the database to repeat tests.

## 1. Feature status against Project-1.pdf

**Status key:** Implemented = present in this codebase; Partial = a narrower or development-only version exists; Missing = not implemented. A configuration template is not the same as a live deployment or a verified external integration.

| PDF feature / requirement | Status | What this project actually provides |
|---|---|---|
| Vendor registration, email/phone login, JWT | **Partial** | Registration and password login work with email or phone; JWT is required for protected APIs. Login does not require an OTP. Phone OTP verification is an optional Settings feature, not a login second factor. |
| UTR validation | **Partial** | Checks 12-22 alphanumeric characters, normalizes case, and detects repeat submissions for the same vendor. It does not validate a bank-specific UTR pattern or prove a payment exists. |
| Duplicate UTR detection | **Implemented** | Duplicate submissions are retained and flagged, so they remain visible for review. |
| Amount/date mismatch checks | **Implemented** | Expected amount mismatch and future transaction dates are scored and alerted. |
| Transaction anomaly detection | **Partial** | Deterministic rules include duplicates, small-transaction structuring, unusual local time, amount mismatch, future date, and weak screenshot metadata signals. No general behavioral model is present. |
| Screenshot upload and metadata | **Partial** | JPEG, PNG, and WebP uploads are validated, decoded, stored locally per vendor, and read only by the owning vendor. EXIF/editing-software hints are weak risk indicators; this is not image-authenticity or pixel-tampering proof. No S3 storage or image-forensics model is present. |
| Fraud scoring and alerts | **Implemented** | The separate FastAPI service applies configurable rules and returns a risk score and risk level. Alerts can be reviewed. Scores and alerts indicate risk; they do not establish confirmed fraud. |
| Confirmed fraud verdict/status | **Missing** | The system marks a transaction valid or suspicious based on configured signals. It does not adjudicate a transaction as confirmed fraud. |
| Customer reputation | **Implemented** | Customer records are vendor-scoped. A customer linked to a transaction with risk factors loses 10 reputation points (floor 0) and gains one flagged count. This is an application policy, not a proven scam classification. |
| Dashboard: totals, alerts, high-risk count, daily graph, recent alerts | **Partial** | The dashboard shows payment totals, customer/trust metrics, recent transactions, and open alerts. It does not currently show the PDF's daily graph or a dedicated high-risk-count card. |
| Alerts page and review history | **Implemented** | Vendors can view their alerts and acknowledge an alert; review time is retained. |
| PDF evidence/report | **Partial** | A user can download a transaction review PDF with transaction/risk/review details and an unverified-payment disclaimer. It is user-triggered, not automatically generated or archived as an evidence package. |
| OTP through MSG91 | **Partial** | Optional phone verification supports MSG91 configuration. Local development has a mock code (`123456`). Live delivery requires MSG91 credentials/template and has not been exercised against a real account. |
| WhatsApp bot/alerts | **Partial** | Consent-controlled high-risk vendor notifications, a retry queue, Meta Cloud API configuration, and webhook signature handling are implemented. Development mock mode sends no real message. This is alert delivery, not a conversational WhatsApp bot. Live delivery needs Meta credentials, an approved template, webhook setup, and vendor consent. |
| Razorpay payments/subscriptions and plans | **Partial** | Basic/Pro/Enterprise plan rules, subscriptions, cancellation, payment signature checks, and signed webhook processing are implemented. Mock activation is for local development only. Live verification requires Razorpay credentials, plan IDs, webhook configuration, and real provider testing. The Settings page does not provide a full hosted checkout/payment UI for every flow. |
| Bank API integration / actual payment confirmation | **Missing** | No bank API is connected. A UTR entered for a transaction remains `unverified`; only appropriately signed Razorpay events can confirm payments made through this product's own Razorpay flow. |
| Multi-vendor enterprise mode | **Partial** | Separate vendor accounts have tenant-scoped data access. There is no enterprise organization/workspace with multiple users, roles, or shared teams. An Enterprise subscription tier does not add team administration. |
| Zero-trust / tenant isolation | **Implemented** | Protected routes require JWTs, data queries are scoped to the authenticated vendor, and database relations reinforce tenant ownership. Automated integration tests exercise cross-tenant denial. |
| Immutable audit trail | **Implemented** | Important application actions write audit records; the initial database migration creates a database trigger that prevents audit-log updates/deletes. |
| Rate limiting and basic API protections | **Implemented** | Helmet, CORS allowlisting, request limits, authentication rate limits, input validation, safe error handling, and tenant authorization are present. |
| Encrypted data flow / HTTPS | **Partial** | Nginx and Certbot HTTPS configuration/examples are present for deployment. Local development uses HTTP. Application-level encryption-at-rest for database/evidence files is not implemented; secure disk/cloud encryption must be supplied by the deployment environment. |
| AES-256 encrypted logs | **Missing** | Audit records are append-only, but the application does not encrypt audit/log contents with AES-256. |
| S3 for screenshots/logs | **Missing** | Evidence is stored on local disk and in a Docker volume in the production Compose configuration. AWS S3 integration, bucket policies, and S3 encryption are absent. |
| Docker/Nginx deployment | **Partial** | Development and production Compose files, Dockerfiles, and Nginx/Certbot configuration exist. No cloud deployment has been performed, and Docker image/Compose validation was unavailable in the inspected Windows environment because Docker CLI was missing. |
| EC2, RDS, monitoring (Prometheus/Grafana) | **Missing** | There are deployment instructions/configuration, but no AWS resources, Prometheus/Grafana setup, or production monitoring deployment in this repository. |
| AI behavioral model / device fingerprinting / suspicious-login detection | **Missing** | The fraud engine is deterministic and rule-based. Login IP and user-agent are logged, but there is no behavioral model, device fingerprinting, or suspicious-login detector. |
| Go-to-market strategy in the PDF | **Planning content** | WhatsApp groups, Instagram sellers, local shops, referrals, and micro-influencers are business launch suggestions, not implemented application features. |

The implemented risk rules are configurable in PostgreSQL. Current default weights are amount mismatch +40, future date +20, small-transaction structuring +30, unusual local time +20, uploaded-image metadata issue +50, and duplicate UTR +60. Risk is **high** only when the total is greater than 60; a suspicious transaction can have a low or medium score. Never interpret a score as a confirmed fraud verdict.

## 2. Local prerequisites and service checks

This project uses the following local ports:

| Service | Port | Check |
|---|---:|---|
| Next.js dashboard | 3001 | `http://localhost:3001/` |
| Express API | 3000 | `http://localhost:3000/api/v1/health` and `/api/v1/ready` |
| PostgreSQL | 5432 | Readiness endpoint reports database status |
| FastAPI fraud engine | 8000 | `http://localhost:8000/health` |

Use PowerShell to check the tools and listeners:

```powershell
Get-Command node,npm,python,py,docker,psql -ErrorAction SilentlyContinue |
  Select-Object Name,Source
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object LocalPort -In @(3000,3001,5432,8000) |
  Select-Object LocalPort,OwningProcess
```

Check that the app responds:

```powershell
curl.exe -i http://127.0.0.1:3001/
curl.exe -i http://127.0.0.1:3000/api/v1/health
curl.exe -i http://127.0.0.1:3000/api/v1/ready
curl.exe -i http://127.0.0.1:8000/health
curl.exe -i http://127.0.0.1:3000/api/v1/transactions
```

Expected: dashboard, API health, API readiness, and fraud-engine health return HTTP 200. Readiness JSON should report both `database: "ok"` and `fraudEngine: "ok"`. The protected transactions route without a bearer token should return HTTP 401.

### Start the project if it is stopped

Do not overwrite existing private `.env` files. If Docker Compose is available and Docker Desktop is running, from the project root start the local PostgreSQL and fraud-engine containers:

```powershell
docker compose up -d db fraud-engine
docker compose ps
```

In a backend terminal:

```powershell
Set-Location .\backend
npm install
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

In a second terminal:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open `http://localhost:3001`. The frontend API base URL defaults to `http://localhost:3000/api/v1`. If Docker is unavailable, use an already installed/running PostgreSQL service and Python environment for the fraud engine; configure each private service `.env` from the corresponding `.env.example` only when that private file does not already exist. Keep the database password and `FRAUD_ENGINE_API_KEY` consistent between services. Do not put secrets in this document, screenshots, or terminal recordings.

## 3. Automated checks

Run these from separate terminals or sequentially after services/database are available:

```powershell
Set-Location .\backend
npm test
```

```powershell
Set-Location .\frontend
npm test
npm run build
```

Expected: backend integration suite passes; frontend PDF report test passes; `npm run build` exits with code 0. The backend integration suite uses an isolated temporary PostgreSQL schema and exercises registration/login, transaction scoring, evidence validation, OTP, tenant boundaries, consent/notification queue behavior, billing, and signed webhook scenarios. If a test fails, copy the failing assertion and stack trace into your issue notes, but remove any tokens, credentials, or personal data first.

## 4. End-to-end test using the website

Use the mock providers. No paid provider account or real customer phone number is needed for this local walkthrough. Use unique email addresses, phone numbers, and UTRs if repeating it. Do not send real bank payments for these tests.

### A. Register two separate vendors and check login

1. Open `http://localhost:3001` and choose **Create an account**.
2. Register Vendor A with:
   - Business name: `QA Corner Shop A`
   - Email: `qa-vendor-a@example.com` (add a suffix if already registered)
   - Phone: `+919876543210`
   - Password: `Test-Only-Password-123!`
3. Confirm the Overview dashboard appears. Sign out.
4. Register Vendor B with a different email and phone, such as `qa-vendor-b@example.com` and `+919876543211`, using the same test-only password. Sign out.
5. Sign in to Vendor A with its email and password. Sign out and sign in again using its phone and password.
6. Try an incorrect password once. Expected: a safe invalid-credentials message; no session is created. Sign back into Vendor A.

### B. Create a customer and verify the directory

1. Open **Customers** and choose **Add customer**.
2. Enter name `QA Customer One`, phone `+919876500001`, and email `qa-customer@example.com`.
3. Save. Search for `QA Customer One`; confirm it appears in the customer directory.
4. Try adding the same phone number again for Vendor A. Expected: the duplicate is rejected. The same phone is allowed in a different vendor's tenant.

### C. Add a normal transaction

1. Open **Transactions** and choose **Add transaction**.
2. Enter a unique 12-22 character alphanumeric UTR, for example `QA20261019A001`.
3. Enter amount `1250.00`, expected amount `1250.00`, today's date/time, and select `QA Customer One`.
4. Leave screenshot empty and save. Expected: transaction is listed, its payment-verification status is `unverified`, and no missing-screenshot-metadata alert is created just because the optional upload was absent.
5. Confirm the dashboard's recent-transactions and payment totals update.

### D. Exercise validation and fraud rules

Run each test using a unique UTR unless the test explicitly says to repeat one:

| Test | Inputs/action | Expected result |
|---|---|---|
| Invalid UTR length | Enter `QA123` | The form prevents submission (and the API rejects invalid input with HTTP 400). |
| Invalid UTR characters | Enter a 12+ character value containing `-` or a space | Form/API validation rejects it. |
| Invalid amount | Try zero, a negative value, or more than two decimal places | Form/API validation rejects it. |
| Amount mismatch | Amount `900.00`, expected amount `1200.00`, unique UTR | `amount_mismatch` risk factor worth +40; alert appears; not a confirmed fraud verdict. |
| Future date | Use a unique UTR and set date/time to tomorrow | `future_date` +20 appears in the risk factors and an alert is recorded. |
| Duplicate UTR | Re-submit the UTR from section C with amount `900.00` and expected amount `1200.00` | Submission is retained, reports `duplicate_utr`, and also reports `amount_mismatch`; together the default score is 100 (high risk). |
| Structuring | Submit five separate transactions under INR 500 with unique UTRs within 10 minutes | The fifth small transaction should match `structuring` (+30), because the current transaction is included in the threshold. |
| Unusual time | Submit a unique transaction with its occurrence time from 1:00 AM through 3:59 AM Asia/Kolkata time | `odd_time` +20 appears. |
| Optional screenshot | Upload a JPEG, PNG, or WebP image no larger than 5 MB | Upload is accepted only if the image signature and decode are valid. It is available to the owning vendor; metadata can add a weak risk signal. |
| Rejected screenshot | Try a PDF/SVG/renamed non-image file or image over 5 MB | Upload is rejected with a validation/size error; it must not appear as stored evidence. |

If you need a harmless test image, create a 1x1 PNG in your temporary folder and select it in the upload picker:

```powershell
$pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC')
$testImage = Join-Path $env:TEMP 'qa-evidence.png'
[IO.File]::WriteAllBytes($testImage, $pngBytes)
Get-Item $testImage | Select-Object FullName,Length
```

After verifying upload and download, remove only this generated temporary image if desired: `Remove-Item -LiteralPath $testImage`.

For a date input, use the current local date/time shown in the form. The backend requires a valid date or an ISO datetime with timezone. An upload with absent EXIF may be scored as a weak signal; this says nothing conclusive about whether the image is genuine or altered.

### E. Review alerts and download evidence/report

1. Open **Alerts**. Verify amount mismatch, duplicate, future-date, and structuring alerts appear for Vendor A.
2. Click the review/check button on one alert. Expected: it is marked reviewed and its review time is retained; it remains a risk record.
3. Open **Transactions**. For the image-upload transaction, click **Download image** and confirm it downloads for Vendor A.
4. Click **Download report PDF**. Open the PDF and confirm it includes transaction references, amount/date, risk score/factors, review history, and a clear payment-unverified disclaimer. This is a manual report download, not a fraud certificate.

### F. Test optional phone OTP and WhatsApp consent in mock mode

1. Open **Settings > Phone verification**. Request verification for `+919876543210`.
2. Enter incorrect code `000000`. Expected: verification fails and the phone stays unverified.
3. Request another code when allowed by the cooldown, then enter the development mock code `123456`. Expected: phone status becomes **Verified**.
4. Under **WhatsApp alerts**, opt in. Expected: consent is enabled only after phone verification.
5. Create another high-risk transaction after opting in, using a repeated UTR plus a different expected amount. Wait several seconds for the local queue worker. The mock provider sends no real WhatsApp message; automated integration testing checks the queue result.
6. Opt out and create another high-risk transaction. Confirm the setting is off. A queued job must be suppressed if consent is withdrawn before delivery.
7. If phone verification is available only for a different phone, changing the number requires verifying again; do not assume a previous number's verification carries over.

Never use the mock code in production. Live MSG91/Meta delivery needs provider configuration and must be tested with provider-authorized accounts and explicit consent.

### G. Test subscription/access behavior in local mock mode

1. In **Settings > Plan and billing**, choose **Pro · ₹999/mo**.
2. Expected: a local mock subscription is created with status `created`; the screen must not show paid access yet.
3. Click **Simulate signed provider activation** (development mock only). Expected: the signed local mock event changes subscription status to active and reflects the Pro monthly transaction limit (5,000).
4. Click **Cancel at period end**. Expected: cancellation is scheduled; the current subscription status/access is not incorrectly treated as canceled immediately.
5. Sign out and sign in as Vendor B. Confirm Vendor B still has its own Free plan/status and cannot inherit Vendor A's subscription.

The local UI mock tests subscription activation, not live Razorpay checkout. Live Razorpay testing must use test-mode credentials, configured plan IDs, and a signed provider webhook. A browser success page alone must never be treated as payment proof.

### H. Verify tenant separation

1. In Vendor A, note its transaction/customer/alert records. Sign out.
2. Sign in as Vendor B. Confirm Vendor A's transactions, alerts, customer, uploaded image, and billing state are absent from Vendor B's dashboard.
3. Try creating records in Vendor B with Vendor A's customer ID (if you have it from a test response). Expected: the API rejects the cross-tenant customer reference; the record is not created.
4. The automated backend integration test also checks cross-tenant reads for customer, transaction, alert, uploaded evidence, and billing data, because protected API requests require a vendor JWT.

### I. Check API readiness and final state

Re-run the four `curl.exe` checks from section 2. Check that the dashboard loads, sign-in works, and the transaction/alert lists still load after a page refresh. The access token expires after 15 minutes; sign in again if the UI returns to the login screen.

## 5. API route reference used by the tests

Routes are under `/api/v1`; protected routes require `Authorization: Bearer <vendor JWT>`.

- `POST /auth/register`, `POST /auth/login`
- `POST /auth/phone-otp/request`, `POST /auth/phone-otp/verify`
- `POST /transaction/validate` (optional multipart field `evidence`), `POST /transactions` alias, `GET /transactions`, `GET /transactions/:transactionId/evidence`
- `GET /alerts`, `GET /alerts/:alertId`, `POST /alerts/:alertId/acknowledge`
- `POST /customer/create`, `GET /customer/check`, `GET /customers`, `POST /customers`, `GET /customers/:customerId`, `PATCH /customers/:customerId`
- `GET /notification-settings`, `PATCH /notification-settings`
- `GET /billing`, `POST /billing/subscription`, `POST /billing/subscription/cancel`, `POST /billing/orders`, `POST /billing/payments/verify`
- `GET/POST /whatsapp/webhook` and `POST /billing/razorpay/webhook` are provider webhooks; do not send arbitrary unsigned test payloads to a live deployment.

## 6. Test completion record

Use this checklist to record the result on your machine:

- [ ] All four local service/health checks return HTTP 200.
- [ ] Backend integration tests pass.
- [ ] Frontend report test and production build pass.
- [ ] Registration/login works for two vendors; invalid credentials fail safely.
- [ ] Normal transaction, invalid input, mismatch, duplicate, future date, and structuring tests behave as expected.
- [ ] Optional image upload, rejected-file cases, owner-only download, and PDF report are verified.
- [ ] Alert review, customer listing/reputation, OTP mock, WhatsApp consent/opt-out, subscription mock, and cancellation are checked.
- [ ] Vendor B cannot see Vendor A's data or subscription.
- [ ] Notes clearly distinguish unverified UTRs and risk alerts from bank-confirmed payments and confirmed fraud.

Live MSG91, Meta WhatsApp, Razorpay, AWS/S3/EC2/RDS, HTTPS on a public domain, and Prometheus/Grafana require provider/cloud setup and are not proven by the local mock walkthrough.
