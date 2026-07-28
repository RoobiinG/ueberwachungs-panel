# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

---

## [1.51.0] - 2026-07-28 (Build 278) — *Docker vereint & robuster Updater*

### ✨ Neue Funktionen & Features
- **„Docker" und „Docker-Ressourcen" zu einem Menüpunkt zusammengelegt**: Die Navigation führte zwei
  Einträge, die inhaltlich zusammengehören. Es gibt jetzt nur noch **Docker** mit einer Tab-Leiste
  **Container · Images · Volumes · Netzwerke · Stacks** (neue Seite `DockerCenter.jsx`).
  - Jeder Tab hängt weiterhin an seinem eigenen Recht (`docker.view`, `docker.images.view` …). Wer nur
    Images sehen darf, bekommt genau diesen einen Tab; ohne jedes Docker-Recht verschwindet der Punkt.
  - Der alte Pfad `/docker-resources` leitet dauerhaft auf `/docker` um, alte Lesezeichen bleiben gültig.

### 🐛 Bugfixes & Optimierungen
- **Update-Vorgang lud die Seite viel zu früh neu (`Settings.jsx`)**: Nach dem Auslösen wurde pauschal
  nach **1,5 Sekunden** neu geladen. Ein Docker-Update braucht für Pull und Recreate aber 20–30 Sekunden.
  Die Seite lud also noch den **alten** Container, wirkte, als sei nichts passiert — und kurz darauf brach
  die Verbindung weg, weil der Container erst dann neu startete.
  Das Panel wartet jetzt aktiv: Es merkt sich die Build-Nummer vor dem Update und fragt `/api/version`
  alle 3 Sekunden ab. Neu geladen wird erst, wenn eine neue Build-Nummer erscheint oder der Server nach
  einer Unterbrechung zurück ist. Ein Zähler zeigt die verstrichene Zeit; nach 3 Minuten erscheint ein
  Hinweis statt eines endlosen Wartens.
- **Fehler des Updaters waren im Panel unsichtbar (`update.js`)**: Der Vorgang läuft nach der HTTP-Antwort
  im Hintergrund weiter, Fehlschläge landeten ausschließlich in der Container-Konsole. Erfolg und
  Scheitern werden jetzt zusätzlich in die **Panel-Logs** geschrieben (Quelle `Panel-Updater`) — inklusive
  der Angabe, welcher Weg genutzt wurde (Dockhand-API, nsenter oder Docker-Socket) und der `stderr`-Ausgabe
  im Fehlerfall.
- **Doppeltes Auslösen des Updates verhindert (`POST /api/update/run`)**: Ein zweiter Klick startete bisher
  einen weiteren Pull samt Recreate, während der erste noch lief. Weitere Aufrufe werden nun mit
  **HTTP 409** abgewiesen, solange ein Update läuft. Die Sperre verfällt nach 10 Minuten und wird bei
  jedem Fehlschlag sofort gelöst, damit ein abgebrochener Lauf keine weiteren Updates blockiert.
