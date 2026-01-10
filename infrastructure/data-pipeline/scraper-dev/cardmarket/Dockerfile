# CardMarket Scraper - Production Docker Image
# For AWS ECS Fargate deployment

# ============================================================================
# Stage 1: Build
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production=false

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY prisma/ ./prisma/

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript (if needed for type checking)
RUN npm run build --if-present

# ============================================================================
# Stage 2: Production
# ============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy Prisma schema and generate client
COPY prisma/ ./prisma/
RUN npx prisma generate

# Copy source files (tsx runs TypeScript directly)
COPY --from=builder /app/src/ ./src/
COPY --from=builder /app/scripts/ ./scripts/

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S scraper -u 1001 -G nodejs

USER scraper

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "console.log('healthy')" || exit 1

# Environment variables (overridden at runtime)
ENV NODE_ENV=production
ENV AWS_REGION=us-east-1

# Default command - run production pipeline
CMD ["npx", "tsx", "scripts/daily-cardmarket-production.ts"]
