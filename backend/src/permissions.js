/**
 * Alle verfügbaren Berechtigungen, nach Kategorie geordnet.
 * Neue Berechtigungen hier eintragen — sie erscheinen automatisch in der UI.
 */
const PERMISSIONS = [
  // ─── Dashboard ────────────────────────────────────────────────────────────
  { key: 'dashboard.view',      category: 'Dashboard',          label: 'Dashboard anzeigen',              description: 'Hauptübersicht mit Metriken und Charts' },

  // ─── Remote-Server (Agents) ───────────────────────────────────────────────
  { key: 'agents.view',         category: 'Remote-Server',      label: 'Server anzeigen',                 description: 'Liste der Remote-Server einsehen' },
  { key: 'agents.add',          category: 'Remote-Server',      label: 'Server hinzufügen',               description: 'Neue Remote-Server registrieren' },
  { key: 'agents.edit',         category: 'Remote-Server',      label: 'Server bearbeiten',               description: 'URL, Name und Token ändern' },
  { key: 'agents.delete',       category: 'Remote-Server',      label: 'Server löschen',                  description: 'Remote-Server entfernen' },
  { key: 'agents.update',       category: 'Remote-Server',      label: 'Agent aktualisieren',             description: 'Agent-Software auf Servern aktualisieren' },

  // ─── Docker ───────────────────────────────────────────────────────────────
  { key: 'docker.view',         category: 'Docker',             label: 'Container anzeigen',              description: 'Container-Liste und Stats einsehen' },
  { key: 'docker.control',      category: 'Docker',             label: 'Container steuern',               description: 'Container starten, stoppen, neustarten, pausieren' },

  // ─── Systemd-Services ────────────────────────────────────────────────────
  { key: 'services.view',       category: 'Systemd-Services',   label: 'Services anzeigen',               description: 'Systemd-Services einsehen' },
  { key: 'services.control',    category: 'Systemd-Services',   label: 'Services steuern',                description: 'Services starten, stoppen, neustarten' },

  // ─── Firewall ─────────────────────────────────────────────────────────────
  { key: 'firewall.view',       category: 'Firewall',           label: 'Regeln anzeigen',                 description: 'Firewall-Regeln einsehen' },
  { key: 'firewall.manage',     category: 'Firewall',           label: 'Regeln verwalten',                description: 'Firewall-Regeln hinzufügen und löschen' },

  // ─── Webhooks ────────────────────────────────────────────────────────────
  { key: 'webhooks.view',       category: 'Webhooks',           label: 'Webhooks anzeigen',               description: 'Webhook-Liste einsehen' },
  { key: 'webhooks.manage',     category: 'Webhooks',           label: 'Webhooks verwalten',              description: 'Webhooks anlegen, bearbeiten, löschen' },
  { key: 'webhooks.test',       category: 'Webhooks',           label: 'Webhooks testen',                 description: 'Test-Nachricht an Webhook senden' },

  // ─── Alerts ───────────────────────────────────────────────────────────────
  { key: 'alerts.view',         category: 'Alerts',             label: 'Alerts anzeigen',                 description: 'Alert-Regeln und History einsehen' },
  { key: 'alerts.manage',       category: 'Alerts',             label: 'Alerts verwalten',                description: 'Alert-Regeln anlegen, bearbeiten, löschen' },

  // ─── SSH ──────────────────────────────────────────────────────────────────
  { key: 'ssh.view',            category: 'SSH',                label: 'SSH-Hosts anzeigen',              description: 'Gespeicherte SSH-Verbindungen einsehen' },
  { key: 'ssh.connect',         category: 'SSH',                label: 'SSH verbinden',                   description: 'SSH-Terminal-Sitzungen starten' },
  { key: 'ssh.manage',          category: 'SSH',                label: 'Hosts & Keys verwalten',          description: 'SSH-Hosts und Keys anlegen und löschen' },

  // ─── Monitoring ───────────────────────────────────────────────────────────
  { key: 'metrics.view',        category: 'Monitoring',         label: 'Metriken anzeigen',               description: 'System-Metriken, Charts und Zeitreihen abrufen' },

  // ─── Benutzerverwaltung ───────────────────────────────────────────────────
  { key: 'users.view',          category: 'Benutzerverwaltung', label: 'Benutzer anzeigen',               description: 'Benutzerliste einsehen' },
  { key: 'users.manage',        category: 'Benutzerverwaltung', label: 'Benutzer verwalten',              description: 'Benutzer erstellen, bearbeiten, löschen' },
  { key: 'roles.manage',        category: 'Benutzerverwaltung', label: 'Rollen verwalten',                description: 'Rollen und Berechtigungen konfigurieren' },

  // ─── Einstellungen ────────────────────────────────────────────────────────
  { key: 'settings.view',       category: 'Einstellungen',      label: 'Einstellungen anzeigen',          description: 'System-Einstellungen einsehen' },
  { key: 'settings.manage',     category: 'Einstellungen',      label: 'Einstellungen ändern',            description: 'SMTP, Integrationen und Systemparameter konfigurieren' },
];

const ALL_KEYS = PERMISSIONS.map(p => p.key);

// ─── Standard-Berechtigungen für vordefinierte Rollen ────────────────────────

const OPERATOR_PERMISSIONS = [
  'dashboard.view',
  'agents.view', 'agents.add', 'agents.edit', 'agents.update',
  'docker.view', 'docker.control',
  'services.view', 'services.control',
  'firewall.view',
  'webhooks.view', 'webhooks.test',
  'alerts.view',
  'ssh.view', 'ssh.connect', 'ssh.manage',
  'metrics.view',
  'users.view',
  'settings.view',
];

const GUEST_PERMISSIONS = [
  'dashboard.view',
  'agents.view',
  'docker.view',
  'services.view',
  'firewall.view',
  'webhooks.view',
  'alerts.view',
  'metrics.view',
];

module.exports = { PERMISSIONS, ALL_KEYS, OPERATOR_PERMISSIONS, GUEST_PERMISSIONS };