- **Menüpunkte mit mehreren möglichen Rechten fehlten in der Mobil-Navigation (`MobileNav.jsx`)**:
  Die Sichtbarkeitsprüfung reichte ein Rechte-**Array** direkt an `hasPermission()` weiter, das intern
  `permissions.includes(key)` nutzt — mit einem Array ergibt das **immer** `false`. Betroffen war
  „Docker-Ressourcen", der Punkt fehlte im Drawer für **alle** Benutzer, auch für Administratoren.
  Die Prüfung wertet Arrays jetzt wie die Sidebar als ODER aus.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.51.0` (Build 278)** erhöht — Minor, da sich die Navigation ändert.
- **Keine Datenbank-Migration**, keine Änderung an Rechten oder deren Namen. Die bestehenden
  `docker.*`-Berechtigungen gelten unverändert und steuern jetzt die Tabs statt zweier Seiten.
- **Keine Agent-Aktualisierung nötig**, keine Änderung an WebSocket oder Metrik-Erfassung.
- **Sichtbar für Benutzer**: Der Menüpunkt „Docker-Ressourcen" verschwindet aus der Seitenleiste; seine
  Inhalte liegen unverändert unter „Docker". Wer bisher keinerlei Docker-Recht hatte, aber den Punkt
  „Docker" trotzdem sah, sieht ihn nun nicht mehr — die Seite war für ihn ohnehin leer.
- **Der Updater-Fix wirkt erst beim übernächsten Update**: Das Warten auf den Neustart steckt in der
  Oberfläche der *neuen* Version. Das Einspielen dieser Version läuft noch mit dem alten Verhalten.

---

## [1.50.3] - 2026-07-28 (Build 277) — *Stabiler Image-Push*

### 🐛 Bugfixes & Optimierungen
- **Sporadisch fehlschlagender Image-Push abgesichert (`docker-build.yml`)**: Ein Lauf brach mit
  `ERROR: unknown blob` ab — **nicht** beim Bauen, sondern beim Hochladen der Layer zu ghcr.io.
  Auslöser war sehr wahrscheinlich, dass zwei Läufe kurz hintereinander denselben `latest`-Tag
  gleichzeitig hochluden. Zwei Gegenmaßnahmen:
  - `concurrency`-Gruppe pro Branch — es läuft nur noch ein Image-Build gleichzeitig, ein zweiter
    wartet, statt parallel zu pushen. `cancel-in-progress` bleibt bewusst aus, damit ein laufender
    Build fertig wird.
  - `provenance: false` — ohne Attestierungs-Manifest entsteht ein einfacher Image-Index mit
    weniger Blob-Uploads. Das Panel wertet die Provenance-Daten ohnehin nirgends aus.
- **Dependabot auf ein sinnvolles Maß gebracht (`dependabot.yml`)**: Die erste Aktivierung erzeugte auf
  einen Schlag zwölf Pull Requests, überwiegend Hauptversionssprünge (React 19, Tailwind 4,
  better-sqlite3 13, recharts 3, nodemailer 9). Solche Sprünge gehören geplant und im Browser getestet,
  nicht über Nacht als PR. Hauptversionen werden jetzt für alle drei Ökosysteme ignoriert, das Limit
  liegt bei drei offenen PRs.
  **Sicherheitsupdates sind davon ausdrücklich nicht betroffen** — die meldet Dependabot weiterhin,
  auch wenn dafür eine neue Hauptversion nötig wäre.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.50.3` (Build 277)** erhöht.
- **Reine CI-Änderung**, kein Eingriff in Backend, Frontend, Agent oder Datenbank.
- **Der fehlgeschlagene Lauf hatte keine Auswirkung auf den Betrieb**: Der unmittelbar folgende Build
  hat `latest` erfolgreich hochgeladen (Stand v1.50.2, Tag `da6e1be`). Auf dem Server genügt weiterhin
  `docker compose pull && up -d`.
- **Zur Einordnung der Historie**: Drei ältere Fehlschläge desselben Workflows (27.07. sowie zweimal am
  28.07. gegen 15:50) hatten eine andere Ursache — dort scheiterte `npm run build` im Frontend an einem
  Syntaxfehler. Diese wurden jeweils vom nächsten Commit behoben und sind hier nicht betroffen.
- Die bereits offenen Dependabot-PRs mit Hauptversionssprüngen bleiben bestehen und können von Hand
  geschlossen werden; die geänderte Regel verhindert nur, dass neue dieser Art entstehen.

---

## [1.50.2] - 2026-07-28 (Build 276) — *Express aktualisiert*

