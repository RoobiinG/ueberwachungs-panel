# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

---

## [1.48.17] - 2026-07-28 (Build 265) — *Frontend Build-Fix & GitHub Token UI Restoral*

### 🐛 Bugfixes & Frontend
- **Syntaxfehler im Settings-Build behoben**: Korrigiert fehlende schließende Tags (`</div>` und Tab-Bedingungen) in `Settings.jsx`, die beim Vite-Production-Build von Docker Action zu einem Abbruch gefühlt hatten.
- **GitHub Update-Token UI im System-Tab wiederhergestellt**: Das Kartenelement `GitHubTokenCard` (inkl. "Token testen"-Button zur Live-Prüfung der GitHub-PAT-Gültigkeit im privaten Repository) ist nun wieder sauber im Tab "System & Backup" eingebunden, nachdem es beim Tab-Refactoring versehentlich ausgelassen wurde.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Behebt den Vite ESBuild Abbruch (`npm run build`), sodass der Docker-Build und der Updater wieder fehlerfrei durchlaufen.

---

## [1.48.16] - 2026-07-28 (Build 264) — *Docker Updater Host-Namespace (nsenter) Priorisierung*

### 🐛 Bugfixes & Updater
- **Host-Namespace (`nsenter`) als primärer Docker-Updater (`update.js`)**: Behebt das Hängenbleiben des automatischen Klick-Updaters in der Sidebar. Zuvor wurde versucht, das Update primär über die Dockhand Pro API auszuführen, deren HTTP-Anfrage beim `pullImage` hängen bleiben konnte und so den weiteren Update-Verlauf blockierte.
- **Reihenfolge der Update-Fallbacks optimiert**: Der Updater nutzt nun wieder primär die bewährte Host-Namespace-Methode (`nsenter --target 1 ... docker pull && docker compose up -d --force-recreate`) laut `AGENTS.md`. Erst falls `nsenter` nicht verfügbar ist, wird das lokale Docker-Socket genutzt, und erst an dritter Stelle die Dockhand Pro API als Fallback.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Der Klick auf „⚡ Update jetzt installieren" unten links in der Sidebar aktualisiert und startet den Container im NGINX Proxy Manager Betrieb nun zuverlässig in 10-20 Sekunden neu.

---

## [1.48.15] - 2026-07-28 (Build 263) — *MC-Host24 Laufzeit-Benachrichtigungen & Settings Cleanup*

### 🎨 Frontend & Einstellungen
- **KI-Funktionen aus Firewall und Einstellungen entfernt**: Der `ScanSearch`-Aufruf in `Firewall.jsx` sowie das Claude-KI-Modul inklusive API-Key-Verwaltung in `Settings.jsx` wurden vollständig aus der Benutzeroberfläche entfernt.
- **4 übersichtliche Tabs in den Einstellungen (`Settings.jsx`)**: Die Einstellungsseite wurde strukturiert in vier klar getrennte Tabs untergliedert:
  - 👤 **Profil & Sicherheit**: Passwort, E-Mail-Adresse, Passkeys (WebAuthn), 2FA, Aktive Sitzungen.
  - 🎨 **Allgemein & Design**: Darstellung & Design (Pride Flag), Aktive Module, Benachrichtigungen, Live-Refresh.
  - ☁️ **Cloud & APIs (Admin)**: Hetzner Cloud API, MC-Host24, Dockhand, PatchMon, SMTP.
  - 🛠️ **System & Backup (Admin)**: GitHub Update-Token, Backup & Migration.

### 🔔 Alerts & Benachrichtigungen (`alertEvaluator.js`)
- **Minimalistisches Layout für MC-Host24 Laufzeit-Warnungen (Vorschlag A)**: Bei der Auswertung von `mchost_runtime` wird in Benachrichtigungen nur noch der Servername und die exakt verbleibende Laufzeit (z. B. `Verbleibende Laufzeit: 10,9 Tage`) anstelle einer redundanten Auflistung sämtlicher ODER-Schwellenwerte gesendet. Bei Verlängerung wird ebenso sauber entwarnungsfrei protokolliert (`Aktuelle Laufzeit: 30,0 Tage`).
- **Schutz vor doppelten Nachrichten nach Neustarts**: Der `AlertEvaluator` stellt den Alarm-Zustand (`hasFired` sowie den letzten Schwellenwert `lastFiredThreshold`) bei Server- oder Panel-Neustarts direkt aus der Datenbank (`alert_history`) wieder her. Bestehende Alarme werden nach Neustarts nicht mehr doppelt versendet.
- **Intelligente ODER-Schwellenauslösung**: Bei Regeln mit mehreren Schwellen (z. B. `< 11`, `< 7`, `< 5` Tage) wird eine erneute Warnung nur versendet, wenn eine noch tiefere Schwelle als beim letzten Alarm unterschritten wird.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Neue Spalte `server_key TEXT DEFAULT NULL` via try/catch-Migration zur Tabelle `alert_history` hinzugefügt, um Alarmzustände pro Server auch über Neustarts hinweg genau zuzuordnen.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Keine Auswirkung auf aktive Sessions. Alarm-Benachrichtigungen sind durch die Datenbank-Persistierung nun gegen Server-Neustarts abgesichert.

