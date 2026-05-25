import { useEffect, useState } from 'react';
import axios from 'axios';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { Activity, Globe } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const fmtSpeed = (bps) => {
  if (!bps || bps < 0) return '0 B/s';
  if (bps > 1048576) return `${(bps / 1048576).toFixed(1)} MB/s`;
  if (bps > 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
};

export default function Network({ liveStats }) {
  const [interfaces, setInterfaces] = useState([]);
  const [publicIp, setPublicIp] = useState('');
  const [history, setHistory] = useState([]);

  useEffect(() => {
    axios.get('/api/network/interfaces').then(r => setInterfaces(r.data)).catch(() => {});
    axios.get('/api/network/public-ip').then(r => setPublicIp(r.data.ip || '')).catch(() => {});
  }, []);

  useEffect(() => {
    if (!liveStats?.network?.[0]) return;
    const n = liveStats.network[0];
    setHistory(h => [...h.slice(-29), {
      t: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      rx: Math.round((n.rxSec || 0) / 1024),
      tx: Math.round((n.txSec || 0) / 1024),
    }]);
  }, [liveStats]);

  const n0 = liveStats?.network?.[0];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard title="Download" value={n0 ? fmtSpeed(n0.rxSec) : '—'} unit="" icon={Activity} color="green" />
        <StatCard title="Upload" value={n0 ? fmtSpeed(n0.txSec) : '—'} unit="" icon={Activity} color="blue" />
        <StatCard title="Öffentliche IP" value={publicIp || '—'} unit="" icon={Globe} color="purple" />
      </div>

      {history.length > 1 && (
        <Card title="Netzwerk-Traffic (Live)">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8b949e', fontSize: 10 }} unit=" KB/s" />
              <Tooltip contentStyle={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '6px', fontSize: '12px' }} labelStyle={{ color: '#e6edf3' }} />
              <Legend />
              <Line type="monotone" dataKey="rx" name="Download (KB/s)" stroke="#3fb950" dot={false} strokeWidth={1.5} />
              <Line type="monotone" dataKey="tx" name="Upload (KB/s)" stroke="#388bfd" dot={false} strokeWidth={1.5} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Netzwerk-Interfaces">
        {interfaces.length === 0 ? (
          <div className="text-panel-muted text-sm py-4 text-center">Keine Interfaces gefunden</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {interfaces.map((iface, i) => (
              <div key={i} className="bg-panel-surface rounded-md p-3 text-xs">
                <div className="flex justify-between mb-2">
                  <span className="font-medium text-panel-text">{iface.iface || iface.ifaceName}</span>
                  <span className={iface.operstate === 'up' ? 'text-panel-green' : 'text-panel-red'}>{iface.operstate}</span>
                </div>
                <div className="text-panel-muted space-y-0.5">
                  {iface.ip4 && <div>IPv4: <span className="text-panel-text">{iface.ip4}</span></div>}
                  {iface.ip6 && <div>IPv6: <span className="text-panel-text font-mono text-xs">{iface.ip6.slice(0, 20)}…</span></div>}
                  {iface.mac && <div>MAC: <span className="text-panel-text font-mono">{iface.mac}</span></div>}
                  {iface.speed > 0 && <div>Speed: <span className="text-panel-text">{iface.speed} Mbit/s</span></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