### 🔐 Sicherheit
- **Express von fest `4.19.2` auf `^4.22.2` gehoben**: Der erste Lauf der neuen Abhängigkeitsprüfung meldete
  im Backend 14 Schwachstellen (9 hoch, 2 mittel, 3 niedrig). Sieben der hohen Funde hingen an einer einzigen
  Wurzel — der veralteten Express-Version und deren Unterpaketen `body-parser`, `cookie`, `path-to-regexp`,
  `qs`, `send` und `serve-static`. Der Sprung bleibt innerhalb von Express 4 und ist damit ein reines
  Wartungsupdate ohne Umstellungen am Code.
- **Einordnung der behobenen Meldungen**: Die beiden `body-parser`-Advisories betreffen
  `application/x-www-form-urlencoded`. Das Panel bindet ausschließlich `express.json()` ein, war also
  praktisch kaum exponiert — die Aktualisierung räumt sie trotzdem ab.
- **Caret statt fester Version**: Da das Projekt keine Lockfiles führt, löst ohnehin jeder Build die
  Abhängigkeiten neu auf. Die exakte Angabe erzeugte damit nur den Anschein von Reproduzierbarkeit,
  verhinderte aber, dass Sicherheits-Patches innerhalb von Express 4 überhaupt ankommen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.50.2` (Build 276)** erhöht.
- **Keine Code-Anpassung nötig**, keine Datenbank-Migration, keine Agent-Aktualisierung. Express 4.22 ist zu
  4.19 API-kompatibel; Routen, Middleware und `express.json()` verhalten sich unverändert.
- **Wirksam mit dem nächsten Image-Build**, da die Abhängigkeiten dort neu installiert werden.
- **Bewusst offen gelassen** (erfordern Sprünge über Hauptversionen und einen Test im Browser):
  - `vite` / `esbuild` (Frontend): Die Meldung betrifft den **Entwicklungsserver**, nicht das ausgelieferte
    Produktions-Bundle. Ein Fix erfordert Vite 8.
  - `react-router-dom` (Frontend): Offene Weiterleitung über Backslash in `<Link>` / `useNavigate`.
    Der zweite Teil des Advisories betrifft SSR-Hydration, die das Panel nicht verwendet.
  - `geoip-lite` (Backend): DoS in `brace-expansion` über `rimraf`/`glob`, erreichbar nur beim Aktualisieren
    der GeoIP-Daten, nicht über Anfragen an das Panel.

---

## [1.50.1] - 2026-07-28 (Build 275) — *Abhängigkeitsprüfung*

### 🔐 Sicherheit
- **Neuer Workflow „Abhängigkeiten prüfen" (`.github/workflows/security-audit.yml`)**: Führt `npm audit`
  getrennt für `backend/` und `frontend/` aus — bei Änderungen an einer `package.json`, zusätzlich jeden
  Montag um 06:00 UTC und jederzeit manuell auslösbar. Das Ergebnis erscheint als Tabelle in der
  Job-Zusammenfassung, betroffene Pakete werden bei kritischen und hohen Funden namentlich aufgeführt.
  Der Lauf ist **bewusst vom Image-Build getrennt** und blockiert das Deployment nicht: Eine neu
  veröffentlichte Schwachstelle in einem Fremdpaket soll sichtbar werden, aber kein Update verhindern.
- **`.github/dependabot.yml` ergänzt**: Wöchentliche Update-Vorschläge für `backend/` und `frontend/`,
  monatlich für die GitHub-Actions. Patch- und Minor-Updates sind gebündelt, damit nicht für jedes
  einzelne Paket ein eigener Pull Request entsteht.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.50.1` (Build 275)** erhöht.
- **Reine CI-Änderung.** Keine Auswirkung auf Backend, Frontend, Agent, Datenbank oder das Image —
  am Panel selbst ändert sich nichts.
- **Voraussetzung für Dependabot**: Die Datei wirkt erst, wenn Dependabot in den Repository-Einstellungen
  aktiviert ist (Settings → Code security). Aktuell ist es dort **abgeschaltet**, der Abruf der
  Sicherheitswarnungen über die API antwortet mit `403 Dependabot alerts are disabled`.
  Der neue Workflow läuft davon unabhängig und liefert die Prüfung auch ohne diese Einstellung.