---

## [1.48.14] - 2026-07-28 (Build 262) — *GitHub Token Verifizierung & Dockhand Updater Integration*

### 🎨 Frontend & Design
- **Redundantes Regenbogen-Icon entfernt (`Sidebar.jsx`)**: Da das Pride-Flag-Design den gesamten unteren Footer-Bereich der Sidebar als Hintergrund-Gradient ausfüllt, wurde das separate `🏳️‍🌈`-Emoji-Icon entfernt, um ein klares und aufgeräumtes Erscheinungsbild in eingeklappter und ausgenommener Seitenleiste zu gewährleisten.
- **GitHub Token Live-Test im Frontend (`Settings.jsx`)**: Neuer **„Token testen"**-Button bei der GitHub-PAT-Konfiguration. Prüft per Klick sofort das eingegebene oder gespeicherte Token gegen das private Repository und zeigt direkt die aktuelle Remote-Version und Build-Nummer bei Erfolg an (bzw. klare Fehlermeldungen bei fehlenden Rechten / 404 / 401).

### ⚙️ Backend & Updater
- **GitHub Token Prüf-Endpunkt (`settings.js`)**: Neuer API-Endpunkt `POST /api/settings/github/test`, der mit dem GitHub-Token die GitHub-API kontaktiert und den Lesezugriff auf das private Repository `RoobiinG/ueberwachungs-panel` (`version.json`) verifiziert.
- **Dreistufige Docker-Updater Integration (`update.js`)**: Der automatische Updater (`POST /api/update/run`) in Docker-Umgebungen unterstützt nun eine intelligente Fallback-Kette:
  1. **Dockhand Pro API**: Ist in den Einstellungen die Dockhand-Anbindung konfiguriert, wird das Update reibungslos über die Dockhand-REST-API ausgeführt (Image pullen + Container neu erstellen).
  2. **Direktes Docker-Socket**: Ist `/var/run/docker.sock` im Container eingebunden, wird das Update direkt über die lokale Docker-CLI ausgeführt.
  3. **Host-Namespace (`nsenter`)**: Fallback für Umgebungen mit Host-Namespace-Zugriff.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Keine Auswirkung auf bestehende Logins oder Sessions. Der automatische Updater funktioniert nun in sämtlichen Docker-/Reverse-Proxy-Konfigurationen zuverlässig.

---

## [1.48.13] - 2026-07-28 (Build 261) — *Vollflächiges Pride Flag & Webhook-Fixes*

### 🎨 Frontend & Design
- **Vollflächige Progress Pride Flag in der Sidebar (`Sidebar.jsx`)**: Das Pride-Flag-Design beschränkt sich nicht mehr auf eine kleine Badge neben dem Benutzernamen, sondern füllt nun den **gesamten unteren Footer-Bereich** der Seitenleiste (Benutzernamen, Rolle, Version und Build) mit einem eleganten 135°-Gradienten.
- **Optimierte Lesbarkeit & Kontrast**: Weiße Typografie mit starkem Dark-Shadow sorgt dafür, dass alle Informationen auf jeder Farbe des Regenbogen-Verlaufs gestochen scharf lesbar bleiben.
- **Beschreibung in Einstellungen angepasst**: Erklärung des Toggles in `Settings.jsx` auf den vollflächigen Sidebar-Footer aktualisiert.

