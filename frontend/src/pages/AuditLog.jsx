import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import {
  Shield, Search, Trash2, ChevronLeft, ChevronRight,
  RefreshCw, Filter, Monitor, User, Container, Webhook,
  Bell, Server, Settings, Lock, Flame, MapPin,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// Aktions-Kategorien mit Farben + Icons
const ACTION_META = {
  login:                  { label: 'Login',             color: 'text-panel-green',  icon: User },
  'password.change':      { label: 'Passwort geändert', color: 'text-panel-orange', icon: Lock },
  'user.create':          { label: 'Benutzer erstellt', color: 'text-panel-accent', icon: User },
  'user.delete':          { label: 'Benutzer gelöscht', color: 'text-panel-red',    icon: User },
  'user.role_change':     { label: 'Rolle geändert',    color: 'text-panel-orange', icon: User },
  'user.password_reset':  { label: 'Passwort zurückgesetzt', color: 'text-panel-orange', icon: Lock },
  'role.create':          { label: 'Rolle erstellt',    color: 'text-panel-accent', icon: Shield },
  'role.delete':          { label: 'Rolle gelöscht',    color: 'text-panel-red',    icon: Shield },
  'role.permissions_changed': { label: 'Rechte geändert', color: 'text-panel-orange', icon: Shield },
  'agent.create':         { label: 'Server hinzugefügt', color: 'text-panel-accent', icon: Server },
  'agent.edit':           { label: 'Server bearbeitet', color: 'text-panel-muted',  icon: Server },
  'agent.delete':         { label: 'Server entfernt',   color: 'text-panel-red',    icon: Server },
  'docker.start':         { label: 'Container gestartet', color: 'text-panel-green', icon: Container },
  'docker.stop':          { label: 'Container gestoppt',  color: 'text-panel-orange', icon: Container },
  'docker.restart':       { label: 'Container neugestartet', color: 'text-panel-accent', icon: Container },
  'docker.kill':          { label: 'Container beendet',  color: 'text-panel-red',   icon: Container },
  'docker.pause':         { label: 'Container pausiert', color: 'text-panel-muted', icon: Container },
  'docker.unpause':       { label: 'Container fortgesetzt', color: 'text-panel-green', icon: Container },
  'firewall.allow':       { label: 'Firewall: Port erlaubt', color: 'text-panel-green', icon: Flame },
  'firewall.deny':        { label: 'Firewall: Port gesperrt', color: 'text-panel-red', icon: Flame },
  'firewall.delete':      { label: 'Firewall: Regel gelöscht', color: 'text-panel-orange', icon: Flame },
  'webhook.create':       { label: 'Webhook erstellt',  color: 'text-panel-accent', icon: Webhook },
  'webhook.edit':         { label: 'Webhook bearbeitet', color: 'text-panel-muted', icon: Webhook },
  'webhook.delete':       { label: 'Webhook gelöscht',  color: 'text-panel-red',   icon: Webhook },
  'webhook.test':         { label: 'Webhook getestet',  color: 'text-panel-muted', icon: Webhook },
  'alert.create':         { label: 'Alert-Regel erstellt', color: 'text-panel-accent', icon: Bell },
  'alert.delete':         { label: 'Alert-Regel gelöscht', color: 'text-panel-red', icon: Bell },
  'settings.smtp_save':   { label: 'SMTP gespeichert',  color: 'text-panel-muted', icon: Settings },
};

const getMeta = (action) => ACTION_META[action] || { label: action, color: 'text-panel-muted', icon: Monitor };

// Browser aus User-Agent extrahieren
function parseBrowser(ua) {
  if (!ua) return '—';
  if (ua.includes('Edg/'))     return 'Edge';
  if (ua.includes('OPR/'))     return 'Opera';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Chrome/'))  return 'Chrome';
  if (ua.includes('Safari/'))  return 'Safari';
  if (ua.includes('curl'))     return 'curl';
  return ua.slice(0, 30);
}

// OS aus User-Agent
function parseOS(ua) {
  if (!ua) return '';
  if (ua.includes('Windows NT')) return 'Windows';
  if (ua.includes('Mac OS X'))   return 'macOS';
  if (ua.includes('Linux'))      return 'Linux';
  if (ua.includes('Android'))    return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return '';
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const PAGE_SIZE = 50;

export default function AuditLog() {
  const [rows,    setRows]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [page,    setPage]    = useState(0);

  // Filter
  const [filterUser,   setFilterUser]   = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterFrom,   setFilterFrom]   = useState('');
  const [filterTo,     setFilterTo]     = useState('');
  const [expanded,     setExpanded]     = useState(null); // aufgeklappte Zeile

  const load = useCallback(async (pg = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit:  PAGE_SIZE,
        offset: pg * PAGE_SIZE,
        ...(filterUser   && { user:   filterUser }),
        ...(filterAction && { action: filterAction }),
        ...(filterFrom   && { from:   filterFrom }),
        ...(filterTo     && { to:     filterTo }),
      });
      const { data } = await axios.get(`/api/audit?${params}`);
      setRows(data.rows);
      setTotal(data.total);
    } catch {}
    setLoading(false);
  }, [page, filterUser, filterAction, filterFrom, filterTo]);

  useEffect(() => { load(0); setPage(0); }, [filterUser, filterAction, filterFrom, filterTo]);
  useEffect(() => { load(page); }, [page]);

  const clearLog = async () => {
    if (!confirm('Audit-Log komplett leeren? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
    await axios.delete('/api/audit');
    load(0);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">

      {/* ── Filter-Leiste ─────────────────────────────────────────── */}
      <Card title={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2">
            <Filter size={14} />
            <span>Filter</span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => load(page)}>
              <RefreshCw size={12} className="mr-1" />Aktualisieren
            </Button>
            <Button size="sm" variant="ghost" onClick={clearLog}
              className="text-panel-red hover:bg-panel-red/10">
              <Trash2 size={12} className="mr-1" />Log leeren
            </Button>
          </div>
        </div>
      }>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-panel-muted block mb-1">Benutzer</label>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-panel-muted" />
              <input
                className="w-full bg-panel-surface border border-panel-border rounded-md pl-7 pr-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
                placeholder="z.B. Admin"
                value={filterUser}
                onChange={e => setFilterUser(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Aktion</label>
            <input
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              placeholder="z.B. docker.stop"
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Von</label>
            <input type="date"
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-panel-muted block mb-1">Bis</label>
            <input type="date"
              className="w-full bg-panel-surface border border-panel-border rounded-md px-3 py-1.5 text-xs text-panel-text focus:outline-none focus:border-panel-accent"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* ── Log-Tabelle ───────────────────────────────────────────── */}
      <Card title={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-panel-accent" />
            <span>Audit-Protokoll</span>
            <span className="text-xs text-panel-muted">({total} Einträge)</span>
          </div>
          {/* Pagination */}
          <div className="flex items-center gap-1 text-xs text-panel-muted">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-1 rounded hover:bg-panel-card disabled:opacity-30">
              <ChevronLeft size={13} />
            </button>
            <span>{page + 1} / {pages}</span>
            <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}
              className="p-1 rounded hover:bg-panel-card disabled:opacity-30">
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      }>
        {loading ? (
          <p className="text-panel-muted text-sm py-8 text-center">Lade...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-10">
            <Shield size={32} className="mx-auto mb-3 text-panel-muted opacity-30" />
            <p className="text-panel-muted text-sm">Keine Einträge gefunden</p>
          </div>
        ) : (
          <div className="space-y-px">
            {rows.map(row => {
              const meta   = getMeta(row.action);
              const Icon   = meta.icon;
              const isOpen = expanded === row.id;
              let parsedDetails = null;
              try { if (row.details) parsedDetails = JSON.parse(row.details); } catch {}

              return (
                <div key={row.id}
                  onClick={() => setExpanded(isOpen ? null : row.id)}
                  className="flex flex-col gap-1 px-3 py-2.5 rounded-lg hover:bg-panel-card/50 cursor-pointer transition-colors border border-transparent hover:border-panel-border/50">

                  {/* Hauptzeile */}
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon size={13} className={`flex-shrink-0 ${meta.color}`} />

                    {/* Zeitstempel */}
                    <span className="text-[11px] text-panel-muted flex-shrink-0 w-32 truncate">
                      {fmtDate(row.created_at)}
                    </span>

                    {/* Benutzer */}
                    <span className="text-xs font-medium text-panel-text flex-shrink-0 w-24 truncate">
                      {row.username}
                    </span>

                    {/* Aktion */}
                    <span className={`text-xs font-semibold flex-shrink-0 ${meta.color}`}>
                      {meta.label}
                    </span>

                    {/* Ziel */}
                    {row.target_name && (
                      <span className="text-xs text-panel-muted truncate flex-1">
                        → {row.target_name}
                      </span>
                    )}

                    {/* IP */}
                    <span className="text-[11px] text-panel-muted flex-shrink-0 hidden md:block font-mono">
                      {row.ip || '—'}
                    </span>

                    {/* Standort */}
                    {row.location && (
                      <span className="text-[11px] text-panel-muted flex-shrink-0 hidden lg:flex items-center gap-0.5">
                        <MapPin size={10} className="flex-shrink-0" />
                        {row.location}
                      </span>
                    )}

                    {/* Browser */}
                    <span className="text-[11px] text-panel-muted flex-shrink-0 hidden xl:block">
                      {parseBrowser(row.user_agent)}
                      {parseOS(row.user_agent) && ` · ${parseOS(row.user_agent)}`}
                    </span>
                  </div>

                  {/* Erweiterte Details (aufgeklappt) */}
                  {isOpen && (
                    <div className="ml-6 mt-1 space-y-1 text-[11px] text-panel-muted border-t border-panel-border/40 pt-2">
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <div><span className="text-panel-text font-medium">Benutzer:</span> {row.username} (ID: {row.user_id ?? '—'})</div>
                        <div><span className="text-panel-text font-medium">IP-Adresse:</span> {row.ip || '—'}</div>
                        <div><span className="text-panel-text font-medium">Standort:</span>{' '}
                          {row.location
                            ? <span className="inline-flex items-center gap-1"><MapPin size={10} />{row.location}</span>
                            : '—'}
                        </div>
                        <div><span className="text-panel-text font-medium">Aktion:</span> <code className="text-panel-accent">{row.action}</code></div>
                        <div><span className="text-panel-text font-medium">Ziel-Typ:</span> {row.target_type || '—'}</div>
                        <div><span className="text-panel-text font-medium">Ziel-Name:</span> {row.target_name || '—'}</div>
                        <div><span className="text-panel-text font-medium">Zeitstempel:</span> {fmtDate(row.created_at)}</div>
                      </div>
                      <div>
                        <span className="text-panel-text font-medium">Browser / User-Agent:</span>
                        <span className="ml-1 font-mono break-all">{row.user_agent || '—'}</span>
                      </div>
                      {parsedDetails && (
                        <div>
                          <span className="text-panel-text font-medium">Details:</span>
                          <code className="ml-1 text-panel-accent break-all">
                            {JSON.stringify(parsedDetails)}
                          </code>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
