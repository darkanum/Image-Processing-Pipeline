# Uses the official Node base image and installs OpenJDK 17 + firebase-tools
# to run the Firebase Local Emulator Suite (Firestore + Storage + Auth).
FROM node:20-bookworm-slim

ENV FIREBASE_TOOLS_VERSION=13.29.1 \
    JAVA_TOOL_OPTIONS="-Xmx1024m"

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless wget \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g firebase-tools@${FIREBASE_TOOLS_VERSION}

WORKDIR /app
# Build context is already `./firebase` (set in docker-compose.yml),
# so we copy the config files directly — no nested `firebase/` folder.
COPY firebase.json ./
COPY firestore.rules ./
COPY storage.rules ./

# Container-internal ports — these are mapped to host via docker-compose.
EXPOSE 4000 4400 8080 9099 9199

# Healthcheck on the emulator UI (it boots last).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD wget -q -O- http://localhost:4000/ >/dev/null 2>&1 || exit 1

# IMPORTANT: host bindings are set in firebase.json (`emulators.*.host = 0.0.0.0`).
# Without that, firebase-tools defaults to 127.0.0.1 inside the container, so
# docker-compose host-port mappings (e.g. 4001:4000) refuse connections even
# though the container itself is "healthy" (the healthcheck hits container
# localhost, which still works).
CMD ["firebase", "emulators:start", \
     "--project", "demo-image-pipeline", \
     "--config", "firebase.json"]
