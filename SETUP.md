# Überwachungs-Panel — Setup

## Voraussetzungen
- Docker + Docker Compose auf dem Server
- NGINX Proxy Manager (SSL-Terminierung läuft darüber)

## Docker (empfohlen)

```bash
# 1. .env aus Vorlage erstellen
cp .env.example .env
# JWT_SECRET setzen (mind. 32 Zeichen), API-Tokens eintragen

# 2. Container bauen und starten
docker compose up -d --build

# Logs anschauen
docker compose logs -f

# Container stoppen
docker compose down
```

Die SQLite-Datenbank wird im Docker-Volume `ueberwachungs-panel-data` gespeichert und überlebt Neustarts/Updates.

### Services & Firewall im Docker-Betrieb
Die systemctl- und UFW-Befehle laufen auf dem **Host**, nicht im Container. Damit die Seiten funktionieren, muss in `docker-compose.yml` auskommentiert werden:
```yaml
privileged: true
```
> Nur aktivieren wenn wirklich benötigt — erhöht die Container-Rechte!

---

## Alternativ: Manuell ohne Docker

### 1. Backend
```bash
cd backend
cp .env.example .env
# .env bearbeiten: JWT_SECRET setzen, API-Tokens eintragen
npm install
npm start
```

### 2. Frontend (Build für Produktion)
```bash
cd frontend
npm install
npm run build
```
Der Build landet in `frontend/dist/` — der Express-Server serviert diesen Ordner automatisch.

### 3. Entwicklung (lokal)
```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend (Vite Dev-Server mit Proxy)
cd frontend && npm run dev
```
Frontend läuft dann auf http://localhost:5173, proxied API-Calls an http://localhost:3001

## NGINX Proxy Manager
- Proxy Host anlegen → Ziel: `http://<server-ip>:3001`
- SSL-Zertifikat über NPM verwalten
- WebSocket-Support aktivieren (für Live-Stats)

## Standard-Login
- Benutzer: `admin`
- Passwort: `admin` ← **Bitte sofort ändern!**

## Rollen
| Rolle | Rechte |
|-------|--------|
| `admin` | Vollzugriff, User anlegen, Firewall-Regeln |
| `operator` | Services starten/stoppen, Docker verwalten |
| `viewer` | Nur lesen |

## Umgebungsvariablen (.env)
| Variable | Beschreibung |
|----------|--------------|
| `PORT` | Backend-Port (Standard: 3001) |
| `JWT_SECRET` | Geheimer Key für JWT — mindestens 32 Zeichen! |
| `JWT_EXPIRES_IN` | Token-Gültigkeit (Standard: 24h) |
| `HETZNER_API_TOKEN` | Hetzner Cloud API Token |
| `MCHOST_API_TOKEN` | MC-Host24 API Token |
