import { KeyRound, Users as UsersIcon, ShieldCheck } from 'lucide-react';
import { HubLayout } from '../components/ui/HubLayout';
import { useTabParam } from '../hooks/useTabParam';
import Users from './Users';
import Roles from './Roles';

// Benutzerliste sehen reicht `users.view`; Rollen und Berechtigungen sind Admin-nah
// (`roles.manage`) und bekommen deshalb einen eigenen, sonst unsichtbaren Tab.
// Das Backend verhindert zusätzlich, dass jemand mehr vergibt, als er selbst darf.
const TABS = [
  { key: 'users', label: 'Benutzer-Liste',          icon: UsersIcon,   permission: 'users.view' },
  { key: 'roles', label: 'Rollen & Berechtigungen', icon: ShieldCheck, permission: 'roles.manage' },
];

export default function AccessCenter() {
  const { tabs, active, setTab } = useTabParam(TABS);

  return (
    <HubLayout
      icon={KeyRound}
      title="Identität & Zugriff"
      subtitle="Benutzerkonten, Rollen und Berechtigungen des Panels"
      tabs={tabs}
      active={active}
      onTabChange={setTab}
    >
      {active === 'users' ? <Users /> : active === 'roles' ? <Roles /> : null}
    </HubLayout>
  );
}