- **Bekannte Einschränkung — keine Lockfiles**: Das Projekt führt weder `backend/package-lock.json` noch
  `frontend/package-lock.json`, und der `Dockerfile` installiert mit `npm install` statt `npm ci`.
  Dadurch löst jeder Image-Build die Abhängigkeiten neu auf: Zwei Builds desselben Commits können
  unterschiedliche Paketversionen enthalten, und neue Patch-Versionen gelangen ungeprüft in das Image.
  Der Workflow löst den Baum für die Prüfung deshalb jedes Mal frisch auf — er prüft damit den Stand
  zum Zeitpunkt des Laufs, nicht zwingend exakt den des letzten Builds.

---

## [1.50.0] - 2026-07-28 (Build 274) — *Sicherheits-Audit*

Vollständige Durchsicht von Backend, Agent und Frontend auf Sicherheitslücken und Bugs.
Vier Befunde wurden behoben, der schwerwiegendste stammte aus der Vorversion.

### 🔐 Sicherheit
- **Befehlsinjektion als root auf dem Host geschlossen (kritisch, `POST /api/update/run`)**:
  Das in v1.49.0 eingeführte Update-Ziel (`panel_container`) wurde ungeprüft in ein Shell-Skript eingesetzt,
  das per `nsenter` als **root im Host-Namespace** läuft. Die einzige Absicherung war ein Escaping von
  Anführungszeichen — gegen `$(…)` und Backticks wirkungslos. Ein Wert wie `$(befehl)` hätte damit beliebigen
  Code als root auf dem Docker-Host ausgeführt, also weit außerhalb des Containers.
  Ein Panel-Administrator konnte sich so zu vollem Host-Zugriff erweitern; über eine gekaperte Admin-Sitzung
  wäre derselbe Weg von außen nutzbar gewesen.
  Ziele werden jetzt gegen das von Docker zugelassene Zeichenrepertoire geprüft
  (`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`) — beim Speichern in `PUT /api/update/target` (Antwort `400` bei
  Verstoß) **und** ein zweites Mal unmittelbar vor der Verwendung, damit auch Altbestände aus der Datenbank
  oder aus früheren Versionen nicht durchrutschen.
- **Passwortänderung beendet jetzt fremde Sitzungen (`PUT /api/auth/password`)**: Bisher blieb ein bereits
  erbeutetes JWT nach einer Passwortänderung bis zum Ablauf (Standard 24 Stunden) gültig — ausgerechnet die
  Maßnahme, zu der man bei Verdacht auf Missbrauch greift, sperrte niemanden aus. Alle übrigen Sitzungen des
  Kontos werden nun widerrufen; die gerade benutzte bleibt bestehen, damit man nicht selbst herausfliegt.
- **Passwort-Reset beendet ausnahmslos alle Sitzungen (`POST /api/auth/reset-password`)**: Da der Reset ohne
  Anmeldung abläuft, wird hier keine Sitzung verschont.
- **E-Mail-Änderung erfordert das aktuelle Passwort (`PUT /api/auth/me/email`)**: Die Adresse ist der
  Wiederherstellungsweg des Kontos. Zuvor genügte eine gültige Sitzung, um sie zu tauschen — anschließend
  hätte „Passwort vergessen" die vollständige Übernahme des Kontos ermöglicht. Die Änderung wird zusätzlich
  im Audit-Log vermerkt.
- **GitHub-Token nicht mehr über die Shell (`POST /api/update/run`)**: Der `git pull` mit eingebettetem Token
  lief über eine Shell-Zeile. Der Aufruf nutzt jetzt `execFile` ohne Shell, wodurch Sonderzeichen im Token
  nicht mehr interpretiert werden können.

### ✅ Geprüft und in Ordnung (keine Änderung nötig)
- **Firewall-Regeln** (`firewallAdapters.js`): Ports, Protokolle und Quell-Adressen sind über strenge
  Regex-Whitelists abgesichert, bevor sie in Kommandos einfließen.