### 🐛 Bugfixes & Stabilität
- **Telegram Webhook HTML-Sanitisierung (`sendWebhook.js`)**: Behebt HTTP 400 Fehler bei Telegram-Webhooks (z. B. beim Alert `"Laufzeit 24"`), die durch unescapete `<` oder `>` Zeichen (z. B. `< 24 Tage` oder `CPU > 80%`) im `parse_mode: 'HTML'` auftraten. Eine neue Hilfsfunktion `sanitizeTelegramHtml()` schützt gültige Telegram-Tags (`<b>`, `<i>`, `<code>` etc.), escapet jedoch sicher alle anderen Vergleichszeichen.
- **Express Reverse Proxy Trust (`index.js`)**: `app.set('trust proxy', 1)` aktiviert, um die Warnung `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` von `express-rate-limit` im Betrieb hinter Reverse Proxies (NGINX Proxy Manager / Docker) zu beheben und Client-IPs korrekt zu erkennen.
- **Zuverlässigere Remote-Agent-Alerts (`alertEvaluator.js`)**: Der Alert-Evaluator liest Metriken von Remote-Agenten primär aus dem lokalen SQLite-Cache (`server_id = 'agent:<id>'`), der sekundengenau vom `remoteMetricsRecorder` gepflegt wird. Dadurch werden Alert-Auswertungen nicht mehr durch temporäre HTTP-Timeouts oder Netzwerkverzögerungen verworfen.
- **Aktive Webhooks gefiltert**: SQL-Queries im `alertEvaluator.js` und `actionNotify.js` prüfen nun explizit auf `w.active = 1`, um fehlerhafte Sendeversuche an deaktivierte Webhooks zu vermeiden.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.13` (Build 261)** erhöht.
- **Keine Breaking Changes:** Alle DB-Schemas, Endpunkte und Agent-Schnittstellen bleiben vollständig kompatibel.
- **Keine DB-Migration erforderlich.**
- **Keine Neustarts oder Session-Abbrüche nötig:** Bestehende Token und Logins bleiben unverändert gültig.

---

## [1.48.12] - 2026-07-28 (Build 260) — *Gemeinsamer Wissensstand*

### 📚 Dokumentation
- **`AGENTS.md` um den Abschnitt „Stand der Aufräumaktion vom 28.07.2026" erweitert**, damit jeder KI-Assistent
  (Claude Code wie Antigravity IDE) beim nächsten Einstieg denselben Ausgangspunkt hat: umgeschriebene Historie,
  neue Commit-Hashes, gelöschter Branch `pre-session-5`, Lage der Vollsicherung und die Auflage, `.claude/`,
  `.artifacts/`, `.agents/` und `android/` nie wieder einzuchecken.
- **Klargestellt, dass `version.json` und `CHANGELOG.md` die verbindliche Quelle für Versionsstand und Historie
  sind** — der Überblick in `AGENTS.md` wird bewusst nicht mit jeder Version nachgezogen und kann so nicht veralten.
- **Hinweis ergänzt**, dass `master` der einzige Branch auf GitHub ist und das so bleiben soll.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.12` (Build 260)** erhöht.
- **Reine Dokumentationsänderung.** Keine Auswirkungen auf Backend, Frontend, Agent, Datenbank, Rechte-System
  oder das Docker-Image. Keine DB-Migration, keine Agent-Aktualisierung, kein Einfluss auf laufende Sessions.
- Das Image wird durch den Push regulär neu gebaut, Inhalt bleibt funktional identisch zu v1.48.11.

---

## [1.48.11] - 2026-07-28 (Build 259) — *Bereinigte Git-Historie*

### 🔐 Sicherheit & Repository-Hygiene
- **Git-Historie vollständig umgeschrieben** (`git filter-branch` über alle Branches und Tags). Aus **jedem** Commit
  der Projektgeschichte wurden entfernt:
  - `.claude/`, `.artifacts/` und `.agents/` — Arbeitsdaten der KI-Werkzeuge. Darin lag mit
    `.claude/settings.local.json` die einzige Datei, die je die produktive Panel-Domain enthielt
    (eingebracht in Build 71). Die Domain ist damit aus der gesamten Historie verschwunden, nicht nur aus dem
    aktuellen Stand wie noch in v1.48.9.
  - `android/` — die eingestellte Kotlin-App, endgültig auch aus der Vergangenheit entfernt.
- **Verwaisten Branch `pre-session-5` gelöscht** (lokal und auf GitHub). Er stammte vom 26.05.2026, enthielt nie
  nach `master` übernommene Commits und hätte die entfernten Inhalte weiterhin auf GitHub zugänglich gemacht.
- **Alle 47 Versions-Tags** (`v1.0.0` … `v1.22.0`) zeigen nach dem Rewrite auf die bereinigten Commits.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.11` (Build 259)** erhöht.
- **Keine** inhaltliche Änderung an Backend, Frontend, Agent, Datenbank oder Docker-Image. Der Dateibaum des
  neuesten Commits ist identisch zu v1.48.10 — es wurde ausschließlich die Historie bereinigt.
- **Alle Commit-Hashes haben sich geändert.** Der Projektstand zählt jetzt 237 statt 256 Commits: 19 Commits
  bestanden ausschließlich aus den entfernten Verzeichnissen und sind dadurch leer geworden und entfallen.
- **Bestehende Klone des Repositories passen nicht mehr zur Historie** und müssen einmalig nachgezogen werden:
  `git fetch origin && git reset --hard origin/master`. Der Produktivbetrieb ist nicht betroffen, da das Panel
  im Docker-Betrieb über das Image `ghcr.io/roobiing/ueberwachungs-panel:latest` aktualisiert wird und kein
  Git-Repository auf dem Server benötigt.
- Ältere Container-Images mit SHA-Tags aus der alten Historie bleiben in der Registry bestehen; das `latest`-Tag
  wird durch den nächsten Workflow-Lauf regulär neu gebaut.
- **Sicherung**: Vor dem Eingriff wurde ein vollständiges Bundle aller Refs außerhalb des Repositories abgelegt.

---

## [1.48.10] - 2026-07-28 (Build 258) — *Workflow-Actions auf Node 24*

### 🧹 Aufräumen & Struktur
- **GitHub-Actions im Build-Workflow auf ihre aktuellen Major-Versionen gehoben** (`.github/workflows/docker-build.yml`).
  GitHub hatte bei jedem Lauf die Annotation *„Node.js 20 is deprecated. The following actions target Node.js 20 but
  are being forced to run on Node.js 24"* gemeldet, weil alle vier eingesetzten Actions noch auf der abgekündigten
  Node-20-Laufzeit basierten und vom Runner notgedrungen auf Node 24 gezwungen wurden:

  | Action | vorher | jetzt |
  |---|---|---|
  | `actions/checkout` | `v4` | **`v7`** |
  | `docker/login-action` | `v3` | **`v4`** |
  | `docker/metadata-action` | `v5` | **`v6`** |
  | `docker/build-push-action` | `v5` | **`v7`** |

  Alle vier Ziel-Majors laufen nativ auf Node 24, damit verschwindet die Annotation vollständig.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.10` (Build 258)** erhöht.
