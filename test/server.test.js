'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocket } = require('ws');
const { createServer, LIMITS } = require('../server');

function start() {
  const { server, wss } = createServer();
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, ws: base.replace('http', 'ws') + '/ws', close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); server.close(r); }) });
  }));
}

function get(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// A WebSocket client that queues the server's messages for the test to await.
function client(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue = [], waiting = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      const w = waiting.findIndex((x) => x.match(msg));
      if (w >= 0) waiting.splice(w, 1)[0].resolve(msg); else queue.push(msg);
    });
    ws.on('open', () => resolve({
      send: (m) => ws.send(JSON.stringify(m)),
      next: (match = () => true, ms = 2000) => {
        const i = queue.findIndex(match);
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const entry = { match, resolve: (m) => { clearTimeout(t); res(m); } };
          const t = setTimeout(() => { waiting.splice(waiting.indexOf(entry), 1); rej(new Error('no message')); }, ms);
          waiting.push(entry);
        });
      },
      close: () => ws.close(),
    }));
    ws.on('error', reject);
  });
}

test('serves the game and blocks paths outside it', async (t) => {
  const srv = await start();
  t.after(srv.close);
  const home = await get(srv.base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.match(home.body, /<script src="js\/media\.js">/);
  const js = await get(srv.base + '/js/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers['content-type'], /javascript/);
  const again = await get(srv.base + '/js/app.js', { 'If-Modified-Since': js.headers['last-modified'] });
  assert.equal(again.status, 304);
  assert.equal((await get(srv.base + '/nope.js')).status, 404);
  for (const p of ['/../server.js', '/%2e%2e/server.js', '/js/..%2f..%2fserver.js', '/%00']) {
    const res = await get(srv.base + p);
    assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.doesNotMatch(res.body, /createServer/);
  }
});

test('info and QR endpoints', async (t) => {
  const srv = await start();
  t.after(srv.close);
  const info = JSON.parse((await get(srv.base + '/api/info')).body);
  assert.equal(info.ok, true);
  assert.ok(Array.isArray(info.lan));
  const qr = await get(srv.base + '/api/qr.svg?d=' + encodeURIComponent('http://192.168.1.5:3000/#join-BRTK'));
  assert.equal(qr.status, 200);
  assert.match(qr.headers['content-type'], /image\/svg\+xml/);
  assert.match(qr.body, /^<svg/);
  assert.equal((await get(srv.base + '/api/qr.svg?d=' + 'x'.repeat(301))).status, 400);
  assert.equal((await get(srv.base + '/api/qr.svg')).status, 400);
});

test('relays presence between the peers of a room', async (t) => {
  const srv = await start();
  t.after(srv.close);
  const host = await client(srv.ws);
  host.send({ t: 'join', room: 'gor-brtk' });
  const hj = await host.next((m) => m.t === 'joined');
  assert.deepEqual(hj.peers, []);
  host.send({ t: 'p', d: { r: 'host', s: { ph: 'lobby' } } });

  const phone = await client(srv.ws);
  phone.send({ t: 'join', room: 'gor-brtk' });
  const pj = await phone.next((m) => m.t === 'joined');
  assert.equal(pj.peers.length, 1);
  assert.deepEqual(pj.peers[0].d, { r: 'host', s: { ph: 'lobby' } });

  phone.send({ t: 'p', d: { r: 'player', nm: 'Ann' } });
  const seen = await host.next((m) => m.t === 'p' && m.d.r === 'player');
  assert.equal(seen.id, pj.you);

  const other = await client(srv.ws);              // another room hears nothing
  other.send({ t: 'join', room: 'gor-zzzz' });
  assert.deepEqual((await other.next((m) => m.t === 'joined')).peers, []);

  phone.send({ t: 'leave' });
  assert.equal((await host.next((m) => m.t === 'left')).id, pj.you);
  for (const c of [host, phone, other]) c.close();
});

test('rejects bad room names and oversized presence', async (t) => {
  const srv = await start();
  t.after(srv.close);
  const c = await client(srv.ws);
  c.send({ t: 'join', room: '../Etc' });
  assert.equal((await c.next((m) => m.t === 'err')).code, 'bad_room');
  c.send({ t: 'join', room: 'gor-abcd' });
  await c.next((m) => m.t === 'joined');
  c.send({ t: 'p', d: { blob: 'x'.repeat(LIMITS.presenceBytes) } });
  assert.equal((await c.next((m) => m.t === 'err')).code, 'too_big');
  c.close();
});
