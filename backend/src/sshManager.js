let Client;
try { Client = require('ssh2').Client; } catch {}

const db      = require('./db');
const { decrypt } = require('./utils/keyEncryption');

// Map<ws, { conn: ssh2.Client, stream: ssh2.Channel }>
const sessions = new Map();

function sendToClient(ws, type, data) {
  if (ws.readyState !== 1 /* OPEN */) return;
  try { ws.send(JSON.stringify({ type, ...data })); } catch {}
}

async function connect(ws, hostId, userId) {
  if (!Client) return sendToClient(ws, 'ssh_error', { message: 'ssh2 nicht verfügbar' });

  // Vorherige Session trennen
  disconnect(ws);

  const host = db.prepare('SELECT * FROM ssh_hosts WHERE id = ? AND user_id = ?').get(hostId, userId);
  if (!host) return sendToClient(ws, 'ssh_error', { message: 'SSH-Host nicht gefunden' });

  let privateKey;
  if (host.auth_type === 'key' && host.ssh_key_id) {
    const keyRow = db.prepare('SELECT private_key FROM ssh_keys WHERE id = ? AND user_id = ?').get(host.ssh_key_id, userId);
    if (!keyRow) return sendToClient(ws, 'ssh_error', { message: 'SSH-Key nicht gefunden' });
    try { privateKey = decrypt(keyRow.private_key); }
    catch { return sendToClient(ws, 'ssh_error', { message: 'SSH-Key konnte nicht entschlüsselt werden' }); }
  }

  const conn = new Client();

  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) {
        sendToClient(ws, 'ssh_error', { message: err.message });
        conn.end();
        return;
      }
      sessions.set(ws, { conn, stream });
      sendToClient(ws, 'ssh_connected', {});

      stream.on('data', (data) => sendToClient(ws, 'ssh_output', { data: data.toString('base64') }));
      stream.stderr.on('data', (data) => sendToClient(ws, 'ssh_output', { data: data.toString('base64') }));
      stream.on('close', () => {
        sessions.delete(ws);
        sendToClient(ws, 'ssh_closed', {});
        conn.end();
      });
    });
  });

  conn.on('error', (err) => {
    sessions.delete(ws);
    sendToClient(ws, 'ssh_error', { message: err.message });
  });

  conn.on('close', () => {
    sessions.delete(ws);
  });

  const connectConfig = {
    host:     host.hostname,
    port:     host.port || 22,
    username: host.username,
    readyTimeout: 10_000,
  };

  if (privateKey) {
    connectConfig.privateKey = privateKey;
  } else {
    return sendToClient(ws, 'ssh_error', { message: 'Passwort-Auth über Browser nicht unterstützt — bitte SSH-Key verwenden' });
  }

  try {
    conn.connect(connectConfig);
  } catch (err) {
    sendToClient(ws, 'ssh_error', { message: err.message });
  }
}

function write(ws, data) {
  const session = sessions.get(ws);
  if (session?.stream) {
    try { session.stream.write(data); } catch {}
  }
}

function resize(ws, cols, rows) {
  const session = sessions.get(ws);
  if (session?.stream) {
    try { session.stream.setWindow(rows, cols, 0, 0); } catch {}
  }
}

function disconnect(ws) {
  const session = sessions.get(ws);
  if (session) {
    try { session.stream?.close(); } catch {}
    try { session.conn?.end(); } catch {}
    sessions.delete(ws);
  }
}

module.exports = { connect, write, resize, disconnect };
