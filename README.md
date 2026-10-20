# Micro-Vendor Fraud Detection SaaS

Seven-day build of the Micro-Vendor Fraud Detection SaaS. Days 1-5 are implemented. Day 6 features now include optional phone verification, stored image evidence, review PDFs, consent-controlled WhatsApp alerts, and Razorpay billing/payment verification. Live provider activation and public deployment need account credentials and server/domain setup. Direct bank verification and enterprise team workspaces remain incomplete. Day 7 remains planned.

## Stack

- Node.js 20+ and Express 5 for the backend API
- PostgreSQL 16 and Prisma 6 for persistence
- Python/FastAPI fraud intelligence service
- Next.js dashboard frontend and Docker/Nginx deployment

## Roadmap progress

- [x] Day 1: Express backend skeleton and PostgreSQL/Prisma data model
- [x] Day 2: Vendor registration/login/JWT protection, UTR validation, and transaction ingestion
- [x] Day 3: Fraud rules, risk scoring, and evidence metadata checks
- [x] Day 4: Alert review, customer management/reputation, and audit history
- [x] Day 5: Next.js dashboard and responsive business UI
- [ ] Day 6: Live MSG91/Meta/Razorpay setup, enterprise team workspaces, direct bank verification, and public deployment (local mock integrations and deployment configuration are available)
- [ ] Day 7: Behavioral anomaly scoring, monitoring, integration review, fixes, and launch preparation

## Day 1 foundation

- Express app/server split, API version prefix, JSON error handling, security headers, CORS allowlist, and rate limiting
- Liveness and database readiness endpoints
- Prisma models for vendors, customers, transactions, fraud alerts, login logs, risk rules, and append-only audit history
- Tenant ownership links and tenant-oriented query indexes
- Local PostgreSQL service with a persistent Docker volume

## Day 2 transaction intake

- Public registration and login endpoints issue 15-minute HS256 bearer tokens; passwords are bcrypt-hashed and authentication is rate-limited.
- Transaction routes require a valid vendor token and always scope database reads and writes to that vendor.
- UTRs are trimmed and normalized to uppercase, then checked for 12-22 alphanumeric characters and duplicate submissions.
- Duplicate UTR submissions are retained as suspicious records and returned with `validation.code: duplicate_utr`, preserving evidence of repeated attempts for risk scoring.
- Amounts must be positive with at most two decimal places; dates must be valid ISO dates or timezone-qualified ISO datetimes.
- Optional customer IDs are checked against the authenticated vendor. The composite database relation also prevents cross-vendor customer references.
- Transaction ingestion and its audit entry are written atomically. A PostgreSQL advisory lock serializes concurrent submissions for the same vendor and UTR.
- Transaction listing is vendor-scoped and cursor-paginated.

## Day 3 fraud scoring

- A separate FastAPI fraud engine scores each transaction before it is committed. The Express API authenticates service-to-service calls with `FRAUD_ENGINE_API_KEY`; an unavailable scoring service fails ingestion closed.
- Enabled rules are loaded from PostgreSQL, so rule weights can be changed in the database without changing the Python code.
- The engine applies the blueprint weights: amount mismatch +40, future date +20, five or more under-INR-500 transactions ingested in ten minutes +30, 1:00-4:00 AM vendor-local time +20, and missing/tampering-indicated metadata on an uploaded screenshot +50. No upload is neutral.
- The blueprint does not assign a duplicate-UTR weight; this build uses +60 as an explicit initial policy value. Risk levels follow the brief: over 60 is high, over 30 is medium, otherwise low.
- Scores, matched factors, and alerts are stored atomically with the transaction. Any matched rule makes the transaction `suspicious`; high risk is a review priority and is not treated as a confirmed fraud verdict.
- Screenshot checks use server-extracted EXIF fields when present. An editing-software tag or missing fields can raise a weak risk signal; neither proves an image was altered or is genuine.
- Vendor timezone defaults to `Asia/Kolkata` and is used for the suspicious-time rule.

## Day 4 alerts and customers

