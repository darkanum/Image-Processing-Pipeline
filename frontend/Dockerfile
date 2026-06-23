# --- Build stage ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Build deps for some npm packages that need native compilation.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Build-time configuration. These are baked into the bundle by Vite via
# `import.meta.env.VITE_*`. Pass them from docker-compose as build args.
ARG VITE_API_URL=http://localhost:3001
ARG VITE_FIREBASE_PROJECT_ID=demo-image-pipeline
ARG VITE_FIREBASE_API_KEY=demo-api-key
ARG VITE_FIREBASE_AUTH_DOMAIN=demo-image-pipeline.firebaseapp.com
ARG VITE_FIREBASE_STORAGE_BUCKET=demo-image-pipeline.appspot.com
ARG VITE_FIRESTORE_EMULATOR_HOST=localhost:8080
ARG VITE_FIREBASE_STORAGE_EMULATOR_HOST=localhost:9199
ARG VITE_FIREBASE_AUTH_EMULATOR_HOST=localhost:9099

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# Inline the VITE_* env vars so `vite build` (which spawns a child process)
# sees them in process.env. Without this, Vite reads only the values
# exported by ARG, which it doesn't see at build time.
RUN VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIRESTORE_EMULATOR_HOST=$VITE_FIRESTORE_EMULATOR_HOST \
    VITE_FIREBASE_STORAGE_EMULATOR_HOST=$VITE_FIREBASE_STORAGE_EMULATOR_HOST \
    VITE_FIREBASE_AUTH_EMULATOR_HOST=$VITE_FIREBASE_AUTH_EMULATOR_HOST \
    npm run build

# --- Runtime stage (nginx static serving) ---
FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://localhost/ >/dev/null 2>&1 || exit 1