- **Keine** Auswirkungen auf Backend, Frontend, Datenbank oder Agenten — geändert wurde ausschließlich die
  CI-Konfiguration. **Keine** DB-Migration, **keine** Agent-Aktualisierung, **kein** Einfluss auf laufende
  Sessions oder Neustart-Verhalten. Das Panel selbst ist identisch zu v1.48.9.
- **Image-Ergebnis unverändert**: Registry, Tags (`latest` + Kurz-SHA) und Build-Kontext bleiben exakt gleich.
  Auf dem Server genügt weiterhin `docker compose pull && up -d`.
- **Breaking Changes der neuen Majors geprüft, keine betrifft diesen Workflow**: `actions/checkout@v6` legt die
  Zugangsdaten in einer separaten Datei ab, `@v7` blockiert das Auschecken von Fork-PRs bei `pull_request_target`
  und `workflow_run` — der Workflow läuft nur auf `push` und `workflow_dispatch`.
  `docker/metadata-action@v6` ändert die `#`-Behandlung in Listen-Eingaben; die hier genutzten Tag-Regeln
  (`type=raw`, `type=sha`) enthalten kein `#`. `docker/build-push-action@v7` entfernt die veralteten Variablen
  `DOCKER_BUILD_NO_SUMMARY` und `DOCKER_BUILD_EXPORT_RETENTION_DAYS`, die hier nie gesetzt waren.
- **Runner-Anforderung**: Alle vier Majors setzen Actions-Runner **v2.327.1** oder neuer voraus. Auf den von
  GitHub gehosteten `ubuntu-latest`-Runnern ist das erfüllt; ein späterer Wechsel auf einen selbst gehosteten
  Runner müsste diese Mindestversion mitbringen.

---

## [1.48.9] - 2026-07-28 (Build 257) — *Repo-Hygiene & Gemeinsame Agenten-Regeln*

### 🧹 Aufräumen & Struktur
- **Android-App endgültig entfernt**: Der Ordner `android/` (Kotlin-App, Package `de.roobiin.panel`) war nach der
  bewussten Entfernung in v1.45.0 durch einen späteren Commit versehentlich wieder ins Repository gelangt.
  Er wurde jetzt vollständig gelöscht (77 Dateien) und über `.gitignore` dauerhaft ausgeschlossen. Das nie
  fertiggestellte Jetpack-Compose-Remake wird nicht weiterverfolgt.
- **Arbeitsdaten der KI-Werkzeuge aus dem Repository genommen**: `.claude/`, `.artifacts/` und `.agents/` werden
  nicht mehr versioniert (lokal bleiben sie erhalten). Damit verschwindet auch die Panel-Domain aus dem
  aktuellen Stand des Repositories, die zuvor in `.claude/settings.local.json` mitgeführt wurde.
- **`.gitignore` überarbeitet**: klarere Abschnitte, zusätzlich `.vscode/`, `*.local.json`, `android/` und `.kotlin/`.
  Der versehentliche Ausschluss von `agent/` wurde entfernt und kommentiert — das Verzeichnis **muss** im
  Repository bleiben, da der `Dockerfile` `agent/panel-agent.js` und `agent/install.sh` ins Image kopiert.

### ✨ Neue Funktionen & Features
- **`AGENTS.md` im Projekt-Root als gemeinsame Quelle der Wahrheit**: Projektüberblick (Tech-Stack, Deployment,
  Verzeichnisstruktur) sowie alle verbindlichen Regeln zu Versionierung, Changelog, Commits und dem, was auf
  GitHub gehört. Claude Code und die Antigravity IDE arbeiten ab sofort mit demselben Wissensstand.
- **`CLAUDE.md`** eingeführt; es bindet `AGENTS.md` ein, statt Regeln zu duplizieren. Die alte Datei
  `.agents/AGENTS.md` ist nur noch ein Verweis auf den Root.
