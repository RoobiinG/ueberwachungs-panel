# Stage 1: Frontend bauen
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend mit nativen Abhängigkeiten bauen
FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
# Build-Tools für better-sqlite3 (native Kompilierung)
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm install --omit=dev --silent
COPY backend/ ./

# Stage 3: Finales Image (ohne Build-Tools)
FROM node:22-alpine
WORKDIR /app/backend

# Alle Systempakete auf den neuesten Sicherheitsstand bringen und benötigte Tools installieren
# (sqlite-libs: SQLite runtime; util-linux: nsenter für Host-Namespace-Zugriff; git + curl für Updater; docker-cli + docker-cli-compose für lokales Sock-Update)
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache sqlite-libs util-linux git curl docker-cli docker-cli-compose && \
    npm install -g npm@latest && \
    npm cache clean --force

COPY --from=backend-builder /app/backend ./
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
# version.json und CHANGELOG.md liegen im Repo-Root und müssen explizit kopiert werden
COPY version.json /app/version.json
COPY CHANGELOG.md /app/CHANGELOG.md
# Agent-Scripts: panel-agent.js (Update-Push + öffentlicher Download) + install.sh (Installer)
COPY agent/panel-agent.js /app/agent/panel-agent.js
COPY agent/install.sh     /app/agent/install.sh

ENV DB_PATH=/app/data/data.db
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["node", "src/index.js"]
