import { useEffect, useMemo, useState } from 'react';
import { Container, Layers, HardDrive, Network, Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Docker from './Docker';
import DockerResources from './DockerResources';

// Container und Ressourcen liegen seit v1.51.0 unter einem Menüpunkt. Jeder Tab hängt an
// seinem eigenen Recht — wer nur Images sehen darf, bekommt auch nur diesen Tab.
const TABS = [
  { key: 'containers', label: 'Container', icon: Container, permission: 'docker.view' },
  { key: 'images',     label: 'Images',    icon: Layers,    permission: 'docker.images.view' },
  { key: 'volumes',    label: 'Volumes',   icon: HardDrive, permission: 'docker.volumes.view' },
  { key: 'networks',   label: 'Netzwerke', icon: Network,   permission: 'docker.networks.view' },
  { key: 'stacks',     label: 'Stacks',    icon: Package,   permission: 'docker.stacks.view' },
];

export default function DockerCenter() {
  const { hasPermission, isAdmin } = useAuth();

  const availableTabs = useMemo(
    () => TABS.filter(t => isAdmin || hasPermission(t.permission)),
    [isAdmin, hasPermission],
  );

  const [tab, setTab] = useState(() => availableTabs[0]?.key || 'containers');

  // Die Rechte stehen beim ersten Rendern noch nicht zwingend fest. Sobald sie da sind,
  // auf einen erlaubten Tab wechseln, damit niemand auf einer leeren Ansicht landet.
  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some(t => t.key === tab)) {
      setTab(availableTabs[0].key);
    }
  }, [availableTabs, tab]);

  if (availableTabs.length === 0) {
    return (
      <div className="bg-panel-orange/10 border border-panel-orange/30 text-panel-orange text-sm rounded-md px-4 py-3">
        Keine Berechtigung für Docker.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1 bg-panel-surface border border-panel-border rounded-lg p-1 w-fit max-w-full overflow-x-auto">
        {availableTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              tab === t.key ? 'bg-panel-card text-panel-text' : 'text-panel-muted hover:text-panel-text'
            }`}
          >
            <t.icon size={13} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'containers'
        ? <Docker />
        : <DockerResources tab={tab} onTabChange={setTab} hideTabs />}
    </div>
  );
}