- **Explizite Sicherheitsregel dokumentiert**: Domain, Tokens, Secrets und Produktions-Configs gehören
  niemals ins Repository — inklusive Kurz-Checkliste vor jedem Push.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.9` (Build 257)** erhöht.
- **Keine** Auswirkungen auf Backend, Frontend, Datenbank oder Agenten — es wurde ausschließlich Nicht-Laufzeit-Code
  entfernt. Kein Datenbank-Migrationsbedarf, keine Agent-Aktualisierung nötig.
- Das Docker-Image wird unverändert gebaut; `agent/` bleibt Teil des Build-Kontexts.
- **Hinweis zur Historie**: Die Domain ist aus dem aktuellen Stand entfernt, steht aber weiterhin in älteren
  Commits. Ein vollständiges Entfernen würde ein Umschreiben der Git-Historie erfordern.

---

## [1.48.8] - 2026-07-27 (Build 256) — *Progress Pride Sidebar Flag (Deaktivierbar)*

### ✨ Neue Funktionen & Features
- **Progress Pride Flag Badge in der Seitenleiste (`Sidebar.jsx`)**:
  - Unten in der Seitenleiste (direkt rechts neben dem Benutzernamen im Footer-Bereich) wird ab sofort ein elegantes Progress Pride Flag Symbol (`🏳️‍🌈`) mit 11-farbigem Gradient-Hintergrund angezeigt.
  - Im eingeklappten Zustand der Sidebar erscheint das Symbol kompakt im Footer.
- **Benutzer-Einstellung zum Deaktivieren (`Settings.jsx`)**:
  - Unter **Einstellungen** wurde die neue Kategorie **Darstellung & Design** hinzugefügt.
  - Dort kann das Pride Flag Symbol in der Seitenleiste über einen Schalter ("Pride Flag in der Sidebar anzeigen") jederzeit von jedem Nutzer einzeln aktiviert oder deaktiviert werden.
  - Die Änderung wirkt **sofort live** in der Seitenleiste ohne Neuladen der Seite (`localStorage` + `pride_flag_change` Event).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.8` (Build 256)** erhöht.
- Keine Backend-Datenbankmigrationen erforderlich, da die Anzeigepräferenz individuell pro Browser im `localStorage` hinterlegt wird (`show_pride_flag`).

---

## [1.48.7] - 2026-07-27 (Build 255) — *Remove Top Accent Bar*

### 🎨 Design & Layout Anpassungen
- **Horizontale Regenbogen-Akzentlinie entfernt (`Layout.jsx` & `Sidebar.jsx`)**:
  - Die horizontale Linie am oberen Bildschirmrand und im Sidebar-Header wurde auf Nutzer-Feedback wieder entfernt, damit das gewohnte, saubere Dark-Mode-Layout nicht durch einen farbigen Querbalken gestört wird.
  - Das SVG-Favicon für den Browser-Tab (`favicon.svg`) bleibt unverändert erhalten.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.7` (Build 255)** erhöht.

---

## [1.48.6] - 2026-07-27 (Build 254) — *Docker Background Updater (No HTTP 504 Timeout)*

### 🐛 Bugfixes & Optimierungen
- **HTTP 504 Gateway Timeout beim Docker-Update (`POST /api/update/run`) behoben**:
  - Wenn ein Docker-Container ohne `.git`-Verzeichnis aktualisiert wird (`isDockerUpdate = true`), wartet die API nicht mehr synchron auf den potenziell langen `docker pull` Befehl (der bei Reverse-Proxies wie Nginx nach 60 Sekunden zu HTTP 504 führt).
  - Der Endpunkt antwortet ab sofort in < 10ms mit `HTTP 200 OK` und startet das Ziehen des Images sowie das Neuladen des Containers (`docker pull ... && docker compose up -d`) asynchron im Hintergrund über den Host-Namespace (`nsenter`).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf **`1.48.6` (Build 254)** erhöht.
- Das Web-UI erhält beim Klick auf den Update-Button sofortige Bestätigung ohne Timeout.

---

## [1.48.5] - 2026-07-27 (Build 253) — *New Rainbow Flag (Progress Pride)*

### ✨ Neue Funktionen & Features
- **New Rainbow Flag (Progress Pride) Akzentleiste**: 11-farbiger Regenbogen-Gradient am oberen Fensterrand (`Layout.jsx`) und an der Oberkante des Sidebar-Headers (`Sidebar.jsx`).
- **Custom SVG Favicon (`favicon.svg`)**: Reines Vektorgrafik-Favicon für den Browser-Tab (`index.html`) mit der New Rainbow Flag (Progress Pride) Linie und dem Panel-Emblem statt generischer Browser-Standardicons.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.48.5` (Build 253)** erhöht.
- Das neue SVG-Favicon wird im Browser automatisch als Tab-Icon gerendert.

---

## [1.48.4] - 2026-07-27 (Build 252) — *Retroactive Versioning & Version Sync Rule*

### ✨ Neue Funktionen & Features
- **Verpflichtende SemVer-Synchronisation (`AGENTS.md`)**: Bei jeder Erhöhung der Build-Nummer muss ab sofort auch die SemVer-Versionsnummer (`version.json`) zwingend erhöht werden (Patch-Release bei Fixes/Chores, Minor-Release bei neuen Features).
- **Rückwirkende Versionierung**: Alle neueren Builds im `CHANGELOG.md` und in `version.json` wurden rückwirkend getrennt versioniert (`1.48.0` für Build 248 bis `1.48.4` für Build 252).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf `1.48.4` (Build 252) aktualisiert.