- **Systemd-Steuerung** (`services.js`): Unit-Namen über Whitelist geprüft, Aktionen auf eine feste Liste begrenzt.
- **SQL**: Keine Injektion gefunden. Die wenigen Stellen mit Interpolation setzen ausschließlich fest
  verdrahtete Spaltennamen bzw. Platzhalter ein, alle Werte laufen über Parameter.
- **Authentifizierung**: JWT-Prüfung, Widerrufsliste und Rechteprüfung greifen auf allen `/api`-Routen;
  Login, 2FA-Prüfung und „Passwort vergessen" sind rate-limited (10 Versuche / 15 Minuten).
- **Frontend**: Kein `target="_blank"` ohne `rel`, keine fehlenden React-Keys; das einzige
  `dangerouslySetInnerHTML` rendert ausschließlich das serverseitig erzeugte QR-Code-SVG.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.50.0` (Build 274)** erhöht — Minor, da sich Abläufe sichtbar ändern.
- **Keine Datenbank-Migration.** Die Tabellen `sessions` und `revoked_tokens` bestehen bereits und werden
  lediglich zusätzlich genutzt.
- **Spürbare Verhaltensänderungen**: Nach einer Passwortänderung müssen sich alle *anderen* Geräte neu
  anmelden. Zum Ändern der E-Mail-Adresse fragt die Oberfläche jetzt zusätzlich das aktuelle Passwort ab —
  Backend und Oberfläche wurden gemeinsam umgestellt, es bleibt kein Formular ohne passendes Gegenstück.
- **Bereits gespeicherte Update-Ziele**: Enthält ein vorhandener Wert unerlaubte Zeichen, wird er ignoriert
  und im Log vermerkt; das Panel fällt dann auf die automatische Erkennung zurück. Normale Container-Namen
  sind nicht betroffen.
- **Keine Agent-Aktualisierung erforderlich**, keine Änderung an Rechten, WebSocket oder Metrik-Erfassung.

---

## [1.49.1] - 2026-07-28 (Build 273) — *Update-Ziel ohne Dubletten*

### 🐛 Bugfixes & Optimierungen
- **Jeder Container stand doppelt in der Auswahlliste „Ziel des Updates"**: `GET /api/update/targets` legte jeden
  Dockhand-Container zweimal an — einmal unter seiner Container-ID und einmal unter seinem Namen. Beide Einträge
  trugen dieselbe Beschriftung und waren im Auswahlfeld nicht auseinanderzuhalten; bei vielen Containern
  (mailcow, PatchMon usw.) verdoppelte das die gesamte Liste.
  Es wird jetzt **ein Eintrag pro Container** erzeugt. Gespeichert wird der **Container-Name** statt der ID:
  er ist lesbar und trägt in beiden Update-Wegen — die Dockhand-Suche vergleicht ohnehin gegen ID *und* Name,
  der lokale Host-Fallback braucht ihn für `docker inspect` und `docker restart`. Nur namenlose Container
  fallen weiterhin auf ihre ID zurück.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.49.1` (Build 273)** erhöht.
- **Keine Datenbank-Migration.** Rein serverseitige Änderung an der Zusammenstellung der Auswahlliste,
  das Frontend bleibt unverändert.
- **Hinweis für bereits gesetzte Ziele**: Wer in v1.49.0 einen Eintrag ausgewählt hat, bei dem zufällig die
  Container-**ID** gespeichert wurde, muss nichts tun — die Suche in `/api/update/run` prüft weiterhin gegen ID
  und Name. Die Auswahl bleibt also gültig, taucht in der Liste aber nur noch einmal auf.
- Da Dockhand-Container nun unter ihrem Namen geführt werden, erscheinen lokal gefundene Container weiterhin
  nur dann zusätzlich, wenn Dockhand sie nicht kennt — Doppelungen zwischen beiden Quellen bleiben ausgeschlossen.

