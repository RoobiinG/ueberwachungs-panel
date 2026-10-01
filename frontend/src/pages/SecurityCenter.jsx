import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, ShieldHalf, Flame, Ban, Database } from 'lucide-react';
import { HubLayout } from '../components/ui/HubLayout';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useTabParam } from '../hooks/useTabParam';
import SecurityAuditTab from '../components/Security/SecurityAuditTab';
import Fail2banBansCard from '../components/Security/Fail2banBansCard';
import DauersperrenCard from '../components/Security/DauersperrenCard';
import BedrohungsdatenTab from '../components/Security/BedrohungsdatenTab';
import Firewall from './Firewall';

// Jeder Tab hängt am Lese-Recht seines Bereichs; Schreib-Knöpfe prüfen innerhalb der Tabs
// die Schreib-Rechte (firewall.manage, fail2ban.manage, fail2ban.ban, security.ssh_kick,
// security.intel_update, agents.edit, agents.manage_ssh) und werden ohne sie gar nicht erst gerendert.
const TABS = [
  { key: 'audit',    label: 'Audit & Score',      icon: ShieldHalf, permission: 'security.view' },
  { key: 'firewall', label: 'Firewall',           icon: Flame,      permission: 'firewall.view' },
  { key: 'fail2ban', label: 'Fail2Ban & Sperren', icon: Ban,        permission: 'security.view' },
  { key: 'intel',    label: 'Bedrohungsdaten',    icon: Database,   permission: 'security.view' },
];
// Diese Tabs betreffen das Panel selbst, nicht einen Server — dort gibt es keine Serverauswahl.
const OHNE_SERVER = ['intel'];
// Beim Tab-Wechsel bleibt der gewählte Server erhalten.
const PERSIST = ['server'];

// Tab „Fail2Ban & Sperren": zeitliche Jail-Sperren und alle dauerhaften Sperren.
// Ändert eine Karte etwas, lädt die andere neu (z. B. „Dauerhaft sperren" aus der Jail-Liste).
function SperrenTab({ agentId }) {
  const [f2bStand, setF2bStand]     = useState(0);
  const [dauerStand, setDauerStand] = useState(0);
  return (
    <div className="space-y-4">
      <Fail2banBansCard agentId={agentId} aktualisieren={f2bStand} onGeaendert={() => setDauerStand(n => n + 1)} />
      <DauersperrenCard agentId={agentId} aktualisieren={dauerStand} onGeaendert={() => setF2bStand(n => n + 1)} />
    </div>
  );
}

export default function SecurityCenter() {
  const { tabs, active, setTab } = useTabParam(TABS, { persist: PERSIST });
  const [params, setParams] = useSearchParams();
  const serverParam = params.get('server');
  const serverId = serverParam && /^\d+$/.test(serverParam) ? Number(serverParam) : null;

  const setServer = useCallback((id) => {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('server', String(id)); return n; }, { replace: !serverParam });
  }, [setParams, serverParam]);

  return (
    <HubLayout
      icon={ShieldCheck}
      title="Security Center"
      subtitle="Sicherheits-Score, Firewall, Fail2Ban-Sperren und Bedrohungsdaten deiner Server an einem Ort"
      tabs={tabs}
      active={active}
      onTabChange={setTab}
      extra={tabs.length > 0 && !OHNE_SERVER.includes(active) && <ServerSelector selected={serverId} onChange={setServer} />}
    >
      {active === 'intel' ? (
        <BedrohungsdatenTab />
      ) : !serverId ? (
        <p className="text-xs text-panel-muted">Kein Server ausgewählt — lege unter „Server" einen Agenten an, um ihn hier zu prüfen.</p>
      ) : active === 'audit' ? (
        <SecurityAuditTab agentId={serverId} />
      ) : active === 'firewall' ? (
        <Firewall serverId={serverId} />
      ) : active === 'fail2ban' ? (
        <SperrenTab key={serverId} agentId={serverId} />
      ) : null}
    </HubLayout>
  );
}
