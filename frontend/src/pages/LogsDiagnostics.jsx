import { Activity, ScrollText, ClipboardList, Stethoscope } from 'lucide-react';
import { HubLayout } from '../components/ui/HubLayout';
import { useTabParam } from '../hooks/useTabParam';
import PanelLogs from './PanelLogs';
import AuditLog from './AuditLog';
import Diagnose from './Diagnose';

// Lesen und kritische Aktionen sind getrennt: Logs ansehen (panel_logs.view, audit.view)
// ist harmlos, Diagnose (diagnose.run) liest Systeminterna und kann Berichte öffentlich
// freigeben. Löschen/Freigeben innerhalb der Tabs prüft panel_logs.manage bzw. audit.clear.
const TABS = [
  { key: 'system',   label: 'System-Logs',    icon: ScrollText,    permission: 'panel_logs.view' },
  { key: 'audit',    label: 'Audit-Trail',    icon: ClipboardList, permission: 'audit.view' },
  { key: 'diagnose', label: 'Diagnose-Tools', icon: Stethoscope,   permission: 'diagnose.run' },
];

export default function LogsDiagnostics() {
  const { tabs, active, setTab } = useTabParam(TABS);

  return (
    <HubLayout
      icon={Activity}
      title="Logs & Diagnose"
      subtitle="Fehler-Logs des Panels, Protokoll aller Aktionen und Systemdiagnose"
      tabs={tabs}
      active={active}
      onTabChange={setTab}
    >
      {active === 'system' ? <PanelLogs /> : active === 'audit' ? <AuditLog /> : active === 'diagnose' ? <Diagnose /> : null}
    </HubLayout>
  );
}