---

## [1.49.0] - 2026-07-28 (Build 272) — *Wählbares Update-Ziel*

### ✨ Neue Funktionen & Features
- **Ziel-Container bzw. Stack für das Panel-Update frei wählbar**: Der Updater musste sich sein Ziel bisher
  über Namensraten selbst suchen (`name.includes('panel')`, Image enthält `roobiing` …). Heißt der Container
  auf dem Server anders, lief das ins Leere. Ab sofort lässt sich das Ziel in den Einstellungen fest hinterlegen:
  - **`GET /api/update/targets`** (Admin) liefert eine kombinierte Auswahlliste aus Dockhand-Stacks,
    Dockhand-Containern und lokal über den Host-Namespace gefundenen Containern — jeweils mit Image-Angabe.
  - **`PUT /api/update/target`** (Admin) speichert die Auswahl unter dem Settings-Schlüssel `panel_container`.
  - **Einstellungen → System → GitHub-Repository & Panel-Updater**: neuer Abschnitt „Ziel des Updates" mit
    Auswahlfeld, Neu-laden-Knopf und der Voreinstellung *Automatisch erkennen*. Die Auswahl wird sofort gespeichert.
  - Sowohl die Dockhand-Suche als auch der lokale Host-Fallback bevorzugen ab jetzt das konfigurierte Ziel und
    fallen nur ohne Auswahl auf die bisherige automatische Erkennung zurück.
- **Robusterer lokaler Fallback**: Das Host-Skript liest `com.docker.compose.project.working_dir` **und**
  `com.docker.compose.project.config_files` aus den Container-Labels, führt vor dem Recreate ein `docker compose pull`
  aus und durchsucht erst danach die bekannten Verzeichnisse. Reihenfolge ist jetzt nsenter (Host-Namespace) zuerst,
  Docker-Socket als Fallback — im Container selbst existieren die Compose-Pfade des Hosts nicht.

### 🐛 Bugfixes & Optimierungen
- **Backend-Absturz verhindert**: In `backend/src/routes/update.js` waren die neuen Routen versehentlich
  **innerhalb** des `/changelog`-Handlers gelandet, dessen Funktionsrumpf dadurch nie geschlossen wurde.
  Die Datei war nicht ladbar (`SyntaxError: Unexpected end of input`) — das Backend wäre beim Start abgestürzt.
  Der Handler wird jetzt korrekt geschlossen, beide Routen liegen auf oberster Ebene.
- **Doppeltes Neuerstellen des Containers behoben**: Der frühe Ausstieg prüfte nur noch `stackUpdated`, während
  ein erfolgreiches Container-Recreate über die Dockhand-API in `apiSuccess` vermerkt, aber nicht mehr ausgewertet
  wurde. Dadurch lief nach einem bereits erfolgreichen Update zusätzlich der Host-Fallback und erstellte den
  Container ein zweites Mal neu — mitten im laufenden ersten Recreate. Geprüft wird jetzt wieder `apiSuccess`.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`1.49.0` (Build 272)** erhöht (Minor, da neues Feature).
- **Keine Datenbank-Migration nötig**: `panel_container` ist ein gewöhnlicher Schlüssel in der bestehenden
  Key-Value-Tabelle `settings` und wird erst beim ersten Speichern angelegt.
- **Abwärtskompatibel**: Ohne gesetztes Ziel verhält sich der Updater exakt wie bisher (automatische Erkennung).
- **Keine Agent-Aktualisierung erforderlich**, keine Änderung an Rechten, Sessions oder WebSocket-Verhalten.
  Die neuen Routen sind wie der restliche Updater auf die Rolle `admin` beschränkt.
- **Wirksam erst nach dem Update**: Da der Fix im Updater selbst sitzt, greift er erst bei dem Update, das auf
  diese Version folgt. Das Einspielen dieser Version läuft noch über den bisherigen Weg.

