import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  RefreshCw, ShieldCheck, ShieldAlert, Shield, Key, Lock, Unlock, Radio, Globe, Clock,
  Terminal, Plus, Trash2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { berechneSicherheitsScore, parseAllowedPorts } from '../../utils/securityScore';

/**
 * Tab „Audit & Score" im Security Center (früher Tab „Sicherheit" der Server-Detailseite).
 *
 * Rechte, wie im Backend durchgesetzt:
 *   security.view      → Score, Checkliste, lauschende Ports, SSH-Sitzungen (Tab-Voraussetzung)
 *   agents.edit        → Port-Whitelist speichern
 *   agents.manage_ssh  → SSH-Schlüssel sehen, hinterlegen, entfernen (= Root-Zugang)
 */
export default function SecurityAuditTab({ agentId }) {
  const { hasPermission } = useAuth();
  const darfPortsAendern = hasPermission('agents.edit');
  const darfSshKeys      = hasPermission('agents.manage_ssh');

  const [sshConfig, setSshConfig]     = useState(null);
  const [sshSessions, setSshSessions] = useState([]);
  const [sshKeys, setSshKeys]         = useState([]);
  const [loading, setLoading]         = useState(false);
  const [allowedPorts, setAllowedPorts] = useState('');
  const [savingPorts, setSavingPorts] = useState(false);
  const [addKeyModal, setAddKeyModal] = useState(false);
  const [newKeyForm, setNewKeyForm]   = useState({ user: 'root', key: '' });
  const [addingKey, setAddingKey]     = useState(false);

  // Antworten eines inzwischen abgewählten Servers verwerfen.
  const anfrage = useRef(0);

  const load = useCallback(async () => {
    if (!agentId) return;
    const nr = ++anfrage.current;
    setLoading(true);
    const [confRes, sessRes, keysRes, agentsRes] = await Promise.all([
      axios.get(`/api/agents/${agentId}/ssh/audit`).catch(() => ({ data: null })),
      axios.get(`/api/agents/${agentId}/ssh/sessions`).catch(() => ({ data: [] })),
      darfSshKeys ? axios.get(`/api/agents/${agentId}/ssh/keys`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      axios.get('/api/agents').catch(() => ({ data: [] })),
    ]);
    if (nr !== anfrage.current) return;
    setSshConfig(confRes.data || null);
    setSshSessions(sessRes.data || []);
    setSshKeys(keysRes.data || []);
    const agent = (agentsRes.data || []).find(a => String(a.id) === String(agentId));
    try { setAllowedPorts(JSON.parse(agent?.allowed_ports || '[]').join(', ')); } catch { setAllowedPorts(''); }
    setLoading(false);
  }, [agentId, darfSshKeys]);

  useEffect(() => {
    setSshConfig(null); setSshSessions([]); setSshKeys([]);
    load();
  }, [load]);

  const audit = useMemo(() => berechneSicherheitsScore(sshConfig, allowedPorts), [sshConfig, allowedPorts]);
  const whitelist = useMemo(() => parseAllowedPorts(allowedPorts), [allowedPorts]);

  const saveAllowedPorts = async () => {
    setSavingPorts(true);
    try {
      await axios.put(`/api/agents/${agentId}`, { allowed_ports: whitelist });
      alert('Erlaubte Ports gespeichert.');
    } catch (err) {
      alert('Fehler beim Speichern der Ports: ' + (err.response?.data?.error || err.message));
    }
    setSavingPorts(false);
  };

  const applyListeningPorts = () => {
    if (!sshConfig?.listeningPorts?.length) return;
    setAllowedPorts([...new Set(sshConfig.listeningPorts.map(p => p.port))].sort((a, b) => a - b).join(', '));
  };

  const removeSshKey = async (identifier) => {
    if (!confirm('SSH-Key wirklich entfernen?')) return;
    try {
      await axios.delete(`/api/agents/${agentId}/ssh/keys/${encodeURIComponent(identifier)}`);
      load();
    } catch (err) {
      alert('Fehler beim Entfernen des Schlüssels: ' + (err.response?.data?.error || err.message));
    }
  };

  const addSshKey = async (e) => {
    e?.preventDefault();
    if (!newKeyForm.key.trim()) return;
    setAddingKey(true);
    try {
      await axios.post(`/api/agents/${agentId}/ssh/keys`, { user: newKeyForm.user || 'root', key: newKeyForm.key.trim() });
      setAddKeyModal(false);
      setNewKeyForm({ user: 'root', key: '' });
      load();
    } catch (err) {
      alert('Fehler beim Hinzufügen des Schlüssels: ' + (err.response?.data?.error || err.message));
    } finally {
      setAddingKey(false);
    }
  };

  const tile = (tone) => ({
    red:    'bg-panel-red/10 border-panel-red/30',
    orange: 'bg-panel-orange/10 border-panel-orange/30',
    green:  'bg-panel-green/10 border-panel-green/30',
    blue:   'bg-panel-blue/10 border-panel-blue/30',
    plain:  'bg-panel-surface border-panel-border',
  }[tone]);

  return (
    <div className="space-y-4">
      <Card title="Sicherheits-Audit & Bewertung">
        {loading && !sshConfig ? (
          <p className="text-xs text-panel-muted py-2">Lade Sicherheitsdaten …</p>
        ) : !sshConfig ? (
          <p className="text-xs text-panel-muted">Keine SSH-Konfiguration gefunden — ist der Agent erreichbar?</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-panel-surface/60 border border-panel-border">
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-full ${
                  audit.score >= 80 ? 'bg-panel-green/20 text-panel-green' :
                  audit.score >= 50 ? 'bg-panel-orange/20 text-panel-orange' : 'bg-panel-red/20 text-panel-red'
                }`}>
                  {audit.score >= 80 ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-panel-text">Sicherheits-Score: {audit.score} / 100</span>
                    <Badge color={audit.score >= 80 ? 'green' : audit.score >= 50 ? 'orange' : 'red'}>{audit.rating}</Badge>
                  </div>
                  <p className="text-xs text-panel-muted mt-0.5">
                    Basierend auf SSH-Konfiguration, Authentifizierungsmethoden, Fail2ban und Port-Wächter.
                  </p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
                <RefreshCw size={14} className={`mr-1.5 ${loading ? 'animate-spin' : ''}`} /> Neu prüfen
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className={`p-3 rounded-lg border ${tile(sshConfig.PermitRootLogin === 'yes' ? 'red' : sshConfig.PermitRootLogin === 'no' ? 'green' : 'blue')}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-panel-muted">Root-Login</span>
                  {sshConfig.PermitRootLogin === 'yes' ? <Unlock size={14} className="text-panel-red" /> : <Lock size={14} className="text-panel-green" />}
                </div>
                <p className="text-sm font-semibold text-panel-text">{sshConfig.PermitRootLogin}</p>
                <p className={`text-[10px] mt-1 ${sshConfig.PermitRootLogin === 'yes' ? 'text-panel-red font-medium' : 'text-panel-muted'}`}>
                  {sshConfig.PermitRootLogin === 'yes' ? 'Sicherheitsrisiko (Brute-Force Ziel)' : 'Abgesichert'}
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${tile(sshConfig.PasswordAuthentication === 'yes' ? 'orange' : 'green')}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-panel-muted">Passwort Auth</span>
                  <Key size={14} className={sshConfig.PasswordAuthentication === 'yes' ? 'text-panel-orange' : 'text-panel-green'} />
                </div>
                <p className="text-sm font-semibold text-panel-text">{sshConfig.PasswordAuthentication}</p>
                <p className="text-[10px] text-panel-muted mt-1">
                  {sshConfig.PasswordAuthentication === 'yes' ? 'Nur Schlüssel empfohlen' : 'Nur SSH-Keys zulässig'}
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${tile('plain')}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-panel-muted">SSH Port</span>
                  <Radio size={14} className="text-panel-accent" />
                </div>
                <p className="text-sm font-semibold text-panel-text">{sshConfig.Port}</p>
                <p className="text-[10px] text-panel-muted mt-1">
                  {parseInt(sshConfig.Port, 10) === 22 ? 'Standard-Port' : 'Benutzerdefinierter Port'}
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${tile(sshConfig.fail2banActive ? 'green' : sshConfig.fail2banInstalled ? 'orange' : 'plain')}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-panel-muted">Fail2ban Schutz</span>
                  <Shield size={14} className={sshConfig.fail2banActive ? 'text-panel-green' : 'text-panel-muted'} />
                </div>
                <p className="text-sm font-semibold text-panel-text">
                  {sshConfig.fail2banActive ? 'Aktiv' : sshConfig.fail2banInstalled ? 'Inaktiv' : 'Nicht installiert'}
                </p>
                <p className="text-[10px] text-panel-muted mt-1 truncate">
                  {sshConfig.fail2banActive
                    ? `${sshConfig.fail2banJails?.length || 0} Jails (${(sshConfig.fail2banJails || []).join(', ') || 'sshd'})`
                    : 'Kein automatischer IP-Bann'}
                </p>
              </div>
            </div>

            {audit.checks.length > 0 && (
              <div className="space-y-1.5 pt-2">
                <p className="text-xs font-semibold text-panel-muted uppercase tracking-wider mb-2">Sicherheits-Empfehlungen & Audit-Checkliste</p>
                {audit.checks.map((chk) => (
                  <div key={chk.id} className="flex items-start gap-2.5 p-2.5 rounded bg-panel-bg/60 border border-panel-border/50 text-xs">
                    {chk.status === 'ok' ? <CheckCircle2 size={16} className="text-panel-green shrink-0 mt-0.5" />
                      : chk.status === 'danger' ? <ShieldAlert size={16} className="text-panel-red shrink-0 mt-0.5" />
                      : <AlertTriangle size={16} className="text-panel-orange shrink-0 mt-0.5" />}
                    <div className="min-w-0">
                      <span className={`font-semibold ${chk.status === 'ok' ? 'text-panel-text' : chk.status === 'danger' ? 'text-panel-red' : 'text-panel-orange'}`}>
                        {chk.label}
                      </span>
                      <p className="text-[11px] text-panel-muted mt-0.5">{chk.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card title="Port-Wächter & Lauschende Dienste">
        <p className="text-xs text-panel-muted mb-3">
          Welche Ports (für 0.0.0.0 oder ::) auf dem Server offen sein dürfen, kommagetrennt (z. B. 22, 80, 443).
          Über die Alert-Regeln kannst du bei Port-Drift (unerlaubte offene Ports) alarmiert werden.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <input
            type="text"
            readOnly={!darfPortsAendern}
            title={darfPortsAendern ? undefined : 'Ändern erfordert das Recht „Server bearbeiten"'}
            className="bg-panel-bg text-panel-text text-sm rounded-lg border border-panel-border px-3 py-1.5 focus:border-panel-accent focus:ring-1 focus:ring-panel-accent outline-none w-full font-mono read-only:opacity-70"
            placeholder="22, 80, 443"
            value={allowedPorts}
            onChange={(e) => setAllowedPorts(e.target.value)}
          />
          {darfPortsAendern && (
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={saveAllowedPorts} disabled={savingPorts}>
                {savingPorts ? 'Speichere …' : 'Speichern'}
              </Button>
              {sshConfig?.listeningPorts?.length > 0 && (
                <Button size="sm" variant="ghost" onClick={applyListeningPorts} title="Übernimmt alle aktuell erkannten Ports in die Whitelist">
                  Ports übernehmen
                </Button>
              )}
            </div>
          )}
        </div>

        {sshConfig?.listeningPorts?.length > 0 && (
          <div className="pt-2 border-t border-panel-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-panel-muted uppercase tracking-wider">
                Aktuell lauschende Netzwerk-Ports ({sshConfig.listeningPorts.length})
              </span>
              {audit?.unallowedPorts?.length > 0 && <Badge color="red">{audit.unallowedPorts.length} Unerlaubt (Drift)</Badge>}
            </div>
            {/* Ohne Whitelist gibt es keinen Drift — so rechnet auch der Score. Früher standen
                dann trotzdem alle Ports rot auf „Drift". */}
            {whitelist.length === 0 && (
              <p className="text-[11px] text-panel-muted mb-2">Noch keine Whitelist hinterlegt — Drift wird erst geprüft, wenn erlaubte Ports gespeichert sind.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {sshConfig.listeningPorts.map((lp, idx) => {
                const ohneWhitelist = whitelist.length === 0;
                const erlaubt = whitelist.includes(lp.port);
                return (
                  <div key={idx} className={`p-2.5 rounded border text-xs flex items-center justify-between gap-2 ${
                    ohneWhitelist || erlaubt ? 'bg-panel-surface/60 border-panel-border' : 'bg-panel-red/10 border-panel-red/30'
                  }`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-panel-text">Port {lp.port}</span>
                        <span className="text-[10px] text-panel-muted uppercase font-mono">{lp.proto}</span>
                      </div>
                      <p className="text-[11px] text-panel-muted truncate">
                        {lp.process || 'Unbekannter Dienst'} <span className="text-panel-muted/60 font-mono">({lp.local || lp.bind})</span>
                      </p>
                    </div>
                    {ohneWhitelist
                      ? <Badge color="gray">Offen</Badge>
                      : <Badge color={erlaubt ? 'green' : 'red'}>{erlaubt ? 'Erlaubt' : 'Drift'}</Badge>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card title="Aktive SSH-Sitzungen">
        {loading && sshSessions.length === 0 ? (
          <p className="text-xs text-panel-muted">Lade aktive Sitzungen …</p>
        ) : sshSessions.length === 0 ? (
          <p className="text-xs text-panel-muted">Keine aktiven SSH-Verbindungen gefunden.</p>
        ) : (
          <div className="space-y-2">
            {sshSessions.map((s, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border border-panel-border rounded-lg bg-panel-surface/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded bg-panel-bg border border-panel-border">
                    <Terminal size={16} className="text-panel-accent" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-panel-text">{s.ip}</span>
                      {s.user && <Badge color="blue">{s.user}</Badge>}
                      {s.tty && <span className="text-xs font-mono text-panel-muted">{s.tty}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-panel-muted mt-0.5">
                      {s.country && s.country !== 'Unknown' && (
                        <span className="flex items-center gap-1"><Globe size={12} /> {(s.country || '').toUpperCase()} {s.city ? `— ${s.city}` : ''}</span>
                      )}
                      {s.loginTime && <span className="flex items-center gap-1"><Clock size={12} /> Login: {s.loginTime}</span>}
                    </div>
                  </div>
                </div>
                <Badge color="green">Aktiv</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SSH-Schlüssel nur mit agents.manage_ssh — wer Schlüssel hinterlegen darf, hat Root-Zugang. */}
      {darfSshKeys && (
        <Card
          title="Autorisierte SSH-Schlüssel"
          action={
            <Button size="sm" onClick={() => setAddKeyModal(true)}>
              <Plus size={14} className="mr-1" /> Schlüssel hinterlegen
            </Button>
          }
        >
          <p className="text-xs text-panel-muted mb-3">
            {sshKeys.length} {sshKeys.length === 1 ? 'Schlüssel' : 'Schlüssel'} hinterlegt
          </p>
          {loading && sshKeys.length === 0 ? (
            <p className="text-xs text-panel-muted">Lade Schlüssel …</p>
          ) : sshKeys.length === 0 ? (
            <p className="text-xs text-panel-muted">Keine autorisierten Schlüssel gefunden.</p>
          ) : (
            <div className="space-y-2">
              {sshKeys.map((k, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 border border-panel-border rounded-lg bg-panel-surface/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color="blue">{k.user}</Badge>
                      <span className="text-sm font-medium text-panel-text truncate">{k.comment || 'Unbenannt'}</span>
                    </div>
                    <p className="text-xs text-panel-muted font-mono">{k.fingerprint}</p>
                    <p className="text-[10px] text-panel-muted mt-1 truncate max-w-xl font-mono">{k.type} …{String(k.key || '').slice(-20)}</p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => removeSshKey(k.fingerprint)}>
                    <Trash2 size={14} className="mr-1" /> Entfernen
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Modal
        open={addKeyModal}
        onClose={() => setAddKeyModal(false)}
        title="Autorisierten SSH-Schlüssel hinterlegen"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setAddKeyModal(false)}>Abbrechen</Button>
            <Button size="sm" onClick={addSshKey} disabled={addingKey || !newKeyForm.key.trim()}>
              {addingKey ? 'Hinterlege …' : 'Schlüssel speichern'}
            </Button>
          </>
        }
      >
        <form onSubmit={addSshKey} className="space-y-4 text-xs">
          <div>
            <label className="block text-panel-muted font-medium mb-1">Benutzerkonto auf dem Server</label>
            <input
              type="text"
              value={newKeyForm.user}
              onChange={(e) => setNewKeyForm(f => ({ ...f, user: e.target.value }))}
              placeholder="root"
              className="w-full bg-panel-bg text-panel-text px-3 py-1.5 rounded-lg border border-panel-border focus:border-panel-accent focus:ring-1 focus:ring-panel-accent outline-none font-mono"
            />
          </div>
          <div>
            <label className="block text-panel-muted font-medium mb-1">Öffentlicher SSH-Schlüssel (Public Key)</label>
            <textarea
              rows={4}
              value={newKeyForm.key}
              onChange={(e) => setNewKeyForm(f => ({ ...f, key: e.target.value }))}
              placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@domain"
              className="w-full bg-panel-bg text-panel-text px-3 py-2 rounded-lg border border-panel-border focus:border-panel-accent focus:ring-1 focus:ring-panel-accent outline-none font-mono text-[11px] resize-none"
            />
            <p className="text-[11px] text-panel-muted mt-1">
              Füge den Einzeiler des öffentlichen Schlüssels ein. Er wird in <code className="text-panel-accent font-mono">~/.ssh/authorized_keys</code> angehängt.
            </p>
          </div>
        </form>
      </Modal>
    </div>
  );
}
