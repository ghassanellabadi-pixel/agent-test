'use strict';
// The phone-only rooms (public/js/net.js, MQTT over WebSocket) against a real
// MQTT broker (aedes) running here, using Node's built-in WebSocket.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer, createWebSocketStream } = require('ws');
const { load, plain } = require('./helpers/load');

async function startBroker() {
  const { Aedes } = await import('aedes');
  const broker = await Aedes.createBroker();
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (socket) => broker.handle(createWebSocketStream(socket)));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    // Cut every connection without a goodbye, as a phone losing signal would.
    drop: () => { for (const c of wss.clients) c.terminate(); },
    close: () => new Promise((r) => {
      for (const c of wss.clients) c.terminate();
      broker.close(() => server.close(r));
    }),
  };
}

// Each device gets its own copy of net.js, as each phone would.
function device(brokers) {
  const G = load(['net.js'], {
    WebSocket, TextEncoder, TextDecoder, URL,
    location: { protocol: 'file:', href: 'file:///game/index.html' },
    GOR_BROKERS: brokers,
  });
  return G.net;
}

// Opens a room on a fresh device; the channel is closed when the test ends.
async function join(t, brokers, code, opts) {
  const N = device(brokers);
  const net = await N.detect();
  assert.equal(net.kind, 'mqtt');
  const ch = await N.open(net, code, opts);
  if (t) t.after(() => ch.close());
  return ch;
}

function waitFor(ch, test, ms = 8000) {
  return new Promise((resolve, reject) => {
    if (test(ch.peers())) return resolve(ch.peers());
    const t = setTimeout(() => { off(); reject(new Error('timed out; peers: ' + JSON.stringify(ch.peers()))); }, ms);
    const off = ch.onPeers((peers) => { if (test(peers)) { clearTimeout(t); off(); resolve(peers); } });
  });
}
const hasHost = (peers) => peers.some((p) => p.p.r === 'host');

test('host and players meet in a room and see each other leave', async (t) => {
  const b = await startBroker();
  t.after(b.close);
  const host = await join(t, [b.url], 'BRTK');
  host.setPresence({ r: 'host', s: { ph: 'lobby', n: 0 } });
  const phone = await join(t, [b.url], 'BRTK', { seek: true });
  const seen = await waitFor(phone, hasHost);
  assert.deepEqual(plain(seen[0].p), { r: 'host', s: { ph: 'lobby', n: 0 } });
  phone.setPresence({ r: 'player', nm: 'Ann', g: null });
  await waitFor(host, (peers) => peers.some((p) => p.p.nm === 'Ann'));
  phone.setPresence({ r: 'player', nm: 'Ann', g: ['g1', 1, 2, 'paris'] });
  await waitFor(host, (peers) => peers.some((p) => p.p.g && p.p.g[3] === 'paris'));

  const other = await join(t, [b.url], 'ZZZZ');                // another room hears nothing
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(plain(other.peers()), []);
  other.close();

  phone.close();                                             // a clean goodbye
  await waitFor(host, (peers) => peers.length === 0);
  host.close();
});

test('a latecomer gets the room at once, and a dropped phone disappears', async (t) => {
  const b = await startBroker();
  t.after(b.close);
  const host = await join(t, [b.url], 'LATE');
  host.setPresence({ r: 'host', s: { ph: 'q' } });
  await new Promise((r) => setTimeout(r, 200));
  const phone = await join(t, [b.url], 'LATE');
  assert.ok(hasHost(phone.peers()), 'the host is there as soon as the room opens');
  phone.setPresence({ r: 'player', nm: 'Bo' });
  await waitFor(host, (peers) => peers.length === 1);

  // Losing signal: no goodbye, so the broker's last will clears the presence,
  // and both sides reconnect by themselves.
  const statuses = [];
  host.onStatus((st) => statuses.push(st));
  b.drop();
  await waitFor(host, (peers) => peers.length === 0).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(statuses.includes('reconnecting') && statuses[statuses.length - 1] === 'ok', 'reconnected: ' + statuses.join(','));
  await waitFor(host, (peers) => peers.some((p) => p.p.nm === 'Bo'));   // the phone came back too
  await waitFor(phone, hasHost);
  host.close();
  phone.close();
});

test('big states survive the trip', async (t) => {
  const b = await startBroker();
  t.after(b.close);
  const host = await join(t, [b.url], 'BIGG');
  const phone = await join(t, [b.url], 'BIGG');
  for (const size of [100, 3800, 20000]) {
    const s = { pad: 'é'.repeat(size) };
    host.setPresence({ r: 'host', s });
    const peers = await waitFor(phone, (ps) => ps.some((p) => p.p.s && p.p.s.pad.length === size));
    assert.equal(peers[0].p.s.pad, s.pad);
  }
  host.close();
  phone.close();
});

test('an unreachable relay is skipped, and players find a host on another one', async (t) => {
  const b1 = await startBroker();
  const b2 = await startBroker();
  t.after(() => Promise.all([b1.close(), b2.close()]));
  const dead = 'ws://127.0.0.1:9';                           // nothing listens here
  const host = await join(t, [dead, b2.url], 'SEEK');           // ends up on b2
  host.setPresence({ r: 'host', s: { ph: 'lobby' } });
  // This phone reaches b1 first, finds the room empty and looks on b2.
  const phone = await join(t, [b1.url, b2.url], 'SEEK', { seek: true });
  await waitFor(phone, hasHost, 10000);
  phone.setPresence({ r: 'player', nm: 'Cy' });
  await waitFor(host, (peers) => peers.some((p) => p.p.nm === 'Cy'));
  host.close();
  phone.close();
});

test('no relay at all: opening a room fails cleanly', async () => {
  await assert.rejects(join(null, ['ws://127.0.0.1:9'], 'NONE'), /No relay could be reached/);
});
