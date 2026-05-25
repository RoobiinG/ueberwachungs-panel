# Stage 1: Frontend bauen
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend + Frontend-Build
FROM node:20-alpine
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev --silent

COPY backend/ ./

# Frontend-Build aus Stage 1 ins erwartete Verzeichnis kopieren
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Datenpfad für SQLite
ENV DB_PATH=/app/data/data.db

# Datenverzeichnis anlegen
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "src/index.js"]
