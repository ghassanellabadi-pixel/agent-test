/* Online rooms. Two transports share one small "channel" interface:
 *   - the WebSocket relay in server.js, when the page is served by the game server
 *   - claude.ai's room capability, when the page runs as a published artifact
 *
 * channel.setPresence(obj)  publish this device's whole state object
 * channel.peers()           -> [{ id, p }] everyone else in the room
 * channel.onPeers(fn)       fn(peers) whenever someone joins, leaves or updates
 * channel.onStatus(fn)      fn('ok' | 'reconnecting' | 'failed')
 * channel.close()
 */
(function (G) {
  'use strict';

  var detected = null;

  // Which transport (if any) works here. Resolves { kind, ... } or null.
  function detect() {
    if (detected) return detected;
    detected = new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (!done) { done = true; resolve(v); }
      }
      function tryServer() {
        if (!/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return finish(null);
        var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        var timer = setTimeout(function () {
          if (ctrl) ctrl.abort();
          finish(null);
        }, 3000);
        fetch('api/info', { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (info) {
            clearTimeout(timer);
            finish(info && info.online ? { kind: 'ws', info: info } : null);
          })
          .catch(function () {
            clearTimeout(timer);
            finish(null);
          });
      }
      var claude = typeof window !== 'undefined' ? window.claude : null;
      if (claude && typeof claude.use === 'function') {
        claude.use('room').then(function (room) {
          if (room) finish({ kind: 'claude', room: room });
          else tryServer();
        }, tryServer);
      } else {
        tryServer();
      }
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

  // claude.ai artifact rooms. Prefer a named room per game; if this viewer
  // can't open named rooms, share the page's lobby and filter by room code.
  function openClaude(room, roomName, code) {
    return room.join(roomName).then(
      function (named) { return wrapClaude(named, null); },
      function (err) {
        if (err && err.code === 'not_permitted') return wrapClaude(room, code);
        throw err;
      }
    );
  }

  function wrapClaude(r, filterCode) {
    var current = {}, status = r.connected() ? 'ok' : 'reconnecting';
    var statusEvents = listenerList();
    function setStatus(s) {
      if (status === s) return;
      status = s;
      statusEvents.emit(s);
    }
    var offConn = r.onConnection(function (c) { setStatus(c ? 'ok' : 'reconnecting'); }, function () { setStatus('failed'); });
    var ch = {
      kind: 'claude',
      setPresence: function (obj) {
        var patch = {}, k;
        for (k in current) if (!Object.prototype.hasOwnProperty.call(obj, k)) patch[k] = null;
        for (k in obj) patch[k] = obj[k];
        if (filterCode) patch.rm = filterCode;
        current = obj;
        r.presence(patch).catch(function (e) {
          if (typeof console !== 'undefined') console.warn('room presence rejected:', e && (e.code || e.message));
        });
      },
      peers: function () {
        return r.peers().filter(function (p) {
          if (p.kind !== 'viewer' || (p.isMe && p.sameTab)) return false;
          return !filterCode || (p.presence && p.presence.rm === filterCode);
        }).map(function (p) { return { id: p.peer, p: p.presence || {} }; });
      },
      onPeers: function (fn) {
        return r.onPeers(function () { fn(ch.peers()); }, function () { setStatus('failed'); });
      },
      onStatus: statusEvents.add,
      status: function () { return status; },
      close: function () {
        offConn();
        if (filterCode) {
          var clear = { rm: null };
          for (var k in current) clear[k] = null;
          r.presence(clear).catch(function () {});
        } else {
          r.leave().catch(function () {});
        }
      },
    };
    return ch;
  }

  function open(net, code) {
    var roomName = 'gor-' + String(code).toLowerCase();
    if (net.kind === 'claude') return openClaude(net.room, roomName, code);
    return openWs(roomName);
  }

  G.net = { detect: detect, open: open };
})(window.GOR = window.GOR || {});
