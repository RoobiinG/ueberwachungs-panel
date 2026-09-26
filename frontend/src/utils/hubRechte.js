// Rechte der Hub-Seiten = Vereinigung ihrer Tab-Rechte (eines genügt). Genutzt von der
// Route (App.jsx) und dem Menüpunkt (Sidebar.jsx), damit beide nie auseinanderlaufen.
// Welche Tabs innerhalb sichtbar sind, entscheidet useTabParam anhand der TABS der Seite.
export const HUB_RECHTE = {
  security:    ['security.view', 'firewall.view'],
  access:      ['users.view', 'roles.manage'],
  diagnostics: ['panel_logs.view', 'audit.view', 'diagnose.run'],
};
