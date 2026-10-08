/* Game engine: deck, rounds, timer, hints and scoring. It runs only on the
 * host's screen; players receive the compact public state it produces.
 * The clock is injected so tests can drive time directly. */
(function (G) {
  'use strict';

  var M = G.match;
  var PROTO = 1;
  var MAX_PLAYERS = 16;
  var HINT_AT = [0.4, 0.7];      // share of the timer at which hint 1 and hint 2 appear
  var FIRST_BONUS = 100;
  var ALL_DONE_DELAY = 1200;     // ms between the last correct guess and the reveal

  function rand() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    }
    return Math.random();
  }

  function rid(n) {
    var chars = 'abcdefghijkmnopqrstuvwxyz23456789';
    var out = '';
    for (var i = 0; i < n; i++) out += chars[Math.floor(rand() * chars.length)];
    return out;
  }

  // Consonants only, so a random code can never spell a word.
  function roomCode() {
    var chars = 'BCDFGHJKLMNPRSTVWZ';
    var out = '';
    for (var i = 0; i < 4; i++) out += chars[Math.floor(rand() * chars.length)];
    return out;
  }

  // 1000 points for an instant answer down to 400 at the buzzer.
  function pointsFor(elapsed, dur) {
    var f = 1 - Math.min(1, Math.max(0, elapsed / dur));
    return Math.round((400 + 600 * f) / 10) * 10;
  }

  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Reorder so the same category doesn't come up twice in a row when avoidable.
  function spread(items) {
    var rest = items.slice(), out = [];
    while (rest.length) {
      var last = out.length ? out[out.length - 1].pack : null;
      var i = rest.findIndex(function (it) { return it.pack !== last; });
      out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
    }
    return out;
  }

  // Pick the puzzles for one game. Prefers the requested difficulty, then
  // puzzles this device hasn't shown before. "mixed" climbs from easy to hard
  // (about 30% easy, 40% medium, 30% hard), like the videos.
  function buildDeck(o) {
    var rnd = o.rnd || rand;
    var n = Math.max(1, o.rounds | 0);
    var want = { easy: 1, medium: 2, hard: 3 }[o.diff] || 0;
    var seen = new Set(o.seen || []);
    var pool = [];
    o.packs.forEach(function (p) {
      if (o.cats.indexOf(p.id) < 0) return;
      p.items.forEach(function (it) { if (!o.playable || o.playable(it)) pool.push(it); });
    });
    shuffle(pool, rnd);
    function rank(it) {
      var off = want && it.d ? Math.abs(it.d - want) : 0;   // custom puzzles (d = 0) fit any level
      return off * 2 + (seen.has(it.id) ? 1 : 0);
    }
    pool.sort(function (a, b) { return rank(a) - rank(b); });
    if (want) return spread(pool.slice(0, n));

    var byLevel = { 1: [], 2: [], 3: [] };
    pool.forEach(function (it) { byLevel[it.d || 2].push(it); });
    var easy = Math.round(n * 0.3), hard = Math.round(n * 0.3);
    var target = { 1: easy, 2: n - easy - hard, 3: hard };
    var picked = {};
    [1, 2, 3].forEach(function (lv) { picked[lv] = byLevel[lv].splice(0, target[lv]); });
    var short = n - picked[1].length - picked[2].length - picked[3].length;
    while (short > 0) {
      var moved = false;
      [2, 1, 3].forEach(function (lv) {
        if (short > 0 && byLevel[lv].length) { picked[lv].push(byLevel[lv].shift()); short--; moved = true; }
      });
      if (!moved) break;
    }
    return [1, 2, 3].reduce(function (deck, lv) { return deck.concat(spread(picked[lv])); }, []);
  }

  // Puzzles whose media failed to load are gone by now: pick the final questions
  // from what's left (keeping the easy-to-hard ramp) and keep the rest as spares
  // for clips that turn out to be unplayable mid-game.
  function trimDeck(list, n, diff) {
    if (diff !== 'mixed') return { deck: list.slice(0, n), spare: list.slice(n) };
    var byLevel = { 1: [], 2: [], 3: [] };
    list.forEach(function (it) { byLevel[it.d || 2].push(it); });
    var easy = Math.round(n * 0.3), hard = Math.round(n * 0.3);
    var target = { 1: easy, 2: n - easy - hard, 3: hard };
    var picked = {};
    [1, 2, 3].forEach(function (lv) { picked[lv] = byLevel[lv].splice(0, target[lv]); });
    var short = n - picked[1].length - picked[2].length - picked[3].length;
    while (short > 0) {
      var moved = false;
      [2, 1, 3].forEach(function (lv) {
        if (short > 0 && byLevel[lv].length) { picked[lv].push(byLevel[lv].shift()); short--; moved = true; }
      });
      if (!moved) break;
    }
    return {
      deck: [1, 2, 3].reduce(function (deck, lv) { return deck.concat(spread(picked[lv])); }, []),
      spare: byLevel[1].concat(byLevel[2], byLevel[3]),
    };
  }

  // One puzzle per line: "clue = answer / other answer | hint". The clue can be
  // emoji or text, a link to a picture, or a YouTube link (optionally with ?t=).
  function parseCustom(text) {
    var items = [], errors = [];
    String(text || '').split(/\r?\n/).forEach(function (line, i) {
      var raw = line.trim();
      if (!raw || raw[0] === '#') return;
      // Links contain "=" themselves (watch?v=…, ?t=43): a link clue runs to the first space.
      var link = /^(https?:\/\/\S+)\s+=(.*)$/i.exec(raw) || /^(https?:\/\/\S+?)=([^=]*)$/i.exec(raw);
      var eq = raw.indexOf('=');
      if (!link && eq < 0) { errors.push(i + 1); return; }
      var clue = M.clean(link ? link[1] : raw.slice(0, eq), 300);
      var rest = link ? link[2] : raw.slice(eq + 1);
      var bar = rest.indexOf('|');
      var hint = bar >= 0 ? M.clean(rest.slice(bar + 1), 60) : '';
      var names = (bar >= 0 ? rest.slice(0, bar) : rest).split(/\s+\/\s+/)
        .map(function (s) { return M.clean(s.replace(/_/g, ' '), 60); })
        .filter(function (s) { return M.forms(s).full; });
      if (!clue || !names.length) { errors.push(i + 1); return; }
      if (items.length >= 200) return;
      var it = {
        id: 'custom:' + (G.slug(names[0]) || 'puzzle') + '-' + items.length,
        pack: 'custom', kind: 'emoji', clue: clue, answer: names[0], alts: names.slice(1), hint: hint, d: 0,
      };
      var yt = G.media && /^https?:\/\//i.test(clue) ? G.media.parseYouTube(clue) : null;
      if (yt) {
        it.kind = 'url-yt';
        it.yt = yt.id;
        it.start = yt.start;
        it.clue = '';
      } else if (/^https?:\/\/\S+$/i.test(clue)) {
        it.kind = 'url-img';
        it.img = clue;
        it.clue = '';
      } else if (Array.from(clue).length > 40) {
        errors.push(i + 1);
        return;
      }
      items.push(it);
    });
    return { items: items, errors: errors };
  }

  function utf8Bytes(str) {
    var n = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function Game(o) {
    this.now = o.now || function () { return Date.now(); };
    this.mode = o.mode === 'online' ? 'online' : 'party';
    this.cfg = Object.assign({ seconds: 30, hints: true, reveal: 'all', icons: [] }, o.cfg || {});
    this.packInfo = o.packInfo || {};
    this.onChange = o.onChange || function () {};
    this.players = [];
    this.kicked = {};
    this.reset(o.deck || []);
  }

  Game.prototype.emit = function (what) { this.onChange(what); };

  // New game with the same players (scores cleared).
  Game.prototype.reset = function (deck) {
    this.gid = rid(6);
    this.deck = deck;
    this.phase = 'lobby';
    this.qi = -1;
    this.r = null;
    this.players.forEach(function (p) {
      p.score = 0; p.streak = 0; p.prev = 0; p.best = 0; p.correct = 0; p.fast = null;
    });
  };

  Game.prototype.byPid = function (pid) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].pid === pid) return this.players[i];
    return null;
  };

  Game.prototype.addPlayer = function (pid, nm, av) {
    if (!pid || this.kicked[pid]) return null;
    var p = this.byPid(pid);
    if (p) {
      p.nm = nm || p.nm; p.av = av || p.av;
      if (!p.on) { p.on = true; this.checkAllDone(); }
      this.emit('players');
      return p;
    }
    if (this.players.length >= MAX_PLAYERS) return null;
    p = { pid: pid, nm: nm || 'Player', av: av || '🙂', score: 0, streak: 0, prev: 0, best: 0, correct: 0, fast: null, on: true };
    this.players.push(p);
    this.checkAllDone();
    this.emit('players');
    return p;
  };

  Game.prototype.setOnline = function (pid, on) {
    var p = this.byPid(pid);
    if (!p || p.on === on) return;
    p.on = on;
    this.checkAllDone();
    this.emit('players');
  };

  Game.prototype.kick = function (pid) {
    this.kicked[pid] = true;
    this.players = this.players.filter(function (p) { return p.pid !== pid; });
    this.checkAllDone();
    this.emit('players');
  };

  // Someone stops playing (the host switching off "I'm playing too"). Unlike
  // kick, they can come back.
  Game.prototype.removePlayer = function (pid) {
    var before = this.players.length;
    this.players = this.players.filter(function (p) { return p.pid !== pid; });
    if (this.players.length === before) return;
    this.checkAllDone();
    this.emit('players');
  };

  Game.prototype.start = function () {
    if (!this.deck.length) return false;
    this.qi = 0;
    this.startRound();
    return true;
  };

  Game.prototype.startRound = function () {
    this.phase = 'q';
    this.r = {
      // key: tells screens apart two rounds with the same number (a spare swapped in)
      pz: this.deck[this.qi], key: rid(5), t0: this.now(), pausedAt: 0, pausedFor: 0, pr: '', hl: 0,
      endAt: 0, doneAt: 0, why: '', got: [], tries: {}, lastN: {}, fb: {},
      // Where a zoomed-in photo starts, and the order its cover tiles come off.
      fx: { x: Math.round((0.25 + rand() * 0.5) * 100) / 100, y: Math.round((0.25 + rand() * 0.5) * 100) / 100, seed: Math.floor(rand() * 1e6) },
    };
    this.emit('round');
  };

  Game.prototype.dur = function () { return this.cfg.seconds * 1000; };

  Game.prototype.elapsed = function () {
    var r = this.r;
    if (!r) return 0;
    var end = r.doneAt || r.pausedAt || this.now();
    return Math.max(0, Math.min(this.dur(), end - r.t0 - r.pausedFor));
  };

  Game.prototype.remaining = function () { return this.dur() - this.elapsed(); };

  Game.prototype.paused = function () { return !!(this.phase === 'q' && this.r && this.r.pausedAt); };

  Game.prototype.pause = function (reason) {
    if (this.phase !== 'q' || this.r.pausedAt) return;
    this.r.pausedAt = this.now();
    this.r.pr = reason || 'host';
    this.emit('pause');
  };

  Game.prototype.resume = function () {
    var r = this.r;
    if (this.phase !== 'q' || !r.pausedAt) return;
    r.pausedFor += this.now() - r.pausedAt;
    r.pausedAt = 0;
    r.pr = '';
    if (r.endAt) r.endAt = this.now() + ALL_DONE_DELAY;
    this.emit('pause');
  };

  // The clock waits while a clip loads; the host's own pause takes precedence.
  Game.prototype.hold = function () { this.pause('load'); };
  Game.prototype.release = function () {
    if (this.r && this.r.pr === 'load') this.resume();
  };
  Game.prototype.loading = function () { return !!(this.phase === 'q' && this.r && this.r.pr === 'load'); };

  // Swap the current question for a spare (its clip wouldn't play). Same number, fresh clock.
  Game.prototype.replaceCurrent = function (pz) {
    if (this.phase !== 'q' || !pz) return false;
    this.deck[this.qi] = pz;
    this.startRound();
    return true;
  };

  // Call often (the UI does ~5x a second): advances hints and ends the round.
  Game.prototype.tick = function () {
    if (this.phase !== 'q' || this.r.pausedAt) return;
    var r = this.r, e = this.elapsed(), d = this.dur();
    if (this.cfg.hints) {
      var hl = e >= HINT_AT[1] * d ? 2 : e >= HINT_AT[0] * d ? 1 : 0;
      if (hl > r.hl) { r.hl = hl; this.emit('hint'); }
    }
    if (e >= d) this.reveal('time');
    else if (r.endAt && this.now() >= r.endAt) this.reveal('all');
  };

  Game.prototype.gotEntry = function (pid) {
    var got = this.r ? this.r.got : [];
    for (var i = 0; i < got.length; i++) if (got[i].pid === pid) return got[i];
    return null;
  };

  // A typed guess from an online player. n is the player's attempt counter for
  // this question, so repeated or out-of-date presence updates are ignored.
  Game.prototype.guess = function (pid, qn, n, text) {
    // Nothing to guess from while the clip is still loading.
    if (this.phase !== 'q' || qn !== this.qi + 1 || this.loading()) return null;
    var r = this.r, p = this.byPid(pid);
    if (!p || typeof n !== 'number' || !(n > (r.lastN[pid] || 0))) return null;
    r.lastN[pid] = n;
    if (this.gotEntry(pid)) return null;
    r.tries[pid] = (r.tries[pid] || 0) + 1;
    var code = M.judge(M.clean(text, 80), r.pz);
    r.fb[pid] = [qn, n, code];
    if (code === 'y') this.award(pid);
    else this.emit('guess');
    return code;
  };

  // Points for a correct answer, typed (online) or called by the host (party).
  Game.prototype.award = function (pid) {
    if ((this.phase !== 'q' && this.phase !== 'rev') || this.gotEntry(pid)) return 0;
    var p = this.byPid(pid);
    if (!p) return 0;
    var r = this.r, e = this.elapsed();
    var first = r.got.length === 0;
    var pts = pointsFor(e, this.dur()) + (first ? FIRST_BONUS : 0);
    r.got.push({ pid: pid, pts: pts, ms: e, first: first });
    p.score += pts;
    p.correct++;
    if (p.fast == null || e < p.fast) p.fast = e;
    if (this.phase === 'rev') {
      p.streak = p.prev + 1;
      if (p.streak > p.best) p.best = p.streak;
    }
    this.checkAllDone();
    this.emit('award');
    return pts;
  };

  // Party mode: undo a mistaken tap.
  Game.prototype.unaward = function (pid) {
    if (this.mode !== 'party' || !this.r) return 0;
    var got = this.r.got;
    var i = got.findIndex(function (g) { return g.pid === pid; });
    if (i < 0) return 0;
    var g = got.splice(i, 1)[0], p = this.byPid(pid);
    if (p) {
      p.score -= g.pts;
      p.correct--;
      if (this.phase === 'rev') p.streak = 0;
    }
    this.emit('award');
    return g.pts;
  };

  // Online: once everyone still connected has the answer, reveal shortly after.
  Game.prototype.checkAllDone = function () {
    if (this.mode !== 'online' || this.phase !== 'q') return;
    var self = this, r = this.r;
    var active = this.players.filter(function (p) { return p.on; });
    var done = active.length > 0 && active.every(function (p) { return self.gotEntry(p.pid); });
    if (done) { if (!r.endAt) r.endAt = this.now() + ALL_DONE_DELAY; }
    else r.endAt = 0;
  };

  Game.prototype.reveal = function (why) {
    if (this.phase !== 'q') return;
    var r = this.r, self = this;
    if (r.pausedAt) { r.pausedFor += this.now() - r.pausedAt; r.pausedAt = 0; }
    r.doneAt = this.now();
    r.why = why || 'host';
    this.phase = 'rev';
    this.players.forEach(function (p) {
      p.prev = p.streak;
      p.streak = self.gotEntry(p.pid) ? p.streak + 1 : 0;
      if (p.streak > p.best) p.best = p.streak;
    });
    this.emit('reveal');
  };

  // Space bar logic: reveal the answer, or move on after a reveal.
  Game.prototype.next = function () {
    if (this.phase === 'q') { this.reveal('skip'); return; }
    if (this.phase !== 'rev') return;
    if (this.qi + 1 >= this.deck.length) { this.finish(); return; }
    this.qi++;
    this.startRound();
  };

  Game.prototype.finish = function () {
    if (this.phase === 'q') this.reveal('end');
    if (this.phase === 'final') return;
    this.phase = 'final';
    this.emit('final');
  };

  Game.prototype.standings = function () {
    var list = this.players.slice().sort(function (a, b) {
      return b.score - a.score || b.correct - a.correct || a.nm.localeCompare(b.nm);
    });
    var rank = 0, last = null;
    list.forEach(function (p, i) {
      if (p.score !== last) { rank = i + 1; last = p.score; }
      p.rank = rank;
    });
    return list;
  };

  Game.prototype.awards = function () {
    var ps = this.players, out = [];
    var fast = ps.filter(function (p) { return p.fast != null; })
      .sort(function (a, b) { return a.fast - b.fast; })[0];
    if (fast) out.push(['fast', fast.pid, fast.nm, fast.av, Math.round(fast.fast)]);
    var streak = ps.slice().sort(function (a, b) { return b.best - a.best; })[0];
    if (streak && streak.best >= 2) out.push(['streak', streak.pid, streak.nm, streak.av, streak.best]);
    var sharp = ps.slice().sort(function (a, b) { return b.correct - a.correct; })[0];
    if (sharp && sharp.correct) out.push(['sharp', sharp.pid, sharp.nm, sharp.av, sharp.correct]);
    return out;
  };

  // Everything a screen needs to draw the game, small enough to send as presence.
  // sb rows: [pid, name, avatar, score, points this round, got (0/1/2 = first),
  //           connected, streak, ms to answer, guesses this round]
  Game.prototype.publicState = function () {
    var r = this.r, pz = r && r.pz, ph = this.phase, self = this;
    var s = { v: PROTO, gid: this.gid, ph: ph, n: this.qi + 1, of: this.deck.length, sec: this.cfg.seconds, rs: this.cfg.reveal };
    if (ph === 'lobby') s.cfg = { r: this.deck.length, s: this.cfg.seconds, c: (this.cfg.icons || []).slice(0, 16) };
    var live = pz && (ph === 'q' || ph === 'rev');
    if (live) {
      s.rk = r.key;
      var info = this.packInfo[pz.pack] || {};
      s.cat = pz.topic ? [pz.topic[0], 'Emoji · ' + pz.topic[1]] : [info.icon || '❓', info.name || ''];
      if (ph === 'q' && info.ask) s.ask = info.ask;
      var md = pz.media || { type: 'emoji' };
      if (md.type === 'img') s.md = { t: 'img', src: md.src, fx: r.fx, flat: pz.flat ? 1 : 0 };
      else if (md.type === 'yt') s.md = { t: 'yt', a: md.audio ? 1 : 0 };
      else s.clue = pz.clue;
      if (ph === 'rev' && s.md) {
        if (md.credit) s.md.cr = md.credit;
        if (md.type === 'yt' && pz.poster) s.md.poster = pz.poster;   // phones can't see the clip
      }
      s.d = pz.d || 0;
      s.left = this.remaining();
      s.el = this.elapsed();
      s.hl = r.hl;
      if (r.pausedAt) { s.pa = 1; s.pr = r.pr || 'host'; }
      if (ph === 'q') {
        if (r.hl >= 1) {
          s.mask = M.mask(pz.answer, r.hl >= 2 ? 2 : 1);
          if (pz.hint) s.hint = pz.hint;
        }
        s.fb = r.fb;
      } else {
        s.ans = pz.answer;
        s.mask = M.mask(pz.answer, 3);
        if (pz.hint) s.hint = pz.hint;
        s.why = r.why;
      }
    }
    s.sb = this.standings().map(function (p) {
      var g = live ? self.gotEntry(p.pid) : null;
      return [p.pid, p.nm, p.av, p.score, g ? g.pts : 0, g ? (g.first ? 2 : 1) : 0, p.on ? 1 : 0, p.streak,
        g ? Math.round(g.ms) : 0, live ? (r.tries[p.pid] || 0) : 0];
    });
    if (ph === 'final') s.aw = this.awards();
    var kicked = Object.keys(this.kicked);
    if (kicked.length) s.kick = kicked.slice(-20);
    return s;
  };

  G.engine = {
    PROTO: PROTO,
    MAX_PLAYERS: MAX_PLAYERS,
    HINT_AT: HINT_AT,
    FIRST_BONUS: FIRST_BONUS,
    Game: Game,
    buildDeck: buildDeck,
    trimDeck: trimDeck,
    parseCustom: parseCustom,
    pointsFor: pointsFor,
    rid: rid,
    roomCode: roomCode,
    utf8Bytes: utf8Bytes,
  };
})(window.GOR = window.GOR || {});
