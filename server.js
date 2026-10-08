#!/usr/bin/env node
/* Guess-o-Rama server.
 *
 * Serves the game from ./public and relays room "presence" over WebSocket:
 * every connection joins one named room and publishes a small JSON object
 * describing itself (the host publishes the game state, players publish their
 * name and latest guess). The server keeps each peer's latest object and
 * forwards changes to the rest of the room. All game logic runs in the host's
 * browser, so the server stays tiny and never needs to know the rules.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const qrcode = require('qrcode-generator');
const { WebSocketServer } = require('ws');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const LIMITS = {
  messageBytes: 16 * 1024,
  presenceBytes: 8 * 1024,
  peersPerRoom: 40,
  rooms: 5000,
  connections: 5000,
  msgsPerSecond: 30,
  burst: 90,
};
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

function privateRank(ip) {
  if (/^192\.168\./.test(ip)) return 0;
  if (/^10\./.test(ip)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 2;
  return 3;
}

// IPv4 addresses other devices on the same network can use to reach us.
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out.sort((a, b) => privateRank(a) - privateRank(b));
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(pathname, req, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  if (rel.includes('\0')) return sendText(res, 400, 'Bad request');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendText(res, 404, 'Not found');
    const modified = st.mtime.toUTCString();
    if (req.headers['if-modified-since'] === modified) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Last-Modified': modified,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function createServer() {
  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendText(res, 400, 'Bad request');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    if (url.pathname === '/api/info') {
      const port = server.address().port;
      return sendJson(res, { ok: true, online: true, lan: lanAddresses().map((ip) => `http://${ip}:${port}`) });
    }
    if (url.pathname === '/api/qr.svg') {
      const text = url.searchParams.get('d') || '';
      if (!text || text.length > 300) return sendText(res, 400, 'Bad request');
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }));
    }
    serveStatic(url.pathname, req, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.messageBytes });
  const rooms = new Map(); // room name -> Map(peer id -> peer)

  function send(peer, msg) {
    if (peer.ws.readyState === 1) peer.ws.send(JSON.stringify(msg));
  }

  function broadcast(room, except, msg) {
    const text = JSON.stringify(msg);
    for (const p of room.values()) {
      if (p === except || p.ws.readyState !== 1) continue;
      if (p.ws.bufferedAmount > 1024 * 1024) {
        p.ws.terminate(); // hopelessly slow client; it can reconnect
        continue;
      }
      p.ws.send(text);
    }
  }

  function leave(peer) {
    const name = peer.room;
    if (!name) return;
    peer.room = null;
    const room = rooms.get(name);
    if (!room) return;
    room.delete(peer.id);
    if (room.size === 0) rooms.delete(name);
    else broadcast(room, null, { t: 'left', id: peer.id });
  }

  function join(peer, name) {
    if (typeof name !== 'string' || !ROOM_RE.test(name)) return send(peer, { t: 'err', code: 'bad_room' });
    leave(peer);
    let room = rooms.get(name);
    if (!room) {
      if (rooms.size >= LIMITS.rooms) return send(peer, { t: 'err', code: 'busy' });
      room = new Map();
      rooms.set(name, room);
    }
    if (room.size >= LIMITS.peersPerRoom) return send(peer, { t: 'err', code: 'room_full' });
    peer.room = name;
    peer.presence = {};
    room.set(peer.id, peer);
    const others = [...room.values()].filter((p) => p !== peer).map((p) => ({ id: p.id, d: p.presence }));
    send(peer, { t: 'joined', room: name, you: peer.id, peers: others });
    broadcast(room, peer, { t: 'p', id: peer.id, d: peer.presence });
  }

  function setPresence(peer, d, bytes) {
    if (!peer.room || !d || typeof d !== 'object' || Array.isArray(d)) return;
    if (bytes > LIMITS.presenceBytes) return send(peer, { t: 'err', code: 'too_big' });
    peer.presence = d;
    const room = rooms.get(peer.room);
    if (room) broadcast(room, peer, { t: 'p', id: peer.id, d });
  }

  // Token bucket: a steady 30 messages a second with bursts up to 90.
  function allow(peer) {
    const now = Date.now();
    peer.tokens = Math.min(LIMITS.burst, peer.tokens + ((now - peer.last) * LIMITS.msgsPerSecond) / 1000);
    peer.last = now;
    if (peer.tokens < 1) return false;
    peer.tokens -= 1;
    return true;
  }

  wss.on('connection', (ws) => {
    if (wss.clients.size > LIMITS.connections) return ws.close(1013, 'Server busy');
    const peer = { id: crypto.randomBytes(6).toString('base64url'), ws, room: null, presence: {}, alive: true, tokens: LIMITS.burst, last: Date.now() };
    ws.peer = peer;
    ws.on('pong', () => {
      peer.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary || !allow(peer)) return;
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'join') join(peer, msg.room);
      else if (msg.t === 'p') setPresence(peer, msg.d, data.length);
      else if (msg.t === 'leave') leave(peer);
    });
    ws.on('close', () => leave(peer));
    ws.on('error', () => {});
  });

  // Drop connections that stopped answering pings (phones that went to sleep).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.peer) continue;
      if (!ws.peer.alive) {
        ws.terminate();
        continue;
      }
      ws.peer.alive = false;
      ws.ping();
    }
  }, 30000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));

  return { server, wss, rooms };
}

module.exports = { createServer, lanAddresses, LIMITS };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const { server, wss } = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. Try another one, e.g.  PORT=3001 npm start\n`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(port, host, () => {
    console.log('\n  Guess-o-Rama is running!\n');
    console.log(`  On this computer:   http://localhost:${port}`);
    for (const ip of lanAddresses()) console.log(`  On your Wi-Fi:      http://${ip}:${port}`);
    console.log('\n  Open it on the big screen and choose "Play on one screen", or');
    console.log('  "Host an online game" so friends on the same Wi-Fi join from their phones.');
    console.log('  Clips and photos stream from YouTube and Wikipedia, so keep the internet on.\n');
  });
  const stop = () => {
    for (const ws of wss.clients) ws.terminate();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