- Authenticated vendors can list, filter, and inspect only their own fraud alerts. `POST /api/v1/alerts/:alertId/acknowledge` marks an alert reviewed once; the first acknowledgment is recorded in the audit log.
- Customer records can be created, searched, listed, read, and updated through vendor-scoped endpoints. Phone-based lookup is also vendor-scoped, and duplicate phone numbers are rejected within a vendor account.
- Reputation starts at 100. Each ingested transaction with one or more risk factors lowers its linked customer's score by 10 (floor 0) and increments `flaggedCount` once. This is an initial application policy because the brief does not specify reputation weights.
- Customer creation/updates, alert acknowledgments, and reputation changes add audit entries. A schema migration adds alert review timestamps and an index for pending/reviewed alert lists.

### Day 4 API

- `GET /api/v1/alerts?reviewed=false&alert_type=<rule-code>&limit=25&cursor=<id>` lists alerts; `GET /api/v1/alerts/:alertId` returns one alert; `POST /api/v1/alerts/:alertId/acknowledge` records review.
- `POST /api/v1/customer/create` creates a customer; `GET /api/v1/customer/check?phone=<number>` checks the authenticated vendor's customer by phone.
- `GET /api/v1/customers?search=<text>&reputation_below=<score>&limit=25&cursor=<id>`, `GET /api/v1/customers/:customerId`, and `PATCH /api/v1/customers/:customerId` manage customer records.

## Day 5 dashboard and UI

- A responsive Next.js dashboard provides vendor registration/sign-in, business overview metrics, transaction intake and search/filter, fraud alert review, and customer directory views.
- Business data uses the authenticated API token and existing vendor-scoped endpoints. The frontend stores the short-lived session in browser local storage and clears it after the API token's 15-minute lifetime.
- OTP verification, evidence upload, PDF reports, consent-controlled WhatsApp alerts, and Razorpay billing are now covered in the Day 6 section below.

## Day 6 app integrations and local mock mode

### Evidence images and PDF reports

- Transaction intake accepts optional JPEG, PNG, and WebP images up to 5 MB. The server verifies the image format and decodes it with Sharp before storing it under a vendor-specific local uploads directory. Production Compose persists this directory in the `evidence_data` volume. Only the owning vendor can download the file.
- EXIF metadata is extracted on the server when present. Missing EXIF is a weak signal only when an image was actually uploaded; it is not proof of tampering. Requests without an image do not receive a missing-metadata risk factor. Client-supplied metadata is not trusted.
- The Transactions page can download a PDF review report with transaction details, risk factors, alert review history, and an explicit unverified payment status. It does not claim that UTR format checks prove funds reached a bank.

### Optional phone verification with MSG91

- Authenticated vendors can use Settings to request and verify an OTP for a phone number in international format. Set `OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY`, and `MSG91_TEMPLATE_ID` in the private backend env file for live delivery.
- Development defaults to a mock provider. Use code `123456` only in development; OTP values are not logged or returned by the API. Mock mode is rejected in production.
- API: `POST /api/v1/auth/phone-otp/request` with `{ "phone": "+919876543210" }`, then `POST /api/v1/auth/phone-otp/verify` with `{ "challenge_id", "code" }`.

### WhatsApp Cloud alerts

- The vendor must first verify their phone and explicitly opt in under Settings. Only high-risk transactions enqueue a vendor alert; opting out, changing the phone, or revoking verification prevents queued messages from being sent.
- Live mode uses `WHATSAPP_PROVIDER=meta`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, and `WHATSAPP_APP_SECRET`. Configure the approved template named by `WHATSAPP_ALERT_TEMPLATE` with three body parameters (UTR last four characters, risk score, and signal count). The queue retries failures with backoff up to five attempts.
- Development mock mode sends no external message. Webhook endpoints are `GET/POST /api/v1/whatsapp/webhook`; POST signatures are checked against the Meta app secret.

### Razorpay billing and payment verification

