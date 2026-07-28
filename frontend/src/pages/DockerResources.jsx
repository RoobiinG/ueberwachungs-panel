import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ServerSelector } from '../components/ui/ServerSelector';
import { Layers, HardDrive, Network, Trash2, RefreshCw, DownloadCloud, Wand2, Package, Play, Square } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const fmtBytes = (b, d = 1) => {
  if (!b || b <= 0) return '—';
  const k = 1024, u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${u[i]}`;
};

const imageName = (r) =>
  r.repoTags?.[0] || r.tags?.[0] ||
  (r.repository ? `${r.repository}:${r.tag || 'latest'}` : null) ||
  r.name || (r.id || '').replace(/^sha256:/, '').slice(0, 19) || '—';

const parseDate = (d) => {
  if (!d) return null;
  if (typeof d === 'number') {
    return new Date(d < 100000000000 ? d * 1000 : d);
  }
  return new Date(d);
};

const TABS = [
  { key: 'images',   label: 'Images',    icon: Layers,    endpoint: '/api/docker/images' },
  { key: 'volumes',  label: 'Volumes',   icon: HardDrive, endpoint: '/api/docker/volumes' },
  { key: 'networks', label: 'Netzwerke', icon: Network,   endpoint: '/api/docker/networks' },
  { key: 'stacks',   label: 'Stacks',    icon: Package,   endpoint: '/api/docker/stacks' },
];

/**
 * Ressourcen-Ansicht (Images, Volumes, Netzwerke, Stacks).
 *
 * Wird von `DockerCenter` eingebettet, das die gemeinsame Tab-Leiste stellt. Dann kommen
 * `tab` und `onTabChange` von außen und `hideTabs` blendet die eigene Leiste aus.
 * Ohne diese Props verhält sich die Seite wie zuvor eigenständig.
 */
export default function DockerResources({ tab: controlledTab, onTabChange, hideTabs = false }) {
  const { hasPermission, isAdmin, hideLocal } = useAuth();

  const availableTabs = TABS.filter(t => isAdmin || hasPermission(`docker.${t.key}.view`));

  const [selectedServer, setSelectedServer] = useState(null);

  const [internalTab, setInternalTab] = useState(() => {
    if (availableTabs.some(t => t.key === 'images')) return 'images';
    return availableTabs.length > 0 ? availableTabs[0].key : 'images';
  });

  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);
  const [pullImg, setPullImg] = useState('');
  const [redeployId, setRedeployId] = useState(null);
  const [optPull, setOptPull] = useState(true);
  const [optBuild, setOptBuild] = useState(false);
  const [optForce, setOptForce] = useState(false);

  // Gesteuerter Modus (eingebettet in DockerCenter) hat Vorrang, sonst der eigene Zustand.
  const tab    = controlledTab ?? internalTab;
  const setTab = onTabChange   ?? setInternalTab;

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some(t => t.key === tab)) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  const cfg = TABS.find(t => t.key === tab) || availableTabs[0];
  const canView = availableTabs.length > 0;
  const canControl = isAdmin || (cfg && hasPermission(`docker.${cfg.key}.control`));

  const getUrl = (base) => selectedServer ? `/api/agents/${selectedServer}${base.replace('/api', '')}` : base;

  const load = useCallback(async () => {
    if (!canView || !cfg) return;
    setLoading(true); setError('');
    try { const { data } = await axios.get(getUrl(cfg.endpoint)); setItems(Array.isArray(data) ? data : (data.items || [])); }
    catch (e) { setError(e.response?.data?.error || 'Laden fehlgeschlagen'); setItems([]); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.endpoint, canView, selectedServer]);

  useEffect(() => {
    if (hideLocal && selectedServer === null) return;
    setItems([]);
    load();
  }, [load, hideLocal, selectedServer, tab]);

  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); }
    catch (e) { setError(e.response?.data?.error || 'Aktion fehlgeschlagen'); }
    setBusy(false);
  };

  const prune  = () => act(() => axios.post(`${getUrl(cfg.endpoint)}/prune`));
  const remove = (id) => { if (confirm('Wirklich entfernen?')) act(() => axios.delete(`${getUrl(cfg.endpoint)}/${encodeURIComponent(id)}`)); };
  const pull   = () => { if (pullImg.trim()) act(async () => { await axios.post(getUrl('/api/docker/images/pull'), { image: pullImg.trim() }); setPullImg(''); }); };
  const stackAction = (id, action) => act(() => axios.post(`${getUrl(cfg.endpoint)}/${encodeURIComponent(id)}/${action}`));

  const openRedeploy = (id) => {
    setRedeployId(id); setOptPull(true); setOptBuild(false); setOptForce(false);
  };
  const doRedeploy = () => {
    if (!redeployId) return;
    const id = redeployId; setRedeployId(null);
    act(() => axios.post(`${getUrl(cfg.endpoint)}/${encodeURIComponent(id)}/update`, { pullImages: optPull, buildImages: optBuild, forceRecreate: optForce }));
  };

  if (!canView) {
    return <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
      Keine Berechtigung für Docker-Ressourcen.
    </div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <ServerSelector selected={selectedServer} onChange={setSelectedServer} />
      </div>

      {/* Tabs + Aktionen */}
      <div className="flex items-center gap-2 flex-wrap">
        {!hideTabs && (
          <div className="flex gap-1 bg-panel-surface border border-panel-border rounded-lg p-1">
            {availableTabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t.key ? 'bg-panel-card text-panel-text' : 'text-panel-muted hover:text-panel-text'
                }`}>
                <t.icon size={13} />{t.label}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />Aktualisieren
          </Button>
          {canControl && tab !== 'stacks' && (
            <Button size="sm" variant="danger" onClick={prune} disabled={busy}>
              <Wand2 size={13} className="mr-1" />Ungenutzte entfernen
            </Button>
          )}
        </div>
      </div>

      {tab === 'images' && canControl && (
        <div className="flex items-center gap-2">
          <input value={pullImg} onChange={e => setPullImg(e.target.value)}
            placeholder="Image ziehen, z.B. nginx:latest"
            onKeyDown={e => e.key === 'Enter' && pull()}
            className="flex-1 bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent" />
          <Button size="sm" onClick={pull} disabled={busy || !pullImg.trim()}>
            <DownloadCloud size={13} className="mr-1" />Pull
          </Button>
        </div>
      )}

      {error && <div className="bg-panel-red/10 border border-panel-red/30 text-panel-red text-xs rounded-md px-3 py-2">{error}</div>}

      <Card title={`${cfg.label} (${items.length})`}>
        {loading ? (
          <div className="text-panel-muted text-sm py-4 text-center">Lade…</div>
        ) : items.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine {cfg.label} vorhanden</div>
        ) : (
          <div className="divide-y divide-panel-border -mx-4 -mb-4">
            {[...items].sort((a, b) => {
              const aTime = parseDate(a.created)?.getTime() || 0;
              const bTime = parseDate(b.created)?.getTime() || 0;
              if (aTime !== bTime) return bTime - aTime;
              const aName = a.name || a.Name || (a.id || '').toString();
              const bName = b.name || b.Name || (b.id || '').toString();
              return aName.localeCompare(bName);
            }).map((r, i) => {
              const id = r.id ?? r.name ?? r.Id ?? r.Name ?? i;
              const primary = tab === 'images' ? imageName(r) : (r.name || r.Name || id);
              const cDate = parseDate(r.created);
              const sub = tab === 'images'
                ? [fmtBytes(r.size ?? r.Size), cDate && cDate.toLocaleDateString('de-DE')].filter(Boolean).join(' · ')
                : tab === 'volumes'
                ? [r.driver || r.Driver, fmtBytes(r.size ?? r.Size), r.mountpoint || r.Mountpoint].filter(Boolean).join(' · ')
                : tab === 'stacks'
                ? [r.status || r.Status, r.path || r.Path].filter(Boolean).join(' · ')
                : [r.driver || r.Driver, r.scope || r.Scope].filter(Boolean).join(' · ');
              return (
                <div key={id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-panel-text truncate font-mono">{primary}</div>
                    {sub && <div className="text-[11px] text-panel-muted truncate">{sub}</div>}
                  </div>
                  {canControl && tab === 'stacks' && (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openRedeploy(id)} disabled={busy} title="Redeploy / Pull"><DownloadCloud size={14} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => stackAction(id, 'start')} disabled={busy} title="Start"><Play size={14} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => stackAction(id, 'stop')} disabled={busy} title="Stop"><Square size={14} /></Button>
                      <Button size="sm" variant="danger" onClick={() => remove(id)} disabled={busy} title="Löschen"><Trash2 size={14} /></Button>
                    </div>
                  )}
                  {canControl && tab !== 'stacks' && (
                    <Button size="sm" variant="danger" onClick={() => remove(id)} disabled={busy}>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {/* Modal: Redeploy Stack */}
      {redeployId && (
        <Modal open={!!redeployId} onClose={() => setRedeployId(null)}
          title="Redeploy Stack"
          footer={<>
            <Button variant="ghost" size="sm" onClick={() => setRedeployId(null)}>Abbrechen</Button>
            <Button size="sm" onClick={doRedeploy} disabled={busy}>Deploy</Button>
          </>}>
          <div className="space-y-4">
            <p className="text-sm text-panel-muted">Stack <span className="font-mono text-panel-text">{redeployId}</span> neu deployen.</p>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input type="checkbox" checked={optPull} onChange={e => setOptPull(e.target.checked)} className="accent-panel-accent w-4 h-4" />
              <span className="text-sm text-panel-text group-hover:text-panel-accent transition-colors">Pull images</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input type="checkbox" checked={optBuild} onChange={e => setOptBuild(e.target.checked)} className="accent-panel-accent w-4 h-4" />
              <span className="text-sm text-panel-text group-hover:text-panel-accent transition-colors">Build images</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input type="checkbox" checked={optForce} onChange={e => setOptForce(e.target.checked)} className="accent-panel-accent w-4 h-4" />
              <span className="text-sm text-panel-text group-hover:text-panel-accent transition-colors">Force recreate</span>
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}
