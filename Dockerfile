# Stage 1: Frontend bauen
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend mit nativen Abhängigkeiten bauen
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
# Build-Tools für better-sqlite3 (native Kompilierung)
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm ci --omit=dev --silent
COPY backend/ ./

# Stage 3: Finales Image (ohne Build-Tools)
FROM node:20-alpine
WORKDIR /app/backend

# Laufzeit-Abhängigkeit für SQLite
RUN apk add --no-cache sqlite-libs

COPY --from=backend-builder /app/backend ./
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

ENV DB_PATH=/app/data/data.db
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["node", "src/index.js"]
