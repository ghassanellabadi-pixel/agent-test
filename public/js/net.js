/* Online rooms. Two transports share one small "channel" interface:
 *   - the WebSocket relay in server.js, when the page is served by the game server
 *   - a free public MQTT broker, when the page is hosted anywhere else (GitHub
 *     Pages, any static host), so phones can play with no computer involved
 *
 * channel.setPresence(obj)  publish this device's whole state object
 * channel.peers()           -> [{ id, p }] everyone else in the room
 * channel.onPeers(fn)       fn(peers) whenever someone joins, leaves or updates
 * channel.onStatus(fn)      fn('ok' | 'reconnecting' | 'failed')
 * channel.close()
 */
(function (G) {
  'use strict';

  // Public brokers, reached over secure WebSockets, tried in this order by
  // everyone. A page can set window.GOR_BROKERS to use its own.
  var BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var TOPIC = 'guess-o-rama/v1/rooms/';

  var detected = null;

  // Which transport works here. Resolves { kind, ... } or null.
  function detect() {
    if (detected) return detected;
    detected = new Promise(function (resolve) {
      var custom = typeof window !== 'undefined' && Array.isArray(window.GOR_BROKERS) && window.GOR_BROKERS.length;
      var relay = typeof WebSocket === 'function' && typeof TextEncoder === 'function'
        ? { kind: 'mqtt', brokers: custom ? window.GOR_BROKERS.slice() : BROKERS.slice() } : null;
      if (!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return resolve(relay);
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (ctrl) ctrl.abort();
        resolve(relay);
      }, 3000);
      fetch('api/info', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (info) {
          clearTimeout(timer);
          resolve(info && info.online ? { kind: 'ws', info: info } : relay);
        })
        .catch(function () {
          clearTimeout(timer);
          resolve(relay);
        });
    });
    return detected;
  }

  function listenerList() {
    var fns = [];
    return {
      add: function (fn) {
        fns.push(fn);
        return function () { fns = fns.filter(function (f) { return f !== fn; }); };
      },
      emit: function (v) { fns.slice().forEach(function (fn) { fn(v); }); },
    };
  }

  function openWs(roomName) {
    var url = new URL('ws', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.hash = '';
    url.search = '';
    var ws = null, me = null, closed = false, joined = false, retry = 0, sendTimer = 0;
    var presence = {}, peers = {}, status = 'connecting';
    var peerEvents = listenerList(), statusEvents = listenerList();
    var settle = null;

    function setStatus(s) {
      if (status === s) return;
      status = s;
      statusEvents.emit(s);
    }
    function flush() {
      sendTimer = 0;
      if (joined && ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'p', d: presence }));
    }
    function connect() {
      if (closed) return;
      ws = new WebSocket(url.href);
      ws.onopen = function () {
        retry = 0;
        ws.send(JSON.stringify({ t: 'join', room: roomName }));
      };
      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!m || typeof m !== 'object') return;
        if (m.t === 'joined') {
          me = m.you;
          peers = {};
          (m.peers || []).forEach(function (p) { if (p.id !== me) peers[p.id] = p.d || {}; });
          joined = true;
          setStatus('ok');
          flush();
          peerEvents.emit(ch.peers());
          if (settle) settle(null);
        } else if (m.t === 'p' && m.id !== me) {
          peers[m.id] = m.d || {};
          peerEvents.emit(ch.peers());
        } else if (m.t === 'left') {
          delete peers[m.id];
          peerEvents.emit(ch.peers());
        } else if (m.t === 'err' && settle) {
          settle(new Error(m.code || 'error'));
        }
      };
      ws.onclose = function () {
        joined = false;
        if (closed) return;
        setStatus('reconnecting');
        // Keep the last known peers through short blips; 'joined' replaces them.
        setTimeout(connect, Math.min(5000, 400 * Math.pow(2, retry++)));
      };
      ws.onerror = function () {};
    }

    var ch = {
      kind: 'ws',
      setPresence: function (obj) {
        presence = obj;
        if (!sendTimer) sendTimer = setTimeout(flush, 40);
      },
      peers: function () {
        return Object.keys(peers).map(function (id) { return { id: id, p: peers[id] }; });
      },
      onPeers: peerEvents.add,
      onStatus: statusEvents.add,
      status: function () { return status; },
      close: function () {
        closed = true;
        clearTimeout(sendTimer);
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' }));
          ws.close();
        } catch (e) { /* already closed */ }
      },
    };

    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { if (settle) settle(new Error('timeout')); }, 8000);
      settle = function (err) {
        settle = null;
        clearTimeout(timer);
        if (err) {
          ch.close();
          reject(err);
        } else {
          resolve(ch);
        }
      };
      connect();
    });
  }

  // ------------------------------------------------------------ MQTT relay

  function bytes(text) { return new TextEncoder().encode(text); }
  function concat(parts) {
    var len = 0, at = 0;
    parts.forEach(function (p) { len += p.length; });
    var out = new Uint8Array(len);
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function u16(n) { return new Uint8Array([(n >> 8) & 255, n & 255]); }
  function str(text) { var b = bytes(text); return concat([u16(b.length), b]); }
  // Fixed header (type, flags, remaining length) + body.
  function packet(type, flags, body) {
    var head = [(type << 4) | flags], n = body.length;
    do {
      var b = n % 128;
      n = Math.floor(n / 128);
      head.push(n > 0 ? b | 128 : b);
    } while (n > 0);
    return concat([new Uint8Array(head), body]);
  }

  // One MQTT 3.1.1 connection over a WebSocket, with just what rooms need:
  // QoS 0 publishes (retained), one subscription and a last will that clears
  // this device's presence if it drops off. Resolves once subscribed.
  function mqttSession(url, o) {
    return new Promise(function (resolve, reject) {
      var ws, buf = new Uint8Array(0), ready = false, over = false, lastHeard = Date.now(), ping = 0;
      var timer = setTimeout(function () { fail(new Error('timeout')); }, o.timeout || 6000);
      // Runs once, however the connection ends: before it was ready (reject)
      // or after (tell the room, which reconnects).
      function fail(err) {
        if (over) return;
        over = true;
        clearTimeout(timer);
        clearInterval(ping);
        try { ws.close(); } catch (e) { /* not open */ }
        if (!ready) reject(err);
        else if (o.onClose) o.onClose();
      }
      function send(p) {
        if (ws.readyState === 1) ws.send(p);
      }
      var session = {
        publish: function (topic, text, retain) { send(packet(3, retain ? 1 : 0, concat([str(topic), bytes(text)]))); },
        end: function (lastWords) {
          if (over) return;
          over = true;
          clearTimeout(timer);
          clearInterval(ping);
          try {
            if (lastWords) lastWords();
            send(packet(14, 0, new Uint8Array(0)));            // DISCONNECT
            ws.close();
          } catch (e) { /* already closed */ }
        },
      };
      function handle(type, flags, body) {
        lastHeard = Date.now();
        if (type === 2) {                                    // CONNACK
          if (body[1] !== 0) { fail(new Error('refused ' + body[1])); return; }
          send(packet(8, 2, concat([u16(1), str(o.subscribe), new Uint8Array([0])])));
        } else if (type === 9) {                             // SUBACK
          if (body[2] === 0x80) { fail(new Error('subscribe refused')); return; }
          ready = true;
          clearTimeout(timer);
          ping = setInterval(function () {
            if (Date.now() - lastHeard > 45000) { fail(new Error('silent')); return; }
            send(packet(12, 0, new Uint8Array(0)));          // PINGREQ
          }, 15000);
          resolve(session);
        } else if (type === 3) {                             // PUBLISH
          var tl = (body[0] << 8) | body[1];
          var topic = new TextDecoder().decode(body.subarray(2, 2 + tl));
          var start = 2 + tl + (((flags >> 1) & 3) ? 2 : 0);
          o.onMessage(topic, new TextDecoder().decode(body.subarray(start)));
        }
      }
      try {
        ws = new WebSocket(url, 'mqtt');
      } catch (e) {
        fail(e);
        return;
      }
      ws.binaryType = 'arraybuffer';
      ws.onopen = function () {
        // Clean session, a retained empty will on our presence topic, 30 s keep-alive.
        send(packet(1, 0, concat([str('MQTT'), new Uint8Array([4, 0x02 | 0x04 | 0x20]), u16(30),
          str(o.clientId), str(o.will), u16(0)])));
      };
      ws.onmessage = function (ev) {
        buf = concat([buf, new Uint8Array(ev.data)]);
        for (;;) {
          var len = 0, mult = 1, i = 1, b;
          do {
            if (i >= buf.length) return;                     // the rest is still on its way
            b = buf[i++];
            len += (b & 127) * mult;
            mult *= 128;
          } while (b & 128 && i < 5);
          if (buf.length < i + len) return;
          var type = buf[0] >> 4, flags = buf[0] & 15, body = buf.slice(i, i + len);
          buf = buf.slice(i + len);
          handle(type, flags, body);
        }
      };
      ws.onerror = function () {};
      ws.onclose = function () { fail(new Error('closed')); };
    });
  }

  // A room on a public broker. Each device keeps its presence as a retained
  // message under the room's topic, so newcomers get everyone's at once.
  // opts.seek (players): if nobody is in the room on the first broker that
  // answers, look on the others too.
  function openMqtt(urls, roomName, opts) {
    var base = TOPIC + roomName + '/';
    var me = 'p' + Math.random().toString(36).slice(2, 12);
    var presence = null, peers = {}, status = 'connecting', closed = false;
    var session = null, current = 0, retry = 0, sendTimer = 0;
    var peerEvents = listenerList(), statusEvents = listenerList();

    function setStatus(st) {
      if (status === st) return;
      status = st;
      statusEvents.emit(st);
    }
    function publishPresence() {
      sendTimer = 0;
      if (session && presence) session.publish(base + me, JSON.stringify(presence), true);
    }
    function onMessage(topic, text) {
      var id = topic.slice(base.length);
      if (!id || id === me || topic.indexOf(base) !== 0) return;
      if (!text) {
        if (peers[id]) { delete peers[id]; peerEvents.emit(ch.peers()); }
        return;
      }
      var known = peers[id];
      if (known && known.raw === text) { known.at = Date.now(); return; }
      var d;
      try { d = JSON.parse(text); } catch (e) { return; }
      if (!d || typeof d !== 'object') return;
      peers[id] = { d: d, raw: text, at: Date.now() };
      peerEvents.emit(ch.peers());
    }
    function connect(i) {
      return mqttSession(urls[i], {
        clientId: 'gor-' + me, will: base + me, subscribe: base + '+', onMessage: onMessage,
        onClose: function () { lost(i); },
      }).then(function (s) {
        if (closed) { s.end(); throw new Error('closed'); }
        session = s;
        current = i;
        retry = 0;
        setStatus('ok');
        publishPresence();
        return s;
      });
    }
    function lost(i) {
      session = null;
      if (closed) return;
      setStatus('reconnecting');
      setTimeout(function () {
        if (!closed) connect(i).catch(function () { lost(i); });
      }, Math.min(5000, 400 * Math.pow(2, retry++)));
    }
    function leave(s) {
      s.end(function () { s.publish(base + me, '', true); });
      if (session === s) session = null;
    }
    // First broker that answers; then, when seeking, the first that has someone in the room.
    function first(i) {
      if (i >= urls.length) return Promise.reject(new Error('No relay could be reached'));
      return connect(i).catch(function () { return first(i + 1); });
    }
    function seek(home, i) {
      if (closed || Object.keys(peers).length) return;
      var next = i + 1;
      if (next >= urls.length) {
        if (current !== home && session) { leave(session); connect(home).catch(function () { lost(home); }); }
        return;
      }
      if (session) leave(session);
      peers = {};
      connect(next).then(function () {
        setTimeout(function () { seek(home, next); }, 2500);
      }, function () { seek(home, next); });
    }

    // Peers that stopped sending (and whose last will never arrived) fade out;
    // our own presence is re-sent as a heartbeat.
    var sweep = 0;
    function housekeeping() {
      var now = Date.now(), gone = false;
      Object.keys(peers).forEach(function (id) {
        if (now - peers[id].at > 30000) { delete peers[id]; gone = true; }
      });
      if (gone) peerEvents.emit(ch.peers());
      if (presence) publishPresence();
    }

    var ch = {
      kind: 'mqtt',
      setPresence: function (obj) {
        presence = obj;
        if (!sendTimer) sendTimer = setTimeout(publishPresence, 40);
      },
      peers: function () {
        return Object.keys(peers).map(function (id) { return { id: id, p: peers[id].d }; });
      },
      onPeers: peerEvents.add,
      onStatus: statusEvents.add,
      status: function () { return status; },
      close: function () {
        closed = true;
        clearTimeout(sendTimer);
        clearInterval(sweep);
        if (session) leave(session);
      },
    };


    return first(0).then(function () {
      var home = current;
      sweep = setInterval(housekeeping, 10000);
      // Give retained presences a moment to arrive before anyone looks.
      return new Promise(function (resolve) { setTimeout(resolve, 400); }).then(function () {
        if (opts && opts.seek) setTimeout(function () { seek(home, home); }, 2100);
        return ch;
      });
    });
  }

  // opts.seek: a player looking for a host (may check more than one broker).
  function open(net, code, opts) {
    var roomName = 'gor-' + String(code).toLowerCase();
    if (net.kind === 'mqtt') return openMqtt(net.brokers, roomName, opts || {});
    return openWs(roomName);
  }

  G.net = { detect: detect, open: open };
})(window.GOR = window.GOR || {});
