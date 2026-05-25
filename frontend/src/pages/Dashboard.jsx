import { useEffect, useState, useCallback } from 'react';
import { Cpu, HardDrive, Server, MemoryStick } from 'lucide-react';
import axios from 'axios';
import { StatCard } from '../components/ui/StatCard';
import { Card } from '../components/ui/Card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const RANGES = [
  { key: '1h',  label: '1 Std' },
  { key: '24h', label: '24 Std' },
  { key: '7d',  label: '7 Tage' },
  { key: '30d', label: '30 Tage' },
];

const fmtTs = (ts, range) => {
  const d = new Date(ts * 1000);
  if (range === '1h' || range === '24h')
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

const fmtBytes = (b, d = 1) => {
  if (!b) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(d))} ${sizes[i]}`;
};

const fmtUptime = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

export default function Dashboard({ liveStats }) {
  const [info, setInfo]         = useState(null);
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ltRange, setLtRange]   = useState('24h');
  const [ltData, setLtData]     = useState([]);
  const [ltLoading, setLtLoading] = useState(false);

  useEffect(() => {
    axios.get('/api/system/stats').then(r => { setInfo(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const loadLongterm = useCallback(async (range) => {
    setLtLoading(true);
    try {
      const { data } = await axios.get(`/api/metrics?range=${range}`);
      setLtData(data.rows || []);
    } catch {}
    setLtLoading(false);
  }, []);

  useEffect(() => { loadLongterm(ltRange); }, [ltRange, loadLongterm]);

  useEffect(() => {
    if (!liveStats) return;
    setHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      cpu: liveStats.cpu,
      mem: liveStats.memory?.usedPercent,
    }]);
  }, [liveStats]);

  if (loading) return <div className="text-panel-muted text-sm">Lade Systemdaten...</div>;

  const cpu = liveStats?.cpu ?? info?.cpu?.usage ?? 0;
  const memPct = liveStats?.memory?.usedPercent ?? info?.memory?.usedPercent ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="CPU Auslastung" value={cpu} unit="%" icon={Cpu} color="blue" percent={cpu} />
        <StatCard
          title="RAM Auslastung" value={memPct} unit="%" icon={MemoryStick} color="green"
          subtitle={info ? `${fmtBytes(info.memory.used)} / ${fmtBytes(info.memory.total)}` : ''}
          percent={memPct}
        />
        {info?.disk?.[0] && (
          <StatCard
            title="Festplatte" value={Math.round(info.disk[0].usedPercent)} unit="%" icon={HardDrive} color="orange"
            subtitle={`${fmtBytes(info.disk[0].used)} / ${fmtBytes(info.disk[0].size)}`}
            percent={info.disk[0].usedPercent}
          />
        )}
        <StatCard
          title="System" value={info?.os?.distro?.split(' ')[0] ?? '—'} unit="" icon={Server} color="purple"
          subtitle={info?.os ? `${info.os.hostname} · ${fmtUptime(info.os.uptime)}` : ''}
        />
      </div>

      {history.length > 1 && (
        <Card title="CPU & RAM (Live)">
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="gcpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#388bfd" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#388bfd" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gmem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3fb950" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '12px' }} labelStyle={{ color: '#e6edf3' }} />
              <Area type="monotone" dataKey="cpu" name="CPU" stroke="#388bfd" fill="url(#gcpu)" strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="mem" name="RAM" stroke="#3fb950" fill="url(#gmem)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {info?.disk && info.disk.length > 0 && (
        <Card title="Festplatten">
          <div className="space-y-3">
            {info.disk.map((d, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-panel-text">{d.mount} <span className="text-panel-muted">({d.fs})</span></span>
                  <span className="text-panel-muted">{fmtBytes(d.used)} / {fmtBytes(d.size)}</span>
                </div>
                <div className="h-1.5 bg-panel-surface rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${d.usedPercent > 80 ? 'bg-panel-red' : d.usedPercent > 60 ? 'bg-panel-orange' : 'bg-panel-accent'}`}
                    style={{ width: `${Math.min(d.usedPercent, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Langzeit-Monitoring */}
      <Card title={
        <div className="flex items-center justify-between w-full">
          <span>Langzeit-Monitoring</span>
          <div className="flex gap-1">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setLtRange(r.key)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  ltRange === r.key
                    ? 'bg-panel-accent text-white'
                    : 'text-panel-muted hover:text-panel-text'
                }`}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      }>
        {ltLoading ? (
          <div className="text-panel-muted text-xs text-center py-6">Lade...</div>
        ) : ltData.length < 2 ? (
          <div className="text-panel-muted text-xs text-center py-6">
            Noch zu wenig Daten — Aufzeichnung läuft alle 5 Minuten
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={ltData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="ltcpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#388bfd" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#388bfd" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ltmem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3fb950" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ltdisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#e3b341" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#e3b341" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tickFormatter={t => fmtTs(t, ltRange)}
                tick={{ fill: '#8b949e', fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 10 }} unit="%" />
              <Tooltip
                contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '12px' }}
                labelFormatter={t => fmtTs(t, ltRange)}
                formatter={(v, name) => [`${v}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Area type="monotone" dataKey="cpu"  name="CPU"  stroke="#388bfd" fill="url(#ltcpu)"  strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="mem"  name="RAM"  stroke="#3fb950" fill="url(#ltmem)"  strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="disk" name="Disk" stroke="#e3b341" fill="url(#ltdisk)" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {info?.os && (
        <Card title="System-Info">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              ['Hostname', info.os.hostname],
              ['Betriebssystem', `${info.os.distro} ${info.os.release}`],
              ['Architektur', info.os.arch],
              ['Laufzeit', fmtUptime(info.os.uptime)],
            ].map(([k, v]) => (
              <div key={k} className="bg-panel-surface rounded-md p-3">
                <div className="text-panel-muted mb-0.5">{k}</div>
                <div className="text-panel-text font-medium truncate">{v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
