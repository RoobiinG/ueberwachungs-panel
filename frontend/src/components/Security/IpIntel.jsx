import { Badge } from '../ui/Badge';

// Herkunft und Einstufung einer IP, wie sie das Backend liefert (utils/ipIntel.js):
// { land, stadt, isp, asn, asnOrg, typ, missbrauch, status }.
// Die Daten stammen teils von einem Drittanbieter — React maskiert sie ohnehin, und hier
// werden sie ausschließlich als Text ausgegeben.

const TYP = {
  tor:           { label: 'Tor',           color: 'red' },
  vpn:           { label: 'VPN',           color: 'red' },
  proxy:         { label: 'Proxy',         color: 'red' },
  rechenzentrum: { label: 'Rechenzentrum', color: 'orange' },
  mobil:         { label: 'Mobilfunk',     color: 'blue' },
  provider:      { label: 'Provider',      color: 'gray' },
};

const STATUS_TEXT = {
  ausstehend:         'wird ermittelt …',
  nicht_eingerichtet: 'Provider-Daten nicht eingerichtet',
  fehler:             'Provider unbekannt',
  intern:             'internes Netz',
};

// Ländercode → Flaggen-Emoji (Regional Indicator Symbols).
export function flagge(code) {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/** Kompakte Herkunft: Flagge, Land, Stadt. */
export function IpHerkunft({ intel }) {
  if (!intel?.land) return <span className="text-panel-muted">—</span>;
  return (
    <span className="whitespace-nowrap" title={[intel.stadt, intel.land].filter(Boolean).join(', ')}>
      <span className="mr-1" aria-hidden="true">{flagge(intel.land)}</span>
      {intel.land}{intel.stadt ? <span className="text-panel-muted"> · {intel.stadt}</span> : null}
    </span>
  );
}

/** Provider bzw. ASN, mit Hinweis, solange die Daten noch geholt werden. */
export function IpProvider({ intel }) {
  if (intel?.isp) {
    return (
      <span className="block max-w-[14rem] truncate" title={[intel.isp, intel.asn ? `AS${intel.asn}` : null, intel.asnOrg].filter(Boolean).join(' · ')}>
        {intel.isp}{intel.asn ? <span className="text-panel-muted"> · AS{intel.asn}</span> : null}
      </span>
    );
  }
  return <span className="text-panel-muted italic">{STATUS_TEXT[intel?.status] || '—'}</span>;
}

/** Einstufung als Badge (VPN/Proxy/Tor rot, Rechenzentrum orange, sonst grau). */
export function IpTyp({ intel }) {
  const t = TYP[intel?.typ];
  if (!t) return <span className="text-panel-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge color={t.color}>{t.label}</Badge>
      {intel.missbrauch && <Badge color="red">bekannt für Missbrauch</Badge>}
    </span>
  );
}
