# --- Build stage ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Build deps for some npm packages that need native compilation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# --- Runtime stage (nginx static serving) ---
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://localhost/ >/dev/null 2>&1 || exit 1
