import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, ShieldHalf, Flame, Ban } from 'lucide-react';
import { HubLayout } from '../components/ui/HubLayout';
import { ServerSelector } from '../components/ui/ServerSelector';
import { useTabParam } from '../hooks/useTabParam';
import SecurityAuditTab from '../components/Security/SecurityAuditTab';
import Fail2banBansCard from '../components/Security/Fail2banBansCard';
import Firewall from './Firewall';

// Jeder Tab hängt am Lese-Recht seines Bereichs; Schreib-Knöpfe prüfen innerhalb der Tabs
// die Schreib-Rechte (firewall.manage, fail2ban.manage, agents.edit, agents.manage_ssh).
const TABS = [
  { key: 'audit',    label: 'Audit & Score',      icon: ShieldHalf, permission: 'security.view' },
  { key: 'firewall', label: 'Firewall',           icon: Flame,      permission: 'firewall.view' },
  { key: 'fail2ban', label: 'Fail2Ban & Sperren', icon: Ban,        permission: 'security.view' },
];
// Beim Tab-Wechsel bleibt der gewählte Server erhalten.
const PERSIST = ['server'];

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
      subtitle="Sicherheits-Score, Firewall und Fail2Ban-Sperren deiner Server an einem Ort"
      tabs={tabs}
      active={active}
      onTabChange={setTab}
      extra={tabs.length > 0 && <ServerSelector selected={serverId} onChange={setServer} />}
    >
      {!serverId ? (
        <p className="text-xs text-panel-muted">Kein Server ausgewählt — lege unter „Server" einen Agenten an, um ihn hier zu prüfen.</p>
      ) : active === 'audit' ? (
        <SecurityAuditTab agentId={serverId} />
      ) : active === 'firewall' ? (
        <Firewall serverId={serverId} />
      ) : active === 'fail2ban' ? (
        <Fail2banBansCard agentId={serverId} />
      ) : null}
    </HubLayout>
  );
}
