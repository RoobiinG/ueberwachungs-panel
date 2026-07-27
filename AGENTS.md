# Agenten-Regeln & Projektwissen — Überwachungs-Panel

Diese Datei ist die **gemeinsame Quelle der Wahrheit** für alle KI-Assistenten am Projekt
(Claude Code, Antigravity IDE und alles, was später dazukommt). Wer hier etwas ändert, ändert es für alle.
`.agents/AGENTS.md` und `CLAUDE.md` verweisen nur noch hierher — bitte nicht doppelt pflegen.

Antworten, Commit-Messages, UI-Texte und Code-Kommentare immer auf **Deutsch**.

---

## 1. Projekt in Kürze

Selbst entwickeltes Server-Monitoring-Panel (Web) für die eigene Infrastruktur.

| Bereich | Technik |
|---|---|
| Backend | Node.js + Express, Port 3001, `backend/src/index.js` |
| Datenbank | SQLite via `better-sqlite3`, Migrationen in `backend/src/db.js` (try/catch `ALTER TABLE`) |
| Frontend | React 18 + Vite + Tailwind (Dark-only, `panel-*` Farben), Seiten in `frontend/src/pages/` |
| Auth | JWT, Passkeys (SimpleWebAuthn v12), 2FA per TOTP (RFC 6238, offline) oder E-Mail-Code |
| Live-Daten | WebSocket `/ws`, `metricsCache` + Aggregator (10 s → 1 min → 1 h) |
| Rechte | Dynamische Rollen in der DB, alle Keys in `backend/src/permissions.js` |
| Remote-Server | `agent/panel-agent.js` auf den Zielservern, Token-Auth, HMAC-signierte Updates |
| Angebunden | Hetzner Cloud + Storage Boxes, MC-Host24, Dockhand, PatchMon, Uptime Kuma |

**Deployment:** GitHub Action baut bei jedem Push auf `master` das Image
`ghcr.io/roobiing/ueberwachungs-panel:latest`. Auf dem Server läuft nur `docker compose pull && up -d`
hinter einem NGINX Proxy Manager. Der Updater im Panel (`POST /api/update/run`) erkennt den Docker-Betrieb
am fehlenden `.git` und startet Pull + Recreate **asynchron** über den Host-Namespace (`nsenter`),
damit der Reverse Proxy keinen 504 wirft.

**Nicht mehr im Projekt:** die Android-App (`android/`) wurde in v1.48.9 endgültig entfernt.

---

## 2. Pflicht vor jedem Commit: Version + Changelog

1. `version.json`
   - `build` um 1 erhöhen
   - `date` auf das heutige Datum (`YYYY-MM-DD`)
   - **`version` zwingend mit erhöhen** — Patch bei Fixes/Chores, Minor bei neuen Features, Major bei Breaking Changes.
     Die Versionsnummer darf **nie** unverändert bleiben, wenn die Build-Nummer steigt.
2. `CHANGELOG.md`
   - Neuer Abschnitt `## [x.y.z] - YYYY-MM-DD (Build N) — *Codename*`
   - Features / Bugfixes **und** immer der Block **„System-Auswirkungen & Nachwirken (Impact Analysis)"**:
     DB-Migrationen, Agent-Kompatibilität, Neustart-/Session-Verhalten.

Beides gehört in denselben Commit wie die eigentliche Änderung, nicht nachgereicht.

---

## 3. Was auf GitHub darf — und was nicht

Das Repository ist **privat**, trotzdem gilt strikt: **nur der Code und die Projektdoku, die dorthin gehören.**

**Nie einchecken:**
- Die produktive Panel-Domain und alle anderen echten Hostnamen/IPs der Infrastruktur → gehören ausschließlich
  in `.env` bzw. Umgebungsvariablen, niemals in Code, Doku oder Konfigurationsdateien im Repo
- Echte Secrets: `JWT_SECRET`, API-Tokens (Hetzner, MC-Host24, PatchMon, GitHub PAT), Passwörter, Webhook-URLs
- `docker-compose.prod.yml` (die echte Produktions-Config)
- Datenbanken (`*.db`), `.env`, `node_modules/`, `dist/`
- Arbeitsdaten der KI-Werkzeuge und IDEs: `.claude/`, `.artifacts/`, `.agents/`, `.idea/`, `.vscode/`

**Gehört ins Repo:** `backend/`, `frontend/`, `agent/` (der Dockerfile kopiert `panel-agent.js` und `install.sh` ins Image!),
`Dockerfile`, `docker-compose.yml`, `docker-compose.prod.example.yml` (nur Platzhalter), `.github/`,
`version.json`, `CHANGELOG.md`, `SETUP.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`.

**Vor jedem Push kurz prüfen:** `git diff --cached` auf Domains/Tokens durchsehen und das Projekt auf
offensichtliche Sicherheitslücken checken (fehlende Auth-Middleware, unparametrisierte SQL-Queries, fehlende
Input-Validierung). Kritisches vorher fixen, Mittleres benennen.

---

## 4. Commits & Git

- Commit-Messages auf Deutsch, Muster: `feat|fix|style|chore|docs|perf: Beschreibung (vX.Y.Z / Build N)`
- **Keine `Co-Authored-By`-Zeile** anhängen.
- `git add`, `git commit` und `git push` sind generell freigegeben — nicht jedes Mal nachfragen.
- Git-Befehle einzeln absetzen (nicht mit `&&` oder `;` verketten) — die Sandbox der Antigravity IDE
  blockt verkettete Befehle trotz Freigabe.
- Gearbeitet wird auf `master`.