---

## [1.48.3] - 2026-07-27 (Build 251) — *Full Changelog History v1.0.0 – v1.48.0*

### ✨ Neue Funktionen & Features
- **Vollständiges Release-Log**: Gesamte Projektgeschichte seit Mai 2026 (`v1.0.0` / Build 1) inklusive aller Meilensteine in `CHANGELOG.md` übernommen.
- **Regel zur ständigen Changelog-Pflege (`AGENTS.md`)**: In `.agents/AGENTS.md` verankert, dass `CHANGELOG.md` vor jedem Commit und Push dokumentiert werden muss.

---

## [1.48.2] - 2026-07-27 (Build 250) — *Docker Auto-Update per Host nsenter & Robuste E-Mail-2FA*

### 🐛 Bugfixes & Optimierungen
- **Docker Auto-Updater (`POST /api/update/run`)**: Erkennt Docker-Umgebungen ohne `.git`-Verzeichnis in `update.js` — führt stattdessen ein Docker Image Update (`docker pull ghcr.io/roobiing/ueberwachungs-panel:latest` und Container-Restart) per `nsenter` auf dem Host aus.
- **E-Mail-2FA Bestätigungscode (`/api/auth/2fa/enable` & `/login/2fa`)**: Gültigkeitsdauer auf 20 Minuten erhöht, toleranter String/Trim-Vergleich, präzise Fehlermeldungen und Konsolen-Logging für generierte E-Mail-Codes.

---

## [1.48.1] - 2026-07-27 (Build 249) — *GitHub Update-Log & System Impact Analysis*

### ✨ Neue Funktionen & Features
- **Update-Log Modal (`UpdateLogModal.jsx`)**: Tab-Ansicht zwischen Changelog und Git-Commits sowie direkter Link auf GitHub.
- **Bugfix (`Sidebar.jsx`)**: Syntaxfehler (Zeile 148) bei der Rendering-Bedingung behoben.

---

## [1.48.0] - 2026-07-27 (Build 248) — *Automatischer Panel-Updater & 2FA Security*

### ✨ Neue Funktionen & Features
- **Automatischer Panel-Updater (`POST /api/update/run`)**: Direktes Auslösen von `git pull` aus dem Panel heraus.
- **GitHub-Token Erklärung & Anleitung (`Settings.jsx`)**: Schritt-für-Schritt-Anleitung für Fine-Grained PATs mit Read-only Berechtigungen.
- **Zwei-Faktor-Authentifizierung (2FA / MFA)** (Build 247 Integration):
  - **Authenticator-App (TOTP / RFC 6238)** via offline SVG QR-Code (`qr.js`).
  - **E-Mail-2FA**: Temporärer 6-stelliger Bestätigungscode per SMTP.
  - Zweistufiger Login-Prozess mit geschütztem Zwischen-JWT (`tempToken`).

### 🐛 Bugfixes & Optimierungen
- **ReferenceError Behebung**: Fehler beim Löschen externer Token oder nach Einstellungs-Änderungen (`load is not defined` → Nutzung von `loadAdmin`) in `Settings.jsx` behoben.
- **IP-Kopierfunktion für Server**: Bei Hetzner Cloud API und MC-Host24 können IPs nun direkt mit visuellem Klick-Feedback (`✓ Kopiert`) kopiert werden.
- **Webhook-Konfiguration in Benachrichtigungen**: Schneller Absprung über „Webhooks als Einstellung“-Button in `Alerts.jsx`.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migration (SQLite)**: Spalten `twofa_type`, `twofa_secret`, `twofa_code`, `twofa_expires` in Tabelle `users` ergänzt.
- **Agenten-Kompatibilität (`remote_agents`)**: Vollständig abwärtskompatibel zu bestehenden v1.4x Agenten.
- **Server-Neustart & Sitzungen**: Automatischer Prozess-Neustart (~1,5 Sekunden) nach Update. Bestehende JWT-Sitzungen bleiben erhalten.

---

## [1.47.0] - 2026-07-27 (Build 246) — *Modular & Smart Updates*

### ✨ Neue Funktionen
- **Aktive Module konfigurieren**: Modul-Toggles in `Settings.jsx` (`Docker`, `PatchMon`, `Hetzner`, `MC-Host24` etc.) zum benutzerdefinierten Ein-/Ausblenden in der Sidebar.
- **GitHub PAT Update-Check**: Hinterlegen eines privaten Tokens, um GitHub API Rate-Limits zu umgehen und private Repositories zu checken.
- **Webhooks Integration**: Übersichtliche Verwaltung für Discord- und Slack-Alerts.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neue Tabelle/Spalten in `settings` für modulare Schalter (`module_docker`, `module_patchmon` usw.).
- Abwärtskompatibel: Wenn ein Schalter noch nicht konfiguriert wurde, ist das Modul standardmäßig aktiviert.

---

## [1.46.0] - 2026-07-20 (Build 240) — *MC-Host24 & Storage Box Metriken*

