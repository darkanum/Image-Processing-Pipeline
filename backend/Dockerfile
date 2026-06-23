# --- Build stage ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install build deps for sharp (libvips)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN npm run build

# --- Production deps stage ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# --- Runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Sharp runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Run as non-root
RUN useradd --create-home --shell /bin/bash app && chown -R app:app /app
USER app

EXPOSE 3001
CMD ["node", "dist/server.js"]
