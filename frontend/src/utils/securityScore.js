// Sicherheits-Score eines Servers aus der SSH-Konfiguration (/api/agents/:id/ssh/audit)
// und der Port-Whitelist. Reine Funktion — früher als useMemo in AgentDetail.jsx,
// jetzt vom Security Center genutzt.
//
// Abzüge: Root-Login erlaubt −30, Passwort-Auth −25, Port 22 −10,
// fail2ban fehlt oder inaktiv −15, Port-Drift −20.

export function parseAllowedPorts(text) {
  return (text || '')
    .split(',')
    .map(p => parseInt(p.trim(), 10))
    .filter(p => !isNaN(p) && p > 0 && p <= 65535);
}

export function berechneSicherheitsScore(sshConfig, allowedPortsText) {
  if (!sshConfig) return null;
  let score = 100;
  const checks = [];

  if (sshConfig.PermitRootLogin === 'yes') {
    score -= 30;
    checks.push({ id: 'root', status: 'danger', label: 'Root-Login erlaubt',
      detail: 'Direkter SSH-Login als root erhöht das Risiko von Credential-Stuffing. Empfohlen: "prohibit-password" oder "no".' });
  } else {
    checks.push({ id: 'root', status: 'ok', label: 'Root-Login abgesichert',
      detail: sshConfig.PermitRootLogin === 'no' ? 'Root-Login komplett deaktiviert.' : 'Nur Key-basierter Root-Login erlaubt.' });
  }

  if (sshConfig.PasswordAuthentication === 'yes') {
    score -= 25;
    checks.push({ id: 'pw', status: 'warn', label: 'Passwort-Authentifizierung aktiv',
      detail: 'Passwörter können per Brute-Force erraten werden. Es wird empfohlen, ausschließlich SSH-Keys zuzulassen.' });
  } else {
    checks.push({ id: 'pw', status: 'ok', label: 'Passwort-Authentifizierung deaktiviert',
      detail: 'Nur kryptografische SSH-Schlüssel erlaubt.' });
  }

  const portNum = parseInt(sshConfig.Port, 10) || 22;
  if (portNum === 22) {
    score -= 10;
    checks.push({ id: 'port', status: 'info', label: 'Standard SSH-Port (22)',
      detail: 'Port 22 zieht automatisierte Internet-Scans an. Ein alternativer Port reduziert Log-Spam.' });
  } else {
    checks.push({ id: 'port', status: 'ok', label: `Alternativer SSH-Port (${portNum})`,
      detail: 'Reduziert automatisiertes Scan-Rauschen im Internet.' });
  }

  if (sshConfig.fail2banInstalled && sshConfig.fail2banActive) {
    checks.push({ id: 'fail2ban', status: 'ok', label: 'Fail2ban aktiv',
      detail: `Schutz vor Brute-Force aktiv (${sshConfig.fail2banJails?.length || 0} Jails: ${(sshConfig.fail2banJails || []).join(', ') || 'sshd'}).` });
  } else if (sshConfig.fail2banInstalled) {
    score -= 15;
    checks.push({ id: 'fail2ban', status: 'warn', label: 'Fail2ban installiert aber inaktiv',
      detail: 'Der Fail2ban-Dienst läuft momentan nicht.' });
  } else {
    score -= 15;
    checks.push({ id: 'fail2ban', status: 'warn', label: 'Fail2ban nicht installiert',
      detail: 'Keine automatische IP-Sperre bei fehlgeschlagenen Login-Versuchen.' });
  }

  const allowed = parseAllowedPorts(allowedPortsText);
  let unallowedPorts = [];
  if (allowed.length > 0 && sshConfig.listeningPorts) {
    unallowedPorts = sshConfig.listeningPorts.filter(lp => !allowed.includes(lp.port));
    if (unallowedPorts.length > 0) {
      score -= 20;
      checks.push({ id: 'drift', status: 'danger', label: `Port-Drift: ${unallowedPorts.length} unerlaubte offene Ports`,
        detail: `Gefundene offene Ports außerhalb der Whitelist: ${unallowedPorts.map(p => p.port).join(', ')}.` });
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    checks,
    unallowedPorts,
    rating: score >= 90 ? 'Hervorragend' : score >= 70 ? 'Gut' : score >= 50 ? 'Verbesserungsbedürftig' : 'Kritisch',
  };
}