- Plans in this implementation are Basic ₹499/month (500 transactions), Pro ₹999/month (5,000 transactions), and Enterprise ₹4,999/month (unlimited transactions). The free plan is limited to 100 transactions per month. New paid access is granted only after a signed Razorpay `subscription.charged` webhook. Creating a subscription or a browser checkout response alone does not activate paid access.
- To enable live mode, set `RAZORPAY_MODE=live`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and the Razorpay plan IDs `RAZORPAY_PLAN_BASIC`, `RAZORPAY_PLAN_PRO`, and `RAZORPAY_PLAN_ENTERPRISE`. Create the plans in Razorpay using the stated monthly prices. Configure `POST /api/v1/billing/razorpay/webhook` in Razorpay and subscribe it to payment and subscription lifecycle events.
- API: `GET /api/v1/billing`, `POST /api/v1/billing/subscription`, `POST /api/v1/billing/subscription/cancel`, `POST /api/v1/billing/orders`, and `POST /api/v1/billing/payments/verify`. One-time callback signatures are checked server-side; captured status comes only from a signed webhook. Webhook event IDs are deduplicated.
- Development mock mode lets you create a subscription and explicitly simulate a signed provider activation from Settings. It is disabled in production.
- Razorpay here verifies payments made through this SaaS’s own Razorpay order/subscription flow. Arbitrary UTRs and external bank transfers remain `unverified`; there is no direct bank API integration.

### Remaining Day 6/7 scope

- Enterprise subscription pricing and quota exist, but organization/team membership and enterprise workspace administration are not implemented.
- Fraud scoring is rule-based. There is no AI behavioral model, and screenshot metadata checks do not prove image authenticity.
- Live MSG91, Meta, and Razorpay credentials and approved templates/plan IDs must be supplied in private environment files to test real provider delivery. Local mocks test the application flow without charges or external messages.

## Day 6 production deployment (Docker Compose + Nginx + HTTPS)

Production deployment files are provided in `docker-compose.prod.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, and `infra/nginx/`. This production stack is separate from the existing development `docker-compose.yml`. It exposes only Nginx on ports 80 and 443; PostgreSQL and the fraud engine stay on the private Compose network. No public deployment has been made: it requires a Linux server with Docker Compose and a domain whose DNS points to that server.

The production env examples are templates. Copy them to private files and edit the copies; never commit real secrets:

```powershell
Copy-Item .env.production.example .env.production
Copy-Item backend/.env.production.example backend/.env.production
Copy-Item fraud-engine/.env.production.example fraud-engine/.env.production
```

Set the same real domain in all three files and in `infra/nginx/default.conf`. Generate unique strong values for `POSTGRES_PASSWORD`, `JWT_SECRET`, and `FRAUD_ENGINE_API_KEY`; use the same engine key in `backend/.env.production` and `fraud-engine/.env.production`. `DATABASE_URL` must use the same database password. Set `NEXT_PUBLIC_API_URL` to `https://YOUR_DOMAIN/api/v1`. These files contain secrets and are ignored by Git. Keep the templates' `.example` files unchanged.

On the Linux server, install Docker Engine and the Compose plugin, clone the repository, create and fill those private env files, and open inbound TCP ports 80 and 443 in the server firewall/provider firewall. Ensure the domain's A/AAAA records point to the server. From the repository root, validate the Compose configuration and build images:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml build
```

Start the database and wait for it to become healthy, then run the one-off Prisma migration image. This dedicated image includes Prisma CLI, which the normal production backend image omits:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml up -d db
docker compose --env-file .env.production -f docker-compose.prod.yml --profile ops run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d fraud-engine backend frontend nginx
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

For the initial certificate, `infra/nginx/default.conf` serves HTTP and the ACME challenge path. After the domain DNS is live and port 80 is reachable, request a certificate (replace the domain and email):

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml --profile certbot run --rm certbot certonly --webroot -w /var/www/certbot -d YOUR_DOMAIN --email YOU@example.com --agree-tos --no-eff-email
```

Then update `infra/nginx/default.conf` to the HTTPS configuration in `infra/nginx/default.https.conf.example`, replacing every `yourdomain.com` with the real domain. Validate and reload Nginx:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -t
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

Check `https://YOUR_DOMAIN/api/v1/health`, `https://YOUR_DOMAIN/api/v1/ready`, and the dashboard at `https://YOUR_DOMAIN/`. Readiness should report healthy database and fraud engine. Review `docker compose ... logs --tail=100 backend fraud-engine frontend nginx` if a health check fails.

Certificate renewal must be scheduled on the server; `certbot renew --dry-run` only tests renewal and does not schedule it. Schedule a recurring command to run `docker compose --env-file .env.production -f docker-compose.prod.yml --profile certbot run --rm certbot renew --webroot -w /var/www/certbot`, followed by `docker compose --env-file .env.production -f docker-compose.prod.yml exec -T nginx nginx -s reload`. Back up the `postgres_prod_data` volume and the `certbot_conf` volume securely before upgrades. Apply future schema changes with the one-off migration service before restarting the backend.

