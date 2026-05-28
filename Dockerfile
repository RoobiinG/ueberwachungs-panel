# Stage 1: Frontend bauen
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend mit nativen Abhängigkeiten bauen
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
# Build-Tools für better-sqlite3 (native Kompilierung)
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm install --omit=dev --silent
COPY backend/ ./

# Stage 3: Finales Image (ohne Build-Tools)
FROM node:20-alpine
WORKDIR /app/backend

# sqlite-libs: SQLite runtime; util-linux: nsenter für Host-Namespace-Zugriff
RUN apk add --no-cache sqlite-libs util-linux

COPY --from=backend-builder /app/backend ./
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
# version.json liegt im Repo-Root und muss explizit kopiert werden
COPY version.json /app/version.json
# Agent-Script für Self-Update-Mechanismus (Panel pusht es direkt an Remote-Agents)
COPY agent/panel-agent.js /app/agent/panel-agent.js

ENV DB_PATH=/app/data/data.db
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["node", "src/index.js"]
