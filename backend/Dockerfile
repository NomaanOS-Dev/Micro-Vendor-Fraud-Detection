FROM node:22-bookworm-slim AS base

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src

# Keep Prisma CLI available in this one-off image for production migrations.
FROM build AS migrator
ENV NODE_ENV=production
CMD ["npm", "run", "db:deploy"]

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/src ./src
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home app \
    && mkdir -p /app/uploads \
    && chown -R app:app /app/uploads
USER app
EXPOSE 3000
CMD ["npm", "start"]