### ✨ Neue Funktionen
- **MC-Host24 Server-Details**: Exakte Anzeige der VServer-Laufzeit (`mchost_runtime`), Server-Spezifikationen und direkter API-Status im Server-Detail-Modal.
- **Multi-Bedingungen in Benachrichtigungen**: Alerts unterstützen ab sofort mehrere UND/ODER-Verknüpfungen für komplexe Schwellenwerte inkl. Cooldown-Konfiguration.
- **Hetzner Storage Box Alarme**: Automatische Warnungen bei Überschreitung der Quota von Storage Boxes.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `VALID_METRICS` im Backend um `mchost_runtime` und Storage-Box-Metriken erweitert.
- Keine Anpassungen an bestehenden Alert-Rules erforderlich.

---

## [1.45.0] - 2026-07-16 (Build 230) — *Server-Backup & Automatisierte Agent-Migration*

### ✨ Neue Funktionen
- **Automatisierte Agent-Migration & Backups**: Neues System zur Sicherung und Migration von Server-Konfigurationen und verbundenen Remote-Agenten.
- **Auto-Update der Agenten bei Migration**: Automatische Aktualisierung verbundener Agenten auf die passende API-Version während der System-Migration.
- **Entfernung des alten Android-Clients**: Reduktion des Repositories auf reines Web-/PWA-Monitoring für minimale Wartungsanfälligkeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verbesserte Synchronisierung der SystemStats-Funktionen ohne `TypeError` bei unterbrochenen Verbindungen.

---

## [1.44.0] - 2026-07-12 (Build 123) — *Mobile-Version & Responsive Dockhand UI*

### ✨ Neue Funktionen
- **Mobile-App Interface**: Automatische Erkennung von Smartphones mit Touch-optimierter Bottom-Tab-Bar und Drawer für schnelle Bedienung unterwegs.
- **Dockhand-Stack-Verwaltung**: Volle Unterstützung für Docker Compose Stacks (Pull, Re-Deploy, Logs und Lifecycle-Steuerung direkt im Panel).
- **Granulare Docker-Berechtigungen**: Einzelrechte für Images, Volumes, Netzwerke und Stacks (`docker.images`, `docker.stacks` usw.).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neues Rechte-Schema für Docker-Ressourcen; bestehende Admin-Rollen erben alle Docker-Rechte automatisch.

---

## [1.43.0] - 2026-07-12 (Build 122) — *Dockhand (Docker-Stacks, Images, Volumes & Netzwerke)*

### ✨ Neue Funktionen
- **Dockhand-Engine**: Vollwertiges Docker-Management-System (Ersatz für einfache Portainer-Anwendungsfälle).
- **Ressourcen nach Server filterbar**: Schnelles Umschalten zwischen dem lokalen Server und entfernten Docker-Hosts.
- **Live-Container-Stats**: Überwachung von CPU-, RAM- und Netzwerk-Verbrauch pro Container in Echtzeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Geringerer Overhead durch Wegfall des alten, rein lesenden Docker-Moduls zugunsten der Dockhand-API.

---

## [1.42.0] - 2026-07-12 (Build 121) — *Hetzner Storage Boxes Integration*

### ✨ Neue Funktionen
- **Hetzner Storage Boxes**: Nahtlose Anzeige von Speicherplatz, Quota und Zugangsdaten direkt über den Hetzner-API-Token.
- **Dashboard-Widget**: Eigene Storage-Box-Kachel im frei anordnbaren Dashboard.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Nutzt den bereits in den Einstellungen hinterlegten Hetzner Cloud API-Token, kein separater Key nötig.

---

## [1.41.0] - 2026-07-09 (Build 118) — *Freies Dashboard-Grid & Mini-Verlaufscharts*

### ✨ Neue Funktionen
- **Frei konfigurierbares Dashboard**: Drag & Drop Grid (`react-grid-layout`) für individuelle Anordnung und Größenänderung der Widgets.
- **15-Minuten Mini-Charts**: Dynamische Sparkline-Verlaufsgraphen für CPU, RAM, Disk und Netzwerk direkt auf den Server-Karten.
- **KPI-Leiste & Aktivitäts-Feed**: Schnellübersicht der gesamten Server-Gesundheit auf einen Blick.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Das individuelle Dashboard-Layout jedes Nutzers wird im Browser-LocalStorage bzw. im Benutzerprofil gespeichert.

---

## [1.35.0] - 2026-07-06 (Build 107) — *PatchMon-Integration (Linux System-Updates)*

### ✨ Neue Funktionen
- **PatchMon System-Update-Monitor**: Automatische Erkennung ausstehender Linux-Paket-Updates (APT/YUM/DNF/Pacman) sowie notwendiger Systemneustarts (`needs_reboot`).
- **Server-Zuordnung**: Verbindung zwischen PatchMon-Clients und den im Panel hinterlegten Servern.
- **PatchMon-Benachrichtigungen**: Eigener Alert-Typ bei kritischer Anzahl ausstehender Sicherheitsupdates.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verwendet das v2 PatchMon-Schema (`friendly_name`, `total_packages`, `needs_reboot`).

