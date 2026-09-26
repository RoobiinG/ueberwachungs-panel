import { ShieldOff } from 'lucide-react';

/**
 * Gemeinsamer Rahmen der Hub-Seiten (Security Center, Identität & Zugriff, Logs & Diagnose):
 * Kopfzeile mit Titel, optionalem Zusatz (z. B. Server-Auswahl) und Tab-Leiste.
 * Die Tabs kommen bereits nach Rechten gefiltert aus useTabParam.
 */
export function HubLayout({ icon: Icon, title, subtitle, tabs, active, onTabChange, extra, children }) {
  return (
    <div className="space-y-4">
      <div className="bg-panel-surface border border-panel-border rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-panel-text flex items-center gap-2">
              {Icon && <Icon size={18} className="text-panel-accent shrink-0" />}
              {title}
            </h1>
            {subtitle && <p className="text-xs text-panel-muted mt-0.5">{subtitle}</p>}
          </div>
          {extra && <div className="shrink-0">{extra}</div>}
        </div>

        {tabs.length > 0 && (
          <div role="tablist" className="flex gap-1 bg-panel-card border border-panel-border rounded-lg p-1 w-fit max-w-full overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.key}
                role="tab"
                aria-selected={active === t.key}
                onClick={() => onTabChange(t.key)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap ${
                  active === t.key
                    ? 'bg-panel-accent/15 text-panel-accent border border-panel-accent/30 font-semibold shadow-sm'
                    : 'text-panel-muted hover:text-panel-text border border-transparent'
                }`}
              >
                {t.icon && <t.icon size={14} />}
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tabs.length === 0 ? <NoAccess what={title} /> : <div role="tabpanel">{children}</div>}
    </div>
  );
}

export function NoAccess({ what }) {
  return (
    <div className="flex items-center gap-2 bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
      <ShieldOff size={15} className="shrink-0" />
      Keine Berechtigung für {what}.
    </div>
  );
}
