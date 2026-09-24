# 📜 Überwachungs-Panel — Update-Log & Release-Historie (CHANGELOG)

Alle Änderungen, neue Module, Bugfixes und das **Nachwirken (System-Auswirkungen & Kompatibilität)** werden hier fortlaufend protokolliert.

**Versionsschema `Major.Minor.Änderung.Fix`** — vier Stellen, rückwirkend auf die gesamte Historie
angewandt. Die Zählung beginnt beim ersten Release mit `1.0.0.0` und läuft von dort lückenlos durch:

| Stelle | Beispiel | Wofür |
|---|---|---|
| 1 — Major | `5`.1.0.0 | Zählt weiter, sobald die zweite Stelle über 9 hinausliefe |
| 2 — Minor | 5.`1`.0.0 | Größeres Update, neues Modul oder Feature — **immer einstellig (0–9)** |
| 3 — Änderung | 5.1.`1`.0 | Kleinere Verbesserung, Design, Abhängigkeiten, Wartung |
| 4 — Fix | 5.1.1.`1` | Reiner Bugfix |

Auf `5.9.x.x` folgt also `6.0.0.0`. Beim Erhöhen einer Stelle werden alle dahinter auf `0` zurückgesetzt.
Einstellig ist **nur** die zweite Stelle — die dritte und vierte dürfen zweistellig werden
(nach `5.1.1.9` folgt `5.1.1.10`), damit eine längere Bugfix-Reihe am selben Thema zusammenbleibt.

## [7.5.1.0] - 2026-09-24 (Build 384) — *Host Shield*

### Verbesserungen & Anpassungen
- **DeinServerHost (DSH) — Ausgelaufene & gekündigte Server ausblenden:**
  - Alte, gekündigte oder beendete Server (`Cancelled`, `Terminated`, `Fraud` oder lange überfällige Verträge) werden nun standardmäßig in der Übersicht ausgeblendet, damit nur noch aktive Produkte im Fokus stehen.
  - Neuer Filter-Umschalter *„Ausgelaufene ausblenden (N)“* in der Kopfzeile mit Speicherung in `localStorage`.
  - Infobanner oberhalb der Serverliste mit Direktlink *„Alle anzeigen“*, wenn ausgelaufene Server vorhanden sind.
  - Sind ausgelaufene Server eingeblendet, werden deren Steuerungsbuttons (Start, Stop, Reset, Konsole) deaktiviert und der Status wird mit dezentem grauem Badge dargestellt.
  - Im Backend werden Live-Status-Abfragen für gekündigte Services übersprungen, was die Ladezeiten der DSH-Seite spürbar verkürzt.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** Vollständig abwärtskompatibel.
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.5.0.0] - 2026-09-24 (Build 383) — *Host Shield*

### Features & Neuerungen
- **Neues Hoster-Modul: DeinServerHost (DSH) Integration:**
  - Direkte Anbindung an die offizielle DSH API v2 (`https://api.dsh.gg/api/v2`) unter dem Menüpunkt **Cloud- & Hosting-Provider** (`/hosting`) neben Hetzner Cloud und MC-Host24.
  - **Server- & Vertragsübersicht:** Anzeige aller gebuchten Produkte (z. B. *Storage VPS 2TB* / *Web01-DSH*), Live-Status (`power on` / `power off` bzw. VM-Status), dedizierte & zugewiesene IPv4-Adressen mit Schnellkopier-Funktion, Hardware-Spezifikationen (CPU, vCores, Speicher, RAM) und Abrechnungs- / Fälligkeitsanzeige mit dynamischem Restlaufzeit-Countdown.
  - **Granulare Einzelberechtigungen pro Aktion:** Wie gewünscht verfügt jeder Steuerungs-Button über ein eigenständiges Berechtigungsrecht in `backend/src/permissions.js`:
    - `dsh.view`: DSH-Bereich, Server, Status und Details anzeigen
    - `dsh.start`: Server starten (Power on)
    - `dsh.stop`: Server stoppen / herunterfahren (Power off)
    - `dsh.reset`: Kaltstart / Reset durchführen
    - `dsh.rescue`: Notfall-Rettungssystem booten (inkl. Passwort-Dialog und Schlüsselanzeige)
    - `dsh.console`: NoVNC-Notfall-Webkonsole direkt in einem neuen Browserfenster öffnen
    - `dsh.rdns`: Reverse DNS (PTR-Record) für die Server-IP verwalten
  - **Combahton / Path.net DDoS-Schutz:** Ausklappbare Detail-Übersicht für jeden Server zur Anzeige von erkannten DDoS-Angriffen (Zeitpunkt, Peak Bandbreite in Mbit/s, Pakete/s, Methode und Mitigations-Modus).
  - **Reverse DNS (rDNS):** PTR-Records direkt aus dem Panel für die jeweilige Server-IP setzen oder löschen.
  - **Einstellungen & Verbindungs-Test:** API-Token-Verwaltung (`dsh_api_token`) in den Panel-Einstellungen unter „Hosting & Cloud APIs“ mit Verbindungstest-Knopf und automatischer Geheimhaltung/Maskierung im Diagnose-Bericht.
  - **Modul-Steuerung:** DSH lässt sich in den Panel-Einstellungen unter *Aktive Module* nach Bedarf aktivieren oder deaktivieren.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine Schema-Änderung; neue Berechtigungen für Systemrollen (`admin`, `operator`) werden beim Start automatisch synchronisiert.
- **Agent-Kompatibilität:** Vollständig abwärtskompatibel, kein Agent-Update erforderlich.
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.4.1.0] - 2026-09-23 (Build 382) — *Patch Pilot*

### Verbesserungen & Anpassungen
- **Diagnose-Abfragesperre (Cooldown) ausgebaut:** Die künstliche 15-Sekunden-Wartezeit (`COOLDOWN_MS`) am Diagnose-Endpunkt (`/api/diagnose`) wurde vollständig entfernt. Das Umschalten der Log-Option oder das erneute Klicken auf „Neu erstellen“ wird nun sofort ohne blockierende Fehlermeldung („Bitte 10s warten, bevor ein neuer Bericht erstellt wird“) ausgeführt.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** Vollständig abwärtskompatibel.
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.4.0.0] - 2026-09-23 (Build 381) — *Patch Pilot*

### Features & Verbesserungen
- **Diagnose-Bericht nach Mail-Panel-Vorbild:** Die Diagnose-Seite wurde optisch und funktional an das Schwesterprojekt „Mail-Panel“ angepasst:
  - Neuer Kopfbereich mit Stethoskop-Icon, kompakter Einleitung und blauem primärem „Neu erstellen“-Button mit Lade-Spinner.
  - Dunkelblaue Sicherheits-Infobox zum Ausschluss sensibler Geheimnisse (Passwörter, API-Keys, Tokens).
  - Optionale Checkbox *„Ausführliche Logs mitschicken (100 statt 50 Zeilen)“*.
  - Toolbar mit *„Als Text kopieren“*, *„Verschlüsselten Link erstellen“* sowie Größenangabe (in kB) und Erstellungszeitstempel.
  - Accordion-Karten im aufgeräumten Design ohne Badge-Farbcodierung: links Chevron-Pfeil, fetter Haupttitel und dezenter Untertitel, standardmäßig sind *Panel* und *Maschine* ausgeklappt.
  - Automatisches Laden des Berichts direkt beim Öffnen der Seite.
- **Verschlüsselte Diagnose-Freigabelinks (Public Share):** Neue Funktion *„Verschlüsselten Link erstellen“* generiert einen 7 Tage gültigen Freigabetoken (`/s/diagnose/:token`), der ohne Login aufgerufen werden kann (`diagnose_shares`-Tabelle mit automatischem Ablauf).
- **Log-Anonymisierung im Diagnose-Bericht:** In `backend/src/utils/diagnostics.js` werden E-Mail-Adressen in den Logzeilen durch `<adresse>` ersetzt und Tokens/Passwörter automatisch maskiert.

### Bugfixes
- **NGINX Proxy Manager URL/Port-Bug & Token-Ablauf (HTTP 400):** Endete `npm_host` mit einem Trailing-Slash (z. B. `http://45.81.232.194/`), generierte der String-Zusammenbau `http://host/:81/...`, was vom NGINX Proxy Manager mit HTTP 400 beantwortet wurde. Zudem antwortet NPM bei abgelaufenem JWT-Token mit HTTP 400 (`'Token has expired'`) statt 401. `npmApi.js` normalisiert nun URLs (`getNpmBaseUrl()`), fängt abgelaufene Tokens auch bei Status 400 ab und entfernt ungültige Tokens automatisch, falls mangels Passwort kein Auto-Refresh möglich ist, um Fehlerschleifen im Log zu verhindern.
- **Fehlalarm-Flutung in `panel_logs` behoben:** `frontend/src/hooks/useErrorReporter.js` protokollierte HTTP 502/504-Fehler von Remote-Agenten (`/api/agents/`) fälschlicherweise als interne Software-Fehler des Panels. Upstream-Ausfälle oder Reboots überwachter Zielserver werden nun von der automatischen Frontend-Fehlermeldung ausgenommen.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Neue Tabelle `diagnose_shares` wird beim Start automatisch angelegt.
- **Agent-Kompatibilität:** Vollständig abwärtskompatibel, kein Agent-Update erforderlich.
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.3.0.1] - 2026-09-21 (Build 380) — *Patch Pilot*

### Bugfixes & Agent-Update
- **Kritisch — Agent-Absturz (Agent-Update v2.15.1):** `getSshSessions()` in `agent/panel-agent.js` nutzte in zwei `forEach()`-Callbacks ein `continue`-Statement, um leere Zeilen zu überspringen. `continue` ist nur innerhalb einer echten Schleife (`for`/`while`) gültig, nicht in einer Callback-Funktion — das führte zu einem `SyntaxError` beim Laden der Datei. Jeder frisch installierte oder automatisch aktualisierte Agent crashte dadurch sofort beim Start (Neustart-Schleife via systemd) und war für das Panel nicht mehr erreichbar. Auf `return` umgestellt.
- **Sicherheit — Diagnose-Bericht leakte Zugangsdaten:** `configSummary()` in `backend/src/utils/diagnostics.js` maskierte Settings-Werte über eine Blockliste bekannter Secret-Keys. Neuere Integrationen (Uptime Kuma, Dockhand, Gemini, PatchMon-Token-Secret, Pelican) waren dort nicht eingetragen und erschienen dadurch im Klartext im Diagnose-Bericht. Auf eine Positivliste umgestellt: nur explizit freigegebene Einstellungen erscheinen im Klartext, alles andere wird standardmäßig maskiert, zusätzlich abgesichert durch einen Namensmuster-Filter (token/secret/password/key/auth). **Wer den Diagnose-Bericht seit dem letzten Update genutzt hat, sollte die betroffenen Zugangsdaten rotieren.**

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** **Betroffene Agenten müssen manuell neu installiert werden** — ein abgestürzter Agent hört auf keinem Port mehr und kann das automatische Update nicht per Push empfangen. Nach der Neuinstallation muss im Panel je Server auch der neu generierte Token eingetragen werden (`.env` auf dem Server enthält den aktuell gültigen Wert).
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.3.0.0] - 2026-09-21 (Build 379) — *Patch Pilot*

### Features & Verbesserungen
- **Docker Volumes & Netzwerke Datenanzeige:** In der Detailansicht von Servern (`Docker`-Tab) wurden die Zähler für Volumes und Netzwerke bisher mit `—` dargestellt, wenn der Server als nativer Agent angebunden war. Das Backend ruft nun die nativen Agent-Endpunkte `/docker/volumes` und `/docker/networks` parallel ab und berechnet die exakten Anzahlen.
- **KVM- & V-Server Laufwerkserkennung:** Da KVM-Hypervisoren (z. B. bei Hetzner Cloud oder Proxmox) direkte S.M.A.R.T.-Hardware-Register abstrahieren, meldete die S.M.A.R.T.-Karte bisher fälschlicherweise „Keine kompatiblen Laufwerke gefunden". Der Agent (v2.15.0) erkennt nun virtuelle Block-Devices (`lsblk`, `df -kP`), Dateisystem-Integrität (RW/RO), Typ (SSD/HDD) sowie sämtliche Partitionen, Mountpoints und Speicherbelegungen mit visuellen Balken.
- **Umfassender Sicherheits-Bereich & Audit:**
  - **Sicherheits-Score (0–100):** Berechnet automatisch ein transparentes Sicherheits-Rating mit Audit-Checkliste und konkreten Empfehlungen (Root-Login, Passwort-Authentifizierung, alternativer SSH-Port, Fail2ban).
  - **Status-Kacheln:** Direkte Visualisierung von Root-Login (mit Risiko-Hinweis), Passwort-Auth, SSH-Port und aktivem Fail2ban-Schutz (inkl. aktiver Jails).
  - **Port-Wächter Drift-Inspektor:** Liest alle aktuell lauschenden Netzwerk-Ports (`ss -tulnp`) inklusive Prozessname und Bind-Adresse aus. Unerlaubte Ports außerhalb der Whitelist werden als Live-Port-Drift markiert. Per Klick auf „Ports übernehmen" lassen sich alle erkannten Ports direkt in die Whitelist übertragen.
  - **Aktive SSH-Sitzungen:** Zeigt nun neben der Remote-IP auch den angemeldeten System-Benutzer (`user`), das Terminal (`tty`), Herkunftsland/Stadt und die Login-Uhrzeit an.
  - **SSH-Schlüssel-Verwaltung:** Neues Modal zum direkten Hinterlegen öffentlicher SSH-Schlüssel auf dem Server ohne Konsolenzugriff (`POST /api/agents/:id/ssh/keys`).
- **System-Cleanup Timeout-Verlängerung:** Bereinigungs-Aktionen (`apt-get autoremove`, `journalctl --vacuum-time`, `docker system prune -a`) führten auf ausgelasteten Servern bisher zu einem Axios-Timeout nach 8 Sekunden (`timeout of 8000ms exceeded`). Das Timeout im Panel wurde auf 180 Sekunden (3 Minuten) angehoben, ergänzt durch spinner-gestützte Button-Zustände und saubere Fehlermeldungen.
- **Agent-Update v2.15.0:** KVM/VPS Block-Device-Inspektor, runtime `sshd -T` Konfigurations-Parser (unterstützt `sshd_config.d/*.conf`), Fail2ban-Erkennung, offene Port-Ermittlung sowie Remote-Schlüssel-Hinterlegung.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** **Der Agent muss auf v2.15.0 aktualisiert werden**, um KVM-Laufwerksinformationen, detaillierte Port-Wächter-Daten und die Remote-Schlüssel-Hinterlegung vollumfänglich zu nutzen. Dies kann über den Sammel-Update-Button („Alle auf v2.15.0 aktualisieren") direkt im Panel erfolgen.
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.2.0.0] - 2026-09-21 (Build 378) — *Patch Pilot*

### Features & Verbesserungen
- **Agenten-Sammel-Update (Alle auf einmal aktualisieren):** Auf der Server-Übersicht steht nun ein prominenter Sammel-Update-Button zur Verfügung, wenn neue Agent-Versionen bereitstehen (`Alle auf vX.X.X aktualisieren (N)`).
- **Interaktives Update-Modal:** Das neue Dialogfenster zeigt alle Zielserver mit Vorher-/Nachher-Versionen, führt die Updates mit Live-Fortschrittsbalken und Statusanzeigen (Ausstehend → Wird aktualisiert… → Aktualisiert) nacheinander durch und startet die Agenten automatisch neu.
- **Backend Bulk-API:** Neuer Endpunkt `POST /api/agents/update-all` zur zentralen Ausführung von Sammel-Updates inklusive HMAC-Signierung und automatischer Versionseintragung in der Datenbank.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** Kompatibel mit allen Agenten ab v2.10.0+ (unterstützt HMAC-signierte Updates).
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.1.0.1] - 2026-09-21 (Build 377) — *Patch Pilot*

### Bugfixes & Agent-Update
- **Bugfix (Diagnose-Bericht):** In `backend/src/utils/diagnostics.js` fehlte das Feld `token` in der SQL-Abfrage der Agenten. Dadurch wurde beim Ping-Check kein `x-agent-token`-Header an die Zielserver gesendet und alle erreichbaren Agenten wurden fälschlicherweise mit `ok: false` und dem Grund `Unauthorized` im Diagnose-Bericht ausgewiesen.
- **Agent-Update (v2.14.0):** Die Agenten-Version in `agent/panel-agent.js` wurde auf `2.14.0` angehoben. Dies behebt die `HTTP 502: Not found` Fehler bei SMART-Festplatten-Checks (`/disks/smart`), System-Bereinigung (`/system/cleanup`) und Docker Compose Live-Deployment (`/docker/stacks/:name/deploy`), da die in v7.1.0.0 eingeführten Endpunkte nun über das Update-System für alle Server bereitstehen.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen:** Keine erforderlich.
- **Agent-Kompatibilität:** **Der Agent muss auf v2.14.0 aktualisiert werden**, damit SMART-Daten, System-Bereinigung und Docker Compose Streaming auf den Zielservern funktionieren. Das Panel rollt das Update automatisch beim Container-Start aus oder manuell über „Server → Agent aktualisieren".
- **Neustart-/Session-Verhalten:** Keine Unterbrechung bestehender Sessions.

## [7.1.0.0] - 2026-09-21 (Build 376) - *Patch Pilot*

### Features & Verbesserungen
- **Modul 10 (Docker Compose Stacks UI):** Docker Compose Stacks können nun direkt im Panel verwaltet werden. Ein Editor-Modal ermöglicht das Bearbeiten der Stack-Datei (`docker-compose.yml`), und das Deployment kann gestartet werden. Eine neue Ansicht im Modal streamt die Live-Deployment-Logs direkt vom Zielserver. 
- **Modul 7 (Festplatten & System):** In der Agent-Ansicht ("Festplatten & System") lassen sich nun S.M.A.R.T. Werte der Laufwerke auslesen, Temperatur und Wearout überwachen sowie Kurztests anstoßen. Ein neues Aufräum-Feature erlaubt die Fernsteuerung zum Leeren des APT Caches, Kürzen von Journal-Logs und Ausführen von Docker System Prune.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agenten-Kompatibilität:** Ältere Agenten werden bei den neuen Modulen (Stacks, Festplatten-Gesundheit) entweder leere oder fehlerhafte Daten zurückgeben; ein manuelles Update des Agenten ist auf Zielservern erforderlich, um die neuen Endpunkte für `/disks/smart` und `/docker/stacks` anzusprechen.
- **Berechtigungen:** Eine neue Permission `disks.manage` wurde eingeführt. Nur Accounts mit diesem Recht können auf die System-Speicherverwaltung sowie die S.M.A.R.T.-Daten zugreifen.

## [7.0.0.3] - 2026-09-21 (Build 375) - *Patch Pilot*

- **Fix (Datenbank):** Fehlende Migration (`ALTER TABLE remote_agents ADD COLUMN version TEXT`) in `backend/src/db.js` nachgetragen. Dadurch schlug der Background-Worker nach Agent-Updates fehl.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Führt beim Start einmalig die fehlende `version`-Migration in `remote_agents` aus.
- **Agent-Kompatibilität:** Keine direkte Code-Änderung am Agenten. Löst den Backend-Fehler. Das `Unauthorized`-Lockout erfordert manuelles Einrichten der Tokens.
- **Neustart-/Session-Verhalten:** Keine Auswirkungen.
- **Dienste / Container:** Der Panel-Container baut neu (Build 375).

## [7.0.0.2] - 2026-09-20 (Build 374) - *Patch Pilot*

- **Bugfix (Agent, v2.13.0):** Das Paket-Update ließ Kernel-Updates dauerhaft liegen. `apt-get upgrade` überspringt jedes Paket, das ein neues Paket mitbringt — und genau das tut ein Kernel-Update (`linux-image-amd64` → `linux-image-6.1.0-53-amd64`). Die Pakete blieben dadurch in PatchMon für immer als „ausstehend" stehen, egal wie oft man das Update anstieß. Der Agent nutzt jetzt `--with-new-pkgs`; entfernt wird weiterhin nichts (das täte erst `dist-upgrade`).
- **Änderung (Agent):** Bleibt danach trotzdem etwas zurückgehalten, weil es das Entfernen anderer Pakete erfordern würde, meldet der Agent das am Ende des Logs, statt es stillschweigend zu übergehen.
- **Änderung (Update-Dialog):** Am Ende jedes Laufs steht der Hinweis, dass PatchMon den neuen Paketstand erst nach dem nächsten Check-in des Hosts meldet. Ohne ihn wirkt ein erfolgreicher Lauf wie ein Fehlschlag, weil die Zähler auf der Übersicht zunächst unverändert bleiben.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine.
- **Agent-Kompatibilität:** **Der Agent muss auf v2.13.0 aktualisiert werden**, sonst bleibt es beim alten Verhalten — der Update-Befehl läuft im Agenten, nicht im Panel. Die Aktualisierung läuft wie gewohnt über Server → Agent aktualisieren. Ältere Agenten funktionieren weiterhin, installieren aber keine Kernel-Updates.
- **Neustart-/Session-Verhalten:** Kernel-Updates werden ab jetzt tatsächlich installiert und verlangen danach einen Neustart des Zielservers. Ausgelöst wird er **nicht** automatisch; PatchMon zeigt ihn als „Neustart erforderlich" an.
- **Dienste / Container:** Der Panel-Container baut neu (Build 374) beim nächsten Pull.

## [7.0.0.1] - 2026-09-20 (Build 373) - *Patch Pilot*

- **Bugfix (Live-Log):** Die Ausgabe des Paket-Updates kam hinter dem Reverse Proxy gar nicht an, weil NGINX die Antwort puffert. Das Backend sendet für diesen Stream jetzt `X-Accel-Buffering: no` und schickt die Header sofort los — die Ausgabe läuft damit wirklich live durch.
- **Bugfix (Timeout):** Der Aufruf an den Agenten nutzte den Standard-Client mit 8 Sekunden Timeout. Da das eine Socket-Inaktivitätsgrenze ist, konnte ein laufendes Update abgeschnitten werden, sobald `apt` einmal länger keine Zeile ausgab. Für diese Route gilt jetzt eine Stunde.
- **Bugfix (Verbindungsabbruch):** Ein Abbruch des Agenten-Streams wird abgefangen und sauber ans Ende des Logs geschrieben, statt als ungefangener Stream-Fehler im Panel-Prozess zu landen. Bricht der Browser ab, wird auch die Leitung zum Agenten geschlossen.
- **Bugfix (Fehlermeldung):** Ein `502`/`504` wurde als „Serverfehler … war kein JSON" gemeldet. Läuft das Panel auf dem Server, der gerade aktualisiert wird, startet es durch ein Docker- oder Kernel-Update aber selbst neu — genau das sagt die Meldung jetzt, zusammen mit dem Hinweis, dass das Update auf dem Server zu Ende läuft.
- **Änderung (Panel-Server erkennen):** `GET /api/patchmon/hosts` markiert den Host, auf dem das Panel selbst läuft (`istPanelHost`, aus der bestehenden Einstellung `patchmonLocalHostId`). Die Bestätigung warnt vor dem Verbindungsabbruch, und beim Sammel-Update wird dieser Server **zuletzt** aktualisiert, damit die übrigen vorher sauber durchlaufen.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine.
- **Agent-Kompatibilität:** Keine Änderung am Agent. Der Agent sendet während eines Updates kein Lebenszeichen, wenn `apt` lange nichts ausgibt — ein sehr knapp gesetzter `proxy_read_timeout` im Reverse Proxy kann die Verbindung daher weiterhin kappen. Das Update läuft auf dem Zielserver in dem Fall trotzdem zu Ende.
- **Neustart-/Session-Verhalten:** Unverändert — mit der Einschränkung, dass ein Update auf dem Panel-Server den Panel-Container mit neu startet, sobald es Docker aktualisiert. Laufende Sessions bleiben gültig, die Oberfläche lädt nach dem Neustart wieder.
- **Dienste / Container:** Der Panel-Container baut neu (Build 373) beim nächsten Pull.

## [7.0.0.0] - 2026-09-20 (Build 372) - *Patch Pilot*

- **Feature (PatchMon-Seite):** Updates lassen sich jetzt direkt aus der PatchMon-Übersicht installieren. Der bisherige Platzhalter-Button auf jeder Host-Karte ist aktiv und startet dieselbe Update-Ausführung wie auf der Server-Detailseite (`POST /api/agents/:id/packages/update`, Live-Log im Dialog).
- **Feature (Sammel-Update):** Neuer Button **„Alle aktualisieren (N)"** in der Titelzeile. Er arbeitet alle Server mit ausstehenden Updates **nacheinander** ab — ein Fehler bei einem Server stoppt den Durchlauf nicht, am Ende steht eine Zusammenfassung im Log.
- **Feature (Sicherheitsabfrage):** Vor jedem Update — einzeln wie gesammelt — erscheint eine Bestätigung mit der Liste der betroffenen Server und dem Hinweis, dass ein nötiger Neustart nicht automatisch erfolgt.
- **Änderung (Backend):** `GET /api/patchmon/hosts` liefert je Host zusätzlich `agentId` und `agentName` des verknüpften Panel-Agenten. Die Rollen-Beschränkung auf einzelne Server (`agent_grants`) gilt dabei genauso wie auf der Server-Seite: Ohne Zugriff auf den Agenten bleibt der Update-Button gesperrt.
- **Änderung (Update-Dialog):** `SystemUpdateModal` beherrscht nun mehrere Ziele nacheinander, zeigt den Fortschritt (`3/5`) im Titel und nutzt den gemeinsamen `Modal`-Rahmen. Die bisher wirkungslose Breitenangabe wurde durch die neue Größe `xl` (`max-w-4xl`) ersetzt; Escape und Klick auf den Hintergrund stürzen während eines laufenden Updates nicht mehr ab.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine. Die Verknüpfung nutzt die bestehende Spalte `remote_agents.patchmon_host_id`.
- **Agent-Kompatibilität:** Keine Änderung am Agent — der Endpunkt `/packages/update` existiert dort unverändert. Server **ohne** verknüpften Panel-Agenten lassen sich weiterhin nicht aus dem Panel aktualisieren; ihr Button bleibt mit entsprechendem Hinweis gesperrt.
- **Berechtigungen:** Ausführen erfordert `system.update` (wie bisher auf der Server-Detailseite), Ansehen weiterhin `patchmon.view`. Neue Rechte-Keys gibt es nicht.
- **Neustart-/Session-Verhalten:** Unverändert. Ein durch Updates nötiger Server-Neustart wird **nicht** automatisch ausgelöst und muss weiterhin von Hand erfolgen.
- **Dienste / Container:** Der Panel-Container baut neu (Build 372) beim nächsten Pull.

## [6.9.0.3] - 2026-09-05 (Build 371) - *Geo Tracker*

- **Bugfix (Frontend):** Bessere Fehlerbehandlung im System-Update-Modal: Ein Absturz (`Unexpected token '<' ... is not valid JSON`) beim Auslesen von Fehlerantworten des Servers (z. B. durch Nginx-502-Seiten) wurde behoben. Stattdessen wird der eigentliche HTTP-Fehlercode nun sauber angezeigt.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine.
- **Agent-Kompatibilität:** Keine Änderungen am Agent.
- **Dienste / Container:** Der Panel-Container baut neu (Build 371) beim nächsten Pull.

## [6.9.0.2] - 2026-09-05 (Build 370) - *Geo Tracker*

- **Bugfix (Frontend):** Behebung eines weiteren "agent is not defined" Fehlers, der auftrat, sobald man den Button "Updates jetzt installieren" oder Stack Editor Modal geklickt hat (Falsche Variablen-Referenz in den Modalen).

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine.
- **Agent-Kompatibilität:** Keine Änderungen am Agent.
- **Dienste / Container:** Der Panel-Container baut neu (Build 370) beim nächsten Pull.

## [6.9.0.1] - 2026-09-05 (Build 369) - *Geo Tracker*

- **Bugfix (Frontend):** Behebung eines Absturzes ("agent is not defined") auf der Server-Detailseite, der durch einen falschen Variablenaufruf (`agent` statt `agentData`) beim Prüfen der Update-Buttons verursacht wurde.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank-Migrationen:** Keine.
- **Agent-Kompatibilität:** Keine Änderungen am Agent.
- **Dienste / Container:** Der Panel-Container baut neu (Build 369) beim nächsten Pull.