---

## [1.33.0] - 2026-06-12 (Build 102) — *Monitoring Performance & Remote Live-Stats*

### ✨ Neue Funktionen
- **3s/5s Remote-Live-Polling**: Schnelles Polling für externe Agenten via `metricsCache` ohne unnötige DB-Last.
- **6h-Query-Optimierung**: Schnelleres Laden von Langzeitdiagrammen und Schutz vor gleichzeitigen Doppel-Abfragen (`inflight-Guards`).
- **Chunk-Mismatch Reload**: Automatische Erneuerung des Browser-Caches nach Deployments.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- SQLite WAL-Pragmas (`journal_mode=WAL`, `cache_size=-32000`, `mmap_size=256MB`) sorgen für maximale Geschwindigkeit bei parallelen Lese-/Schreibzugriffen.

---

## [1.32.0] - 2026-06-12 (Build 100) — *Firewall-Redesign (UFW/iptables/nftables/firewalld)*

### ✨ Neue Funktionen
- **Multi-Firewall Unterstützung**: Einheitliches Interface für UFW, iptables, nftables und firewalld auf lokalen und entfernten Servern.
- **Regel-Suche & Paginierung**: Übersichtliches Suchen und Blättern in großen Firewall-Regelwerken.
- **Kippschalter-Steuerung**: Direktes Aktivieren/Deaktivieren von Firewall-Tools per Schalter im Panel.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Befehle werden auf dem Host über `nsenter` isoliert und sicher ausgeführt.

---

## [1.30.0] - 2026-06-03 (Build 85) — *Passkeys (WebAuthn) & SMTP Passwort-Reset*

### ✨ Neue Funktionen
- **Passkeys (FIDO2 / WebAuthn)**: Passwortloser, biometrischer Login via TouchID, FaceID, Windows Hello oder YubiKey.
- **SMTP-Passwort-Reset**: Sicheres Zurücksetzen von Passwörtern über zeitlich begrenzte Reset-Links per E-Mail.
- **SSH-Terminal**: Web-basiertes Terminal für direkten Serverzugriff per Browser (später zugunsten von Dockhand optimiert).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `users` unterstützt Passkeys abwärtskompatibel ohne Zwang für bestehende Konten.

---

## [1.22.0] - 2026-05-26 (Build 60) — *Granulares Rechte-System & GeoIP Audit-Log*

### ✨ Neue Funktionen
- **Granulares Rollen- & Berechtigungssystem**: Feingranulare Steuerung, welche Nutzer Server anlegen, Firewall steuern oder Docker verwalten dürfen (`requirePermission`).
- **Audit-Log mit GeoIP**: Vollständige Protokollierung aller administrativen Aktionen im Panel inkl. IP-Herkunftsland.
- **Uptime Kuma v1/v2 Integration**: Status-Badge und WebSocket/REST-Anbindung an Uptime Kuma Instanzen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Einführung von `requireRole` und `requirePermission` im gesamten Backend.

---

## [1.15.0] - 2026-05-26 (Build 40) — *Alert-Engine & Uptime Kuma Integration*

### ✨ Neue Funktionen
- **Alert-Engine & Benachrichtigungen**: In-App-Alerts und externe Benachrichtigungen bei CPU-, RAM- oder Festplatten-Engpässen.
- **Grafana-ähnlicher Zoom**: Interaktives Drag-to-Select zum Reinzoomen in Monitoring-Diagramme.
- **SFTP-Datei-Browser**: Initialer Dateibrowser für Server.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Hintergrund-Worker überwacht Metriken im 10s-Intervall.

---

## [1.10.0] - 2026-05-25 (Build 25) — *CheckMK-artiger Remote-Server Agent*

### ✨ Neue Funktionen
- **Remote-Agent Architektur**: Leichtgewichtiger Agent für entfernte Linux-Server (Debian, Ubuntu, AlmaLinux, Alpine).
- **TLS & Fingerprint-Pinning**: Verschlüsselte Übertragung und Absicherung durch einzigartige Server-Fingerprints.
- **Langzeit-Monitoring**: 30-Tage-Historie mit 5-Minuten-Aggregationsstufen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `remote_agents` zur Verwaltung aller angebundenen Hosts erstellt.

---

## [1.0.0] - 2026-05-25 (Build 1) — *Initiales Release & Grundgerüst*

### ✨ Neue Funktionen
- **Projekt-Start & Grundgerüst**: Initiales Release des Überwachungs-Panels.
- **Hetzner Cloud API**: Anbindung von Hetzner Cloud Servern inkl. Power-Cycle und Backup-Status.
- **MC-Host24 API Integration**: Anbindung von VServern und Account-Daten bei MC-Host24.
- **Docker- & System-Infos**: Erste Live-Anzeigen zu CPU, RAM und lokalen Containern.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Start der SQLite-Datenbank (`data.db`) mit WAL-Modus für ausfallsicheren Betrieb.