### What you need to provide/do for public deployment

1. Provision a Linux VPS/server and install Docker Engine plus the Compose plugin (or install Docker Desktop + WSL 2 for a local container rehearsal).
2. Own a domain and point its DNS to the server; allow inbound ports 80 and 443.
3. Create the three private production env files from the examples and enter the domain and fresh secrets.
4. Set the domain in `infra/nginx/default.conf`, then run the commands above and request the TLS certificate.

The current development environment remains available through the original `docker-compose.yml` and local service commands. Docker is not installed in the inspected Windows environment, so production image builds and Compose validation could not be run here.

### Run the dashboard

1. Start the backend API and its PostgreSQL/fraud-engine dependencies using the instructions below.
2. In `frontend/`, copy `.env.example` to `.env.local`, install packages, and start the UI:

   ```sh
   npm install
   npm run dev
   ```

3. Open `http://localhost:3001`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:3000/api/v1`; change it when the API is hosted elsewhere.

Start PostgreSQL and the local fraud engine with `docker compose up -d db fraud-engine`. The sample `DATABASE_URL` password matches the Compose-only local fallback; if you set `POSTGRES_PASSWORD` in a root `.env`, use that same password in `backend/.env`. Copy `backend/.env.example` to `backend/.env` and `fraud-engine/.env.example` to `fraud-engine/.env`; set a strong `JWT_SECRET` in the backend file and the same randomly generated `FRAUD_ENGINE_API_KEY` in both files. The engine container receives only that service key, not the API's JWT or database credentials.

### Day 2 API

- `POST /api/v1/auth/register` with `{ "name", "email", "phone?", "password" }`
- `POST /api/v1/auth/login` with `{ "identifier", "password" }` where identifier is the email or phone
- `POST /api/v1/transaction/validate` with a bearer token and `{ "utr", "amount", "date", "expected_amount?", "customer_id?" }`; accepts an optional `evidence` multipart file and validates, scores, and ingests in one request
- `POST /api/v1/transactions` is an equivalent plural alias
- `GET /api/v1/transactions?limit=25&cursor=<id>` lists the authenticated vendor's transactions

## Start locally

1. Create each private env file from its example only if it does not already exist. In PowerShell, from the repository root:

   ```powershell
   if (-not (Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
   if (-not (Test-Path .\fraud-engine\.env)) { Copy-Item .\fraud-engine\.env.example .\fraud-engine\.env }
   if (-not (Test-Path .\frontend\.env.local)) { Copy-Item .\frontend\.env.example .\frontend\.env.local }
   ```

   Set a random `JWT_SECRET` of at least 32 characters in `backend/.env`. Generate a random `FRAUD_ENGINE_API_KEY` and put the same value in `backend/.env` and `fraud-engine/.env`. Keep these private files out of source control. Make sure the password in `DATABASE_URL` matches Compose's `POSTGRES_PASSWORD` (the local fallback matches the checked-in example).
2. Start Docker Desktop and wait for its engine to be ready, then start PostgreSQL and the fraud engine from the repository root:

   ```sh
   docker compose up -d db fraud-engine
   ```

3. Wait until PostgreSQL is healthy, then in `backend/`, install dependencies, generate Prisma Client, apply the checked-in migrations, seed risk rules, and start the API:

   ```sh
   npm install
   npm run db:generate
   npm run db:deploy
   npm run db:seed
   npm run dev
   ```

4. In a second terminal, start the frontend from `frontend/` with `npm install` and `npm run dev`. Open `http://localhost:3001` (use `localhost`, which matches the default CORS origin).
5. Check `GET http://localhost:8000/health`, `GET http://localhost:3000/api/v1/health`, and `GET http://localhost:3000/api/v1/ready`. The readiness response is 200 only when both PostgreSQL and the authenticated fraud engine are reachable.

For production, set a strong database password and JWT secret through the deployment environment, use `npm run db:deploy`, terminate TLS at the reverse proxy, and set `TRUST_PROXY` only to the number of trusted proxy hops.