---

## [1.48.23] - 2026-07-28 (Build 271) — *GitHub-Token Card Layout Fix*

### 🎨 Design & UI-Verbesserungen
- **Fehlendes Card-Layout beim GitHub-Token & Panel-Updater behoben (`Settings.jsx`)**: In den Einstellungen im Tab „System & Backup" fehlte beim Bereich „GitHub Update-Token / Panel-Updater" auf der linken Seite die umliegende `<Card>`-Komponente. Der Block war ohne Header und Rahmen direkt im Grid platziert. Die Komponente `GitHubTokenCard` wurde nun in eine vollwertige `<Card>` mit Titel und Icon eingebettet, sodass sie optisch perfekt zur Karte „Backup & Migration" auf der rechten Seite passt.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Nach dem Seitenneustart erscheint der GitHub-Bereich im Tab „System & Backup" sauber gerahmt als Karte.

---

## [1.48.22] - 2026-07-28 (Build 270) — *Update-Log Modal Changelog Fix*

### 🐛 Bugfixes
- **Anzeige des aktuellen Update-Logs im Popup gelöst (`Dockerfile`, `Sidebar.jsx`, `Settings.jsx`)**: Bisher zeigte das Erfolgs-Popup nach einem Panel-Update standardmäßig alten Fallback-Text zu 2FA/GitHub-Token an. Die Ursache war doppelt:
  1. Im `Dockerfile` wurde `CHANGELOG.md` bisher nicht ins Container-Image (`/app/CHANGELOG.md`) kopiert, weshalb das Backend beim Update keinen aktuellen Changelog-Eintrag auslesen konnte.
  2. In `Sidebar.jsx` und `Settings.jsx` wurde `data.changelogEntry` beim Speichern in den `localStorage` (`panel_update_result`) nicht mit übergeben.
  Beide Punkte wurden behoben, sodass nach dem automatischen Neustart nun immer exakt der neueste Changelog-Eintrag inklusive *Nachwirken* angezeigt wird.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Nach dem nächsten Update erscheint im „Update-Log & Nachwirken"-Modal sofort der korrekte, jeweils neueste Eintrag aus `CHANGELOG.md`.

---

## [1.48.21] - 2026-07-28 (Build 269) — *Dockhand Stack Deploy & Smart Compose Discovery Updater*

### ⚡ Updater & Docker-Optimierungen
- **Dockhand Pro API Stack-Deploy im Updater (`update.js`)**: Der automatische Docker-Updater (`POST /api/update/run`) prüft in Dockhand nun primär, ob das Panel als Docker-Compose-Stack verwaltet wird. Wird ein Panel-Stack gefunden, wird direkt ein Stack-Deploy (`/api/stacks/:id/deploy` mit `pullImages: true` und `forceRecreate: true`) ausgeführt. Da ein Container-Restart (`/api/containers/:id/restart`) das alte Image beibehält und `/recreate` für Container in Dockhand nicht existiert, sorgt das Stack-Deploy für eine vollständige Erneuerung mit dem neu geladenen Image.
- **Intelligente Docker Compose Pfad-Erkennung für lokales Docker & `nsenter`**: Für die Fallback-Methoden (lokales Docker-Socket `/var/run/docker.sock` und Host-Namespace über `nsenter`) liest das Skript zunächst über `docker inspect` automatisch das Label `com.docker.compose.project.working_dir` des Containers aus. So wird exakt das Arbeitsverzeichnis des Projekts auf dem Host ermittelt und `docker compose up -d --force-recreate` im richtigen Ordner gestartet.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Der Updater erneuert den Panel-Container bei Dockhand-Stack-Verwaltung oder über die intelligente Pfadsuche nun fehlerfrei mit dem jeweils aktuellen Image.

---

## [1.48.20] - 2026-07-28 (Build 268) — *MC-Host24 Tag Routing Fix*

