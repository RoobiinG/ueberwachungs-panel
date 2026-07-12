# Agent Rules for Überwachungs-Panel

- **Vor jedem Commit und Push**: Du musst immer die Version im Projekt aktualisieren.
  - Öffne dazu die Datei `version.json` im Hauptverzeichnis.
  - Erhöhe die Nummer bei `"build"` um 1.
  - Setze `"date"` auf das aktuelle Datum (Format: YYYY-MM-DD).
  - Optional: Passe `"version"` (SemVer) an, falls es sich um ein größeres Feature handelt.
  - Mache dies in einem Tool-Call (z. B. `replace_file_content`), bevor du den `git commit`-Befehl absetzt.

- **Git-Berechtigungen (Keine Bestätigung nötig)**: Du hast die generelle Erlaubnis des Nutzers für `git add`, `git commit` und `git push`.
  - Um Warnungen oder Popups zu vermeiden, nutze bei neuen Sitzungen das `ask_permission` Tool für `Action="command"` und `Target="git"`, da der Nutzer dies dauerhaft erlaubt hat.