## [6.9.0.0] - 2026-09-04 (Build 368) - *Geo Tracker*

### Features
- **Aktive SSH Verbindungen**: Das Panel zeigt nun auf der Server-Detailseite unter "Sicherheit" die aktiv verbundenen SSH-Sitzungen in Echtzeit an.
- **Geo-Tracking**: Die IPs der Sitzungen werden mittels `geoip-lite` vom Backend aufgelöst und mit Land und Stadt auf dem Panel visualisiert.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agent-Kompatibilität:** Ältere Agenten, die `/network/ssh-sessions` noch nicht implementieren, werden im Frontend graceful behandelt (leere Anzeige).
- **Abhängigkeiten:** Nutzt die bereits im Backend vorhandene Library `geoip-lite`.

## [6.8.0.0] - 2026-09-03 (Build 367) - *Weekly Reporter*

- **Feature (Modul 11):** Automatische Auslastungsberichte hinzugefügt. Es kann nun ein wöchentlicher HTML-Bericht (Montags 08:00 Uhr) über die Server-Auslastung (Uptime, CPU-/RAM-Spitzen, Zwischenfälle) konfiguriert und per E-Mail versendet werden.
- **Abschluss (Modul 6):** Das Modul zur Docker Container Control & Stack-Verwaltung ("Dockhand") wurde offiziell in der Roadmap als abgeschlossen markiert (war bereits in vorherigen Versionen integriert).

**System-Auswirkungen & Nachwirken (Impact Analysis):**
- Neue Keys `report_email` und `report_weekly_enabled` werden in der SQLite-Settings-Tabelle gespeichert.
- Benötigt eine eingerichtete SMTP-Konfiguration.
- Keine Migrationen oder Neustarts von Agenten erforderlich.

## [6.7.0.0] - 2026-09-03 (Build 366) — *Log Collector*

- **Feature (Modul 14):** Integriertes Log-Management. In der Seitenleiste befindet sich nun der Reiter "Zentrale Logs", der eine serverübergreifende Ansicht über alle Systemlogs (Syslog, Journald) bietet. Inklusive Filter (Server, Error/Warnung) und Volltextsuche.
- **Backend:** Ein neuer `logCollector` Worker pollst die Server einmal pro Minute nach neuen Logs. Aufbewahrungsfrist ist automatisch 7 Tage, danach räumt sich die DB auf.
- **Agent (v2.12.0):** Ein neuer Endpunkt `/logs?since=...` liest Logs via `journalctl -o json` sicher und formatiert aus.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** Eine neue Tabelle `syslogs` wird automatisch angelegt. Sie bereinigt sich eigenständig, sodass die SQLite-Datei nicht ins Endlose wächst.
- **Agent-Kompatibilität:** Da der `logCollector` alle Agenten nach `/logs` fragt, antworten ältere Agenten (vor v2.12.0) einfach mit 404 und werden übersprungen.

## [6.6.0.0] - 2026-09-03 (Build 365) — *Security & Maintenance*

- **Feature (Modul 12):** Auto-Remediation (Bash-Befehl) für Alarmregeln. Sobald ein Alarm auslöst, wird der definierte Befehl (z.B. `systemctl restart nginx`) auf dem Server als Root ausgeführt.
- **Feature (Modul 13):** Port-Wächter (Port-Drift-Erkennung). Auf der Server-Detailseite im Tab "SSH & Sicherheit" können erlaubte Ports hinterlegt werden. Bei unbekannten offenen Ports schlägt eine neue Alarmregel-Art (`port_drift`) an.
- **Feature (Modul 15):** Remote Paket-Updates. Auf der Server-Detailseite gibt es im Tab "System" einen Button, um anstehende Linux-Paketupdates direkt auf dem Agenten auszuführen (via `apt` oder `dnf`) und den Output live im Frontend zu verfolgen.
- **Agent (v2.11.0):** Unterstützt den neuen `POST /run-command` (Modul 12), `GET /network/ports` (Modul 13) und `POST /packages/update` (Modul 15) Endpunkt.

### ⚠️ System-Auswirkungen & Nachwirken (Impact Analysis)
- `remote_agents` Tabelle um `allowed_ports` Spalte erweitert (Default `[]`).
- `alert_rules` Tabelle um `remediation_cmd` Spalte erweitert (Default `NULL`).
- Auto-Remediation nutzt den neuen `POST /run-command` Endpunkt des Agenten.
- Remote System-Updates verwenden chunked Transfer-Encoding, um den Konsolen-Output während des Update-Laufs live ans Frontend durchzureichen.

## [6.5.0.0] - 2026-09-03 (Build 364) — *Dashboard Extensions*

- **Feature:** Das Widget "Aktive Alarme" (mit Details und Server-Zuweisung, nicht nur der nackten Anzahl) ist nun standardmäßig direkt auf dem Dashboard sichtbar.
  *(System-Auswirkungen: Das Layout-Schema wurde auf v4 angehoben; beim nächsten Aufruf wird das Dashboard-Layout für alle Nutzer einmalig auf den neuen Standard zurückgesetzt, um das Widget einzubinden).*

## [6.4.0.4] - 2026-09-03 (Build 363) — *Hotfix Agent Docker Stacks*

- **Bugfix (Agent v2.10.3):** Behebt einen Fehler, bei dem Docker-Stacks auf Remote-Servern nicht im Panel angezeigt wurden, weil die neuere `docker compose` Version das `--format '{{json .}}'` nicht mehr unterstützt. Der Agent nutzt nun `--format json`. Agent muss aktualisiert werden!

## [6.4.0.3] - 2026-09-03 (Build 362) — *Hotfix Images Tab*

- **Bugfix:** Behebt einen Darstellungsfehler auf dem Reiter "Images" im Docker-Zentrum, durch den bei Images statt Dateigröße und Name nur `—` und `NaN undefined` angezeigt wurden (passierte, wenn die Docker-Größe bereits vom Agenten als formatierter String wie "187MB" geliefert wurde).

## [6.4.0.2] - 2026-09-03 (Build 361) — *Hotfix UI*

- **Bugfix:** Behebt einen UI-Absturz (`TypeError: Cannot read properties of undefined (reading 'toFixed')`) auf der Server-Detailseite, der auftrat, wenn Docker-Container oder Remote-Prozesse keine Metriken für CPU/RAM geliefert haben (z.B. weil `c.cpu` oder `p.cpu` `undefined` war).

## [6.4.0.0] - 2026-09-03 (Build 360) — *Docker & Security Suite*

### ✨ Features
- **Modul 10 (Docker Stack-Editor)**: Direkte Bearbeitung von `docker-compose.yml` Dateien auf Remote-Servern über den in der UI eingebetteten Monaco Editor.
- **Docker Container Logs**: Eigenes Modal zur schnellen Live-Ansicht von Container Logs (Option für letzte 100, 500, 1000 oder 5000 Zeilen).
- **Modul 9 (SSH-Schlüsselverwaltung & Audit)**: Neuer Reiter "SSH & Sicherheit" in der Remote-Server-Ansicht zur Überwachung der Sicherheitseinstellungen (`sshd_config`) und Entfernen von autorisierten SSH-Schlüsseln.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agent-Kompatibilität**: Die neuen Funktionen (`/ssh/keys`, `/ssh/audit`, `/docker/stacks/.../file`) erfordern, dass die Agenten auf den Zielservern aktualisiert werden. Ohne Update können die Funktionen nicht genutzt werden.
- **Rechte-System**: Ein neues Recht `agents.manage_ssh` wurde hinzugefügt (Standardmäßig deaktiviert für Operator). Administratoren müssen dieses Recht erst zuweisen.
- **Docker Modus**: Docker Features greifen direkt auf die native Docker Engine zu (`useNative()`), Dockhand Fallbacks existieren aktuell nur für Docker Basic Control und noch nicht für Stack Edit oder Container Logs.
- **Frontend-Pakete**: `@monaco-editor/react` wurde zu `package.json` hinzugefügt und das Image wird beim Build dadurch etwas größer.

## [6.3.0.0] - 2026-09-03 (Build 359) — *Modul 8 Erweiterung - NPM Integration*

- **Feature (Modul 8 Erweiterung):** NGINX Proxy Manager (NPM) Integration. SSL-Zertifikate, die über NPM verwaltet werden, können nun automatisch in den SSL-Wächter synchronisiert werden.
- Das Panel verbindet sich mit der API des NPM, importiert alle Zertifikate und liest deren genaues Ablaufdatum aus — ohne eigene Verbindungen übers Internet aufbauen zu müssen.
- Löscht man ein Zertifikat in NPM, verschwindet es auch automatisch im Panel. Alle Alarm-Webhooks bleiben wie bei manuellen Zertifikaten erhalten.
- **UI:** Neuer Einstellungs-Bereich unter "System & Backup -> Cloud & APIs". Synchronisierte Zertifikate im Wächter tragen zur Unterscheidung ein kleines "[NPM]" Badge und lassen sich nicht mehr manuell bearbeiten.
- **System-Auswirkungen & Nachwirken (Impact Analysis):**
  - DB-Migration: Die Tabelle `ssl_monitors` wurde um die Spalten `source` und `npm_id` erweitert.
  - Einstellungen: Neue Keys (`npm_host`, `npm_port`, `npm_email`, `npm_password`, `npm_token`) wurden zu `settings` hinzugefügt (Passwort und Token werden sensibel behandelt).
  - Neustart / Session: Die NPM-Synchronisation reiht sich nahtlos in den bestehenden 12h-Cronjob ein; kein Neustart erforderlich.

## [6.2.0.0] - 2026-09-03 (Build 355) — *Modul 8: SSL/TLS-Wächter*

- **Feature (Modul 8):** Neues, eigenständiges Modul zur Zertifikats-Überwachung eingeführt! Das Panel kann ab sofort beliebig viele Domains (HTTPS) auf ihre Zertifikatsgültigkeit prüfen.
- Die Überprüfung findet rein serverseitig alle 12 Stunden statt; es wird kein Agent auf dem Zielserver benötigt.
- **Benachrichtigungen:** Bei weniger als 30, 14, 7 und 3 Tagen Restlaufzeit wird automatisch eine Webhook-Benachrichtigung (Typ "System") versendet, um ein unbemerktes Ablaufen zu verhindern.
- **UI:** Neue Ansicht "Zertifikate" (🔒) im Reiter "Dienste" hinzugefügt, welche die Domains inklusive Status (ok, warning, critical, expired) übersichtlich darstellt.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank:** Eine neue Tabelle `ssl_monitors` wird automatisch angelegt. Die Migration erfolgt abwärtskompatibel über ein idempotentes `CREATE TABLE IF NOT EXISTS` Schema.
- **Berechtigungen:** Die Verwaltung der Zertifikate läuft über die bestehende Berechtigung `alerts.manage` und ist damit automatisch für alle Admin-Rollen sowie Nutzer freigeschaltet, die Alerting verwalten dürfen.

## [6.1.3.0] - 2026-09-03 (Build 354) — *Active Alerts Widget*

- **Feature (Dashboard):** Neues, optionales Widget "Aktive Alarme" hinzugefügt, das die aktuell feuernden Alerts übersichtlich als Liste anzeigt (inkl. Typ, Server, Auslösezeitpunkt und Fehlermeldung). Das Widget kann über den "Widget hinzufügen"-Dialog auf dem Dashboard aktiviert werden.

## [6.1.2.0] - 2026-09-03 (Build 353) — *Alert Clarity*