### 🐛 Bugfixes
- **Fehler „Ungültige Aktion" beim Hinzufügen von MC-Host24-Tags behoben (`backend/src/routes/mchost.js`)**:
  - In `mchost.js` war die generische Aktions-Wildcard-Route `router.post('/vserver/:id/:action')` über den spezifischen Tag-Routen (`router.post('/vserver/:id/tags')`) platziert. Dadurch fing Express jeden POST-Request zum Anlegen von Tags mit `action = "tags"` ab und lehnte ihn mit HTTP 400 (`Ungültige Aktion`) ab.
  - Die spezifischen Tag-Routen wurden vor die Wildcard-Route verschoben, sodass Tags nun ordnungsgemäß gespeichert und gelöscht werden können.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Backend verarbeitet Tag-Anfragen für MC-Host24-Server nach Neustart wieder korrekt.

---

## [1.48.19] - 2026-07-28 (Build 267) — *API-First Docker Updater & Comprehensive Console Error Logging*

### ⚡ Updater & API-Optimierungen
- **Dockhand Pro API als primäre Update-Methode (`update.js`)**: Der automatische Docker-Updater (`POST /api/update/run`) priorisiert in Container-Umgebungen ohne `.git` nun primär die **Dockhand Pro API** (falls in den Einstellungen konfiguriert). Das Image (`ghcr.io/roobiing/ueberwachungs-panel:latest`) wird dabei über den `/api/images/pull` Endpunkt geladen und der Panel-Container über `recreate` bzw. `restart` automatisiert erneuert.
- **Volle Fehler- & STDOUT-/STDERR-Transparenz in der Konsole**: Sämtliche Schritte des Updaters (Image-Pull, Container-Suche, Recreate/Restart) sowie die Fallback-Methoden (lokales Docker-Socket `/var/run/docker.sock` und `nsenter`) loggen ab sofort jeden Fortschritt sowie eventuelle Fehler-Details, HTTP-Response-Bodys und Stack-Traces direkt in `console.log` und `console.error`. Somit ist eine stumme Blockade im Hintergrund ausgeschlossen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Container-Updates laufen zuverlässig und transparent über die konfigurierte API; bei Nichtverfügbarkeit greift sofort der Fallback mit 60-Sekunden-Timeout.

---

## [1.48.18] - 2026-07-28 (Build 266) — *Hosting-Provider Fusion & Settings Crash Fix*

### ✨ Features & UI-Optimierungen
- **Zusammenführung der Hoster (Hetzner & MC-Host24)**: 
  - **Sidebar & Router**: Hetzner Cloud und MC-Host24 sind in der Sidebar unter „Dienste" zu einem gemeinsamen Navigationspunkt **„Hosting-Provider" (`/hosting`)** zusammengefasst. Bisherige Links (`/hetzner`, `/mchost`) leiten automatisch auf die kombinierte Seite weiter.
  - **Hosting-Seite (`Hosting.jsx`)**: Bietet eine strukturierte Tab-Steuerung zwischen Hetzner Cloud (Server & Storage Boxes) und MC-Host24 (Root-Server).
  - **Einstellungen (Tab „Cloud & APIs")**: Die separaten Konfigurationskarten für Hetzner Cloud API und MC-Host24 wurden zu einer übersichtlichen Gesamt-Karte **„Hosting & Cloud APIs (Hetzner & MC-Host24)"** zusammengeführt.

### 🐛 Bugfixes
- **Absturz in den Einstellungen behoben**: Behebt einen `ReferenceError: servers is not defined` auf der Seite `/settings`, der durch einen Variablen-Tippfehler im PatchMon-Serververknüpfungsblock (`pmAgents` statt `servers`) aufgetreten war.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Konfigurationen der Hoster-APIs (Hetzner und MC-Host24) bleiben unverändert aktiv. Bisherige Lesezeichen auf `/hetzner` oder `/mchost` werden nahtlos auf die neue kombinierte `/hosting`-Seite umgeleitet.

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
