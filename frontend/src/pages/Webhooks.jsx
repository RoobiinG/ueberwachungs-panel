import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { Plus, Trash2, Send, MessageCircle, Hash } from 'lucide-react';

const inputCls = 'w-full bg-panel-surface border border-panel-border rounded-md px-3 py-2 text-sm text-panel-text focus:outline-none focus:border-panel-accent transition-colors';

// Baut aus Token + ChatId die interne URL
const buildTelegramUrl = (token, chatId) =>
  `https://api.telegram.org/bot${token.trim()}/sendMessage?chat_id=${chatId.trim()}`;

// Extrahiert Token + ChatId aus gespeicherter URL
const parseTelegramUrl = (url) => {
  try {
    const u = new URL(url);
    const token  = u.pathname.split('/')[2] || '';
    const chatId = u.searchParams.get('chat_id') || '';
    return { token, chatId };
  } catch { return { token: '', chatId: '' }; }
};

export default function Webhooks() {
  const { canWrite } = useAuth();
  const [webhooks,    setWebhooks]    = useState([]);
  const [showAdd,     setShowAdd]     = useState(false);
  const [form,        setForm]        = useState({ name: '', type: 'telegram', url: '', method: 'POST', headers: '{}', template: '' });
  const [tgToken,     setTgToken]     = useState('');
  const [tgChatId,    setTgChatId]    = useState('');
  const [testLoading, setTestLoading] = useState({});
  const [testResult,  setTestResult]  = useState({});

  const load = async () => {
    const { data } = await axios.get('/api/webhooks');
    setWebhooks(data);
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ name: '', type: 'telegram', url: '', method: 'POST', headers: '{}', template: '' });
    setTgToken('');
    setTgChatId('');
  };


  const canSave = () => {
    if (!form.name.trim()) return false;
    if (form.type === 'telegram') return tgToken.trim().length > 0 && tgChatId.trim().length > 0;
    return form.url.trim().length > 0;
  };

  const save = async () => {
    const url = form.type === 'telegram'
      ? buildTelegramUrl(tgToken, tgChatId)
      : form.url;
    try {
      await axios.post('/api/webhooks', { ...form, url });
      setShowAdd(false);
      resetForm();
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Fehler beim Speichern');
    }
  };

  const remove = async (id) => {
    if (!confirm('Webhook löschen? Alle verknüpften Alert-Regeln werden ebenfalls gelöscht.')) return;
    await axios.delete(`/api/webhooks/${id}`);
    load();
  };

  const test = async (id) => {
    setTestLoading(p => ({ ...p, [id]: true }));
    try {
      await axios.post(`/api/webhooks/${id}/test`);
      setTestResult(p => ({ ...p, [id]: 'ok' }));
    } catch {
      setTestResult(p => ({ ...p, [id]: 'err' }));
    }
    setTestLoading(p => ({ ...p, [id]: false }));
    setTimeout(() => setTestResult(p => ({ ...p, [id]: null })), 4000);
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => { resetForm(); setShowAdd(true); }}>
            <Plus size={14} className="mr-1" />Webhook hinzufügen
          </Button>
        </div>
      )}

      <Card title={`Webhooks (${webhooks.length})`}>
        {webhooks.length === 0 ? (
          <div className="text-panel-muted text-sm py-6 text-center">
            <MessageCircle size={28} className="mx-auto mb-2 opacity-30" />
            Noch keine Webhooks konfiguriert
          </div>
        ) : (
          <div className="-mx-4 -mb-4">
            {webhooks.map(w => {
              const parsed = w.type === 'telegram' ? parseTelegramUrl(w.url) : null;
              return (
                <div key={w.id} className="flex items-center justify-between px-4 py-3 list-row">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-2">
                      <Badge color={w.type === 'discord' ? 'purple' : 'blue'}>{w.type}</Badge>
                      <span className="text-sm font-medium text-panel-text">{w.name}</span>
                    </div>
                    <div className="text-xs text-panel-muted mt-0.5">
                      {w.type === 'telegram' && parsed
                        ? <>Bot: <span className="font-mono">{parsed.token.slice(0, 12)}…</span> · Chat-ID: <span className="font-mono">{parsed.chatId}</span></>
                        : <span className="truncate block max-w-xs">{w.url}</span>
                      }
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {testResult[w.id] && (
                      <span className={`text-xs font-medium ${testResult[w.id] === 'ok' ? 'text-panel-green' : 'text-panel-red'}`}>
                        {testResult[w.id] === 'ok' ? '✓ Gesendet' : '✗ Fehler'}
                      </span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => test(w.id)} disabled={testLoading[w.id]}
                      title="Test-Nachricht senden">
                      <Send size={12} className="mr-1" />Test
                    </Button>
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={() => remove(w.id)}
                        className="text-panel-red hover:bg-panel-red/10 border-0">
                        <Trash2 size={12} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Webhook hinzufügen ─────────────────────────────────────────── */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); resetForm(); }} title="Webhook hinzufügen" zIndex="z-[60]"
        footer={<>
          <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); resetForm(); }}>Abbrechen</Button>
          <Button size="sm" onClick={save} disabled={!canSave()}>Speichern</Button>
        </>}
      >
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-panel-muted mb-1">Name</label>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="z.B. Server-Alerts" className={inputCls} />
          </div>

          {/* Typ-Auswahl als Buttons */}
          <div>
            <label className="block text-xs text-panel-muted mb-2">Typ</label>
            <div className="flex gap-2">
              {[
                { value: 'telegram', label: '✈️ Telegram', desc: 'Bot-Token + Chat-ID' },
                { value: 'discord',  label: '🎮 Discord',  desc: 'Webhook-URL (Rich Embed)' },
                { value: 'custom',   label: '🔗 Custom',   desc: 'JSON Webhook / Template' },
              ].map(t => (
                <button
                  key={t.value}
                  onClick={() => set('type', t.value)}
                  className={`flex-1 px-3 py-2.5 rounded-lg border text-left transition-all ${
                    form.type === t.value
                      ? 'border-panel-accent bg-panel-accent/10 text-panel-accent'
                      : 'border-panel-border text-panel-muted hover:border-panel-muted/50 hover:text-panel-text'
                  }`}
                >
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs opacity-70 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Telegram — vereinfachtes Formular */}
          {form.type === 'telegram' && (
            <div className="space-y-3">
              <div className="bg-panel-surface rounded-lg p-3 border border-panel-border text-xs text-panel-muted space-y-1.5">
                <p className="font-semibold text-panel-text text-xs">Setup in 3 Schritten:</p>
                <p>1. <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-panel-accent hover:underline">@BotFather</a> in Telegram öffnen → <code className="bg-panel-card px-1 rounded">/newbot</code> → Token kopieren</p>
                <p>2. Bot in deinen Kanal/Gruppe einladen (oder direkt anschreiben)</p>
                <p>3. Chat-ID: <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-panel-accent hover:underline">@userinfobot</a> anschreiben oder <code className="bg-panel-card px-1 rounded">/api/telegram/updates</code> aufrufen</p>
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1 flex items-center gap-1">
                  <MessageCircle size={11} />Bot-Token
                </label>
                <input
                  value={tgToken}
                  onChange={e => setTgToken(e.target.value)}
                  placeholder="1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ"
                  className={inputCls + ' font-mono text-xs'}
                />
                <p className="text-[11px] text-panel-muted mt-1">Von @BotFather beim Erstellen des Bots</p>
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1 flex items-center gap-1">
                  <Hash size={11} />Chat-ID
                </label>
                <input
                  value={tgChatId}
                  onChange={e => setTgChatId(e.target.value)}
                  placeholder="-1001234567890 oder 123456789"
                  className={inputCls + ' font-mono text-xs'}
                />
                <p className="text-[11px] text-panel-muted mt-1">Positiv = persönlicher Chat, Negativ = Gruppe/Kanal</p>
              </div>

              {tgToken && tgChatId && (
                <div className="bg-panel-surface rounded-md px-3 py-2 border border-panel-border/50">
                  <p className="text-[10px] text-panel-muted mb-0.5">Generierte URL:</p>
                  <p className="text-[10px] font-mono text-panel-muted break-all">
                    {buildTelegramUrl(tgToken, tgChatId)}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Discord — URL-Feld */}
          {form.type === 'discord' && (
            <div>
              <label className="block text-xs text-panel-muted mb-1">Webhook-URL</label>
              <input
                value={form.url}
                onChange={e => set('url', e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className={inputCls}
              />
              <p className="text-[11px] text-panel-muted mt-1">
                Discord → Server-Einstellungen → Integrationen → Webhooks → Neuer Webhook
              </p>
            </div>
          )}

          {/* Custom — URL, Method, Headers, Template */}
          {form.type === 'custom' && (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-2">
                <div className="col-span-1">
                  <label className="block text-xs text-panel-muted mb-1">Methode</label>
                  <select
                    value={form.method || 'POST'}
                    onChange={e => set('method', e.target.value)}
                    className={inputCls}
                  >
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-panel-muted mb-1">Webhook-URL</label>
                  <input
                    value={form.url}
                    onChange={e => set('url', e.target.value)}
                    placeholder="https://api.gotify.net/message?token=..."
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">Headers (JSON)</label>
                <input
                  value={form.headers || '{}'}
                  onChange={e => set('headers', e.target.value)}
                  placeholder='{"Authorization": "Bearer TOKEN"}'
                  className={inputCls + ' font-mono text-xs'}
                />
              </div>

              <div>
                <label className="block text-xs text-panel-muted mb-1">JSON Template</label>
                <textarea
                  rows={4}
                  value={form.template || ''}
                  onChange={e => set('template', e.target.value)}
                  placeholder='{"title": "{{alert_title}}", "message": "{{message}}", "server": "{{server_name}}"}'
                  className={inputCls + ' font-mono text-xs'}
                />
                <p className="text-[11px] text-panel-muted mt-1">
                  Verfügbare Platzhalter: <code className="bg-panel-card px-1 rounded">{"{{server_name}}"}</code>, <code className="bg-panel-card px-1 rounded">{"{{alert_title}}"}</code>, <code className="bg-panel-card px-1 rounded">{"{{severity}}"}</code>, <code className="bg-panel-card px-1 rounded">{"{{value}}"}</code>, <code className="bg-panel-card px-1 rounded">{"{{message}}"}</code>
                </p>
              </div>
            </div>
          )}
        </div>
      </Modal>

    </div>
  );
}