- **Verbesserung (Alert-Regelkarten):** Jeder Alert-Typ (Schwellenwert, PatchMon, Storage-Box, MC-Host24, Server-Aktion) hat jetzt ein eigenes Icon, ein farbiges Badge und einen farbigen linken Rand — der Typ einer Regel ist damit auf einen Blick erkennbar, ohne die Details lesen zu müssen.
- **Verbesserung (Firing-Indikator):** Regeln, die aktuell aktiv feuern, zeigen einen pulsierenden roten Punkt und ein „🔥 Feuert"-Badge. Bei Multi-Server-Regeln wird die Anzahl der betroffenen Server angezeigt.
- **Verbesserung (Alert-Verlauf):** Im Alert-Verlauf wird neben jedem Eintrag ein Typ-Badge angezeigt (z. B. „Schwellenwert", „PatchMon"), damit man sofort erkennt, welche Art von Alert ausgelöst hat.
- **Bugfix (Dashboard-KPI „Aktive Alerts"):** Die Zählung aktiver Alerts im Dashboard war unzuverlässig — sie basierte auf dem Activity-Feed (max. 15 Einträge) und zählte unterdrückte/fehlgeschlagene Alerts falsch mit. Jetzt wird ein eigener Backend-Endpunkt `GET /api/alerts/active-count` genutzt, der zuverlässig über die History-Tabelle zählt.
- **Bugfix (Servernamen bei Multi-Server-Alerts):** Der Alert-Verlauf und der Activity-Feed auf dem Dashboard zeigten bei Multi-Server-Regeln immer „Lokal" als Servernamen an, weil der `agent_id`-JOIN auf NULL lief. Jetzt wird der in der Alert-History gespeicherte `server_key` zur Namensauflösung genutzt.
- **Neuer Endpunkt:** `GET /api/alerts/active-count` — zählt alle Regel×Server-Kombinationen, deren jüngster History-Eintrag `fired` oder `failed` ist. `suppressed` (Wartungsmodus) wird nicht mitgezählt.
- **Verbesserung (Rules-API):** `GET /api/alerts/rules` liefert jetzt `is_active` (Boolean) und `active_count` (Anzahl feuernder Server) pro Regel mit, damit das Frontend den Status darstellen kann.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank:** Keine Migration nötig — die genutzten Spalten (`server_key`, `type`) existieren bereits.
- **API-Kompatibilität:** Neue Felder `is_active`/`active_count` in der Rules-Response und `server_key`/`rule_id` in der History-Response sind additive Erweiterungen, keine Breaking Changes.
- **Agent-Kompatibilität:** Keine Änderungen am Agent.
- **Neustart-Verhalten:** Kein besonderes — der neue Endpunkt ist sofort verfügbar.

## [6.1.1.8] - 2026-09-02 (Build 352) — *Agent Only Architecture (Hotfix 8)*

- **Bugfix (Dashboard):** Behebt einen `ReferenceError` (`modules is not defined`), der durch eine unvollständige Variablendeklaration im Dashboard-Polling (Hotfix 7) ausgelöst wurde. Das Dashboard lädt nun wieder fehlerfrei.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- Keine Änderungen an Datenbank oder Agenten.

## [6.1.1.7] - 2026-09-02 (Build 351) — *Agent Only Architecture (Hotfix 7)*

- **Bugfix (Frontend-Polling):** Das Dashboard fragt im Hintergrund nicht mehr stumpf alle Dienste ab (Hetzner, PatchMon, Uptime Kuma), wenn diese in den Einstellungen deaktiviert wurden.
- **Bugfix (Panel-Log Bereinigung):** Der globale Frontend-Error-Catcher ignoriert nun "nicht konfiguriert"-Meldungen und `502 Bad Gateway` Fehler ungenutzter Schnittstellen. Dadurch entstehen keine falschen Alarmierungen ("rote Badges") mehr, wenn z. B. Dockhand oder Hetzner bewusst deaktiviert sind.
- **Verbesserung (Globaler State):** Der `AuthContext` ruft nun einmalig nach dem Login die aktiven System-Module vom Backend (`/api/settings/modules`) ab und stellt sie allen Ansichten (Sidebar, Dashboard, Settings) synchron zur Verfügung.

**System-Auswirkungen & Nachwirken (Impact Analysis)**
- **Datenbank & Panel:** Keine Schema-Änderung. Das Audit-Log und die Panel-Logs füllen sich künftig langsamer, da absichtliche Konfigurationslücken nicht mehr gemeldet werden.
- **Agenten:** Keine Änderung.

## [6.1.1.6] - 2026-09-02 (Build 350) — *Agent Only Architecture (Hotfix 6)*

### 🧹 Refactoring
- **Codebase:** Einige nicht mehr verwendete Variablen und Importe (`localEnvId`, `dockerSocket`) in `dockerQuellen.js` wurden entfernt, um Build-Fehler der CI (GitHub Actions Linter) zu beheben, die nach dem Entfernen der alten lokalen Architektur übrig geblieben waren.

## [6.1.1.5] - 2026-09-02 (Build 349) — *Agent Only Architecture (Hotfix 5)*

### 🐛 Bugfixes
- **Sidebar:** Der Menüpunkt "Hosting-Provider" verschwindet nun wieder zuverlässig, wenn sowohl Hetzner als auch MC-Host24 deaktiviert sind. Zuvor verhinderte ein falscher interner Modul-Schlüssel (mchost24 statt mchost), dass das System die Deaktivierung richtig erkannte.

## [6.1.1.4] - 2026-09-02 (Build 348) — *Agent Only Architecture (Hotfix 4)*

### 🐛 Bugfixes
- **UI:** Im Monitoring-Dashboard wurde der Live-Traffic Graph gefixt, der nach dem Architektur-Umbau stellenweise in einem "Warte auf Daten..." Zustand hängen blieb.
- **UI:** Die drei kleinen System-Metriken (CPU, RAM, Festplatte) im Monitoring wurden im Standardlayout vergrößert und nutzen nun die volle Breite, analog zum Netzwerk-Graphen.

## [6.1.1.3] - 2026-09-02 (Build 347) — *Agent Only Architecture (Hotfix 3)*

### 🧹 Refactoring
- **Architektur:** Letzte Rest-Fragmente der obsoleten lokalen Berechtigungsstruktur (`hide_local`, `darfLokal`) sowie die direkten lokalen Docker-Socket Abfragen wurden tief im Backend (Docker-Suche und Agent-Access) final ausgebaut. Die "Agent-Only" Architektur ist nun 100% konsistent.

## [6.1.1.2] - 2026-09-02 (Build 346) — *Agent Only Architecture (Hotfix 2)*

### 🐛 Bugfixes
- **Monitoring:** Ein verbleibendes Fragment der alten lokalen Architektur im Backend (`metrics.js`) wurde entfernt, welches dazu führte, dass ein Dummy-Eintrag "Panel (lokal)" in der Serverliste generiert wurde, obwohl der lokale Host-Agent jetzt regulär über die Agentenliste verwaltet wird.

## [6.1.1.1] - 2026-09-02 (Build 345) — *Agent Only Architecture (Hotfix)*

### 🐛 Bugfixes
- **Sidebar:** Das Hosting-Provider Menü wird nun korrekt ausgeblendet, wenn sowohl Hetzner als auch MC-Host24 deaktiviert sind.
- **Monitoring:** Ein Fehler wurde behoben, durch den die Metriken-Übersicht ("Live-Stats", "Netzwerk") "Keine Daten" anzeigte. Der Datenfluss für den lokalen Panel-Server wurde vollständig an die neue reine Remote-Agent Architektur (API-Polling statt lokaler WebSocket) angepasst.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Monitoring-Verhalten:** WebSocket-Statistiken für den lokalen Node-Prozess werden nicht länger gepollt. Auch für den Panel-Server selbst fragt das Dashboard nun alle 5 Sekunden den Agent-Endpunkt (`/api/agents/:id/system/stats`) per HTTP ab, wie bei jedem anderen Server auch.

## [6.1.1.0] - 2026-09-02 (Build 344) — *Agent Only Architecture*

### ✨ Features
- **Agent Only Architecture:** Der lokale Server (Panel-Server) wird nun vollständig wie ein normaler Remote-Agent behandelt. Alle speziellen lokalen Fallbacks und Abfragen (`hideLocal`) wurden aus der Benutzeroberfläche und den Auth-APIs entfernt.
- **Cron-Job Verwaltung:** Die Cron-Job UI wurde überarbeitet. Anstelle von reinen Text-Strings gibt es nun ein Dropdown für den Rhythmus (z. B. Täglich, Wöchentlich) und eine native Zeit-Auswahl (Timepicker) für den genauen Startzeitpunkt.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Kompatibilität:** Rollen-Berechtigungen rund um `hideLocal` (Lokaler Server) sind entfallen, da der Host-Server nun über die Standard-Agent-Verwaltung berechtigt wird.
- **Datenbank:** Das Feld `hide_local` wird nicht länger abgefragt und aus `roles` bei zukünftigen Instanzen ignoriert bzw. entfernt. Keine aktive manuelle Migration notwendig.

## [6.1.0.3] - 2026-08-28 (Build 343) — *Agenten-Edit Fix*

### 🐛 Bugfixes
- **Absturz auf der Server-Seite:** Das Modal zum Bearbeiten von Servern/Agenten stürzte mit dem Fehler `editDockerEngine is not defined` ab, da ein Status-Feld fehlte. Dies wurde behoben.
- **Unbeabsichtigtes Überschreiben des Tokens:** Beim Speichern von Server-Einstellungen über das UI wurde der Agent-Token ungewollt geleert, falls das Token-Feld leer gelassen wurde. Dadurch konnten Agenten die Verbindung verlieren. Leere Felder werden jetzt wieder korrekt ignoriert, sodass der alte Token erhalten bleibt.


## [6.1.0.2] - 2026-08-28 (Build 342) — *Agent Syntax Fix*

### 🐛 Bugfixes
- **Agent Crash (Syntax-Fehler):** Ein Syntaxfehler (zusätzliche schließende Klammer), der sich im letzten Update des Remote-Agenten eingeschlichen hatte und den Agent-Dienst sofort beim Start abstürzen ließ (`status=1/FAILURE`), wurde behoben.


## [6.1.0.1] - 2026-08-28 (Build 341) — *Agent Cron-Route Fix*

### 🐛 Bugfixes
- **Remote Cron-Verwaltung 502/404 Fehler:** Die Routen (`/cron/users`, `/cron/jobs/...`) fehlten im Code des Remote-Agenten (`panel-agent.js`), was beim Abrufen von Remote-Cron-Jobs zu einem HTTP 502 Fehler führte. Diese wurden nun im Agenten ergänzt.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agenten-Update zwingend:** Die Remote-Server müssen im Panel aktualisiert werden (Agent-Neuinstallation/Update), damit die neuen Cron-Routen auf dem Server verfügbar sind. Vorher bleibt der Fehler bestehen.


## [6.1.0.0] - 2026-08-28 (Build 340) — *Zentrale Cron-Job Verwaltung & Lokaler Support*

### ✨ Features
- **Zentrale Cron-Job Verwaltung:** Die Cron-Job Verwaltung wurde aus der Agent-Detailansicht in eine zentrale Seite ("Cron Jobs") unter der Kategorie "Infrastruktur" in der Seitenleiste verschoben.
- **Lokaler Server-Support:** Cron-Jobs können nun auch für den Panel-Server selbst (lokal) angelegt und bearbeitet werden. Um trotz Docker-Container-Betrieb die Cron-Jobs des Host-Betriebssystems zu verwalten, werden die entsprechenden Systembefehle sicher per `nsenter` im Host-Namespace (`pid=1`) ausgeführt.
- **Berechtigungen:** Das Recht für Cron-Jobs wurde von `agents.manage_cron` auf `cron.manage` umbenannt, da es sich nicht mehr nur auf Agenten bezieht.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Sicherheit (nsenter):** Die lokale Verwaltung der Host-Crontabs durch den Container erfordert erweiterte Rechte auf Host-Ebene (`--target 1 --mount --uts --ipc --net --pid`). Dies ist durch die bestehenden Systemarchitektur-Privilegien des Panel-Containers abgedeckt, sollte jedoch bei Umzügen bedacht werden.
- **Kompatibilität:** Rollen, denen zuvor das Recht `agents.manage_cron` gewährt wurde, müssen dieses eventuell anpassen. (Im Code wurde die Umbenennung auf `cron.manage` durchgehend vorgenommen).
- **Datenbank:** Keine manuellen Migrationen nötig.


## [6.0.0.0] - 2026-08-28 (Build 339) — *Cron-Job Verwaltung*

### ✨ Features
- **Verwaltung von Cron-Jobs:** System-Cron-Jobs auf Remote-Servern können nun direkt aus dem Panel heraus angesehen, angelegt und gelöscht werden. Die Verwaltung geschieht im neuen Reiter "Cron Jobs" in der Detailansicht eines Servers.
- **Benutzerspezifische Cron-Jobs:** Es können gezielt Cron-Jobs für verschiedene Systembenutzer (z. B. `root`, `www-data`) bearbeitet werden.
- **Rechtesystem:** Die Cron-Job-Verwaltung ist durch das neue Recht `agents.manage_cron` abgesichert.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agenten-Kompatibilität:** Der Agent benötigt ein Update auf die neueste Version, um die Endpunkte für die Cron-Verwaltung bereitzustellen. Ohne Update bleibt der Tab funktionslos.
- **Datenbank:** Keine Migration erforderlich. Das neue Recht wird automatisch über den Code bereitgestellt.

## [5.9.8.2] - 2026-08-22 (Build 338) — *Firewall-Erkennung & Performance Fix*

### Bugfixes
- **HTTP 502 Timeout bei Firewall-Erkennung behoben:** Bei der Abfrage von Remote-Agenten konnte es zu einem 8-Sekunden-Timeout kommen, wenn Firewall-Werkzeuge (z.B. inaktives `ufw`) für Statusabfragen unverhältnismäßig lange brauchten. Die Erkennung (`detectFirewall` / `detectAgentFirewall`) speichert jetzt die Konsolenausgabe (`rawOutput`) zwischen und reicht sie an die Zustandsprüfung (`filterZustand`) weiter, sodass aufwendige Systembefehle nicht mehrfach ausgeführt werden müssen.

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agenten-Kompatibilität:** Der Agent (v2.10.2) wurde aktualisiert und implementiert denselben Zwischenspeicher. Das Panel kann die neue Agenten-Version über die automatische Update-Funktion ausrollen.

## [5.9.8.1] - 2026-08-22 (Build 337) — *Firewall-Erkennung Fix*

### Bugfixes
- **Firewall-Erkennung korrigiert:** Die automatische Erkennung (`detectFirewall`) prüft nun wieder alle installierten Firewall-Werkzeuge (UFW, firewalld, nftables, iptables) in absteigender Reihenfolge und gibt das ranghöchste Werkzeug zurück, **auch wenn dieses aktuell deaktiviert ist**. Zuvor wurden inaktive Werkzeuge übersprungen, wodurch das Panel auf nftables zurückfiel und anzeigte, nftables filtere nicht. Inaktive Werkzeuge können nun wieder wie vorgesehen über die Oberfläche aktiviert werden.
- **Feinere Rückmeldung für nftables:** Zeigt nftables keine Filter-Kette für eingehende Verbindungen an, lautet die Begründung nicht mehr pauschal "vorhandene Tabellen stammen von Docker", sondern allgemeingültiger: "Es gibt keine Kette für eingehende Verbindungen — alle Verbindungen werden zugelassen."

### System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agenten-Kompatibilität:** Der Agent (v2.10.1) wurde entsprechend aktualisiert, damit Remote-Server dasselbe korrigierte Erkennungsverhalten zeigen wie der lokale Host. Das Panel kann die neue Agenten-Version über die automatische Update-Funktion ausrollen.
- **Rückkehr zu UFW / firewalld:** Systeme, auf denen UFW oder firewalld inaktiv war und die fälschlicherweise nftables angezeigt bekamen, zeigen nun wieder das eigentliche Werkzeug an. Dort kann es über das Panel aktiviert werden.

## [5.9.8.0] - 2026-08-22 (Build 336) — *Standortabfrage abgesichert, Agent-Token zeitkonstant*

### 🔒 Sicherheit
- **Der Agent vergleicht sein Zugangs-Token jetzt zeitkonstant.** Ein gewöhnlicher Vergleich
  bricht beim ersten abweichenden Zeichen ab; aus der Antwortzeit ließe sich das Token
  theoretisch Zeichen für Zeichen erraten. Über das Netz ist das durch Laufzeitschwankungen
  praktisch nicht auswertbar — der Aufwand für die saubere Lösung war aber so gering, dass
  sich die Abwägung erübrigt. Betrifft beide Stellen: normale Anfragen und die Konsole.
- **Die Standortabfrage bekommt nur noch wohlgeformte Adressen.** Die dafür genutzte
  Bibliothek bringt eine Abhängigkeit mit, die Adressen mit führender Null (`010.0.0.1`)
  anders auslegt als der Rest des Systems.

### 🔧 Änderungen
- **Bewusst kein Rückschritt bei der Standort-Bibliothek.** Das Prüfwerkzeug schlägt vor, auf
  eine zwei Jahre ältere Fassung zurückzugehen. Beide gemeldeten Schwachstellen greifen hier
  aber nicht: Die eine betrifft eine HTML-Ausgabe, die das Panel nie aufruft; die andere die
  Auslegung von Adressen bei Zugriffsentscheidungen — hier wird lediglich ein Ort zur Anzeige
  nachgeschlagen, und die Ausgabe landet in der Datenbank, nicht in einer Regel.
  Ein Rückschritt hätte veraltete Standortdaten gebracht, um nichts zu gewinnen. Stattdessen
  wird die Eingabe geprüft — das erledigt den Punkt unabhängig von der Fassung.
  Das Prüfwerkzeug meldet die Bibliothek daher weiterhin; das ist bekannt und bewertet.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration.
- **Agent:** neue Version **2.10.0**, verteilt sich über die automatische Aktualisierung.
  Bis dahin arbeiten ältere Agenten unverändert weiter — der Token-Vergleich ist eine
  Verbesserung im Agenten selbst, keine Absprache zwischen Panel und Agent.
- **Standortanzeige:** Für übliche Adressen ändert sich nichts. Ungewöhnlich geschriebene
  Adressen zeigen künftig keinen Ort mehr an, statt einen möglicherweise falschen.

## [5.9.7.0] - 2026-08-22 (Build 335) — *Sicherheits-Kopfzeilen*

### 🔒 Sicherheit
- **Das Panel sendete keine Sicherheits-Kopfzeilen.** Damit ließ es sich in einen fremden
  Rahmen einbetten — die Grundlage für Klickentführung, bei der ein unsichtbar
  übereinandergelegtes Fenster echte Klicks abfängt. Außerdem fehlte im Fall einer
  Skript-Lücke jede zweite Verteidigungslinie.
  Gesetzt werden jetzt unter anderem: **Einbetten verboten** (`X-Frame-Options: deny`),
  **kein Raten des Inhaltstyps** (`nosniff`), eine zurückhaltende **Herkunfts-Weitergabe**
  (`Referrer-Policy: same-origin`) sowie die üblichen weiteren Vorgaben.
- **HSTS nur bei ausdrücklichem HTTPS-Betrieb.** Diese Kopfzeile wirkt im Browser dauerhaft
  fort; wer sein Panel über HTTP erreicht, hätte sich damit ausgesperrt. Sie wird deshalb nur
  gesendet, wenn die eingetragene Panel-Adresse mit `https://` beginnt.

### 🔧 Änderungen
- **Die Inhaltsrichtlinie (CSP) ist bewusst noch nicht aktiv.** Sie muss zur Oberfläche passen,
  sonst bleibt die Seite weiß — eine kaputte Oberfläche ist keine Sicherheit. Sie wird
  getrennt und geprüft nachgezogen. Ebenso bleiben die beiden „Cross-Origin"-Vorgaben aus,
  weil sie eingebundene Schriften, Bilder und die Auslieferung der statischen Dateien
  blockieren würden.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.9.0.
- **Neue Abhängigkeit:** `helmet`.
- **Zu beachten:** Wer das Panel absichtlich irgendwo einbettet — etwa als Kachel in einem
  anderen Dashboard —, wird das nach dem Update nicht mehr können. Das ist der Zweck der
  Änderung; für einen solchen Fall müsste die Vorgabe gezielt gelockert werden.
- Live-Daten und Container-Konsole (WebSocket) sind nicht betroffen und wurden gegengeprüft.

## [5.9.6.0] - 2026-08-22 (Build 334) — *Freigabe-Links laufen ab*

### 🔒 Sicherheit
- **Freigabe-Links für Panel-Protokolle galten unbegrenzt.** Ein solcher Link ist ohne
  Anmeldung abrufbar — das ist sein Zweck. Er lief bisher aber nie ab: Wer ihn einmal
  weitergegeben hat, per Chat, Ticket oder Mail, hinterließ eine dauerhaft offene Tür.
  Panel-Protokolle enthalten Aufrufpfade und Fehlerspuren.
  Beim Erstellen wird jetzt eine Gültigkeitsdauer vergeben — **sieben Tage als Vorgabe**,
  höchstens 90. Danach antwortet der Link wie ein unbekannter, ohne zu verraten, dass es ihn
  einmal gab. Das Erstellen wird zudem im Prüfprotokoll vermerkt.
- **Bestehende Links** bekommen mit dem Update eine Frist von sieben Tagen — gerechnet ab dem
  Update, nicht ab ihrer Erstellung, damit ein gerade verschickter Link nicht sofort ins Leere
  läuft.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** neue Spalte `expires_at` in `panel_log_shares`, wird beim Start angelegt.
  Bestehende Einträge werden einmalig mit einer Frist versehen. Kein Eingriff nötig.
- **Agent:** unverändert bei 2.9.0.
- **Zu beachten:** Wer bisher einen Link dauerhaft im Umlauf hatte — etwa in einem Ticket —
  muss ihn nach Ablauf neu erzeugen. Das ist beabsichtigt.
- Die Übersicht der Freigaben zeigt das Ablaufdatum mit an.

## [5.9.5.1] - 2026-08-19 (Build 333) — *Vorsorgliche Härtung der Warnmail*

### 🔧 Änderungen
- **Benutzername, Adresse und Browserkennung werden in der Warnmail auf eine Zeile gebracht
  und gekürzt.** Anlass war die Überlegung, ob sich über die Browserkennung Zeilenumbrüche in
  den Textteil der Mail schmuggeln lassen — dort ist HTML wirkungslos, ein frei erfundener
  Abschnitt („Ihr Konto wurde gesperrt, hier entsperren: …") wäre aber genauso überzeugend.
  **Beim Nachstellen zeigte sich: Dieser Weg ist gar nicht gangbar.** Zeilenumbrüche sind in
  HTTP-Kopfzeilen nicht zulässig und werden schon von der Netzwerkschicht abgewiesen, lange
  bevor das Panel sie zu sehen bekommt. Es wurde hier also keine offene Lücke geschlossen.
  Die Begrenzung bleibt trotzdem drin: Sie kostet nichts und trägt, falls dieselben Werte
  später einmal aus einer anderen Quelle stammen, bei der Umbrüche möglich sind.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.9.0.
- **Darstellung:** Sehr lange Browserkennungen erscheinen gekürzt (200 Zeichen), Benutzername
  und Adresse bei 64 Zeichen. Für echte Werte ändert sich nichts.
- Die tatsächlich geschlossene Lücke — eingeschleustes HTML im HTML-Teil — steht in v5.9.5.0
  und ist davon unberührt.

## [5.9.5.0] - 2026-08-19 (Build 332) — *Sichere Mails*

### 🔒 Sicherheit
- **Die Mail-Bibliothek war von acht bekannten Schwachstellen betroffen** und ist von Fassung 6
  auf 9 gehoben. Darunter waren das Einschleusen von SMTP-Befehlen und Kopfzeilen, eine
  **fehlerhafte Prüfung des TLS-Zertifikats beim Abholen von OAuth2-Zugangsdaten** sowie die
  Umgehung der Sperren für Datei- und Netzwerkzugriffe beim Zusammenbauen einer Nachricht.
  Betroffen waren damit alle Mails des Panels: Zwei-Faktor-Codes, das Zurücksetzen von
  Passwörtern und die Warnung vor fehlgeschlagenen Anmeldungen.
- **In der Warnung vor fehlgeschlagenen Anmeldungen ließ sich beliebiges HTML unterbringen.**
  Die Mail nennt Adresse und Browserkennung des Versuchs — beide Angaben stammen aus den
  Kopfzeilen der Anfrage und sind damit frei wählbar. Sie wurden ungefiltert in die Nachricht
  gesetzt.
  Ein einziger absichtlich fehlgeschlagener Anmeldeversuch genügte also, um dem Kontoinhaber
  eine Mail mit eingeschleustem Inhalt zu schicken — abgeschickt von der Adresse des eigenen
  Panels und mit dem Betreff einer Sicherheitswarnung. Ein untergeschobener Link wäre ein
  überzeugender Köder gewesen.
  Alle in Mails eingesetzten Werte werden jetzt umgewandelt, bevor sie in den HTML-Teil
  gelangen — auch dort, wo die Werte bereits aus vertrauenswürdiger Quelle stammen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.9.0.
- **Mailversand:** Die Einstellungen (Server, Port, Verschlüsselung, Zugangsdaten) bleiben
  unverändert gültig; es ist nichts neu einzutragen. Der Sprung über drei Hauptversionen wurde
  gegen einen echten SMTP-Dialog geprüft.
- **Darstellung:** Sonderzeichen in Benutzernamen oder Browserkennungen erscheinen in Mails
  jetzt als Zeichen statt als Auszeichnung — inhaltlich ändert sich nichts.

## [5.9.4.0] - 2026-08-19 (Build 331) — *„Aktiv" heißt jetzt auch geschützt*

### 🔒 Sicherheit
- **Das Panel meldete „Firewall aktiv", wo in Wahrheit alles offen stand.** Für nftables und
  iptables galt die Firewall als aktiv, sobald das Werkzeug **installiert** war — geprüft wurde
  nie, ob überhaupt etwas gefiltert wird. Auf jedem Server mit Docker ist das irreführend:
  Docker legt für seine Weiterleitungen immer nft-Tabellen an, und schon stand da „aktiv",
  obwohl die Standard-Regel jede eingehende Verbindung durchließ und es keine einzige Regel
  gab. Wer sich darauf verlassen hat, hielt einen offenen Server für geschützt.
  Das Panel unterscheidet jetzt zwischen **„Werkzeug vorhanden"** und **„filtert wirklich"**:
  - **UFW / firewalld:** eingeschaltet bzw. laufend?
  - **iptables:** Standard-Regel der INPUT-Kette auf DROP oder REJECT — oder wenigstens
    einzelne sperrende Regeln?
  - **nftables:** Gibt es überhaupt eine Kette am Eingang (Docker-Tabellen zählen nicht),
    und sperrt deren Standard-Regel oder eine ihrer Regeln?

  Die Anzeige sagt entsprechend **„filtert"** oder **„filtert nicht"** statt „aktiv/inaktiv",
  und im offenen Fall steht darüber ein deutlicher Hinweis samt Begründung in einem Satz —
  etwa „Es gibt keine Kette für eingehende Verbindungen — vorhandene Tabellen stammen von
  Docker."
- Der Schalter richtet sich nach demselben Zustand: Wo nicht gefiltert wird, bietet er
  „Aktivieren" an statt „Deaktivieren" wie bisher.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. Rein auswertend — es wird nichts an der Firewall verändert.
- **Agent:** neue Version **2.9.0**, die dieselbe Prüfung für Remote-Server mitliefert. Die
  Verteilung übernimmt die automatische Agent-Aktualisierung.
- **Ältere Agenten** melden den neuen Wert noch nicht; für sie bleibt die Anzeige wie bisher,
  statt fälschlich „ungeschützt" zu behaupten. Sobald das Update durch ist, greift die genauere
  Auskunft von selbst.
- **Möglicher Überraschungseffekt:** Server, die bisher grün als „aktiv" angezeigt wurden,
  erscheinen nun rot als „filtert nicht" — nicht weil sich etwas verändert hätte, sondern weil
  die Anzeige vorher falsch war.

## [5.9.3.0] - 2026-08-19 (Build 330) — *Die Firewall sperrt dich nicht mehr aus*

### 🔒 Sicherheit
- **Das Einschalten der Firewall konnte einen Server in einem Zug unerreichbar machen.** Der
  Knopf gab es lokal wie für Remote-Server längst — nur führte er in der häufigsten
  Konstellation ins Verderben: Gibt es keinen systemd-Dienst für iptables (auf Debian mit
  Docker der Normalfall), fiel das Panel auf `iptables -P INPUT DROP` zurück. Damit reißt in
  derselben Sekunde die laufende SSH-Sitzung ab, das Panel ist weg, alle Dienste sind weg —
  und zurückholen lässt sich das nur noch über die Konsole des Anbieters. `ufw --force enable`
  hat dieselbe Wirkung, weil `--force` genau die Rückfrage überspringt, mit der UFW sonst vor
  dem Abriss der SSH-Verbindung warnt.
  **Neu wird vor dem Einschalten geprüft, ob danach überhaupt noch ein Weg hineinführt** —
  Port 22 und der Port, über den das Panel bzw. der Agent erreichbar ist. Fehlt eine Freigabe,
  wird nicht geschaltet, sondern erklärt, welcher Port fehlt. Wer den Zugang anders abgesichert
  hat, kann ausdrücklich darüber hinweg; dann fragt das Panel ein zweites Mal nach.
  Bei Remote-Servern wiegt das schwerer als lokal: Sperrt sich ein Agent-Server aus, ist auch
  der Agent als einziger Draht dorthin verloren. Die Prüfung läuft deshalb im Panel und wirkt
  **auch mit älteren Agenten**, ohne dass dort ein Update nötig wäre.
- **Der iptables-Rückfall selbst ist entschärft.** Muss doch auf die Standard-Policy
  zurückgegriffen werden, setzt das Panel vorher die Regeln, ohne die ein `DROP` unweigerlich
  aussperrt: bestehende Verbindungen weiterlaufen lassen, Loopback und SSH offen halten. Erst
  danach greift `DROP`. Vorhandene Regeln werden dabei nicht doppelt angelegt.

### 🔧 Änderungen
- Die Sicherheitsabfrage vor dem Umschalten benennt jetzt die Folge, statt nur „wirklich?" zu
  fragen — beim Ausschalten also, dass der Server danach ungefiltert erreichbar ist.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration.
- **Agent:** neue Version **2.8.0** — sie spiegelt die Absicherung des iptables-Rückfalls, damit
  sie auch greift, wenn ein Agent direkt angesprochen wird. Die Verteilung übernimmt die
  automatische Agent-Aktualisierung; bis dahin schützt bereits die Prüfung im Panel.
- **Ablauf unverändert**, solange die nötigen Freigaben existieren: Dann schaltet der Knopf wie
  bisher ohne Zwischenfrage.
- **Nicht betroffen** ist das Ausschalten — es kann niemanden aussperren und läuft unverändert.

## [5.9.2.2] - 2026-08-19 (Build 329) — *Die Verdichtung der Messwerte greift endlich*

### 🐛 Bugfixes
- **Das Zusammenfassen der Messwerte hat noch nie funktioniert.** Die Abfragen gruppierten
  über `ts/Intervall` — der Wert des Intervalls wird der Datenbank aber als Zahl übergeben und
  damit als Fließkommazahl behandelt. Aus der beabsichtigten ganzzahligen Division wurde so
  eine Fließkomma-Division, bei der jeder einzelne Messpunkt in einer eigenen Gruppe landet:
  Zusammengefasst wurde also nichts, es kamen stets alle Rohwerte zurück. Erkennbar war das an
  Zeitabständen wie `1.000000238418579` statt glatter Werte.
  Beide Abfragen runden das Intervall jetzt ausdrücklich auf eine ganze Zahl ab. Damit greift
  die Verdichtung erstmals — und mit ihr auch die Obergrenze aus der vorigen Fassung.
- **Wirkung:** Ein Zeitraum von sechs Stunden lieferte über 21.000 Messpunkte und rund 1,6 MB;
  jetzt sind es rund 2.000 Punkte und ein Bruchteil der Datenmenge. Betroffen waren auch feste
  Zeitspannen, die eine Zusammenfassung vorsahen — etwa 24 Stunden, wo trotz vorgesehener
  Minutenwerte die Zehn-Sekunden-Werte kamen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration, keine Änderung an gespeicherten Werten — nur die Abfrage.
- **Agent:** unverändert bei 2.7.0.
- **Darstellung:** Die Kurven sehen unverändert aus; sie bestehen nur aus weniger, dafür
  gemittelten Punkten. Kurze Zeiträume bleiben unverändert sekundengenau.

## [5.9.2.1] - 2026-08-19 (Build 328) — *Monitoring lädt nicht mehr Zehntausende Messpunkte*

### 🐛 Bugfixes
- **Frei gewählte Zeiträume im Monitoring lieferten die Messwerte unverdichtet.** Bis
  einschließlich sechs Stunden kam für jede einzelne Sekunde ein eigener Wert — bei sechs
  Stunden über **21.000 Messpunkte und rund 1,6 MB je Abruf**, die zusätzlich im Browser
  ausgewertet und gezeichnet werden mussten. Ein Diagramm kann davon nur ein paar hundert
  darstellen, der Rest war reine Wartezeit. Kurios dabei: Ein Zeitraum von sechs Stunden **und
  einer Sekunde** wurde korrekt verdichtet und war zehnmal kleiner — die Verdichtung setzte
  erst jenseits der Grenze ein, nicht davor.
  Statt an dieser Grenze zu feilen, gibt es jetzt eine feste Obergrenze: Ein Abruf liefert
  höchstens rund 2.000 Punkte, und der Abstand zwischen ihnen wird passend zum gewählten
  Zeitraum gewählt. Bei sechs Stunden sind das etwa elf Sekunden je Punkt — für die Darstellung
  kein Unterschied, für die Ladezeit rund zehnmal weniger Daten.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. Es ändert sich nur, wie fein die vorhandenen Werte
  zusammengefasst abgefragt werden — gespeichert wird unverändert weiter.
- **Agent:** unverändert bei 2.7.0.
- **Genauigkeit:** Die vordefinierten Zeitspannen (15 Minuten bis 6 Monate) waren bereits
  sinnvoll dimensioniert und ändern sich nicht. Betroffen sind nur selbst gewählte Zeiträume,
  etwa beim Hineinzoomen. Kurze Zeiträume bleiben sekundengenau — bis rund 2.000 Sekunden
  wird gar nicht zusammengefasst.

## [5.9.2.0] - 2026-08-19 (Build 327) — *Docker-Seite lädt in einem Zug*

### 🔧 Änderungen
- **Die Auslastungswerte der Container kommen jetzt in einer einzigen Anfrage statt in einer
  pro Container.** Das war die Ursache für die langen Ladezeiten im Docker-Bereich: Für die
  CPU-Prozente muss die Docker-Engine zwei Messpunkte abwarten, jede einzelne Abfrage dauert
  deshalb ein bis zwei Sekunden. Bei zehn Containern liefen zehn solcher Abfragen — und weil
  ein Browser nur wenige gleichzeitig zulässt, zog sich das in Wellen über zehn Sekunden hin
  und begann alle acht Sekunden von vorn.
  Gemessen auf dem Testserver: **20 Anfragen in 14 Sekunden, im Schnitt 2,4 Sekunden pro
  Anfrage, die langsamste 4,1 Sekunden.** Künftig ist es eine Anfrage je Runde; das Bündeln
  übernimmt der Server, der die Abrufe gleichzeitig erledigt.
- **Die Werte werden serverseitig einige Sekunden vorgehalten.** Mehrere geöffnete Tabs oder
  ein Seitenwechsel lösen damit keinen zweiten Durchlauf aus, und eine noch laufende Abfrage
  wird geteilt statt verdoppelt.
- Bleibt die Abfrage einmal aus, behält die Seite die zuletzt bekannten Werte, statt die
  Anzeige zu leeren.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0 — der Sammelabruf passiert
  im Panel, es ist kein Update auf den Zielservern nötig.
- **Neue Adressen:** `GET /api/docker/stats` und `GET /api/agents/:id/docker/stats`. Die
  bisherigen Einzelabfragen bleiben bestehen und werden weiterhin bedient.
- **Rechte:** unverändert `docker.view`, bei Remote-Servern zusätzlich die Freigabe für den
  jeweiligen Server. Der Zwischenspeicher wird erst nach dieser Prüfung angefasst.
- **Spürbar** wird der Unterschied vor allem auf Servern mit vielen laufenden Containern und
  bei Remote-Servern, deren Agent über das Netz erreicht wird.

## [5.9.1.0] - 2026-08-19 (Build 326) — *Passkeys abschaltbar*

### 🔧 Änderungen
- **Die Passkey-Funktion lässt sich jetzt abschalten.** Unter *Einstellungen → System & Backup →
  Module* steht sie als eigener Schalter neben Docker, PatchMon und den übrigen. Ist sie aus,
  verschwindet der Knopf „Mit Passkey anmelden" von der Anmeldeseite — samt der Trennlinie
  darüber, die sonst ein „oder" ohne Alternative wäre — und die Verwaltung in den Einstellungen
  wird ausgeblendet.
  **Abgeschaltet wird auch serverseitig durchgesetzt:** Registrierung und Anmeldung per Passkey
  werden abgewiesen, auch wenn jemand die Adressen direkt aufruft. Ein reines Ausblenden in der
  Oberfläche wäre keine Abschaltung.
  Bereits angelegte Passkeys bleiben dabei gespeichert und funktionieren wieder, sobald die
  Funktion erneut eingeschaltet wird — es geht nichts verloren.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. Der Schalter liegt bei den übrigen Modulen in `enabled_modules`;
  ohne Eintrag gilt wie bisher „eingeschaltet", bestehende Installationen ändern sich also nicht.
- **Agent:** unverändert bei 2.7.0.
- **Achtung beim Abschalten:** Wer sich ausschließlich per Passkey anmeldet, braucht danach
  Benutzername und Passwort. Die Zwei-Faktor-Anmeldung ist davon unberührt.
- Die Anmeldeseite fragt den Zustand über einen neuen öffentlichen Endpunkt ab
  (`GET /api/auth/optionen`), weil sie vor der Anmeldung nicht an die Moduleinstellungen kommt.
  Er gibt ausschließlich zurück, ob Passkeys angeboten werden.

## [5.9.0.2] - 2026-08-19 (Build 325) — *Passkey: der Weg, der wirklich funktioniert*

### 🐛 Bugfixes
- **Die Hinweise zum Passkey-Speicherort versprachen etwas, das am Windows-Rechner nicht
  funktioniert.** Sie empfahlen für Passwortmanager wie Enpass erst „Passwortmanager oder
  anderes Gerät", dann den stillen Weg — beides führt dort nicht zum Ziel, und die vorherige
  Fassung nannte den stillen Weg sogar ausdrücklich „empfohlen bei Enpass".
  Der tatsächliche Grund, jetzt offen benannt: Am Rechner reichen **alle** Browser die Anlage
  eines Passkeys an Windows weiter, und dessen Dialog kennt nur Programme, die sich dort als
  Passkey-Verwalter registriert haben — seit dem Windows-Update vom November 2025 sind das
  1Password, Bitwarden und der Microsoft-Manager. Ein Passwortmanager, der nur als
  Browser-Erweiterung läuft, kommt gar nicht erst zur Auswahl. Der stille Weg hilft ebenfalls
  nicht: Den bedienen die Browser am Rechner ausschließlich mit ihrem eigenen Manager.
  An der Einstellung steht jetzt, was stattdessen zum Ziel führt — **„Handy,
  Sicherheitsschlüssel oder anderes Gerät"** und den QR-Code mit dem Telefon scannen. Dort legt
  die Passwortmanager-App den Passkey an, und über deren Synchronisierung steht er auch am
  Rechner zur Verfügung. Die Fehlermeldungen verweisen ebenfalls auf diesen Weg.
- Die zwischenzeitliche Sonderbehandlung für Brave ist wieder entfallen: Die Einschränkung gilt
  in jedem Browser gleichermaßen, eine Unterscheidung hätte nur erneut in die Irre geführt.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- Rein anzeigend — alle vier Speicherorte bleiben erhalten und verhalten sich technisch
  unverändert; nur die Beschriftungen und Erklärungen stimmen jetzt. Bereits registrierte
  Passkeys sind nicht betroffen.

## [5.9.0.1] - 2026-08-19 (Build 324) — *Passkey-Fehlschlag wird wieder erklärt*

### 🐛 Bugfixes
- **Ein abgebrochener oder erfolgloser Passkey-Versuch endete in „Registrierung
  fehlgeschlagen", statt den Grund zu nennen.** Erkannt wurde der Fall bisher nur am
  Meldungstext — die verwendete WebAuthn-Bibliothek verpackt die ursprüngliche Ausnahme aber
  und formuliert die Nachricht um, sodass die Erkennung ins Leere lief. Jetzt wird zusätzlich
  der Name der Ausnahme geprüft. Damit erscheinen die erklärenden Hinweise wieder — besonders
  beim stillen Weg über den Passwortmanager, wo es mangels Dialog sonst gar keinen Anhaltspunkt
  gäbe, woran es lag.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- Betrifft ausschließlich die Fehlermeldung; am Anlegen und Anmelden ändert sich nichts.

## [5.9.0.0] - 2026-08-19 (Build 323) — *Passkey ohne Systemdialog*

### ✨ Features
- **Neuer Speicherort „Still im Passwortmanager" — der Weg am Betriebssystem vorbei.** Unter
  Windows reichen alle Browser die Passkey-Anlage an das System weiter, und dessen Dialog bietet
  nur Anbieter an, die sich dort als System-Passkey-Verwalter registriert haben. Enpass tut das
  bislang nicht, weshalb immer Windows Hello erschien — unabhängig vom Browser und von jeder
  Einstellung im Panel.
  Die neue Option nimmt den Weg, den der Standard **„conditional create"** (WebAuthn Level 3)
  dafür vorsieht: Der Passwortmanager, in dem das gerade benutzte Panel-Passwort liegt, legt den
  Passkey **selbst** an. Es erscheint kein Auswahlfenster, kein Systemdialog und damit auch kein
  Windows Hello — das Betriebssystem ist an dem Vorgang gar nicht beteiligt.
  Voraussetzung: Das Panel-Passwort ist im Passwortmanager gespeichert und wurde zur Anmeldung
  benutzt. Am zuverlässigsten klappt es kurz nach dem Anmelden. Schlägt es fehl, sagt die Meldung
  jetzt, woran es liegt, statt von einem „abgebrochenen Dialog" zu sprechen — bei diesem Weg gibt
  es ja keinen Dialog zum Abbrechen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- **Sicherheit:** unverändert. Es ist der vorgesehene Weg der WebAuthn-Spezifikation und keine
  Umgehung: Der Passkey entsteht im Passwortmanager des Benutzers, das Panel bekommt wie bisher
  nur den öffentlichen Schlüssel und prüft ihn unverändert. Die Registrierung akzeptiert dabei
  wie zuvor auch Anmeldedaten ohne Nutzerprüfung — was bei diesem Weg vorgesehen ist, weil der
  Passwortmanager die Freigabe bereits übernommen hat.
- **Bestehende Passkeys** sind nicht betroffen, die übrigen drei Speicherorte bleiben unverändert.
- Der Hinweis auf die Brave-Einschränkung entfällt bei diesem Weg — mangels Systemdialog greift
  der Browserfehler dort nicht.

## [5.8.3.0] - 2026-08-19 (Build 322) — *Passkey-Hinweise kennen deinen Browser*

### 🐛 Bugfixes
- **Der Hinweis zum Speicherort führte in Brave in die falsche Richtung.** Dort meldet sich ein
  Passwortmanager wie Enpass als *Geräte*-Anmeldung und nicht als externer Anbieter — die
  Einstellung „Passwortmanager oder anderes Gerät" schließt ihn in Brave also gerade aus,
  während sie in Chrome und Edge genau richtig ist. Der Text empfahl aber überall dasselbe.
  Das Panel erkennt jetzt Brave und beschreibt für jeden Browser die passende Einstellung.

### 🔧 Änderungen
- **Eine bekannte Einschränkung von Brave wird offen benannt.** Brave übergibt die
  Passkey-Anlage unter Windows an das Betriebssystem, das dann seinen eigenen Dialog zeigt und
  Passwortmanager übergeht — ein seit April 2024 offener Fehler des Browsers. Wer Brave nutzt,
  sieht das jetzt direkt an der Einstellung, statt es für einen Fehler des Panels zu halten,
  zusammen mit zwei Auswegen: den Passkey in Chrome oder Edge anlegen, oder im Dialog
  „Anderes Gerät" den QR-Code mit dem Handy scannen — dort speichert ihn der Passwortmanager,
  und über dessen Synchronisierung steht er auch am Rechner zur Verfügung.
- Die Meldung nach einem abgebrochenen Dialog nennt entsprechend ebenfalls den Weg, der zum
  jeweiligen Browser passt.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- Rein anzeigend: Es ändert sich kein Ablauf beim Anlegen oder Anmelden, nur die Erklärung dazu.
  Bereits registrierte Passkeys sind nicht betroffen.

## [5.8.2.0] - 2026-08-19 (Build 321) — *Der Code bestätigt sich selbst*

### 🔧 Änderungen
- **Der Zwei-Faktor-Code wird abgeschickt, sobald er vollständig ist.** Ein Einmalcode ist mit
  der sechsten Ziffer fertig — es gibt nichts mehr zu ergänzen und nichts zu prüfen. Trägt ihn
  ein Passwortmanager automatisch ein, war der Klick auf „Code bestätigen" nur noch ein
  überflüssiger Schritt am Ende einer sonst vollautomatischen Anmeldung. Jetzt genügen die
  sechs Ziffern, egal ob getippt, eingefügt oder automatisch ausgefüllt.
  Der Knopf bleibt erhalten, und am Feld steht, dass automatisch bestätigt wird.
  Jeder Code wird dabei nur ein einziges Mal abgeschickt — ein abgelehnter Code läuft also
  nicht in eine Wiederholschleife, sondern wartet auf den nächsten.
- **Automatisch ausgefüllte Codes werden auch dann erkannt, wenn der Passwortmanager sie
  stillschweigend einträgt.** Manche Erweiterungen schreiben ihren Wert direkt ins Feld, ohne
  die Seite zu benachrichtigen. Für die ersten fünfzehn Sekunden der Code-Abfrage sieht das
  Panel deshalb selbst nach, statt sich allein auf eine Benachrichtigung zu verlassen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- **Sicherheit:** unverändert — geprüft wird weiterhin serverseitig, das automatische Abschicken
  erspart nur den Klick. Falsche Codes werden wie bisher abgewiesen, die Begrenzung der
  Anmeldeversuche greift unverändert.
- **Ohne Zwei-Faktor** und bei der **Anmeldung per Passkey** ändert sich nichts.

## [5.8.1.0] - 2026-08-19 (Build 320) — *Passkey: du bestimmst den Speicherort*

### 🔧 Änderungen
- **Beim Anlegen eines Passkeys lässt sich jetzt wählen, wo er gespeichert wird.** Bisher machte
  das Panel keine Vorgabe und überließ die Wahl dem Browser — der nimmt unter Windows aber
  praktisch immer Windows Hello, sodass Passwortmanager wie Enpass gar nicht erst zur Auswahl
  standen. Ein Passkey ließ sich damit faktisch nur im Windows-Schlüsselspeicher ablegen.
  Unter *Einstellungen → Passkeys* steht nun ein Feld „Speicherort" mit drei Möglichkeiten:
  - **Automatisch** — wie bisher, der Browser entscheidet.
  - **Auf diesem Gerät** — Windows Hello, Touch ID, Fingerabdruck.
  - **Passwortmanager oder anderes Gerät** — schließt den Geräte-Anmeldedialog aus, sodass
    Enpass, 1Password, ein Sicherheitsschlüssel oder das Handy zur Auswahl stehen.

  Die Wahl bleibt für das nächste Mal gespeichert, weil sie vom Gerät abhängt. Eine feste
  Vorgabe im Panel wäre falsch: In Brave meldet sich Enpass *als* Geräte-Anmeldung, unter
  Windows dagegen nur als externer Anbieter — dieselbe Einstellung führt also je nach Browser
  zum gegenteiligen Ergebnis.
- **Die Fehlermeldung nach einem abgebrochenen Dialog nennt jetzt den passenden nächsten
  Schritt** — je nachdem, welcher Speicherort gewählt war, inklusive der Stelle im Browser, an
  der ein Passwortmanager als Passkey-Anbieter freigeschaltet wird.

### 🐛 Bugfixes
- **Bereits vorhandene Passkeys wurden dem Browser mit geratenen Transportwegen gemeldet.**
  Beim Anlegen wurde fest „internal, hybrid" übermittelt statt der Wege, die der Authenticator
  tatsächlich gemeldet hat — obwohl diese gespeichert sind und beim Anmelden längst korrekt
  verwendet werden. Der Browser konnte dadurch nicht zuverlässig erkennen, welcher
  Authenticator schon belegt ist. Jetzt werden die gespeicherten Werte verwendet.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. Bereits registrierte Passkeys bleiben unverändert gültig.
- **Agent:** unverändert bei 2.7.0.
- **Anmeldung:** der Ablauf beim Anmelden per Passkey ist nicht betroffen, nur das Anlegen.
- **Browser-Speicher:** neuer Eintrag `panel_passkey_ziel` (die zuletzt gewählte Ablage).

## [5.8.0.1] - 2026-08-19 (Build 319) — *Suche respektiert den ausgeblendeten Panel-Server*

### 🐛 Bugfixes
- **Rollen mit ausgeblendetem lokalem Server konnten gar nicht suchen.** Die neue Suche hing
  unterhalb von `/api/docker`, wo eine Prüfung davorliegt, die jede Anfrage abweist, sobald die
  Rolle den Panel-Server nicht sehen darf. Für eine Suche über *alle* Server ist das falsch:
  Der Panel-Server soll dann nur ausgelassen werden, die übrigen Server bleiben durchsuchbar.
  Statt Ergebnissen kam „Kein Zugriff auf den lokalen Server". Die Suche liegt jetzt auf einem
  eigenen Weg — genauso wie es die Spitznamen-Verwaltung schon macht — und prüft die Rechte
  selbst. Aufgefallen beim Testlauf, bevor die Fassung produktiv war.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration. **Agent:** unverändert bei 2.7.0.
- Die Adresse der Suche bleibt unverändert, die Oberfläche ist nicht betroffen.

## [5.8.0.0] - 2026-08-19 (Build 318) — *Ein Suchfeld für alle Server*

### ✨ Features
- **Container lassen sich jetzt über alle Server hinweg suchen.** Bisher zeigte die
  Docker-Seite immer genau einen Server, und wer nicht wusste, wo ein Container läuft, musste
  sich durch die Serverliste klicken. Neben der Serverauswahl steht nun ein Suchfeld: Ab zwei
  Zeichen durchsucht das Panel **alle** Server gleichzeitig und zeigt die Treffer mit dem
  Server, auf dem sie laufen. Ein Klick springt dorthin und hebt die Zeile kurz hervor.
  Gesucht wird in Containername, **Spitzname**, **Pelican-Klarname**, Image, Stack und den
  ersten zwei Kennungs-Blöcken — bei jedem Treffer steht dabei, in welchem Feld er gefunden
  wurde. Wer nach einem selbst vergebenen Spitznamen sucht, findet den Container also auch
  dann, wenn er im System ganz anders heißt.
- **Server, die gerade nicht antworten, werden benannt statt verschwiegen.** Ein nicht
  erreichbarer Agent lässt die Suche nicht scheitern — die übrigen Server werden trotzdem
  durchsucht, und unter dem Ergebnis steht, welcher Server ausgelassen wurde und warum.
  Andernfalls sähe ein unvollständiges Ergebnis wie ein vollständiges aus.

### 🔒 Rechte
- **Die Auswahl der durchsuchten Server passiert im Backend, nicht in der Anzeige.** Rollen mit
  eingeschränkter Serverfreigabe (`restrict_agents`) durchsuchen ausschließlich die ihnen
  zugewiesenen Server; Rollen mit ausgeblendetem lokalem Server (`hide_local`) lassen den
  Panel-Server aus. Beides greift bereits beim Abruf — über die Suche werden also weder
  Container noch Namen von Servern übertragen, die der Benutzer nicht sehen darf. Zusätzlich
  ist wie überall sonst `docker.view` nötig.

### 🔧 Änderungen
- **Der Panel-Server erscheint in der Suche auch ohne eingerichtetes Dockhand.** Fehlt die
  Dockhand-Umgebung oder antwortet sie nicht, holt sich das Panel die Container-Liste seines
  eigenen Servers direkt über die Docker-Installation — denselben Weg nutzt die Konsole seit
  v5.7.0.0 bereits.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration, keine Schema-Änderung.
- **Agent:** unverändert bei 2.7.0 — die Suche nutzt die bestehende Container-Abfrage, ein
  Update auf den Zielservern ist nicht nötig.
- **Betriebsart:** die Einstellung „Docker Verwaltung" (nativ / gemischt / Dockhand) gilt auch
  für die Suche. Im gemischten Betrieb weicht sie bei einem ausgefallenen Agenten genauso auf
  Dockhand aus wie die normale Container-Liste.
- **Last:** eine Suche fragt alle erlaubten Server parallel ab, mit sechs Sekunden Zeitlimit je
  Server. Die Eingabe wird um 350 ms entprellt, es entsteht also nicht pro Tastendruck ein
  Abruf. Ohne Eingabe im Suchfeld passiert nichts.
- **Sitzungen:** kein Neuanmelden nötig, die Seite muss nach dem Update einmal neu geladen werden.

## [5.7.0.2] - 2026-08-19 (Build 317) — *Anmeldung übersteht das Ausfüllen*

### 🐛 Bugfixes
- **Bei aktiver Zwei-Faktor-Anmeldung landete man kurz nach der Passwort-Eingabe wieder auf der
  Anmeldemaske.** Die Abfrage des Codes erschien, verschwand aber nach wenigen Augenblicken —
  obwohl Benutzername und Passwort längst geprüft waren und das Zwischen-Token noch zehn Minuten
  gültig gewesen wäre. Ursache: Der Zwischenschritt lebte ausschließlich im Arbeitsspeicher der
  geöffneten Seite. Jeder Neuaufbau verwarf ihn wortlos, und die Anmeldemaske erschien wieder,
  weil ohne Token niemand angemeldet ist. Ausgelöst wird so ein Neuaufbau unter anderem von
  Passwortmanager-Erweiterungen beim automatischen Ausfüllen.
  Der Schritt wird jetzt im Sitzungsspeicher des Browser-Tabs gehalten und übersteht ein Neuladen.
  Er endet mit dem Tab, mit der erfolgreichen Anmeldung oder mit dem Ablauf des Tokens.
- **Die Anmeldefelder waren für Passwortmanager nicht eindeutig erkennbar.** Keines der drei Felder
  trug eine Kennzeichnung, wofür es da ist. Benutzername, Passwort und Einmalcode sind jetzt als
  solche ausgezeichnet — damit tragen Browser und Passwortmanager den Code ins richtige Feld ein,
  statt zu raten.
- **Automatisch ausgefüllte Felder ließen den Absende-Knopf grau.** Passwortmanager schreiben ihren
  Wert teilweise direkt ins Eingabefeld, ohne die Seite darüber zu benachrichtigen; die Anmeldung
  hielt das Feld dann weiterhin für leer. Beim Absenden werden die Werte nun aus dem Formular selbst
  gelesen, der Zustand der Seite dient nur noch als Rückfallebene.
- **Ein abgelaufener Zwischenschritt führte in eine Sackgasse.** Nach zehn Minuten wurde jeder
  eingegebene Code abgewiesen, ohne Weg zurück. Jetzt landet man mit einem Hinweis wieder auf der
  Anmeldemaske.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank:** keine Migration, keine Schema-Änderung.
- **Agent:** unverändert bei 2.7.0 — kein Update auf den Zielservern nötig.
- **Sitzungen:** bereits angemeldete Benutzer bleiben angemeldet. Die Seite muss nach dem Update
  einmal neu geladen werden, damit die überarbeitete Anmeldemaske greift.
- **Browser-Speicher:** neuer Eintrag `panel_2fa_schritt` im Sitzungsspeicher. Er ist ausschließlich
  während der laufenden Code-Abfrage belegt und verschwindet mit dem Tab, spätestens nach zehn
  Minuten. Das dauerhafte Sitzungs-Token liegt weiterhin unverändert im lokalen Speicher.
- **Konten ohne Zwei-Faktor** und die **Anmeldung per Passkey** sind nicht betroffen und verhalten
  sich unverändert.

## [5.7.0.1] - 2026-08-19 (Build 316) — *Konsole findet die richtige Shell*

### 🐛 Bugfixes
- **Die Konsole blieb bei Containern ohne `bash` leer.** Beim Öffnen wurde zuerst `/bin/bash`
  gestartet — in schlanken Abbildern (Alpine und ähnliche) gibt es das nicht, und die Engine meldet
  das erst im Datenstrom, lange nachdem der Aufruf als erfolgreich gilt. Ein Rückfall über mehrere
  Versuche greift deshalb nicht.
  Die Shell wird jetzt in einem Aufruf selbst bestimmt (`bash`, sonst `sh`) — und zwar mit einer
  Prüfung *vor* dem Ersetzen: Ein fehlgeschlagenes `exec` beendet die Shell sofort, ein
  nachgestelltes `|| exec /bin/sh` kommt nie zum Zug. Genau daran schloss sich der Datenstrom
  zuvor wortlos.

## [5.7.0.0] - 2026-08-19 (Build 315) — *Konsole überall, Namen im Klartext*

### ✨ Features
- **Die Konsole gibt es jetzt auch für Container auf dem Panel-Server selbst.** Bisher war der
  Eintrag dort ausgegraut: Die Konsole lief ausschließlich über den Panel-Agent, und auf dem
  Panel-Server läuft keiner. Das Panel spricht dafür nun die Docker-Installation seines eigenen
  Servers direkt an — der Zugang dorthin ist ohnehin schon eingebunden, es muss nichts
  installiert werden. Bedienung, Rechte, Einmal-Ticket und Audit-Eintrag sind dieselben wie bei
  Remote-Servern.
- **Das Konsolen-Fenster ist deutlich größer** — statt rund 500 Pixel (64 Zeichen pro Zeile) jetzt
  gut die doppelte Breite, dazu ein Schalter für die volle Fensterbreite. Die Wahl wird gemerkt
  und gilt beim nächsten Öffnen wieder.
- **Kopieren und Einfügen in der Konsole**: Markieren mit der Maus kopiert sofort, Einfügen geht
  mit Strg+V oder per Rechtsklick. Strg+C kopiert die Markierung — ist nichts markiert, bleibt es
  wie gewohnt das Abbruchsignal für den laufenden Befehl. Die Tastenkürzel stehen in der Fußzeile
  des Fensters.
- **Der bisherige Verlauf steht beim Öffnen schon da**: Die letzten 200 Zeilen des Containers
  werden vorab eingeblendet, sichtbar abgetrennt vom Live-Teil. Der separate Logs-Knopf bleibt
  unverändert bestehen.
- **Lesbare Namen für Gameserver aus dem Pelican Panel.** Solche Container heißen nach ihrer
  Server-UUID (`6d3bdebc-ded6-48aa-84a7-c268d4d07e83`) und waren im Panel nicht auseinander-
  zuhalten. Ist die Verbindung unter **Einstellungen → Cloud & APIs → Pelican Panel** eingerichtet,
  steht dort jetzt der Klarname, die gekürzte UUID klein daneben und ein Kennzeichen „pelican".
  - **Umbenannt wird nichts** — der Name wird ausschließlich zur Anzeige geholt, die UUID bleibt
    überall der technische Name. Es wird nur gelesen.
  - Ein selbst vergebener Spitzname hat weiterhin Vorrang. Reihenfolge:
    **eigener Spitzname → Pelican-Name → Container-Name**.
  - Die Zuordnung wird fünf Minuten zwischengespeichert, damit die pollende Docker-Seite die
    Pelican-Instanz nicht bei jedem Aufruf befragt. Ist Pelican nicht erreichbar, bleibt die
    Docker-Seite vollständig benutzbar und zeigt weiter die UUIDs.

### 🔧 Änderungen
- **Container-Logs funktionieren auch ohne Dockhand.** Für den lokalen Server wurden sie bisher
  ausschließlich von dort geholt; ist Dockhand nicht eingerichtet oder antwortet nicht, fragt das
  Panel jetzt die Docker-Installation direkt. Das gilt für die Logs-Ansicht wie für den neuen
  Verlauf in der Konsole.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank**: Keine Migration. Zwei neue Einträge in der bestehenden `settings`-Tabelle
  (`pelicanUrl`, `pelicanToken`).
- **Agent**: Unverändert bei 2.7.0 — die neuen Wege betreffen ausschließlich das Panel.
- **Voraussetzung für die lokale Konsole** ist der bereits eingebundene Docker-Zugang
  (`/var/run/docker.sock` in der docker-compose.yml). Fehlt er, bleibt alles andere unberührt und
  das Fenster nennt den Grund.
- **Rechte**: Für die Konsole gilt weiterhin `docker.control`, für die Pelican-Namen `docker.view`
  (wer Container sieht, sieht auch ihre Namen), für das Einrichten `settings.manage`. Kein neues
  Recht, keine Anpassung an bestehenden Rollen nötig.
- **Der Weg über die Agenten bleibt unverändert** und wurde beim Umbau des WebSocket-Handlers
  gegengeprüft.

## [5.6.0.1] - 2026-08-18 (Build 314) — *Verschwundene Container fluten das Log nicht mehr*

### 🐛 Bugfixes
- **Ein neu erstellter Container füllte das Panel-Log mit Fehlern.** Die Docker-Seite fragt für
  jeden laufenden Container im Sekundentakt Statistiken ab. Wird ein Container ersetzt — etwa
  durch `docker compose up -d` —, ändert sich seine ID, und die noch offene Ansicht fragt die
  alte weiter ab. Das war als „läuft nicht" vorgesehen und wurde auch abgefangen, aber nur bei
  einer Antwort mit HTTP 404. Der Agent meldet den Fall jedoch teilweise als Text
  („Ressource nicht gefunden"), woraus ein **502** wurde — samt Eintrag im Panel-Log, im Takt
  des Pollings. Jetzt zählt auch die Meldung, nicht nur der Statuscode.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- Rein Panel-seitig, keine Datenbank- oder Agent-Änderung. Betrifft nur, wie eine bereits
  vorgesehene Antwort erkannt wird.

## [5.6.0.0] - 2026-08-18 (Build 313) — *Konsole rüstet sich selbst nach*

### ✨ Features
- **Fehlende Terminal-Module werden automatisch nachinstalliert.** Bisher brachte das
  automatische Agent-Update nur die Datei `panel-agent.js` auf die Server — fehlten dort `ws`
  und `node-pty`, blieb die Container-Konsole trotz aktuellem Agenten stumm und musste von Hand
  nachgerüstet werden. Das Panel erledigt das jetzt beim selben Durchlauf mit.
  - Beim Start prüft das Panel für **jeden** Server, ob die Konsole bereitsteht — auch bei
    Agenten, die schon aktuell sind, denn die Module hängen am Server, nicht an der Version.
  - Fehlen sie, stößt es die Installation an: erst die Build-Werkzeuge (`build-essential`,
    `python3`, `make`, `g++` bzw. die Entsprechungen unter dnf/yum), dann `ws` und `node-pty`.
    `node-pty` ist eine native Erweiterung und muss auf dem Server übersetzt werden.
  - Danach startet der Agent von selbst neu, damit die Konsole bereitsteht. Das Panel begleitet
    den Vorgang bis zu acht Minuten und schreibt das Ergebnis ins **Panel-Log** sowie als
    `agent.terminal.setup` ins **Audit-Log** — auch im Fehlerfall, dann mit Grund und den
    Befehlen für den Weg von Hand.
  - Solange es läuft, steht im Menü **„Konsole wird eingerichtet…"**.
  - **Sämtliche Paket- und Programmnamen stehen fest im Agent-Code.** Aus einer Anfrage gelangt
    nichts in diese Befehle; der auslösende Endpunkt nimmt keine Parameter entgegen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agent auf 2.7.0** mit dem neuen Endpunkt `POST /terminal/setup`. Er tut nichts, wenn die
  Module bereits vorhanden sind, und startet die Installation sonst im Hintergrund — der Aufruf
  kehrt sofort zurück, weil das Übersetzen Minuten dauern kann.
- **Eingriff ins System**: Auf Servern ohne Compiler installiert der Agent Build-Werkzeuge über
  den Paketmanager nach (bei Debian/Ubuntu mehrere hundert MB). Wer das nicht möchte, schaltet
  das automatische Agent-Update unter **Einstellungen → Allgemein & Design → Agent-Updates** ab;
  dann unterbleibt auch das Nachrüsten.
- **Dauer**: Sind die Werkzeuge schon da, ist es in etwa zehn Sekunden erledigt. Andernfalls
  dauert der erste Durchlauf je nach Server einige Minuten. Er läuft im Hintergrund; das Panel
  ist währenddessen normal bedienbar.
- **Wiederholung**: Schlägt es fehl, wird es beim nächsten Panel-Start erneut versucht.

## [5.5.1.1] - 2026-08-18 (Build 312) — *Konsole zeigt endlich etwas an*

### 🐛 Bugfixes
- **Das Terminal-Fenster blieb leer, obwohl die Verbindung stand.** Nach den beiden vorigen
  Korrekturen kam die Konsole zwar zustande — Sitzung offen, Daten flossen —, im Fenster war
  aber nichts zu sehen.
  Ursache: Der WebSocket-Proxy reichte die Ausgabe des Agenten weiter, ohne den Rahmentyp zu
  übernehmen. Aus dem empfangenen Buffer wurde dabei ein **Binär**-Frame; im Browser kam die
  Ausgabe als `Blob` an, und `xterm` verwirft alles, was weder Text noch `Uint8Array` ist —
  ohne Fehlermeldung. Der Proxy gibt den Rahmentyp jetzt unverändert weiter, und das
  Terminal-Fenster nimmt zusätzlich Blob und ArrayBuffer entgegen.
  - Gefunden erst beim Klick durch die echte Oberfläche: Ein Test über einen Node-Client
    bemerkt das nicht, weil dort ohnehin `.toString()` auf dem Puffer landet.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Nur Panel-seitig**, der Agent bleibt bei 2.6.2 und war an dieser Stelle nie beteiligt.
- **Beide Seiten sind unabhängig voneinander robust**: Ein neues Panel zeigt die Ausgabe auch
  dann, wenn der Rahmentyp unterwegs verändert wird; ein neues Frontend kommt auch mit einem
  älteren Panel zurecht.

## [5.5.1.0] - 2026-08-18 (Build 311) — *Konsole meldet sich, wenn sie fehlt*

Nachtrag zum vorigen Release: Nachdem der Pfad-Konflikt behoben war, zeigte der Testlauf eine
zweite, davon unabhängige Ursache — auf dem Server selbst.

### 🔧 Änderungen
- **Der Agent sagt jetzt, ob er eine Konsole anbieten kann.** `/ping` und `/version` melden
  zusätzlich `terminal: true/false`. Fehlen dem Agenten die Module `ws` und `node-pty`, steht im
  Menü „Konsole nicht verfügbar" — samt Befehl zum Nachrüsten im Tooltip, statt eines
  Verbindungsfehlers erst nach dem Öffnen des Terminal-Fensters.
- **Der Installer verschluckt einen Fehlschlag nicht mehr.** `npm install ws node-pty` endete
  bisher notfalls in einem `|| echo WARNUNG`, das in der Ausgabeflut der Installation unterging.
  Jetzt wird das Ergebnis ausdrücklich geprüft und bei Bedarf in einem umrahmten Kasten gemeldet,
  mit den drei Befehlen zum Nachrüsten.
- **Die Meldung des Agenten beim Start** ist von `console.log` auf `console.error` gehoben und
  nennt den Weg zurück — sie stand bisher unauffällig im Journal, während im Panel nur ein
  nichtssagender Fehler ankam.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Agent auf 2.6.2.** Die Anzeige „Konsole nicht verfügbar" erscheint erst, wenn der jeweilige
  Agent diese Fassung hat; ältere melden nichts, dort verhält sich das Panel wie bisher und
  versucht es einfach. Das automatische Agent-Update bringt die neue Fassung beim nächsten
  Panel-Start von selbst auf alle Server.
- **Bestehende Installationen**: Wo `ws`/`node-pty` fehlen, funktioniert weiterhin alles außer der
  Konsole. Nachrüsten ohne Neuinstallation:
  `cd /opt/panel-agent && npm install --save ws node-pty && systemctl restart panel-agent`.
- **Zusätzlicher Aufruf**: Die Docker-Seite fragt beim Serverwechsel einmal `/ping` ab, um den
  Zustand zu kennen.

## [5.5.0.3] - 2026-08-18 (Build 310) — *Konsole endlich erreichbar*

### 🐛 Bugfixes
- **Die native Container-Konsole hat seit ihrer Einführung nie funktioniert.** Jeder Verbindungs-
  versuch endete mit `400 Bad Request`, auch mit gültigem Einmal-Ticket.
  Ursache: Der WebSocket für die Live-Daten wurde mit `{ server, path: '/ws' }` erzeugt. Mit
  gesetztem `path` hängt sich die ws-Bibliothek selbst an das `upgrade`-Ereignis und beantwortet
  **jeden** abweichenden Pfad sofort mit 400 — also auch den Terminal-WebSocket, dessen eigener
  Handler erst danach registriert wird und dann auf einen bereits geschlossenen Socket trifft.
  Der Live-Daten-Server läuft jetzt mit `noServer` und verteilt die Upgrades selbst: `/ws` an
  sich, den Terminal-Pfad an dessen Proxy, alles andere wie bisher mit 400 abgewiesen.
  - **Warum das so lange unbemerkt blieb:** Die Konsole kam in v5.3.1.0 (Build 300) dazu, der
    Pfad-Konflikt besteht seit dem allerersten Commit. Bis v5.4.1.0 öffnete das Panel bei einem
    Fehlschlag ersatzweise das Dockhand-Terminal in einem neuen Tab — der kaputte native Weg fiel
    dadurch nicht auf. Erst seit die Konsole ausschließlich nativ läuft, tritt der Fehler offen
    zutage.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank & Agent**: Keine Änderung, der Agent bleibt bei 2.6.1. Die Ursache lag allein im
  Panel.
- **Live-Daten**: Der `/ws`-Kanal für Dashboard und Live-Statistiken verhält sich unverändert;
  nur die Zuständigkeit für das `upgrade`-Ereignis ist jetzt ausdrücklich geregelt.
- **Nach dem Update** ist die Konsole auf Servern mit Panel-Agent sofort nutzbar — ohne
  Agent-Update, da der Agent seinen Teil immer korrekt bereitgestellt hat.

## [5.5.0.2] - 2026-08-18 (Build 309) — *Hetzner ohne Token meldet sauber*

### 🐛 Bugfixes
- **Ein fehlender Hetzner-API-Token wurde als Serverstörung gemeldet** (HTTP 500) statt als offene
  Einstellung (400). Im Frontend sah eine schlicht nicht eingerichtete Anbindung damit genauso aus
  wie ein echter Ausfall. Aufgefallen beim Durchtesten aller Routen auf dem Testserver.

## [5.5.0.1] - 2026-08-18 (Build 308) — *Am echten Server nachgemessen*

Alle Punkte hier stammen aus einem Testlauf auf einem echten Server mit nftables und
Docker — Fehler, die sich am Schreibtisch nicht zeigen.

### 🐛 Bugfixes
- **Das Panel stürzte bei einer Erstinstallation beim ersten Start ab.** `metricsRecorder`
  bereitete seine Datenbank-Abfrage schon beim Laden des Moduls vor — zu einem Zeitpunkt, an dem
  die Migration die Spalten `net_rx_sec`/`net_tx_sec` noch nicht ergänzt hatte
  (`table metrics has no column named net_rx_sec`). Aufgefallen ist es nur deshalb kaum, weil der
  Container sich selbst neu startet und der zweite Anlauf gelingt. Mit `restart: no` wäre das Panel
  gar nicht hochgekommen. **Nebenwirkung:** Der Absturz passierte vor dem Start des automatischen
  Agent-Updates — bei einem solchen Start lief dieses also nie an.
- **Eine unbrauchbare Eingabe im Feld „Von" wurde als IPv6-Adresse akzeptiert.** Die Prüfung
  verlangte keinen Doppelpunkt, weshalb jede reine Hex-Folge durchging: `abc` erreichte
  unbeanstandet das Firewall-Werkzeug, das dann versuchte, einen Hostnamen aufzulösen. Jetzt wird
  die Eingabe abgelehnt, bevor sie den Server erreicht.
- **Das Protokoll stand bei nftables immer auf „any"**, auch wenn die Regel eindeutig `tcp` oder
  `udp` festlegte: Bei `tcp dport 80` steht das Protokoll im selben Datenfeld wie der Port, gelesen
  wurde es aber nur, wenn *kein* Port gesetzt war — also nie.
- **Die Quell-Adresse fehlte in der Regel-Liste des Agenten**, obwohl sie in der Regel stand.

### 🔧 Änderungen
- **Die Firewall-Seite zeigt bei nftables nur noch echte Eingangsregeln.** Auf einem Docker-Host
  kamen zuvor rund 50 Einträge zurück — NAT-Weiterleitungen, `FORWARD`, `raw` und sämtliche
  `DOCKER-*`-Ketten, die meisten ohne erkennbare Aktion. Gelistet werden jetzt ausschließlich
  Regeln aus Ketten, die eingehenden Verkehr filtern; alles von Docker Verwaltete bleibt außen vor.
  Sind keine solchen Regeln vorhanden, sagt die Seite das ausdrücklich, statt eine leere Liste zu
  zeigen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank**: Keine Migration. Der Absturz-Fix ändert nur den Zeitpunkt, zu dem eine Abfrage
  vorbereitet wird.
- **Agent auf 2.6.1**: Die Korrekturen an der nftables-Auswertung und der IPv6-Prüfung betreffen
  auch den Agenten. Die Versionsnummer steigt deshalb ausdrücklich mit, damit das automatische
  Agent-Update sie beim nächsten Panel-Start von selbst auf alle Server bringt — ohne
  Versionssprung würde es den Unterschied nicht bemerken.
- **Bestehende Regeln** bleiben unangetastet; es ändert sich nur, was davon angezeigt wird.

## [5.5.0.0] - 2026-08-17 (Build 307) — *Agenten aktualisieren sich selbst*

### ✨ Features
- **Agenten werden beim Panel-Start automatisch aktualisiert.** Jedes Panel-Image bringt das
  passende Agent-Script mit — bisher musste es auf jedem Server einzeln von Hand ausgerollt werden,
  und in der Praxis blieben Agenten dadurch monatelang zurück. Nach jedem Start des Containers
  prüft das Panel nun einmal alle Server und verteilt die neue Fassung an alle, auf denen eine
  ältere läuft.
  - Es wird **derselbe Weg** genutzt wie beim Knopf „Agent aktualisieren": das Script wird mit dem
    Token des jeweiligen Agenten signiert und über die per Fingerprint gepinnte Verbindung
    übertragen. Es entsteht kein neuer Weg nach außen und kein Zugriff auf GitHub.
  - **Nicht erreichbare Server werden übersprungen** — abgeschaltet, im Neustart oder ohne Netz ist
    der Normalfall und erzeugt keinen Fehlereintrag. Beim nächsten Panel-Start wird es erneut
    versucht.
  - **Sicherung gegen den schlechten Tag:** Antwortet ein Server nach seinem eigenen Update nicht
    mehr, bricht der Vorgang sofort ab. Die übrigen Server bleiben dann auf ihrem bisherigen Stand,
    statt dass sich ein fehlerhaftes Script der Reihe nach über die ganze Infrastruktur zieht.
  - Jeder Durchlauf steht im **Panel-Log**, jedes einzelne Update zusätzlich als
    `agent.update.auto` im **Audit-Log**.
  - Abschaltbar unter **Einstellungen → Allgemein & Design → Agent-Updates**. Standard ist
    eingeschaltet.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank**: Keine Migration. Neue Einstellung `agentAutoUpdate` in der bestehenden
  `settings`-Tabelle; fehlt sie, gilt „eingeschaltet".
- **Beim ersten Start nach diesem Update** werden alle erreichbaren Agenten auf **v2.6.0** gehoben.
  Damit erledigt sich der Schritt, der im vorigen Release (v5.4.3.0) noch für jeden Server von Hand
  nötig war — die dortigen Firewall-Korrekturen am Agenten greifen dann von allein.
- **Zeitpunkt**: 45 Sekunden nach dem Start, damit Panel und Server erst hochkommen. Die Agenten
  starten beim Update jeweils kurz neu (~2 Sekunden); laufende Terminal-Sitzungen zu diesem Server
  brechen dabei ab und müssen neu geöffnet werden.
- **Rechte**: Der Vorgang läuft ohne angemeldeten Benutzer und erscheint im Audit-Log als „System".
  An den Rechten für das manuelle Update (`agents.update`) ändert sich nichts.
- **Rückfall**: Wer das nicht möchte, schaltet es in den Einstellungen ab; der manuelle Knopf pro
  Server bleibt unverändert bestehen.

## [5.4.3.0] - 2026-08-17 (Build 306) — *Firewall wieder funktionsfähig*

### 🐛 Bugfixes
- **Die Firewall-Seite stürzte beim Öffnen ab — seit dem 28.07.2026.** Beim Aufräumen der
  Einstellungen in v1.48.15 (Build 263) verschwand ein Symbol aus der Import-Zeile, das die Seite
  weiterhin benutzte. Statt der Firewall erschien seitdem „Diese Seite konnte nicht geladen werden".
  Der Build bemerkt so etwas nicht, deshalb blieb es über zwölf Releases unentdeckt.
- **Remote-Server meldeten immer „Keine aktive Firewall gefunden"**: Die Route zur Firewall-Erkennung
  fehlte im Panel, obwohl der Agent sie längst beantworten konnte. Dadurch brach das Laden ab,
  bevor überhaupt Regeln abgefragt wurden — die Firewall-Seite war für Remote-Server faktisch leer.
- **Ein-/Ausschalten und Bearbeiten gingen bei Remote-Servern ins Leere** (404): Auch für diese
  beiden fehlten die Routen. Bearbeiten funktioniert jetzt zusätzlich mit älteren Agenten, weil das
  Panel dort selbstständig auf „löschen + neu anlegen" ausweicht.
- **firewalld-Regeln ließen sich remote nicht löschen**: Die Prüfung ließ nur reine Zahlen zu,
  firewalld-Regeln heißen aber `80/tcp` oder `svc:ssh`.
- **Firewall-Änderungen an Remote-Servern standen in keinem Audit-Log** — anders als lokale.

### 🔒 Sicherheit
- **Eine Regel galt weiter, als sie sollte**: Das Feld „Von (Quell-IP)" wurde bei UFW-Sperrregeln,
  nftables und firewalld stillschweigend verworfen. Wer einen Port für *eine* Adresse öffnen oder
  sperren wollte, öffnete bzw. sperrte ihn damit für **alle**. Die Quelle wird jetzt in allen vier
  Werkzeugen umgesetzt — bei firewalld über Rich Rules, die auch in der Liste erscheinen und sich
  dort löschen lassen. Einzige Ausnahme: IPv6-Quellen mit iptables, das nun eine klare Meldung gibt,
  statt eine unsichtbare Regel anzulegen.
- **Ein Tippfehler in der IP-Adresse hatte dieselbe Wirkung**: Eine ungültige Eingabe wurde zu
  „keine Einschränkung". Jetzt wird die Regel abgelehnt und die Adresse benannt.
- **Der Agent baute firewalld-Befehle ohne Prüfung zusammen** — Regel-Namen wanderten ungeprüft in
  eine Shell-Zeile. Alle Firewall-Befehle des Agenten laufen jetzt über `execFile` mit
  Argument-Array, denselben Weg wie die Docker-Befehle seit v5.4.0.0.
- **„Sperren" sperrte bei firewalld nichts**, sondern entfernte nur eine vorhandene Erlaubnis. Jetzt
  wird eine echte Reject-Regel angelegt.
- **Ports über 65535 wurden angenommen** und liefen erst im Werkzeug auf eine unverständliche
  Fehlermeldung.

### ✨ Verbesserungen
- **Schutz vor dem Aussperren**: Wer den SSH-Port, den Port des Panel-Agenten oder den Port des
  Panels selbst sperren oder dessen Erlaubnis löschen will, bekommt vorher eine benannte Warnung —
  inklusive Hinweis schon beim Tippen im Dialog. Bestätigen bleibt möglich. Der Agent-Port wird
  dabei aus der Adresse des jeweiligen Servers gelesen, statt eine Standardnummer anzunehmen.
- **Schnellauswahl im Regel-Dialog**: SSH, HTTP, HTTPS und der Zugangs-Port des gewählten Servers
  per Klick, statt Portnummern nachzuschlagen.
- **Keine doppelten Regeln mehr in der Liste**: UFW führt jede Regel zweimal (IPv4 und IPv6). Beide
  erscheinen jetzt als ein Eintrag mit dem Vermerk „IPv4+IPv6"; Löschen und Bearbeiten fassen
  weiterhin beide an — und zwar in der richtigen Reihenfolge, damit die Nummerierung nicht
  verrutscht.
- **Die Standard-Richtlinie steht jetzt sichtbar oben** („eingehend abgelehnt, ausgehend erlaubt")
  statt nur klein in der aufklappbaren Rohausgabe.
- **Verständliche Fehlermeldungen** statt roher Werkzeug-Ausgaben — etwa wenn dem Panel-Container
  die Rechte für die Host-Firewall fehlen oder der Agent nicht antwortet.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank**: Keine Migration, keine Schema-Änderung.
- **Sofort wirksam nach dem Panel-Update**, ohne Agent-Update: der Absturz der Seite, die Erkennung
  und Regel-Liste bei Remote-Servern, Ein-/Ausschalten, das Löschen von firewalld-Regeln, der
  Aussperr-Schutz sowie alle Anzeige-Verbesserungen. Bearbeiten läuft bei alten Agenten über den
  Ersatzweg „löschen + neu anlegen".
- **Agent-Update auf 2.6.0 nötig** für: Quell-IP in allen Werkzeugen, die Absicherung der
  firewalld-Befehle, echte Sperr-Regeln bei firewalld und das Bearbeiten in einem Schritt. Das
  Panel bringt den neuen Agent-Stand mit — pro Server genügt „Update auf v2.6.0" auf der
  Agenten-Seite. Der Agent startet dabei kurz neu (~2 Sekunden).
- **Bestehende Regeln bleiben unangetastet.** Regeln, die früher wegen der verworfenen Quell-IP zu
  weit gefasst angelegt wurden, bleiben so bestehen — sie sind in der Liste jetzt aber als „alle"
  in der Spalte Quelle erkennbar und können bearbeitet werden.
- **Lokale Firewall**: unverändert darauf angewiesen, dass der Panel-Container `privileged: true`
  und `pid: "host"` hat. Fehlt das, sagt die Seite es jetzt in klaren Worten.

## [5.4.2.0] - 2026-08-17 (Build 305) — *Beschriftete Aktionen statt Symbolraten*

### 🔧 Änderungen
- **Alle Aktions-Knöpfe im Panel sind jetzt beschriftet.** Bisher standen in den Listen nur Symbole
  nebeneinander — ohne Text war kaum zu erkennen, welches davon startet, stoppt, neu startet oder
  löscht. Jedes davon trägt nun Symbol **und** Wort.
  - **Häufige Aktionen bleiben direkt sichtbar** (Start, Stopp, Neustart, Bearbeiten, Logs),
    seltene wandern in ein neues **„⋯ Mehr"-Menü** — dort ebenfalls voll benannt. Damit bleiben die
    Zeilen schlank, obwohl mehr Text darin steht.
  - **Laufende Aktionen sagen es**: Während eine Aktion läuft, steht am Knopf „Startet…",
    „Stoppt…" oder „Startet neu…" statt eines stummen ausgegrauten Symbols.
  - Betroffen sind Docker-Container, Docker-Stacks/Images/Volumes/Netzwerke, Remote-Server und deren
    Detailseite, Systemd-Dienste, Hetzner-Server, MC-Host24-VServer, Firewall-Regeln, Alert-Regeln,
    Benutzer, Webhooks, Backups, Sitzungen, Passkeys, Freigabe-Links, PatchMon und Uptime Kuma.
- **Gefährliche Aktionen sind als solche erkennbar** und liegen eine Ebene tiefer im Menü, rot
  markiert und mit Erklärung: „Kill (SIGKILL)", „Hart ausschalten", „Agent deinstallieren",
  „Aus Panel entfernen", „Stack löschen".
- **MC-Host24: „Herunterfahren" und „Hart ausschalten" waren nicht auseinanderzuhalten** — zwei
  ähnliche Symbole direkt nebeneinander, eines davon mit möglichem Datenverlust. Das geordnete
  Herunterfahren steht jetzt beschriftet in der Zeile, das harte Abschalten im Menü mit Warnhinweis.
- **Alert-Regeln zeigen ihren Zustand im Klartext**: Statt eines Schiebesymbols steht am Knopf
  „Aktiv" oder „Inaktiv"; das Ergebnis eines Testversands erscheint daneben als Häkchen oder Kreuz.
- **Kleine Symbole ohne Beschriftung bleiben bewusst erhalten**, wo Text nur stören würde: IP
  kopieren, Aufklapp-Pfeile, Widget-Griffe, Dialog schließen. Sie haben durchgängig einen Tooltip.

### 🐛 Bugfixes
- **Tooltips an Knöpfen waren wirkungslos**: Die zentrale Schaltflächen-Komponente reichte das
  `title`-Attribut nicht an das HTML-Element weiter. Überall dort, wo ein Knopf nur aus einem Symbol
  bestand und der Tooltip die einzige Erklärung war, erschien beim Daraufzeigen also nichts.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Rein visuell**: Keine Änderung an Backend, API, Datenbank oder Agent. Es wurden keine Aktionen
  hinzugefügt, entfernt oder in ihrer Wirkung verändert — nur ihre Darstellung und Erreichbarkeit.
- **Rechte**: Unverändert. Ein Knopf oder Menüeintrag erscheint weiterhin genau dann, wenn die Rolle
  das jeweilige Recht besitzt; das Menü blendet sich komplett aus, wenn kein Eintrag übrig bleibt.
- **Bedienung**: Aktionen, die bisher ein einzelner Klick waren, brauchen teilweise zwei (Menü öffnen,
  Eintrag wählen) — betroffen sind ausschließlich seltene oder gefährliche Aktionen. Das Menü schließt
  bei Escape, Klick daneben und beim Scrollen.
- **Neustart & Sessions**: Nur der übliche Panel-Neustart durch das Update, keine Auswirkung auf
  angemeldete Sitzungen.

## [5.4.1.0] - 2026-08-17 (Build 304) — *Container-Konsole ausschließlich nativ*

### 🔧 Änderungen
- **Die Docker-Container-Konsole läuft ab sofort ausschließlich nativ über den Panel-Agent.**
  Sie öffnet sich wie gewohnt als Terminal-Fenster im Panel selbst — es gibt keinen zweiten Weg mehr,
  über den stattdessen ein Dockhand-Terminal in einem neuen Browser-Tab aufgehen könnte.
  - **Kein Dockhand-Rückfall mehr im Mixed-Modus**: Antwortet der Agent nicht, erscheint eine
    Fehlermeldung statt eines ersatzweise geöffneten Dockhand-Terminals. Damit entfällt auch der
    Vorab-Ping, der bisher nur dazu diente, rechtzeitig auf Dockhand umzuschwenken.
  - **Die Konsole ignoriert die Einstellung „Docker Verwaltung"**: Sie geht immer über den Agenten,
    auch wenn Container-Daten und -Aktionen bewusst über Dockhand Pro laufen. In der Betriebsart
    „Dockhand Pro (Legacy)" war die Konsole bislang komplett gesperrt — dort funktioniert sie jetzt,
    sofern für den Server ein Panel-Agent hinterlegt ist. In den Einstellungen steht dieser Hinweis
    nun direkt unter der Auswahl.
  - **Lokaler Panel-Server**: Dort gibt es keinen Agenten, also auch keine Konsole. Der Knopf ist
    sichtbar, aber deaktiviert und erklärt sich über den Tooltip; der Hinweistext über der
    Container-Liste nennt den Grund.
  - **Deutlichere Fehlermeldung**: Kommt die Verbindung gar nicht erst zustande, weist das
    Terminal-Fenster jetzt auf die tatsächliche Ursache hin (Agent nicht erreichbar oder `node-pty`
    auf dem Zielserver nicht installiert), statt nur „Verbindung fehlgeschlagen" zu zeigen.

### 🧩 System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank**: Keine Migration, keine Schema-Änderung. Die Einstellung `dockerEngine` bleibt
  unverändert und wirkt weiterhin auf alle übrigen Docker-Aufrufe.
- **API**: Die Route `GET /api/dockhand/terminal-url/:containerId` **entfällt ersatzlos** (liefert
  künftig 404). Sie wurde ausschließlich von der Docker-Seite des Panels genutzt; Frontend und Backend
  kommen aus demselben Image und werden gemeinsam aktualisiert. Die Konsole nutzt weiterhin
  `POST /api/agents/:id/docker/containers/:containerId/terminal-ticket` und den WebSocket-Proxy.
- **Agent-Kompatibilität**: Kein Agent-Update nötig. Voraussetzung ist wie bisher ein Agent mit `ws`
  und `node-pty` — beides installiert `agent/install.sh` mit. Fehlt `node-pty` auf einem Server
  (z. B. weil der Build seinerzeit fehlschlug), gibt es dort ab jetzt keine Konsole mehr, weil der
  Dockhand-Ersatzweg weggefallen ist. In dem Fall genügt ein erneutes Ausführen des Installers.
- **Rechte & Sicherheit**: Unverändert — `docker.control`, Agent-Freigabe der Rolle, Einmal-Ticket
  (30 s, einmalig, an Container und Agent gebunden) und Fingerprint-Pinning gelten weiter. Das
  Öffnen wird wie bisher als `docker.terminal.open` im Audit-Log vermerkt.
- **Neustart & Sessions**: Nur der übliche Panel-Neustart durch das Update. Angemeldete Sitzungen
  bleiben bestehen; ein zum Update-Zeitpunkt offenes Terminal-Fenster wird geschlossen und muss
  neu geöffnet werden.

## [5.4.0.0] - 2026-08-16 (Build 303) — *Mixed-Rückfall, sichere Terminals & verlässliche Benachrichtigungen*

### ✨ Features & Verbesserungen
- **„Nativ & Dockhand Pro (Mixed)" tut jetzt tatsächlich etwas**: Die Auswahl war bislang wirkungslos —
  der Modus verhielt sich in jeder Code-Stelle exakt wie „Nativ". Mixed bedeutet ab sofort:
  **zuerst der Panel-Agent, bei einem Fehler automatischer Rückfall auf Dockhand Pro.**
  Das gilt für alle Docker-Aufrufe eines Remote-Servers — Container, Images, Volumes, Netzwerke,
  Stacks, Logs und Statistiken.
  - **Der Rückfall passiert nicht stillschweigend.** Er landet als Warnung im Panel-Log und als
    `docker.fallback.dockhand` im Audit-Log (je Agent auf einen Eintrag alle 5 Minuten gedrosselt,
    damit die pollende Docker-Seite das Log nicht flutet). Sonst würde ein dauerhaft ausgefallener
    Agent monatelang unbemerkt bleiben, weil scheinbar alles funktioniert.
  - **Konsole im Mixed-Modus**: Da sich ein bereits geöffnetes Terminal nicht nachträglich umleiten
    lässt, wird der Agent vorab angepingt. Antwortet er nicht, öffnet sich stattdessen das
    Dockhand-Terminal — mit einem Hinweis, dass ausgewichen wurde.
  - Ein Rückfall setzt ein zugewiesenes Dockhand-Environment voraus. Fehlt es, bleibt es beim
    Agent-Fehler statt einer irreführenden Ersatzmeldung.
- **Docker-Übersicht meldet Agent-Ausfälle statt sie zu verstecken**: Die Kachelansicht eines
  Remote-Servers unterdrückte Fehler des Agenten und zeigte stattdessen „online" mit 0 Containern.
  Jetzt erscheint der tatsächliche Fehler bzw. im Mixed-Modus der Rückfall.
- **Hinweis zum lokalen Server**: Auf der Docker-Seite steht nun sichtbar, dass die Container des
  Panel-Servers selbst immer über Dockhand laufen — die Einstellung „Docker Verwaltung" gilt
  ausschließlich für Remote-Server.

### 🔒 Sicherheit
- **Kein Session-Token mehr in der Terminal-URL**: Das Web-Terminal hängte das JWT als Query-Parameter
  an die WebSocket-Adresse, wo es im Klartext in den Access-Logs des Reverse Proxy landete und die
  Sitzung überdauerte. Stattdessen holt das Frontend jetzt über die reguläre API ein **Einmal-Ticket**:
  30 Sekunden gültig, genau einmal einlösbar und fest an diesen einen Container auf diesem einen
  Agenten gebunden.
- **TLS zum Agenten wird auch beim Terminal geprüft**: Der WebSocket-Proxy verband sich bisher mit
  vollständig abgeschalteter Zertifikatsprüfung, während alle übrigen Agent-Aufrufe den gespeicherten
  Fingerprint pinnen. Beide Wege nutzen jetzt dieselbe Prüfung (`utils/agentTls.js`), womit auch drei
  auseinandergelaufene Kopien derselben Logik zusammengeführt sind.
- **Agent baut Docker-Befehle ohne Shell**: Alle Aufrufe, in die Namen oder IDs aus der Anfrage
  einfließen (Volumes, Netzwerke, Images, Container-Aktionen, Logs, Statistiken, Compose-Stacks),
  laufen jetzt über `execFile` mit Argument-Array statt über einen zusammengesetzten Shell-String.
  Über das Panel war das nicht ausnutzbar — es validiert vorher —, der Agent verließ sich dabei aber
  vollständig auf den Aufrufer. Zusätzlich prüft er Image-Referenzen nun selbst.

### 🐛 Bugfixes
- **„Entwarnung senden" hatte keine Wirkung**: Das Feld `notify_resolved` wurde gespeichert und im
  Regel-Dialog angeboten, vom Alert-Evaluator aber nie gelesen — Entwarnungen gingen immer raus.
  Der Schalter greift jetzt. Ist er aus, wird die Entwarnung nur noch in der Historie vermerkt.
- **„Cooldown" galt nur für Aktions-Alerts**: Bei Schwellenwert-, PatchMon-, Storage- und
  MC-Host-Regeln war die Einstellung wirkungslos. Sie begrenzt jetzt Nachmeldungen bei verschärfter
  Schwelle und übersteht dank Auswertung der Historie auch einen Neustart. Die Erstmeldung eines
  Alarms erfolgt weiterhin sofort.
- **Fehlgeschlagene Benachrichtigungen sahen aus wie erfolgreiche**: Kam ein Webhook nicht durch,
  landete der Fehler nur in der Server-Konsole — in der Alert-Historie stand trotzdem „ausgelöst".
  Neuer Status **`failed`** mit Fehlertext, in der Historie rot dargestellt. Auch unterdrückte
  Wartungs-Alarme sind jetzt als solche erkennbar statt als normale Alarme.
- **Custom-Webhooks zerbrachen an Anführungszeichen**: In JSON-Templates wurde nur `{{message}}`
  maskiert, und auch dort keine Backslashes. Ein Regel- oder Servername mit einem `"` machte das JSON
  ungültig, woraufhin der rohe kaputte Text mit `Content-Type: application/json` verschickt wurde.
  Alle Platzhalter werden nun über `JSON.stringify` korrekt maskiert; ergibt ein Template trotzdem
  kein gültiges JSON, scheitert der Versand jetzt mit klarer Meldung statt still kaputte Daten zu senden.
- **Agent verarbeitet kodierte Namen korrekt**: Volumes und Netzwerke mit Sonderzeichen im Namen
  schlugen stumm fehl, weil der Agent die URL-Segmente nicht dekodierte.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Eine einmalige Angleichung setzt `notify_resolved = 1` für **alle bestehenden**
  Alarm-Regeln. Grund: Das Feld steht standardmäßig auf 0, wurde bisher aber ignoriert — ohne diese
  Angleichung würden nach dem Update schlagartig überhaupt keine Entwarnungen mehr verschickt.
  Bestandsregeln verhalten sich damit unverändert; für neue Regeln entscheidet der Schalter.
  Wer keine Entwarnungen möchte, hakt sie in der jeweiligen Regel ab.
- **Agent-Kompatibilität**: Der Panel-Agent bleibt auf **2.5.1** (unverändert seit Build 302), die
  Härtung betrifft nur seine interne Befehlsausführung. Ein Agent-Update ist empfohlen, aber für die
  Panel-seitigen Korrekturen dieser Version nicht erforderlich. Ältere Agenten funktionieren weiter.
- **Neustart-/Session-Verhalten**: Sessions bleiben gültig. Offene Terminal-Fenster müssen nach dem
  Update einmal neu geöffnet werden, da die Anmeldung am Terminal auf Tickets umgestellt wurde.
- **Zu erwarten**: Wer den Mixed-Modus nutzt, sieht bei einem nicht erreichbaren Agenten künftig
  Einträge `docker.fallback.dockhand` im Audit-Log. Das ist kein Fehler, sondern der beabsichtigte
  Hinweis darauf, dass gerade nicht nativ gearbeitet wird.
- **Unverändert**: Container des lokalen Panel-Servers laufen weiterhin über Dockhand — in allen drei
  Betriebsarten.

---

## [5.3.1.2] - 2026-08-16 (Build 302) — *Docker-Konsole funktionsfähig & abgesichert*

### 🔒 Sicherheit
- **Terminal-WebSocket ohne Rechteprüfung**: Der Proxy für das native Container-Terminal prüfte
  ausschließlich, ob das übergebene JWT gültig ist. Weder die Berechtigung `docker.control` noch die
  Agenten-Freigabe der Rolle (`restrict_agents` / `agent_grants`) wurden ausgewertet — anders als bei
  jeder HTTP-Docker-Route. **Jeder angemeldete Benutzer konnte damit eine interaktive Shell in jedem
  Container auf jedem Agenten öffnen**, auch mit einer reinen Lese-Rolle ohne jedes Docker-Recht.
  Der Upgrade prüft jetzt dieselben Bedingungen wie die HTTP-Routen und lehnt sonst mit `403` ab.
- **Session-Prüfung nachgezogen**: Die Terminal-Verbindung übernimmt nun die vollständige Logik der
  regulären Auth-Middleware — die Rolle wird frisch aus der Datenbank gelesen (statt der womöglich
  veralteten Angabe im Token), gelöschte Benutzer und **widerrufene Sessions** werden abgewiesen, und
  das Zwischen-Token vor abgeschlossener 2FA wird nicht mehr akzeptiert.
- **Terminal-Zugriffe im Audit-Log**: Das Öffnen einer Container-Konsole wird als
  `docker.terminal.open` mit Benutzer, Container, Agent, IP und Standort protokolliert.

### 🐛 Bugfixes
- **Container-Konsole ließ sich überhaupt nicht öffnen**: Gleich drei unabhängige Ursachen verhinderten
  das native Terminal — jede für sich allein hätte schon gereicht:
  - Der WebSocket-Proxy entschied anhand der **veralteten Spalte** `remote_agents.docker_engine`, ob
    nativ gearbeitet wird. Diese Spalte wird seit v5.3.1.0 nicht mehr gepflegt (die Betriebsart kommt
    aus `settings.dockerEngine`) und wurde von der damaligen Migration bei **allen** bereits
    vorhandenen Agenten dauerhaft auf `dockhand` gesetzt. Ergebnis: `400 Bad Request` beim Verbinden,
    das Terminal-Fenster ging auf und schloss sofort wieder — sowohl im Modus „Nativ" als auch
    „Mixed". Nur nach dem Update neu angelegte Agenten funktionierten. Der Proxy liest die Betriebsart
    jetzt aus den globalen Einstellungen.
  - Die Route `/api/dockhand/terminal-url/:containerId` brach mit **„Dockhand URL nicht konfiguriert"**
    ab, bevor sie überhaupt zur Nativ-Weiche kam. Wer Dockhand bewusst nicht eingerichtet hatte — im
    Modus „Direkt via Agent (Nativ)" der Normalfall — konnte die Konsole deshalb nie öffnen. Die
    Nativ-Prüfung steht nun vor der Dockhand-Prüfung.
  - Der Agent startete im Container fest `bash`. Alpine-basierte Images (`nginx:alpine`,
    `redis:alpine`, `postgres:alpine` und ähnliche) haben nur `sh`, wodurch `docker exec` sofort
    abbrach und die Verbindung kommentarlos zuging. Der Agent wählt die Shell jetzt im Container
    selbst (`bash`, sonst `sh`).
- **Terminal-Fehler bleiben nicht mehr unsichtbar**: Beendet sich die Container-Shell sofort, wird die
  Meldung von `docker exec` noch an den Browser ausgeliefert, bevor die Verbindung geschlossen wird.
  Zusätzlich bricht ein nicht antwortender Agent nach 10 Sekunden mit einem Fehler ab, statt stumm zu
  hängen, und eine Störung nach dem Verbindungsaufbau erzeugt keine defekten Protokoll-Frames mehr.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine. Die Spalte `remote_agents.docker_engine` bleibt bestehen, wird aber von
  keiner Code-Stelle mehr ausgewertet — ein Angleichen der Altbestände ist nicht nötig.
- **Agent-Kompatibilität**: Der Panel-Agent steigt auf **2.5.1**. Der Shell-Fallback wirkt erst nach
  einem Agent-Update auf dem jeweiligen Zielserver; bis dahin funktioniert die Konsole dort weiterhin
  nur bei Containern mit `bash`. Alle übrigen Korrekturen dieser Version liegen im Panel und greifen
  sofort. Ältere Agenten bleiben ansonsten voll kompatibel.
- **Berechtigungen**: Benutzer ohne `docker.control` verlieren den Zugang zur Container-Konsole — das
  war die Absicht, entsprach aber bisher nicht dem tatsächlichen Verhalten. Rollen mit eingeschränkter
  Agenten-Auswahl erreichen nur noch die ihnen zugewiesenen Server. Wer die Konsole bisher ohne
  passendes Recht genutzt hat, braucht künftig `docker.control` in seiner Rolle.
- **Neustart-/Session-Verhalten**: Offene Terminal-Fenster brechen beim Neustart wie bisher ab.
  Bestehende Anmeldungen bleiben gültig; widerrufene Sessions verlieren allerdings sofort auch den
  Terminal-Zugriff, den sie zuvor behalten hatten.
- **Unverändert**: Container des lokalen Panel-Servers laufen weiterhin über Dockhand — auch im Modus
  „Nativ". Die Einstellung „Nativ & Dockhand Pro (Mixed)" verhält sich unverändert wie „Nativ".

---

## [5.3.1.1] - 2026-08-16 (Build 301) — *Agent Update Hotfix*

### 🐛 Bugfixes
- **Agent Update Signatur**: Ein Fehler wurde behoben, bei dem das automatische Agent-Update auf Remote-Servern mit dem Fehler "Ungültige HMAC-Signatur — Update abgelehnt" fehlschlug. Dies lag daran, dass mehrzeilige Payloads (wie das Agent-Script) vom Panel stückweise per POST gesendet wurden und die unvollständige String-Konkatenierung der Chunks bei Multi-Byte UTF-8 Zeichen zu einer veränderten Datei führte, die nicht mehr zur errechneten Signatur passte. Der Agent nutzt nun korrekte Puffer (`Buffer.concat`).

---

## [5.3.1.0] - 2026-08-16 (Build 300) — *Native Agent Docker Integration & Global Mixed Mode*

### ✨ Features & Verbesserungen
- **Globaler Mixed Mode**: Die Entscheidung zwischenativer Docker-Verwaltung und Dockhand Pro wird nun nicht mehr pro Server getroffen, sondern in den globalen Einstellungen unter *Docker & Dockhand Verwaltung* festgelegt. Man hat die Wahl zwischen *Direkt via Agent (Nativ)*, *Nativ & Dockhand Pro (Mixed)* und *Dockhand Pro (Legacy)*.
- **Volle native Parität**: Der Panel-Agent unterstützt nun nativ das Auslesen, Starten/Stoppen und Prunen von Docker Stacks (`docker compose`), Volumes, Networks und das Pullen/Löschen von Images.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Einstellungen**: Das Feld `docker_engine` in `remote_agents` wird nicht mehr verwendet (der Wert wird nun aus `settings.dockerEngine` bezogen).
- **Agent Update**: Es wird dringend empfohlen, den Panel-Agent über das Panel auf allen Servern zu aktualisieren, um die volle Funktionalität für Volumes, Netzwerke und Stacks zu erhalten.

---

## [5.3.0.0] - 2026-08-16 (Build 299) — *Native Agent Docker Integration*

### ✨ Features & Verbesserungen
- **Native Docker-Agent Integration**: Docker-Container auf Remote-Servern können nun wahlweise über "Dockhand Pro" (Legacy) oder direkt via Panel-Agent (Nativ) verwaltet werden.
- **Interaktive Agent-Terminals**: Die native Integration beinhaltet ein eingebautes XTerm.js-Webterminal, das per WebSocket-Proxy direkt über den Panel-Agent mit den Containern kommuniziert (`node-pty`).
- **Einstellungen**: Das Docker-Verwaltungs-Backend (Dockhand vs. Nativ) kann pro Server im Panel beim Hinzufügen oder Bearbeiten ausgewählt werden.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine neuen Schemas (Feld `docker_engine` war bereits vorhanden).
- **Voraussetzungen**: Der Agent (`panel-agent.js`) verwendet nun `ws` und `node-pty`. Das Installationsskript (`install.sh`) installiert automatisch die nötigen Build-Tools (`build-essential`, `python3`) und NPM-Abhängigkeiten. Bestehende Agents sollten aktualisiert oder neu installiert werden, um das neue native Terminal zu nutzen.
- **Agent-Kompatibilität**: Abwärtskompatibel. Alte Agents ohne `node-pty` funktionieren weiterhin, allerdings steht dort das neue interaktive Terminal nicht zur Verfügung.

---

## [5.2.2.0] - 2026-08-15 (Build 298) — *Dockhand Terminal Integration*

### ✨ Features & Verbesserungen
- **Dockhand Terminal-Verknüpfung**: In der Docker-Übersicht gibt es nun bei laufenden Containern einen neuen „Konsole“-Button. Dieser fragt dynamisch die zugehörige Dockhand Environment-ID des Servers (lokal oder Remote-Agent) ab und öffnet das Dockhand-Webterminal nahtlos in einem neuen Tab.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine.
- **Voraussetzungen**: Die Dockhand-URL muss in den Panel-Einstellungen hinterlegt und das passende Environment zugewiesen sein (wie bisher auch für die Container-Auflistung).
- **Berechtigungen**: Der Terminal-Button wird nur Administratoren und Nutzern mit der Erlaubnis zur Docker-Steuerung (`docker.control`) angezeigt.

---

## [5.2.1.1] - 2026-08-15 (Build 297) — *SMTP UI & Passkey Fix*

### ✨ Features & Verbesserungen
- **SMTP-Einstellungen wieder da**: Die Eingabemasken zur Konfiguration des SMTP-Servers (inklusive Test-Mail-Funktion) wurden in den Einstellungen unter „System & Backup“ wieder eingebaut.

### 🐛 Bugfixes
- **Passkey-Registrierung fehlgeschlagen**: Die Registrierung und Anmeldung mit Passkeys brach mit HTTP 400 (`User verification was required, but user could not be verified`) ab, wenn der verwendete Authenticator keine Biometrie oder PIN-Abfrage unterstützte. Die Verifizierung wurde angepasst, sodass „bevorzugte“ Nutzerüberprüfung nicht mehr fälschlicherweise serverseitig als zwingend vorausgesetzt wird.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine.
- **Kompatibilität**: Die SMTP-Einstellungen greifen sofort auf die bereits im Backend vorhandenen Endpunkte zu. Passkey-Logins funktionieren nun auch reibungslos mit Passwortmanagern ohne Windows Hello (z.B. Enpass).

---

## [5.2.1.0] - 2026-08-15 (Build 296) — *Benutzerverwaltung erweitert*

### ✨ Features & Verbesserungen
- **Benutzerprofile bearbeiten**: Die Verwaltung von Benutzern wurde vervollständigt. Neben der Rolle und dem Passwort können nun auch der **Benutzername** und die **E-Mail-Adresse** nachträglich geändert werden. 
- **2FA-Notfall-Reset für Administratoren**: Super-Admins können ab sofort jegliche Form der Zwei-Faktor-Authentifizierung (TOTP-App oder E-Mail) für andere Benutzer per Knopfdruck aus der Benutzerliste deaktivieren. Dies hilft sofort, wenn sich Benutzer selbst ausgesperrt haben, ohne dass manuelle Datenbankeingriffe nötig sind.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Schema-Änderungen. Die Endpunkte greifen auf bestehende Felder zurück (`username`, `email`, `twofa_type` etc.).
- **Audit-Log**: Neue Protokoll-Ereignisse für die Änderungen am Profil (`user.update_username`, `user.update_email`) sowie für das Zurücksetzen der 2FA (`user.disable_2fa`) stellen sicher, dass Admins jeden Eingriff nachvollziehen können.
- **Sicherheit**: Die E-Mail-Adresse wird nun proaktiv in der Listenansicht mit angezeigt. Die 2FA-Deaktivierungs-Funktion ist serverseitig strikt auf die systemweite `admin`-Rolle beschränkt.

---

## [5.2.0.1] - 2026-08-15 (Build 295) — *PatchMon-Alerts erreichen alle Server*

### 🐛 Bugfixes
- **PatchMon-Alarme lösten nie aus**: Regeln vom Typ „🔧 PatchMon-Updates“ wurden ausschließlich für den
  **lokalen Panel-Server** ausgewertet. Alle über einen Remote-Agenten angebundenen Server blieben
  unberücksichtigt — auch dann, wenn sie in den Einstellungen sauber mit einem PatchMon-Host verknüpft waren.
  War zusätzlich der lokale Server nicht verknüpft, verwarf der Alert-Evaluator die Regel bei jedem Durchlauf
  stillschweigend, sodass **überhaupt keine** PatchMon-Benachrichtigung versendet wurde.
  Ursache war die fehlende PatchMon-Verzweigung in `backend/src/alertEvaluator.js`: ohne Server-Auswahl fiel
  die Regel auf den Standardwert `local` zurück, statt wie bei Storage-Boxen und MC-Host24 automatisch alle
  passenden Ziele einzusammeln. PatchMon-Regeln prüfen jetzt **alle verknüpften Server** (lokal + Agenten).
- **Server-Auswahl bei PatchMon-Regeln fehlte**: Im Regel-Dialog war die Server-Liste für den PatchMon-Typ
  komplett ausgeblendet, wodurch sich eine Regel gar nicht auf einzelne Server eingrenzen ließ. Die Auswahl
  ist nun sichtbar; ohne Auswahl gelten weiterhin alle verknüpften Server.
- **Stille Fehlkonfiguration wird gemeldet**: Findet eine PatchMon-Regel keinen einzigen verknüpften Server,
  schreibt der Alert-Evaluator jetzt einmalig eine Warnung ins Panel-Log statt kommentarlos nichts zu tun.
  Der Hinweistext im Regel-Dialog verweist zusätzlich direkt auf *Einstellungen › PatchMon-Server-Verknüpfung*.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine. Die Änderung nutzt ausschließlich vorhandene Felder
  (`remote_agents.patchmon_host_id` und die Einstellung `patchmonLocalHostId`).
- **Agent-Kompatibilität**: Unverändert — die PatchMon-Werte stammen aus der PatchMon-API, nicht vom Agenten.
  Ein Agent-Update ist nicht erforderlich.
- **Neustart-/Session-Verhalten**: Sessions und Webhooks bleiben unberührt. Bestehende PatchMon-Regeln greifen
  nach dem Update sofort und ohne Bearbeitung. **Zu erwarten ist direkt nach dem Neustart ein Schwung
  Benachrichtigungen**, weil die bislang nie ausgewerteten Server ihre Schwelle bereits überschreiten — pro
  Regel und Server wird einmalig ausgelöst, danach erst wieder nach einer Entwarnung.
- **Voraussetzung**: Ein Server meldet nur, wenn er unter *Einstellungen › PatchMon-Server-Verknüpfung* einem
  PatchMon-Host zugeordnet ist. Nicht verknüpfte Server bleiben bewusst stumm.

---

## [5.2.0.0] - 2026-08-02 (Build 294) — *Prozess-Manager, Notizbuch & Discord-Embeds*

### ✨ Neue Module & Funktionen
- **Modul 3: Interaktiver Prozess-Manager & Dienst-Steuerung (`/api/agents/:id/processes`)**:
  - **Live-Prozessliste im Server-Detail-Dialog**: Neuer Reiter **„Prozesse“** zeigt die Top 25 Prozesse nach CPU- & RAM-Auslastung (`PID`, `USER`, `CPU %`, `RAM %`, `COMMAND`).
  - **Such- und Sortierfunktion**: Schnelles Filtern nach Prozessname, PID oder Befehlszeile sowie Umschalten der Sortierung zwischen CPU und RAM.
  - **Sicherer Prozess-Abbruch**: Interaktiver Kill-Button mit Bestätigungs-Modal für sanftes Beenden (`SIGTERM`) oder sofortiges Schließen (`SIGKILL`).
  - **Audit & Rechte**: Neue Berechtigung `agents.manage_processes` sowie Audit-Log-Einträge bei jedem Prozessabbruch.
- **Modul 4: Server-Notizbuch & Wartungs-Kalender („Maintenance Mode“)**:
  - **Wartungsmodus („Alarme unterdrücken“)**: Server können vorübergehend um +1h, +2h, +4h, +12h oder +24h in den Wartungsmodus versetzt werden. Solange ein Wartungsfenster aktiv ist, zeigt der Header ein orangefarbenes Warnbanner („Wartung bis HH:mm“) und **unterdrückt automatisch alle Alarm-Benachrichtigungen** (Status `suppressed` in der Historie).
  - **Server-Notizbuch (`/api/agents/:id/notes`)**: Neuer Reiter **„Notizbuch“** im Server-Dialog. Ermöglicht das Anlegen, Formatieren und Speichern von Markdown-Notizen, Befehlslisten und Betriebsanleitungen pro Server.
- **Modul 5: Erweiterte Benachrichtigungs-Kanäle (Discord Rich Embeds & Custom Webhooks)**:
  - **Discord Rich Embeds**: Discord-Webhooks versenden nun farblich formatierte Rich Embeds statt reinem Text (Roter Balken `#ef4444` für ausgelöste Alarme, Grüner Balken `#3fb950` für Entwarnungen/Recovery).
  - **Custom JSON-Webhooks (`method`, `headers`, `template`)**: Neuer Webhook-Typ „Custom“ für universelle Schnittstellen (z. B. Gotify, Matrix, Microsoft Teams, n8n) mit frei definierbarem JSON-Template und automatischen Platzhaltern (`{{server_name}}`, `{{alert_title}}`, `{{severity}}`, `{{value}}`, `{{message}}`).

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Automatischer Try-Catch-Block in `backend/src/db.js` erstellt beim Start der App die neuen Tabellen `server_notes` und `maintenance_windows` sowie die Spalten `method`, `headers` und `template` in der `webhooks`-Tabelle. Kein manueller Eingriff oder Datenbank-Reset erforderlich.
- **Agent-Kompatibilität**: Der Remote-Agent wurde in `agent/panel-agent.js` um die Routen `/processes` und `/processes/:pid/kill` erweitert. Ältere Agenten funktionieren weiterhin reibungslos; im Prozesse-Reiter wird bei alten Agenten lediglich ein leerer Zustand („Keine Prozesse gefunden“) angezeigt.
- **Neustart-/Session-Verhalten**: Vorhandene Login-Sessions und Webhooks bleiben unberührt. Bestehende Discord-Webhooks wechseln automatisch in das neue Rich-Embed-Design.

---

## [5.1.1.2] - 2026-08-01 (Build 293) — *Dashboard-Widgets bleiben an ihrem Platz*


### 🐛 Bugfixes & Stabilität
- **Widgets wechselten von selbst ihre Position (`Dashboard.jsx`)**: Kacheln wurden nicht verschoben,
  sondern kurzzeitig **aus dem Layout geworfen und danach unten wieder angehängt**. Zwei Auslöser:
  - Die **Hetzner-Storage-Kachel** wurde entfernt, sobald der Abruf der Storage Boxes einmal nichts
    lieferte. Dieser Abruf läuft alle 60 Sekunden und setzte im Fehlerfall auf eine leere Liste — jeder
    kurze Aussetzer der Hetzner-API ließ die Kachel also verschwinden und kurz darauf an neuer Stelle
    wieder auftauchen.
  - Alle **Server-Kacheln** flogen aus dem Layout, solange die Agentenliste noch nicht geladen war —
    beim Aufruf der Startseite also regelmäßig für einen Moment.

  Da das Raster mit `compactType="vertical"` arbeitet, rutschte bei jedem dieser Aussetzer alles
  Darunterliegende nach oben. Dieses Zwischenergebnis wurde über `onLayoutChange` auch noch **gespeichert**,
  wodurch sich die Anordnung dauerhaft veränderte. Behoben durch:
  - Eine Kachel verschwindet nur noch, wenn sie **wirklich nicht mehr existiert**, nicht schon bei einer
    leeren Antwort. Die Storage-Kachel bleibt liegen und zeigt selbst an, wenn keine Box vorhanden ist;
    Server-Kacheln werden erst aussortiert, wenn die Agentenliste tatsächlich geladen ist.
  - Gespeichert wird erst, wenn **sowohl das abgelegte Layout als auch die Serverliste** geladen sind.
  - Ein Vergleich der Anordnung vor dem Speichern: Meldet das Raster nur eine selbst ausgelöste
    Umsortierung ohne echte Änderung, wird nichts mehr geschrieben.
- **Aussetzer der Hetzner-API leert die Kachel nicht mehr (`Dashboard.jsx`)**: Schlägt der Abruf fehl,
  bleibt der zuletzt bekannte Stand stehen, statt auf eine leere Liste zurückzufallen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine.
- **Agent-Kompatibilität**: Unverändert.
- **Neustart-/Session-Verhalten**: Bestehende Sitzungen bleiben gültig.
- **Bereits verschobene Layouts**: Eine durch den Fehler entstandene Anordnung bleibt zunächst so
  gespeichert, wie sie zuletzt war. Sie lässt sich über *Layout zurücksetzen* in der Kopfzeile der
  Startseite auf die Standard-Anordnung bringen; ab dann bleibt sie stabil.

---

## [5.1.1.1] - 2026-08-01 (Build 292) — *Updater startet den Container zuverlässig, Widgets wieder löschbar*

### 🐛 Bugfixes & Stabilität
- **Neuer Container blieb nach dem Update stehen, statt zu starten (`update.js`)**: Der Updater legte den
  Container zwar neu an, startete ihn aber nicht — das Panel blieb nach dem Update aus. Ursache war, dass
  `docker compose up -d --force-recreate` zuerst den alten Panel-Container stoppt. Der Update-Befehl lief
  jedoch als **Kindprozess genau dieses Containers** und wurde dabei mitten im Vorgang mitgetötet. Der neue
  Container blieb dann im Zustand `created` liegen, ohne dass ihn noch jemand startete. Behoben durch drei
  Änderungen:
  - Das Update-Skript wird nun auf dem Host abgelegt und per `setsid` (ersatzweise `nohup`) **aus dem
    Prozessbaum des Containers gelöst**. Es überlebt damit das Herunterfahren des Panels und läuft zu Ende.
  - Am Ende prüft eine **Nachlaufschleife** bis zu zwölfmal den Status des Containers und startet ihn per
    `docker start` nach, falls er nicht läuft.
  - Der Verlauf landet auf dem Host in `/tmp/panel-update.log` und ist damit auch dann nachvollziehbar,
    wenn das Panel zwischenzeitlich nicht erreichbar war.
- **Update über die Dockhand-API galt als erfolgreich, sobald der Auftrag angenommen war (`update.js`)**:
  Ob der Container danach auch tatsächlich lief, wurde nicht geprüft — blieb er stehen, griff kein Fallback
  mehr, weil der Updater sich bereits beendet hatte. Ein entkoppelter **Wächter** auf dem Host übernimmt
  jetzt auch auf diesem Weg das Nachstarten.
- **Individuelle Dashboard-Widgets ließen sich nicht löschen (`Dashboard.jsx`)**: Der Verschieben-Griff lag
  mit `absolute top-2 right-2 z-10` genau über dem Löschen-Knopf im Kopf der Widgets. Beide erscheinen beim
  Überfahren mit der Maus an derselben Stelle, wodurch der Griff jeden Klick abfing. Bei individuellen
  Widgets sitzt der Griff nun daneben.
- **Server-Auswahl im Dialog „Widget hinzufügen" ließ sich nicht leeren (`Dashboard.jsx`)**: Die
  Vorauswahl-Logik hing an der Server-Liste, die bei jedem Neuzeichnen der Startseite als neues Array
  entsteht. Dadurch lief sie fortlaufend mit und füllte eine gerade abgewählte Auswahl sofort wieder mit den
  ersten beiden Servern. Die Vorauswahl greift jetzt nur noch beim Öffnen des Dialogs.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine.
- **Agent-Kompatibilität**: Unverändert — am Agenten-Protokoll ändert sich nichts.
- **Neustart-/Session-Verhalten**: Bestehende Sitzungen und gespeicherte Dashboard-Layouts bleiben erhalten.
- **Wirksam erst beim übernächsten Update**: Der Fix sitzt im Updater selbst. Das Einspielen *dieser*
  Version läuft noch über den alten Weg — bleibt der Container dabei erneut stehen, hilft einmalig ein
  `docker start <container>` bzw. `docker compose up -d` auf dem Host. Ab dem darauffolgenden Update greift
  die neue Absicherung.
- **Neue Voraussetzung auf dem Host**: keine. Fehlt `setsid`, wird automatisch `nohup` verwendet.

---

## [5.1.1.0] - 2026-08-01 (Build 291) — *Durchgehende Zählung ab 1.0.0.0*

### 🔢 Versionierung
- **Zweite Stelle ist ab sofort immer einstellig (0–9)**: Läuft sie über, zählt die erste Stelle weiter —
  auf `5.9.x.x` folgt `6.0.0.0`. Die Versionsnummer bleibt dadurch dauerhaft kompakt und lesbar, statt
  wie bisher in der zweiten Stelle immer weiter anzuwachsen.
- **Gesamte Projekthistorie neu durchgezählt**: Die Nummerierung beginnt beim ersten Release wieder bei
  **`1.0.0.0`** und läuft von dort lückenlos bis zum heutigen Stand durch. Grundlage sind alle
  **100 Release-Punkte** der Projektgeschichte — die 47 getaggten Releases der Frühphase und die
  Changelog-Einträge —, jeweils eingestuft nach dem, was sie tatsächlich enthalten:

  | | vorher | jetzt |
  |---|---|---|
  | Initiales Release | 1.0.0 | **1.0.0.0** |
  | CheckMK-artiger Remote-Agent | 1.10.0 | **2.0.0.0** |
  | Granulares Rechte-System & GeoIP | 1.22.0 | **3.2.0.0** |
  | Automatischer Panel-Updater & 2FA | 1.48.0 | **4.4.0.0** |
  | Custom Dashboard-Builder | 1.54.0 | **5.0.0.0** |
  | Vierstellige Versionierung | 1.55.0 | **5.1.0.0** |

- **Nur die zweite Stelle ist begrenzt**: Die dritte und vierte Stelle dürfen zweistellig werden — auf
  `5.1.1.9` folgt `5.1.1.10`. Damit bleibt eine längere Bugfix-Reihe am selben Thema in derselben
  Versionslinie, statt einen Sprung in der dritten Stelle zu erzwingen. Zusammenhängende Fixes werden
  zudem in **einem** Eintrag zusammengefasst, statt für jeden Teilschritt eine eigene Nummer zu vergeben.
- **Versions-Tags erneut angepasst**: Alle 47 Tags tragen die neuen Nummern (`v1.0.0.0` … `v3.2.0.0`)
  und zeigen unverändert auf ihre ursprünglichen Commits.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine. Die Version steht ausschließlich in `version.json`.
- **Agent-Kompatibilität**: Unverändert — der Agent führt seine eigene Versionsnummer.
- **Update-Prüfung**: Die neue Nummer liegt über der bisherigen (`5.1.1.0` > `1.55.0.0`), die Erkennung
  neuer Versionen bleibt also auch ohne die zusätzlich verglichene Build-Nummer korrekt.
- **Sichtbar für Benutzer**: In der Seitenleiste und unter *Einstellungen → System* springt die Anzeige
  von `1.55.0.0` auf `5.1.1.0`. Das ist ein reiner Nummernwechsel — funktional ändert sich nichts,
  bestehende Sitzungen, Rechte und Dashboard-Layouts bleiben unangetastet.
- **Git-Historie**: Diesmal **nicht** umgeschrieben. Es wurden nur Tags umbenannt; alle Commit-Hashes
  bleiben gültig, bestehende Klone brauchen kein `reset --hard`.

---

## [5.1.0.0] - 2026-08-01 (Build 290) — *Vierstellige Versionierung*

### ✨ Neue Funktionen & Features
- **Vierstelliges Versionsschema eingeführt (`Major.Minor.Änderung.Fix`)**: Die Versionsnummer trennt ab sofort
  kleinere Änderungen (3. Stelle) von reinen Bugfixes (4. Stelle). Bisher landeten beide gemeinsam in der
  dritten Stelle, wodurch aus der Nummer allein nicht ablesbar war, ob ein Update etwas Neues bringt oder
  lediglich einen Fehler behebt.
- **Rückwirkende Umstellung der gesamten Historie**: Alle Einträge dieses Changelogs wurden anhand ihres
  tatsächlichen Inhalts neu eingestuft — Bugfixes sind von der dritten in die vierte Stelle gewandert,
  kleinere Änderungen behielten die dritte. Die Reihenfolge bleibt dabei lückenlos aufsteigend.
- **Alle 47 Versions-Tags neu gesetzt**: Die Tags aus der Frühphase (`v1.0.0` … `v1.22.0`) wurden nach
  demselben Schema neu vergeben und zeigen unverändert auf ihre jeweiligen Commits.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine. Die Version wird ausschließlich aus `version.json` gelesen und nirgends
  in der Datenbank vorgehalten.
- **Agent-Kompatibilität**: Unverändert. Der Agent führt seine eigene Versionsnummer, das Schema hier
  betrifft ihn nicht.
- **Update-Prüfung**: Der Versionsvergleich in `updateCheck.js` wertet beliebig viele Stellen aus und
  arbeitet mit vier Stellen unverändert korrekt. Da die Build-Nummer zusätzlich verglichen wird, bleibt die
  Erkennung neuer Versionen auch über den Schemawechsel hinweg zuverlässig.
- **Sichtbar für Benutzer**: In der Seitenleiste und unter *Einstellungen → System* erscheint die
  Versionsnummer ab sofort vierstellig. Bestehende Sitzungen, Rechte und Layouts sind nicht betroffen.
- **Git-Historie umgeschrieben**: Interne Arbeits- und Planungsdateien wurden aus allen Commits entfernt.
  Dadurch haben sich sämtliche Commit-Hashes geändert; ein älterer Klon des Repositories muss einmalig mit
  `git fetch origin && git reset --hard origin/master` nachgezogen werden. Der Produktivbetrieb ist nicht
  betroffen, da das Panel über das Image `ghcr.io/roobiing/ueberwachungs-panel:latest` aktualisiert wird.

---

## [5.0.0.1] - 2026-08-01 (Build 288) — *Fix für Custom-Widget Titel-Parameter im Dashboard*

### 🐛 Bugfixes & Stabilität
- **Behebung von `ReferenceError: item is not defined` im Dashboard (`Dashboard.jsx`)**: Korrektur der Funktionssignatur von `widgetTitle(id, serverName, item)`. Zuvor fehlte der dritte Parameter `item`, was beim Rendern von benutzerdefinierten Kacheln (`id.startsWith('custom:')`) zu einem Absturz beim Zugriff auf `item?.title` führte. Das Dashboard lädt nun mit individuellen Widgets einwandfrei.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankänderung erforderlich.
- **Agent-Kompatibilität**: Unverändert voll kompatibel.
- **Neustart-/Session-Verhalten**: Vorhandene und neue Custom-Widgets auf der Startseite werden jetzt fehlerfrei angezeigt, ohne dass ein Seiten-Crash ausgelöst wird.

---

## [5.0.0.0] - 2026-08-01 (Build 287) — *Modul 1 & 2: Custom Dashboard-Builder & DB-Sicherung im UI*

### ✨ Neue Features & UI-Verbesserungen
- **Modul 1: Backup-Manager im Einstellungs-Panel (`backups.js` & `Settings.jsx`)**:
  - Vollständiges SQLite-Backup-Management direkt im Panel unter *Einstellungen → System & Backup* (geschützt über das Recht `system.backup`).
  - **Manuelle Sofort-Sicherung**: Per Knopfdruck kann ein konsistentes SQLite-Backup im laufenden Betrieb erzeugt werden (`db.backup(destPath)`).
  - **Sicherungsverwaltung**: Anzeige aller im Ordner `data/backups/` gespeicherten `.db`-Sicherungen mit Zeitstempel und Dateigröße, inklusive Download-Funktion und Löschung nicht mehr benötigter Archive.
  - **Live-Wiederherstellung (Restore)**: Geführter Wiederherstellungsprozess aus einer Sicherungsdatei mit Sicherheits-Bestätigungsdialog.
- **Modul 2: Individueller Dashboard-Builder & Multi-Server-Analysen (`Dashboard.jsx`)**:
  - **+ Widget hinzufügen**: Über eine neue Schaltfläche im Dashboard-Header können Nutzer nun individuelle Überwachungs-Widgets im Raster hinzufügen.
  - **5 Spezial-Widgets verfügbar**:
    1. *Multi-Server-Vergleich Chart*: Vergleicht die CPU- oder RAM-Auslastung mehrerer Server zeitgleich im Recharts-Liniendiagramm.
    2. *Tachometer / Gauge-Widget*: Visuelles Rundinstrument mit SVG-Anzeige für die aktuelle Systemlast einzelner Server.
    3. *PatchMon Sicherheitsampel*: Übersichtskachel für anstehende OS-Updates und erforderliche Neustarts.
    4. *Uptime-Kuma Statuskachel*: Kompakte Kachel mit Verfügbarkeits-Fortschrittsbalken und Up/Total-Zähler.
    5. *Live-Log-Ticker*: Scrollbarer Echtzeit-Feed für kürzlich aufgetretene System-Alerts und Systemereignisse.
  - **Persistentes Grid-Layout (`react-grid-layout`)**: Alle hinzugefügten Widgets lassen sich frei verschieben und in der Größe verändern; das Layout wird pro Benutzer/Session beständig in der SQLite-Datenbank (`/api/dashboard/home-layout`) abgelegt.
- **Erweiterungen im Rechtesystem**:
  - Trennung in dedizierte Einzelberechtigungen: `system.update` für den System-Updater und `system.backup` für die Datenbanksicherungen.
  - Integration von Benutzer-Metadaten im Konto-Bereich (Letzter Login, IP, Browser, Passkeys) geschützt durch `users.view_meta`.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Schema-Änderung an SQLite erforderlich; Backups werden im Dateisystem unter `/app/backend/data/backups/` abgelegt. Das Grid-Layout speichert neu erzeugte Custom-Widgets strukturiert unter `custom:<type>:<ts>` im JSON-Format der Spalte `home_layout`.
- **Agent-Kompatibilität**: Vollständig kompatibel; Custom-Widgets greifen auf die im Cache aggregierten Live-Metriken und Verlaufsdaten (`/api/metrics`) der Agenten zurück.
- **Neustart-/Session-Verhalten**: Bestehende Dashboard-Layouts bleiben uneingeschränkt erhalten; neue Custom-Widgets werden zusätzlich im Raster positioniert und können jederzeit über die Header-Buttons zurückgesetzt oder gelöscht werden.

---

## [4.9.0.1] - 2026-08-01 (Build 286) — *Fix für User-Login Metadaten-Migration & Protokollierung*

### 🐛 Bugfixes & Stabilität
- **Fehlende Datenbank-Migration nachgeholt (`db.js`)**: Behebt einen `SqliteError: no such column: last_login`-Fehler bei `/api/auth/me`, der bei neuen Container-Deployments dazu führte, dass angemeldete Benutzer nach 1 Sekunde automatisch wieder zur Login-Seite geleitet wurden. Die Spalten `last_login`, `last_login_ip` und `last_login_from` werden nun beim Start ordnungsgemäß via `ALTER TABLE` zur Tabelle `users` hinzugefügt.
- **Zuverlässige Aufzeichnung der Login-Metadaten (`auth.js` & `audit.js`)**: Beim erfolgreichen Login (`storeSession`) wird die `users`-Tabelle nun bei jedem Anmeldeverfahren (Passwort, 2FA, Passkeys) automatisch mit dem aktuellen Zeitstempel (`CURRENT_TIMESTAMP`), der Client-IP sowie dem per GeoIP aufgelösten Standort (`resolveLocation`) aktualisiert.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Sicheres Try-Catch-Verfahren (`ALTER TABLE users ADD COLUMN ...`) in `backend/src/db.js` legt die fehlenden Login-Metadaten-Spalten in bestehenden und neuen SQLite-Datenbanken an.
- **Agent-Kompatibilität**: Keine Änderungen am Agenten-Protokoll oder Remote-Server-Zugriff (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Bestehende Anmeldungen sind sofort wieder stabil und werden bei `/api/auth/me` korrekt verarbeitet.

---

## [4.9.0.0] - 2026-08-01 (Build 285) — *Feingranulares Rechtesystem & erweiterte Konto-Metadaten*

### 🔒 Sicherheit & Berechtigungen
- **Vollständige Migration auf feingranulares Rechtesystem (`requirePermission`)**: Alle restlichen Backend-Routen (`settings.js`, `users.js`, `roles.js`, `panelLogs.js`, `dockhand.js`) wurden von starren `requireRole('admin')`-Prüfungen auf dynamische Berechtigungs-Checks umgestellt.
- **Eigenes Recht für das Updatesystem (`system.update`)**: Das Systemupdate unter Einstellungen (`/api/update/*`) wird nun über eine eigene Berechtigung (`system.update`) gesteuert und erlaubt damit eine entkoppelte und gezielte Vergabe von Update-Rechten unabhängig vom allgemeinen Systemverwaltungs-Recht.
- **Erweiterung der Berechtigungs-Middleware**: Die Middleware `requirePermission` akzeptiert ab sofort auch Arrays von Berechtigungs-Keys (ODER-Verknüpfung), sodass gemeinsame Lese-Endpunkte flexibel durch mehrere passende Berechtigungen genutzt werden können.

### 👤 Benutzer-Metadaten & Konto-Informationen
- **Erweiterte Login-Metadaten**: Erfassung und automatische Speicherung des letzten Login-Zeitpunkts (`last_login`), der IP-Adresse (`last_login_ip`) und des Herkunftslands/Standorts (`last_login_from`) in der `users`-Tabelle bei jeder Anmeldung im Panel.
- **Konto-Informationen im Profil (`Settings.jsx`)**: Neuer Informationsbereich unter *Einstellungen → Profil & Sicherheit*, der angemeldeten Benutzern Details zum eigenen Konto (Benutzername, Rolle, Registrierungsdatum, letzter Login-Zeitpunkt und Login-Standort) übersichtlich darstellt.
- **Letzter Login in der Benutzerverwaltung (`Users.jsx`)**: Erweiterung der Benutzerliste im Frontend um die Anzeige des letzten Logins (inkl. Datum, Uhrzeit, IP-Adresse und Standort) zusätzlich zum Erstellungsdatum.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Automatische Schema-Erweiterung für die Tabelle `users` um die neuen Spalten `last_login` (TEXT), `last_login_ip` (TEXT) und `last_login_from` (TEXT) im Try-Catch-Verfahren (`backend/src/db.js`).
- **Agent-Kompatibilität**: Keine Änderungen am Kommunikationsprotokoll der Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Bestehende Benutzer-Sitzungen bleiben gültig. Die erweiterten Login-Metadaten werden ab dem nächsten Login neu aufgezeichnet und in der Benutzeroberfläche angezeigt.

---

## [4.8.1.1] - 2026-08-01 (Build 284) — *PatchMon-Alert-Auswertung & präzises Dockhand-Stack-Matching*

### 🐛 Bugfixes & Optimierungen
- **Präzises Dockhand-Stack- & Container-Matching für Panel-Updates (`update.js`)**: Im Updater-Suchfilter wurde das zu unspezifische Kriterium `n.includes('panel')` entfernt, welches dazu führte, dass fälschlicherweise fremde Stacks wie `root-panel` als Panel-Stack erkannt und mit unvollständiger ID (`ID: undefined`) aktualisiert wurden. Die Erkennung prüft nun exakt auf `ueberwachungs-panel` bzw. `ueberwachungs_panel` sowie auf eine gültige, nicht-leere Stack- oder Container-ID (`id`, `Id`, `_id`, `stackId`).
- **Zuverlässige Auswertung von PatchMon-Alerts (`alertEvaluator.js`)**: Behebung eines Typspezifikations-Fehlers bei der Evaluierung von PatchMon-Regeln (`patchmon_updates`, `patchmon_security`) im Alert-Evaluator. Da die PatchMon v2 API die Host-ID (`h.id`) als Zahl zurückgibt, die verknüpften IDs in `remote_agents` jedoch als Text gespeichert werden, schlug der strikte Vergleich (`===`) fehl. Der Vergleich erfolgt nun typsicher per `String(h.id) === String(hostId)`, sodass PatchMon-Benachrichtigungen unter Benachrichtigungen korrekt auslösen.
- **Ganzzahlige Anzeige für PatchMon-Metriken (`alertEvaluator.js`)**: Formatierung der Update-Zahlen (`patchmon_updates`, `patchmon_security`) in ausgelösten Benachrichtigungen und Erholungsnachrichten (Telegram, Gotify, Webhooks) als ganze Zahlen ohne Nachkommastellen (`Math.round()` statt `.toFixed(1)`).

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen am Kommunikationsprotokoll der Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Der Backend-Service erfordert nach dem Deploy einen Neustart, um die korrigierte PatchMon-Alert-Logik sowie das fehlerfreie Dockhand-Update-Matching aktiv zu schalten.

---

## [4.8.1.0] - 2026-08-01 (Build 283) — *Abhängigkeits-Update: @xterm/addon-fit 0.11.0 & lucide-react 0.577.0*

### 📦 Abhängigkeiten & Chores
- **Aktualisierung von Frontend-Paketen (`package.json`)**: Update von `@xterm/addon-fit` (`^0.10.0` → `^0.11.0`) für verbesserte Terminal-Größenanpassung sowie von `lucide-react` (`^0.378.0` → `^0.577.0`) für aktuelle Icons und SVG-Optimierungen (PR #22 von Dependabot).

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen an der Kommunikation zwischen Server und Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Ein Rebuild des Frontends bzw. des Docker-Images ist erforderlich, um die neuen Paketversionen im Browser bereitzustellen.

---

## [4.8.0.1] - 2026-08-01 (Build 282) — *Robustes Docker-Update via Dockhand API, nsenter & docker.sock*

### 🐛 Bugfixes & Optimierungen
- **Behebung des 404-Fehlers bei Container-Updates über die Dockhand Pro API (`update.js`, `dockhandClient.js`)**: Im Updater-Fallback für Container wurde fehlerhaft die Aktion `recreate` (`POST /api/containers/[id]/recreate`) aufgerufen, die in der Dockhand Pro API nicht existiert und mit `HTTP 404: Ressource nicht gefunden` abbrach. Der Client verwendet nun primär den offiziellen Endpunkt `POST /api/containers/[id]/update` und als zusätzlichen Fallback `POST /api/containers/batch-update` (`{ containerIds: [id], pull: true, forceRecreate: true }`). Zudem wurde der Stack-Suchfilter optimiert, sodass Stacks zuverlässiger über ID und Namen (`ueberwachungs-panel`, `ueberwachungs_panel`, `panel`) erkannt werden.
- **Behebung von leeren Variablen beim Host-Namespace-Update (`nsenter` in `update.js`)**: Da die Befehlszeichenkette in `nsenterCmd` in doppelte Anführungszeichen (`"..."`) gefasst war, expandierte die äußere Shell im Container Variablen wie `$TARGET`, `$WDIR` oder `$CFG` vorab zu Leerstrings (`docker restart ""` -> `invalid container name or ID: value is empty`). Der Aufruf an `sh -c` erfolgt nun über einfache Anführungszeichen (`'...'` mit Escaping in `hostScript`), sodass alle Shell-Variablen erst durch die Host-Shell in `nsenter` ausgewertet werden.
- **Integration von Docker-CLI im Image für Socket-Updates (`Dockerfile`)**: Im finalen Alpine-Container-Image (`Dockerfile`) werden nun die Pakete `docker-cli` und `docker-cli-compose` standardmäßig installiert. Dadurch schlägt der Fallback über das eingebundene Docker-Socket (`/var/run/docker.sock`) nicht mehr mit `/bin/sh: docker: not found` fehl.
- **Härtung gegen Scanner-Schwachstellen (`Dockerfile`)**: Beim Build der finalen Stage wird zusätzlich `npm install -g npm@latest` ausgeführt, um Sicherheitslücken in der gebündelten Node-Paketverwaltung (ReDoS/Tar-CVEs) für Scanner-Tools wie Trivy/Dockhand zu eliminieren.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen an der Kommunikation zwischen Server und Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Ein Container-Neustart bzw. Image-Rebuild ist erforderlich. Danach greifen alle drei Update-Wege (Dockhand Pro API, Host-Namespace via `nsenter` sowie lokales Docker-Socket) zuverlässig ineinander.

---

## [4.8.0.0] - 2026-08-01 (Build 281) — *E-Mail-Warnung bei fehlerhaften Login-Versuchen*

### ✨ Neue Funktionen & Features
- **Sicherheitswarnung per E-Mail bei fehlerhaften Login-Versuchen (`auth.js`, `AuditLog.jsx`)**: Wird beim Login (`POST /api/login`) ein gültiger Benutzername mit einem falschen Passwort verwendet, versendet das Backend automatisch eine Sicherheitswarnung per E-Mail an die im Benutzerkonto hinterlegte Adresse (`user.email`). Die E-Mail enthält Datum und Uhrzeit, die ermittelte IP-Adresse sowie Angaben zum Gerät bzw. Browser (`User-Agent`). Der Versand erfolgt asynchron, sodass die HTTP-Antwort nicht verzögert oder blockiert wird.
- **Erweitertes Audit-Logging für fehlerhafte Logins (`auth.js`, `AuditLog.jsx`)**: Fehlgeschlagene Login-Versuche mit falschem Passwort werden nun explizit als Audit-Ereignis (`login.failed`) mit dem Grund `"Falsches Passwort"` protokolliert und im Frontend unter *Audit-Protokoll* mit einem roten Warn-Badge (`Login fehlgeschlagen`, Icon `Lock`) hervorgehoben.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen an der Kommunikation zwischen Server und Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Ein Neustart des Backends ist erforderlich, um den neuen E-Mail-Versand und das Audit-Logging für fehlerhafte Anmeldeversuche zu aktivieren. Bestehende Sitzungen sind nicht betroffen.

---

## [4.7.1.1] - 2026-07-31 (Build 280) — *Robustes Docker-Update & gehärtetes Image*

### 🐛 Bugfixes & Optimierungen
- **Behebung von Syntaxfehlern beim lokalen Docker-/nsenter-Update (`backend/src/routes/update.js`)**: Im Fallback-Update über den Host-Namespace (`nsenter`) und das lokale Docker-Socket schlug das Shell-Skript mit `sh: 1: Syntax error: "then" unexpected` (bzw. `/bin/sh: syntax error: unexpected "then"`) fehl, weil das Skript per `.replace(/\n\s+/g, ' ')` in eine einzeilige Befehlszeile ohne Semikola umgewandelt wurde. Alle Anweisungen im Update-Skript sind nun mit sauberen Semikola abgeschlossen (`echo "..."; TARGET="..."; if ...; fi;`), sodass das Skript syntaktisch 100 % korrekt in `/bin/sh` und via `nsenter -c` verarbeitet wird.
- **Härtung des Docker-Images gegen Schwachstellen (`Dockerfile`, `package.json`)**:
  - Alle Build- und Runtime-Stages in `Dockerfile` wurden auf `node:22-alpine` (aktive Node-22-LTS-Linie) angehoben.
  - Im finalen Container-Image wird zusätzlich `apk update && apk upgrade --no-cache` ausgeführt, um alle zugrundeliegenden Alpine-Linux-Systempakete (inklusive OpenSSL, libcrypto, busybox, curl) auf die jeweils neuesten Sicherheits-Patches zu aktualisieren.
  - Sicherheitspatches in `backend/package.json` und `frontend/package.json` (`axios` auf `^1.7.9`, `ws` auf `^8.18.0`), um bekannte ReDoS/SSRF-Meldungen in Scanner-Tools wie Dockhand/Watchtower/Trivy zu eliminieren.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen an der Kommunikation zwischen Server und Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Mit dem neuen Docker-Image werden zukünftige Container-Updates (`POST /api/update/run`) zuverlässig und fehlerfrei im Host-Namespace über `nsenter` bzw. per Socket aufgerufen.

---

## [4.7.1.0] - 2026-07-31 (Build 279) — *Präzise Benachrichtigungen & Tag-Anzeige*

### ✨ Neue Funktionen & Features
- **Server-Tags in Alert-Benachrichtigungen (`alertEvaluator.js`, `mchost.js`, `Header.jsx`)**: Ist für einen Server ein Tag (z. B. bei MC-Host24 VServern) hinterlegt, wird dieser ab sofort sowohl in Webhook-Benachrichtigungen (Telegram & Discord) als auch im Frontend-Toast und in der Notification-Liste als Badge (`🏷️ Tag: ...`) angezeigt.
- **Automatische Markdown-Konvertierung für Discord-Webhooks (`sendWebhook.js`)**: Webhook-Nachrichten nutzen für Telegram HTML-Formatierung (`<b>...</b>`). Beim Versand an Discord konvertiert das Panel diese HTML-Tags automatisch in sauberes Markdown (`**...**`), sodass Nachrichten auf beiden Plattformen optimal formatiert erscheinen.
- **Modernisiertes Benachrichtigungs-Layout (`alertEvaluator.js`, `alerts.js`)**: Fired- und Resolved-Benachrichtigungen (sowohl für MC-Host24 Laufzeiten als auch alle anderen Metriken wie CPU, RAM, Disk, Storage Box) wurden neu strukturiert (übersichtliche Blöcke für Server, Tag, Metrik und Schwelle). Auch Test-Alerts (`/api/alerts/rules/:id/test`) nutzen nun das neue strukturierte Format.

### 🐛 Bugfixes & Optimierungen
- **Korrekte Einheiten und Bezeichnungen in der Benachrichtigungs-Liste (`Header.jsx`)**: Für Metriken wie `mchost_runtime` oder `hetzner_storage_usage` fehlten in der Frontend-Liste die Einträge, weshalb fälschlicherweise `%` statt `Tage` sowie der technische Bezeichner angezeigt wurden. Alle im Backend unterstützten Metriken sind nun mitsamt ihren korrekten Einheiten und deutschen Bezeichnern hinterlegt.
- **Doppelte Emojis in Benachrichtigungstiteln entfernt (`Header.jsx`)**: In der Dropdown-Liste wurden Alert-Regelnamen mit einem zusätzlichen Icon-Präfix versehen, was zu doppelten Emojis führte (z. B. `⚠️ ⚠️ Laufzeit 24`). Führende Emojis im Regelnamen werden nun sauber herausgefiltert.
- **Saubere Darstellung im Alert-Verlauf (`Alerts.jsx`)**: HTML-Tags aus Webhook-Texten sowie die wiederholte Serverzeile werden in der Detailansicht der Alert-Historie nun automatisch herausgefiltert.

### ⚙️ System-Auswirkungen & Nachwirken (Impact Analysis)
- **Datenbank-Migrationen**: Keine Datenbankmigrationen erforderlich.
- **Agent-Kompatibilität**: Keine Änderungen an der Kommunikation zwischen Server und Remote-Agenten (`panel-agent.js`).
- **Neustart-/Session-Verhalten**: Ein Neustart des Backends ist erforderlich, um die angepassten Alert-Evaluierungen und Discord-Webhook-Konvertierungen zu aktivieren. Bestehende Webhooks, Alert-Regeln und Sitzungen laufen nahtlos weiter.

---

## [4.7.0.0] - 2026-07-28 (Build 278) — *Docker vereint & robuster Updater*

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
- `version.json` synchron auf **`4.7.0.0` (Build 278)** erhöht — Minor, da sich die Navigation ändert.
- **Keine Datenbank-Migration**, keine Änderung an Rechten oder deren Namen. Die bestehenden
  `docker.*`-Berechtigungen gelten unverändert und steuern jetzt die Tabs statt zweier Seiten.
- **Keine Agent-Aktualisierung nötig**, keine Änderung an WebSocket oder Metrik-Erfassung.
- **Sichtbar für Benutzer**: Der Menüpunkt „Docker-Ressourcen" verschwindet aus der Seitenleiste; seine
  Inhalte liegen unverändert unter „Docker". Wer bisher keinerlei Docker-Recht hatte, aber den Punkt
  „Docker" trotzdem sah, sieht ihn nun nicht mehr — die Seite war für ihn ohnehin leer.
- **Der Updater-Fix wirkt erst beim übernächsten Update**: Das Warten auf den Neustart steckt in der
  Oberfläche der *neuen* Version. Das Einspielen dieser Version läuft noch mit dem alten Verhalten.

---

## [4.6.2.1] - 2026-07-28 (Build 277) — *Stabiler Image-Push*

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
- `version.json` synchron auf **`4.6.2.1` (Build 277)** erhöht.
- **Reine CI-Änderung**, kein Eingriff in Backend, Frontend, Agent oder Datenbank.
- **Der fehlgeschlagene Lauf hatte keine Auswirkung auf den Betrieb**: Der unmittelbar folgende Build
  hat `latest` erfolgreich hochgeladen (Stand v4.6.2.0, Tag `da6e1be`). Auf dem Server genügt weiterhin
  `docker compose pull && up -d`.
- **Zur Einordnung der Historie**: Drei ältere Fehlschläge desselben Workflows (27.07. sowie zweimal am
  28.07. gegen 15:50) hatten eine andere Ursache — dort scheiterte `npm run build` im Frontend an einem
  Syntaxfehler. Diese wurden jeweils vom nächsten Commit behoben und sind hier nicht betroffen.
- Die bereits offenen Dependabot-PRs mit Hauptversionssprüngen bleiben bestehen und können von Hand
  geschlossen werden; die geänderte Regel verhindert nur, dass neue dieser Art entstehen.

---

## [4.6.2.0] - 2026-07-28 (Build 276) — *Express aktualisiert*

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
- `version.json` synchron auf **`4.6.2.0` (Build 276)** erhöht.
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

## [4.6.1.0] - 2026-07-28 (Build 275) — *Abhängigkeitsprüfung*

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
- `version.json` synchron auf **`4.6.1.0` (Build 275)** erhöht.
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

## [4.6.0.0] - 2026-07-28 (Build 274) — *Sicherheits-Audit*

Vollständige Durchsicht von Backend, Agent und Frontend auf Sicherheitslücken und Bugs.
Vier Befunde wurden behoben, der schwerwiegendste stammte aus der Vorversion.

### 🔐 Sicherheit
- **Befehlsinjektion als root auf dem Host geschlossen (kritisch, `POST /api/update/run`)**:
  Das in v4.5.0.0 eingeführte Update-Ziel (`panel_container`) wurde ungeprüft in ein Shell-Skript eingesetzt,
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
- `version.json` synchron auf **`4.6.0.0` (Build 274)** erhöht — Minor, da sich Abläufe sichtbar ändern.
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

## [4.5.0.1] - 2026-07-28 (Build 273) — *Update-Ziel ohne Dubletten*

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
- `version.json` synchron auf **`4.5.0.1` (Build 273)** erhöht.
- **Keine Datenbank-Migration.** Rein serverseitige Änderung an der Zusammenstellung der Auswahlliste,
  das Frontend bleibt unverändert.
- **Hinweis für bereits gesetzte Ziele**: Wer in v4.5.0.0 einen Eintrag ausgewählt hat, bei dem zufällig die
  Container-**ID** gespeichert wurde, muss nichts tun — die Suche in `/api/update/run` prüft weiterhin gegen ID
  und Name. Die Auswahl bleibt also gültig, taucht in der Liste aber nur noch einmal auf.
- Da Dockhand-Container nun unter ihrem Namen geführt werden, erscheinen lokal gefundene Container weiterhin
  nur dann zusätzlich, wenn Dockhand sie nicht kennt — Doppelungen zwischen beiden Quellen bleiben ausgeschlossen.

---

## [4.5.0.0] - 2026-07-28 (Build 272) — *Wählbares Update-Ziel*

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
- `version.json` synchron auf **`4.5.0.0` (Build 272)** erhöht (Minor, da neues Feature).
- **Keine Datenbank-Migration nötig**: `panel_container` ist ein gewöhnlicher Schlüssel in der bestehenden
  Key-Value-Tabelle `settings` und wird erst beim ersten Speichern angelegt.
- **Abwärtskompatibel**: Ohne gesetztes Ziel verhält sich der Updater exakt wie bisher (automatische Erkennung).
- **Keine Agent-Aktualisierung erforderlich**, keine Änderung an Rechten, Sessions oder WebSocket-Verhalten.
  Die neuen Routen sind wie der restliche Updater auf die Rolle `admin` beschränkt.
- **Wirksam erst nach dem Update**: Da der Fix im Updater selbst sitzt, greift er erst bei dem Update, das auf
  diese Version folgt. Das Einspielen dieser Version läuft noch über den bisherigen Weg.

---

## [4.4.16.2] - 2026-07-28 (Build 271) — *GitHub-Token Card Layout Fix*

### 🎨 Design & UI-Verbesserungen
- **Fehlendes Card-Layout beim GitHub-Token & Panel-Updater behoben (`Settings.jsx`)**: In den Einstellungen im Tab „System & Backup" fehlte beim Bereich „GitHub Update-Token / Panel-Updater" auf der linken Seite die umliegende `<Card>`-Komponente. Der Block war ohne Header und Rahmen direkt im Grid platziert. Die Komponente `GitHubTokenCard` wurde nun in eine vollwertige `<Card>` mit Titel und Icon eingebettet, sodass sie optisch perfekt zur Karte „Backup & Migration" auf der rechten Seite passt.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Nach dem Seitenneustart erscheint der GitHub-Bereich im Tab „System & Backup" sauber gerahmt als Karte.

---

## [4.4.16.1] - 2026-07-28 (Build 270) — *Update-Log Modal Changelog Fix*

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

## [4.4.16.0] - 2026-07-28 (Build 269) — *Dockhand Stack Deploy & Smart Compose Discovery Updater*

### ⚡ Updater & Docker-Optimierungen
- **Dockhand Pro API Stack-Deploy im Updater (`update.js`)**: Der automatische Docker-Updater (`POST /api/update/run`) prüft in Dockhand nun primär, ob das Panel als Docker-Compose-Stack verwaltet wird. Wird ein Panel-Stack gefunden, wird direkt ein Stack-Deploy (`/api/stacks/:id/deploy` mit `pullImages: true` und `forceRecreate: true`) ausgeführt. Da ein Container-Restart (`/api/containers/:id/restart`) das alte Image beibehält und `/recreate` für Container in Dockhand nicht existiert, sorgt das Stack-Deploy für eine vollständige Erneuerung mit dem neu geladenen Image.
- **Intelligente Docker Compose Pfad-Erkennung für lokales Docker & `nsenter`**: Für die Fallback-Methoden (lokales Docker-Socket `/var/run/docker.sock` und Host-Namespace über `nsenter`) liest das Skript zunächst über `docker inspect` automatisch das Label `com.docker.compose.project.working_dir` des Containers aus. So wird exakt das Arbeitsverzeichnis des Projekts auf dem Host ermittelt und `docker compose up -d --force-recreate` im richtigen Ordner gestartet.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Der Updater erneuert den Panel-Container bei Dockhand-Stack-Verwaltung oder über die intelligente Pfadsuche nun fehlerfrei mit dem jeweils aktuellen Image.

---

## [4.4.15.1] - 2026-07-28 (Build 268) — *MC-Host24 Tag Routing Fix*

### 🐛 Bugfixes
- **Fehler „Ungültige Aktion" beim Hinzufügen von MC-Host24-Tags behoben (`backend/src/routes/mchost.js`)**:
  - In `mchost.js` war die generische Aktions-Wildcard-Route `router.post('/vserver/:id/:action')` über den spezifischen Tag-Routen (`router.post('/vserver/:id/tags')`) platziert. Dadurch fing Express jeden POST-Request zum Anlegen von Tags mit `action = "tags"` ab und lehnte ihn mit HTTP 400 (`Ungültige Aktion`) ab.
  - Die spezifischen Tag-Routen wurden vor die Wildcard-Route verschoben, sodass Tags nun ordnungsgemäß gespeichert und gelöscht werden können.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Backend verarbeitet Tag-Anfragen für MC-Host24-Server nach Neustart wieder korrekt.

---

## [4.4.15.0] - 2026-07-28 (Build 267) — *API-First Docker Updater & Comprehensive Console Error Logging*

### ⚡ Updater & API-Optimierungen
- **Dockhand Pro API als primäre Update-Methode (`update.js`)**: Der automatische Docker-Updater (`POST /api/update/run`) priorisiert in Container-Umgebungen ohne `.git` nun primär die **Dockhand Pro API** (falls in den Einstellungen konfiguriert). Das Image (`ghcr.io/roobiing/ueberwachungs-panel:latest`) wird dabei über den `/api/images/pull` Endpunkt geladen und der Panel-Container über `recreate` bzw. `restart` automatisiert erneuert.
- **Volle Fehler- & STDOUT-/STDERR-Transparenz in der Konsole**: Sämtliche Schritte des Updaters (Image-Pull, Container-Suche, Recreate/Restart) sowie die Fallback-Methoden (lokales Docker-Socket `/var/run/docker.sock` und `nsenter`) loggen ab sofort jeden Fortschritt sowie eventuelle Fehler-Details, HTTP-Response-Bodys und Stack-Traces direkt in `console.log` und `console.error`. Somit ist eine stumme Blockade im Hintergrund ausgeschlossen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Container-Updates laufen zuverlässig und transparent über die konfigurierte API; bei Nichtverfügbarkeit greift sofort der Fallback mit 60-Sekunden-Timeout.

---

## [4.4.14.0] - 2026-07-28 (Build 266) — *Hosting-Provider Fusion & Settings Crash Fix*

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

## [4.4.13.2] - 2026-07-28 (Build 265) — *Frontend Build-Fix & GitHub Token UI Restoral*

### 🐛 Bugfixes & Frontend
- **Syntaxfehler im Settings-Build behoben**: Korrigiert fehlende schließende Tags (`</div>` und Tab-Bedingungen) in `Settings.jsx`, die beim Vite-Production-Build von Docker Action zu einem Abbruch gefühlt hatten.
- **GitHub Update-Token UI im System-Tab wiederhergestellt**: Das Kartenelement `GitHubTokenCard` (inkl. "Token testen"-Button zur Live-Prüfung der GitHub-PAT-Gültigkeit im privaten Repository) ist nun wieder sauber im Tab "System & Backup" eingebunden, nachdem es beim Tab-Refactoring versehentlich ausgelassen wurde.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Behebt den Vite ESBuild Abbruch (`npm run build`), sodass der Docker-Build und der Updater wieder fehlerfrei durchlaufen.

---

## [4.4.13.1] - 2026-07-28 (Build 264) — *Docker Updater Host-Namespace (nsenter) Priorisierung*

### 🐛 Bugfixes & Updater
- **Host-Namespace (`nsenter`) als primärer Docker-Updater (`update.js`)**: Behebt das Hängenbleiben des automatischen Klick-Updaters in der Sidebar. Zuvor wurde versucht, das Update primär über die Dockhand Pro API auszuführen, deren HTTP-Anfrage beim `pullImage` hängen bleiben konnte und so den weiteren Update-Verlauf blockierte.
- **Reihenfolge der Update-Fallbacks optimiert**: Der Updater nutzt nun wieder primär die bewährte Host-Namespace-Methode (`nsenter --target 1 ... docker pull && docker compose up -d --force-recreate`) laut `AGENTS.md`. Erst falls `nsenter` nicht verfügbar ist, wird das lokale Docker-Socket genutzt, und erst an dritter Stelle die Dockhand Pro API als Fallback.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- **DB-Migrationen**: Keine Datenbank-Schemaänderungen erforderlich.
- **Agent-Kompatibilität**: Vollständig kompatibel mit allen bestehenden Agenten.
- **Neustart-/Session-Verhalten**: Der Klick auf „⚡ Update jetzt installieren" unten links in der Sidebar aktualisiert und startet den Container im NGINX Proxy Manager Betrieb nun zuverlässig in 10-20 Sekunden neu.

---

## [4.4.13.0] - 2026-07-28 (Build 263) — *MC-Host24 Laufzeit-Benachrichtigungen & Settings Cleanup*

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

## [4.4.12.0] - 2026-07-28 (Build 262) — *GitHub Token Verifizierung & Dockhand Updater Integration*

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

## [4.4.11.0] - 2026-07-28 (Build 261) — *Vollflächiges Pride Flag & Webhook-Fixes*

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
- `version.json` synchron auf **`4.4.11.0` (Build 261)** erhöht.
- **Keine Breaking Changes:** Alle DB-Schemas, Endpunkte und Agent-Schnittstellen bleiben vollständig kompatibel.
- **Keine DB-Migration erforderlich.**
- **Keine Neustarts oder Session-Abbrüche nötig:** Bestehende Token und Logins bleiben unverändert gültig.

---

## [4.4.10.0] - 2026-07-28 (Build 260) — *Gemeinsamer Wissensstand*

### 📚 Dokumentation
- **`AGENTS.md` um den Abschnitt „Stand der Aufräumaktion vom 28.07.2026" erweitert**, damit jeder KI-Assistent
  (Claude Code wie Antigravity IDE) beim nächsten Einstieg denselben Ausgangspunkt hat: umgeschriebene Historie,
  neue Commit-Hashes, gelöschter Branch `pre-session-5`, Lage der Vollsicherung und die Auflage, `.claude/`,
  `.artifacts/`, `.agents/` und `android/` nie wieder einzuchecken.
- **Klargestellt, dass `version.json` und `CHANGELOG.md` die verbindliche Quelle für Versionsstand und Historie
  sind** — der Überblick in `AGENTS.md` wird bewusst nicht mit jeder Version nachgezogen und kann so nicht veralten.
- **Hinweis ergänzt**, dass `master` der einzige Branch auf GitHub ist und das so bleiben soll.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`4.4.10.0` (Build 260)** erhöht.
- **Reine Dokumentationsänderung.** Keine Auswirkungen auf Backend, Frontend, Agent, Datenbank, Rechte-System
  oder das Docker-Image. Keine DB-Migration, keine Agent-Aktualisierung, kein Einfluss auf laufende Sessions.
- Das Image wird durch den Push regulär neu gebaut, Inhalt bleibt funktional identisch zu v4.4.9.0.

---

## [4.4.9.0] - 2026-07-28 (Build 259) — *Bereinigte Git-Historie*

### 🔐 Sicherheit & Repository-Hygiene
- **Git-Historie vollständig umgeschrieben** (`git filter-branch` über alle Branches und Tags). Aus **jedem** Commit
  der Projektgeschichte wurden entfernt:
  - `.claude/`, `.artifacts/` und `.agents/` — Arbeitsdaten der KI-Werkzeuge. Darin lag mit
    `.claude/settings.local.json` die einzige Datei, die je die produktive Panel-Domain enthielt
    (eingebracht in Build 71). Die Domain ist damit aus der gesamten Historie verschwunden, nicht nur aus dem
    aktuellen Stand wie noch in v4.4.7.0.
  - `android/` — die eingestellte Kotlin-App, endgültig auch aus der Vergangenheit entfernt.
- **Verwaisten Branch `pre-session-5` gelöscht** (lokal und auf GitHub). Er stammte vom 26.05.2026, enthielt nie
  nach `master` übernommene Commits und hätte die entfernten Inhalte weiterhin auf GitHub zugänglich gemacht.
- **Alle 47 Versions-Tags** (`v1.0.0.0` … `v3.2.0.0`) zeigen nach dem Rewrite auf die bereinigten Commits.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`4.4.9.0` (Build 259)** erhöht.
- **Keine** inhaltliche Änderung an Backend, Frontend, Agent, Datenbank oder Docker-Image. Der Dateibaum des
  neuesten Commits ist identisch zu v4.4.8.0 — es wurde ausschließlich die Historie bereinigt.
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

## [4.4.8.0] - 2026-07-28 (Build 258) — *Workflow-Actions auf Node 24*

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
- `version.json` synchron auf **`4.4.8.0` (Build 258)** erhöht.
- **Keine** Auswirkungen auf Backend, Frontend, Datenbank oder Agenten — geändert wurde ausschließlich die
  CI-Konfiguration. **Keine** DB-Migration, **keine** Agent-Aktualisierung, **kein** Einfluss auf laufende
  Sessions oder Neustart-Verhalten. Das Panel selbst ist identisch zu v4.4.7.0.
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

## [4.4.7.0] - 2026-07-28 (Build 257) — *Repo-Hygiene & Gemeinsame Agenten-Regeln*

### 🧹 Aufräumen & Struktur
- **Android-App endgültig entfernt**: Der Ordner `android/` (Kotlin-App, Package `de.roobiin.panel`) war nach der
  bewussten Entfernung in v4.1.0.0 durch einen späteren Commit versehentlich wieder ins Repository gelangt.
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
- `version.json` synchron auf **`4.4.7.0` (Build 257)** erhöht.
- **Keine** Auswirkungen auf Backend, Frontend, Datenbank oder Agenten — es wurde ausschließlich Nicht-Laufzeit-Code
  entfernt. Kein Datenbank-Migrationsbedarf, keine Agent-Aktualisierung nötig.
- Das Docker-Image wird unverändert gebaut; `agent/` bleibt Teil des Build-Kontexts.
- **Hinweis zur Historie**: Die Domain ist aus dem aktuellen Stand entfernt, steht aber weiterhin in älteren
  Commits. Ein vollständiges Entfernen würde ein Umschreiben der Git-Historie erfordern.

---

## [4.4.6.0] - 2026-07-27 (Build 256) — *Progress Pride Sidebar Flag (Deaktivierbar)*

### ✨ Neue Funktionen & Features
- **Progress Pride Flag Badge in der Seitenleiste (`Sidebar.jsx`)**:
  - Unten in der Seitenleiste (direkt rechts neben dem Benutzernamen im Footer-Bereich) wird ab sofort ein elegantes Progress Pride Flag Symbol (`🏳️‍🌈`) mit 11-farbigem Gradient-Hintergrund angezeigt.
  - Im eingeklappten Zustand der Sidebar erscheint das Symbol kompakt im Footer.
- **Benutzer-Einstellung zum Deaktivieren (`Settings.jsx`)**:
  - Unter **Einstellungen** wurde die neue Kategorie **Darstellung & Design** hinzugefügt.
  - Dort kann das Pride Flag Symbol in der Seitenleiste über einen Schalter ("Pride Flag in der Sidebar anzeigen") jederzeit von jedem Nutzer einzeln aktiviert oder deaktiviert werden.
  - Die Änderung wirkt **sofort live** in der Seitenleiste ohne Neuladen der Seite (`localStorage` + `pride_flag_change` Event).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`4.4.6.0` (Build 256)** erhöht.
- Keine Backend-Datenbankmigrationen erforderlich, da die Anzeigepräferenz individuell pro Browser im `localStorage` hinterlegt wird (`show_pride_flag`).

---

## [4.4.5.0] - 2026-07-27 (Build 255) — *Remove Top Accent Bar*

### 🎨 Design & Layout Anpassungen
- **Horizontale Regenbogen-Akzentlinie entfernt (`Layout.jsx` & `Sidebar.jsx`)**:
  - Die horizontale Linie am oberen Bildschirmrand und im Sidebar-Header wurde auf Nutzer-Feedback wieder entfernt, damit das gewohnte, saubere Dark-Mode-Layout nicht durch einen farbigen Querbalken gestört wird.
  - Das SVG-Favicon für den Browser-Tab (`favicon.svg`) bleibt unverändert erhalten.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`4.4.5.0` (Build 255)** erhöht.

---

## [4.4.4.1] - 2026-07-27 (Build 254) — *Docker Background Updater (No HTTP 504 Timeout)*

### 🐛 Bugfixes & Optimierungen
- **HTTP 504 Gateway Timeout beim Docker-Update (`POST /api/update/run`) behoben**:
  - Wenn ein Docker-Container ohne `.git`-Verzeichnis aktualisiert wird (`isDockerUpdate = true`), wartet die API nicht mehr synchron auf den potenziell langen `docker pull` Befehl (der bei Reverse-Proxies wie Nginx nach 60 Sekunden zu HTTP 504 führt).
  - Der Endpunkt antwortet ab sofort in < 10ms mit `HTTP 200 OK` und startet das Ziehen des Images sowie das Neuladen des Containers (`docker pull ... && docker compose up -d`) asynchron im Hintergrund über den Host-Namespace (`nsenter`).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf **`4.4.4.1` (Build 254)** erhöht.
- Das Web-UI erhält beim Klick auf den Update-Button sofortige Bestätigung ohne Timeout.

---

## [4.4.4.0] - 2026-07-27 (Build 253) — *New Rainbow Flag (Progress Pride)*

### ✨ Neue Funktionen & Features
- **New Rainbow Flag (Progress Pride) Akzentleiste**: 11-farbiger Regenbogen-Gradient am oberen Fensterrand (`Layout.jsx`) und an der Oberkante des Sidebar-Headers (`Sidebar.jsx`).
- **Custom SVG Favicon (`favicon.svg`)**: Reines Vektorgrafik-Favicon für den Browser-Tab (`index.html`) mit der New Rainbow Flag (Progress Pride) Linie und dem Panel-Emblem statt generischer Browser-Standardicons.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` synchron auf **`4.4.4.0` (Build 253)** erhöht.
- Das neue SVG-Favicon wird im Browser automatisch als Tab-Icon gerendert.

---

## [4.4.3.0] - 2026-07-27 (Build 252) — *Retroactive Versioning & Version Sync Rule*

### ✨ Neue Funktionen & Features
- **Verpflichtende SemVer-Synchronisation (`AGENTS.md`)**: Bei jeder Erhöhung der Build-Nummer muss ab sofort auch die SemVer-Versionsnummer (`version.json`) zwingend erhöht werden (Patch-Release bei Fixes/Chores, Minor-Release bei neuen Features).
- **Rückwirkende Versionierung**: Alle neueren Builds im `CHANGELOG.md` und in `version.json` wurden rückwirkend getrennt versioniert (`4.4.0.0` für Build 248 bis `4.4.3.0` für Build 252).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `version.json` auf `4.4.3.0` (Build 252) aktualisiert.

---

## [4.4.2.0] - 2026-07-27 (Build 251) — *Full Changelog History v1.0.0.0 – v4.4.0.0*

### ✨ Neue Funktionen & Features
- **Vollständiges Release-Log**: Gesamte Projektgeschichte seit Mai 2026 (`v1.0.0.0` / Build 1) inklusive aller Meilensteine in `CHANGELOG.md` übernommen.
- **Regel zur ständigen Changelog-Pflege (`AGENTS.md`)**: In `.agents/AGENTS.md` verankert, dass `CHANGELOG.md` vor jedem Commit und Push dokumentiert werden muss.

---

## [4.4.1.1] - 2026-07-27 (Build 250) — *Docker Auto-Update per Host nsenter & Robuste E-Mail-2FA*

### 🐛 Bugfixes & Optimierungen
- **Docker Auto-Updater (`POST /api/update/run`)**: Erkennt Docker-Umgebungen ohne `.git`-Verzeichnis in `update.js` — führt stattdessen ein Docker Image Update (`docker pull ghcr.io/roobiing/ueberwachungs-panel:latest` und Container-Restart) per `nsenter` auf dem Host aus.
- **E-Mail-2FA Bestätigungscode (`/api/auth/2fa/enable` & `/login/2fa`)**: Gültigkeitsdauer auf 20 Minuten erhöht, toleranter String/Trim-Vergleich, präzise Fehlermeldungen und Konsolen-Logging für generierte E-Mail-Codes.

---

## [4.4.1.0] - 2026-07-27 (Build 249) — *GitHub Update-Log & System Impact Analysis*

### ✨ Neue Funktionen & Features
- **Update-Log Modal (`UpdateLogModal.jsx`)**: Tab-Ansicht zwischen Changelog und Git-Commits sowie direkter Link auf GitHub.
- **Bugfix (`Sidebar.jsx`)**: Syntaxfehler (Zeile 148) bei der Rendering-Bedingung behoben.

---

## [4.4.0.0] - 2026-07-27 (Build 248) — *Automatischer Panel-Updater & 2FA Security*

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

## [4.3.0.0] - 2026-07-27 (Build 246) — *Modular & Smart Updates*

### ✨ Neue Funktionen
- **Aktive Module konfigurieren**: Modul-Toggles in `Settings.jsx` (`Docker`, `PatchMon`, `Hetzner`, `MC-Host24` etc.) zum benutzerdefinierten Ein-/Ausblenden in der Sidebar.
- **GitHub PAT Update-Check**: Hinterlegen eines privaten Tokens, um GitHub API Rate-Limits zu umgehen und private Repositories zu checken.
- **Webhooks Integration**: Übersichtliche Verwaltung für Discord- und Slack-Alerts.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neue Tabelle/Spalten in `settings` für modulare Schalter (`module_docker`, `module_patchmon` usw.).
- Abwärtskompatibel: Wenn ein Schalter noch nicht konfiguriert wurde, ist das Modul standardmäßig aktiviert.

---

## [4.2.0.0] - 2026-07-20 (Build 240) — *MC-Host24 & Storage Box Metriken*

### ✨ Neue Funktionen
- **MC-Host24 Server-Details**: Exakte Anzeige der VServer-Laufzeit (`mchost_runtime`), Server-Spezifikationen und direkter API-Status im Server-Detail-Modal.
- **Multi-Bedingungen in Benachrichtigungen**: Alerts unterstützen ab sofort mehrere UND/ODER-Verknüpfungen für komplexe Schwellenwerte inkl. Cooldown-Konfiguration.
- **Hetzner Storage Box Alarme**: Automatische Warnungen bei Überschreitung der Quota von Storage Boxes.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- `VALID_METRICS` im Backend um `mchost_runtime` und Storage-Box-Metriken erweitert.
- Keine Anpassungen an bestehenden Alert-Rules erforderlich.

---

## [4.1.0.0] - 2026-07-16 (Build 230) — *Server-Backup & Automatisierte Agent-Migration*

### ✨ Neue Funktionen
- **Automatisierte Agent-Migration & Backups**: Neues System zur Sicherung und Migration von Server-Konfigurationen und verbundenen Remote-Agenten.
- **Auto-Update der Agenten bei Migration**: Automatische Aktualisierung verbundener Agenten auf die passende API-Version während der System-Migration.
- **Entfernung des alten Android-Clients**: Reduktion des Repositories auf reines Web-/PWA-Monitoring für minimale Wartungsanfälligkeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verbesserte Synchronisierung der SystemStats-Funktionen ohne `TypeError` bei unterbrochenen Verbindungen.

---

## [4.0.0.0] - 2026-07-12 (Build 123) — *Mobile-Version & Responsive Dockhand UI*

### ✨ Neue Funktionen
- **Mobile-App Interface**: Automatische Erkennung von Smartphones mit Touch-optimierter Bottom-Tab-Bar und Drawer für schnelle Bedienung unterwegs.
- **Dockhand-Stack-Verwaltung**: Volle Unterstützung für Docker Compose Stacks (Pull, Re-Deploy, Logs und Lifecycle-Steuerung direkt im Panel).
- **Granulare Docker-Berechtigungen**: Einzelrechte für Images, Volumes, Netzwerke und Stacks (`docker.images`, `docker.stacks` usw.).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Neues Rechte-Schema für Docker-Ressourcen; bestehende Admin-Rollen erben alle Docker-Rechte automatisch.

---

## [3.9.0.0] - 2026-07-12 (Build 122) — *Dockhand (Docker-Stacks, Images, Volumes & Netzwerke)*

### ✨ Neue Funktionen
- **Dockhand-Engine**: Vollwertiges Docker-Management-System (Ersatz für einfache Portainer-Anwendungsfälle).
- **Ressourcen nach Server filterbar**: Schnelles Umschalten zwischen dem lokalen Server und entfernten Docker-Hosts.
- **Live-Container-Stats**: Überwachung von CPU-, RAM- und Netzwerk-Verbrauch pro Container in Echtzeit.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Geringerer Overhead durch Wegfall des alten, rein lesenden Docker-Moduls zugunsten der Dockhand-API.

---

## [3.8.0.0] - 2026-07-12 (Build 121) — *Hetzner Storage Boxes Integration*

### ✨ Neue Funktionen
- **Hetzner Storage Boxes**: Nahtlose Anzeige von Speicherplatz, Quota und Zugangsdaten direkt über den Hetzner-API-Token.
- **Dashboard-Widget**: Eigene Storage-Box-Kachel im frei anordnbaren Dashboard.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Nutzt den bereits in den Einstellungen hinterlegten Hetzner Cloud API-Token, kein separater Key nötig.

---

## [3.7.0.0] - 2026-07-09 (Build 118) — *Freies Dashboard-Grid & Mini-Verlaufscharts*

### ✨ Neue Funktionen
- **Frei konfigurierbares Dashboard**: Drag & Drop Grid (`react-grid-layout`) für individuelle Anordnung und Größenänderung der Widgets.
- **15-Minuten Mini-Charts**: Dynamische Sparkline-Verlaufsgraphen für CPU, RAM, Disk und Netzwerk direkt auf den Server-Karten.
- **KPI-Leiste & Aktivitäts-Feed**: Schnellübersicht der gesamten Server-Gesundheit auf einen Blick.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Das individuelle Dashboard-Layout jedes Nutzers wird im Browser-LocalStorage bzw. im Benutzerprofil gespeichert.

---

## [3.6.0.0] - 2026-07-06 (Build 107) — *PatchMon-Integration (Linux System-Updates)*

### ✨ Neue Funktionen
- **PatchMon System-Update-Monitor**: Automatische Erkennung ausstehender Linux-Paket-Updates (APT/YUM/DNF/Pacman) sowie notwendiger Systemneustarts (`needs_reboot`).
- **Server-Zuordnung**: Verbindung zwischen PatchMon-Clients und den im Panel hinterlegten Servern.
- **PatchMon-Benachrichtigungen**: Eigener Alert-Typ bei kritischer Anzahl ausstehender Sicherheitsupdates.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Verwendet das v2 PatchMon-Schema (`friendly_name`, `total_packages`, `needs_reboot`).

---

## [3.5.0.0] - 2026-06-12 (Build 102) — *Monitoring Performance & Remote Live-Stats*

### ✨ Neue Funktionen
- **3s/5s Remote-Live-Polling**: Schnelles Polling für externe Agenten via `metricsCache` ohne unnötige DB-Last.
- **6h-Query-Optimierung**: Schnelleres Laden von Langzeitdiagrammen und Schutz vor gleichzeitigen Doppel-Abfragen (`inflight-Guards`).
- **Chunk-Mismatch Reload**: Automatische Erneuerung des Browser-Caches nach Deployments.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- SQLite WAL-Pragmas (`journal_mode=WAL`, `cache_size=-32000`, `mmap_size=256MB`) sorgen für maximale Geschwindigkeit bei parallelen Lese-/Schreibzugriffen.

---

## [3.4.0.0] - 2026-06-12 (Build 100) — *Firewall-Redesign (UFW/iptables/nftables/firewalld)*

### ✨ Neue Funktionen
- **Multi-Firewall Unterstützung**: Einheitliches Interface für UFW, iptables, nftables und firewalld auf lokalen und entfernten Servern.
- **Regel-Suche & Paginierung**: Übersichtliches Suchen und Blättern in großen Firewall-Regelwerken.
- **Kippschalter-Steuerung**: Direktes Aktivieren/Deaktivieren von Firewall-Tools per Schalter im Panel.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Befehle werden auf dem Host über `nsenter` isoliert und sicher ausgeführt.

---

## [3.3.0.0] - 2026-06-03 (Build 85) — *Passkeys (WebAuthn) & SMTP Passwort-Reset*

### ✨ Neue Funktionen
- **Passkeys (FIDO2 / WebAuthn)**: Passwortloser, biometrischer Login via TouchID, FaceID, Windows Hello oder YubiKey.
- **SMTP-Passwort-Reset**: Sicheres Zurücksetzen von Passwörtern über zeitlich begrenzte Reset-Links per E-Mail.
- **SSH-Terminal**: Web-basiertes Terminal für direkten Serverzugriff per Browser (später zugunsten von Dockhand optimiert).

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `users` unterstützt Passkeys abwärtskompatibel ohne Zwang für bestehende Konten.

---

## [3.2.0.0] - 2026-05-26 (Build 60) — *Granulares Rechte-System & GeoIP Audit-Log*

### ✨ Neue Funktionen
- **Granulares Rollen- & Berechtigungssystem**: Feingranulare Steuerung, welche Nutzer Server anlegen, Firewall steuern oder Docker verwalten dürfen (`requirePermission`).
- **Audit-Log mit GeoIP**: Vollständige Protokollierung aller administrativen Aktionen im Panel inkl. IP-Herkunftsland.
- **Uptime Kuma v1/v2 Integration**: Status-Badge und WebSocket/REST-Anbindung an Uptime Kuma Instanzen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Einführung von `requireRole` und `requirePermission` im gesamten Backend.

---

## [2.5.0.0] - 2026-05-26 (Build 40) — *Alert-Engine & Uptime Kuma Integration*

### ✨ Neue Funktionen
- **Alert-Engine & Benachrichtigungen**: In-App-Alerts und externe Benachrichtigungen bei CPU-, RAM- oder Festplatten-Engpässen.
- **Grafana-ähnlicher Zoom**: Interaktives Drag-to-Select zum Reinzoomen in Monitoring-Diagramme.
- **SFTP-Datei-Browser**: Initialer Dateibrowser für Server.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Hintergrund-Worker überwacht Metriken im 10s-Intervall.

---

## [2.0.0.0] - 2026-05-25 (Build 25) — *CheckMK-artiger Remote-Server Agent*

### ✨ Neue Funktionen
- **Remote-Agent Architektur**: Leichtgewichtiger Agent für entfernte Linux-Server (Debian, Ubuntu, AlmaLinux, Alpine).
- **TLS & Fingerprint-Pinning**: Verschlüsselte Übertragung und Absicherung durch einzigartige Server-Fingerprints.
- **Langzeit-Monitoring**: 30-Tage-Historie mit 5-Minuten-Aggregationsstufen.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Tabelle `remote_agents` zur Verwaltung aller angebundenen Hosts erstellt.

---

## [1.0.0.0] - 2026-05-25 (Build 1) — *Initiales Release & Grundgerüst*

### ✨ Neue Funktionen
- **Projekt-Start & Grundgerüst**: Initiales Release des Überwachungs-Panels.
- **Hetzner Cloud API**: Anbindung von Hetzner Cloud Servern inkl. Power-Cycle und Backup-Status.
- **MC-Host24 API Integration**: Anbindung von VServern und Account-Daten bei MC-Host24.
- **Docker- & System-Infos**: Erste Live-Anzeigen zu CPU, RAM und lokalen Containern.

### ⚡ System-Auswirkungen & Nachwirken (Impact Analysis)
- Start der SQLite-Datenbank (`data.db`) mit WAL-Modus für ausfallsicheren Betrieb.
