/* Guess-o-Rama screens and controls.
 * Party mode runs entirely on this screen. Online games run the engine on the
 * host's screen and keep players' phones in sync through net.js. Clues are real
 * photos and clips (media.js); the host's screen plays clips, phones show photos
 * and send guesses. */
(function () {
  'use strict';

  var G = window.GOR, M = G.match, E = G.engine, N = G.net, SFX = G.sound, MEDIA = G.media;
  var PACKS = G.PACKS;
  var EMOJI_PACK = G.EMOJI_PACK;

  var AVATARS = ['🦊', '🐼', '🐸', '🐯', '🦄', '🐙', '🦖', '🐧', '🐨', '🦁', '🐵', '🐰', '🐻', '🐶', '🐱', '🦉',
    '🐢', '🐝', '🦋', '🐳', '🌵', '🍕', '🌮', '🍩', '👽', '🤖', '👻', '🎃', '🚀', '⭐'];
  var DIFFS = [['mixed', 'Mixed'], ['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
  var ROUNDS = [5, 10, 15, 20, 30];
  var SECONDS = [10, 15, 20, 30, 45, 60];
  var REVEALS = [['zoom', 'Zoomed in'], ['blur', 'Blurry'], ['tiles', 'Tiles'], ['clear', 'Clear']];
  var LEVEL = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
  var MAX_ROSTER = 12;
  var AUTO_NEXT_MS = 7000;
  var HOST_LOST_MS = 5000;
  var NO_HOST_MS = 7000;
  var TILE_COLS = 6, TILE_ROWS = 4;
  var EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';
  // Home-page demo: real photos when Wikipedia is reachable, emoji otherwise.
  var DEMO_PHOTOS = [
    { id: 'demo:eiffel', kind: 'photo', wiki: 'Eiffel Tower', answer: 'Eiffel Tower', cat: ['🗽', 'Landmarks'] },
    { id: 'demo:panda', kind: 'photo', wiki: 'Red panda', answer: 'Red panda', cat: ['🐾', 'Animals'] },
    { id: 'demo:brazil', kind: 'photo', wiki: 'Flag of Brazil', flat: true, answer: 'Brazil', cat: ['🚩', 'Flags'] },
    { id: 'demo:machu', kind: 'photo', wiki: 'Machu Picchu', answer: 'Machu Picchu', cat: ['🗽', 'Landmarks'] },
    { id: 'demo:sushi', kind: 'photo', wiki: 'Sushi', answer: 'Sushi', cat: ['🍜', 'Food'] },
  ];
  var DEMO_EMOJI = [
    ['🦁👑', 'The Lion King', '🏰', 'Animated Movies'],
    ['🗽🍎🚕', 'New York', '🏙️', 'Cities'],
    ['🍕🍝🛵', 'Italy', '🌍', 'Countries'],
  ];
  var ICONS = {
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 5.2l11 6.8-11 6.8z"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true" class="stroke"><path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true" class="stroke"><path d="M19 12H6M11 6.5L5.5 12l5.5 5.5"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true" class="stroke"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true" class="stroke"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true" class="stroke"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>',
  };

  var screenEl = document.getElementById('screen');
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ---------------------------------------------------------------- helpers

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('en-US'); }
  function secs(ms) { return (ms / 1000).toFixed(1) + 's'; }
  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function firstGrapheme(s) { return M.graphemes(M.clean(s, 16))[0] || ''; }
  // Only ever put http(s) URLs into src attributes.
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }

  var store = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem('gor.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set: function (k, v) {
      try { localStorage.setItem('gor.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ }
    },
  };

  // One id per browser tab, so two tabs on one laptop are two players.
  function tabPid() {
    var pid = null;
    try { pid = sessionStorage.getItem('gor.pid'); } catch (e) { pid = null; }
    if (!pid || !/^p[a-z0-9]{8}$/.test(pid)) {
      pid = 'p' + E.rid(8);
      try { sessionStorage.setItem('gor.pid', pid); } catch (e) { /* fine without */ }
    }
    return pid;
  }

  // ------------------------------------------------- emoji the device can draw

  // Only matters for the Emoji Bonus category: new emoji show as empty boxes on
  // older phones, so those puzzles are left out of the deck.
  var Emoji = (function () {
    var cache = Object.create(null), ctx = null, refW = 0, broken = false;
    function init() {
      try {
        var c = document.createElement('canvas');
        c.width = 48; c.height = 48;
        ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) { broken = true; return; }
        ctx.font = '32px ' + EMOJI_FONT;
        ctx.textBaseline = 'top';
        refW = ctx.measureText('😀').width;
        if (!(refW > 0)) broken = true;
      } catch (e) {
        broken = true;
      }
    }
    function colorful(g) {
      ctx.clearRect(0, 0, 48, 48);
      ctx.fillStyle = '#000';
      ctx.fillText(g, 4, 4);
      var d = ctx.getImageData(0, 0, 48, 48).data;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 40 && (Math.abs(d[i] - d[i + 1]) > 24 || Math.abs(d[i + 1] - d[i + 2]) > 24)) return true;
      }
      return false;
    }
    function needsColorCheck(g) {
      var cp = g.codePointAt(0);
      if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return true; // regional indicators (flags)
      for (var i = 0; i < g.length; i++) {
        var c = g.codePointAt(i);
        if (c >= 0x1fa70 && c <= 0x1faff) return true; // newest emoji block
      }
      return false;
    }
    function ok(g) {
      if (g in cache) return cache[g];
      if (!ctx && !broken) init();
      var res = true;
      if (!broken) {
        try {
          if (ctx.measureText(g).width > refW * 1.45) res = false;
          else if (needsColorCheck(g)) res = colorful(g);
        } catch (e) {
          res = true;
        }
      }
      cache[g] = res;
      return res;
    }
    return { ok: ok };
  })();

  var playableCache = Object.create(null);
  function playable(pz) {
    if (pz.kind !== 'emoji') return true;
    if (!(pz.id in playableCache)) playableCache[pz.id] = M.graphemes(pz.clue).every(Emoji.ok);
    return playableCache[pz.id];
  }
  function clueDrawable(clue) { return M.graphemes(clue || '').every(Emoji.ok); }

  // ------------------------------------------------------------------ state

  var PACK_INFO = {};
  PACKS.concat(EMOJI_PACK).forEach(function (p) { PACK_INFO[p.id] = { name: p.name, icon: p.icon, ask: p.ask }; });
  PACK_INFO.custom = { name: 'My Puzzles', icon: '✏️', ask: 'What is it?' };

  function loadCustom() {
    var text = store.get('custom', '');
    if (typeof text !== 'string') text = '';
    return { text: text, items: E.parseCustom(text).items };
  }

  var app = {
    screen: 'home',
    net: null,         // { kind: 'ws' | 'mqtt', ... } or null
    netReady: false,
    sess: null,        // the game this screen is running (party or online host)
    player: null,      // this phone's seat in someone else's online game
    loadToken: null,   // the game that is loading right now
    custom: loadCustom(),
    me: {
      pid: tabPid(),
      nm: M.clean(store.get('name', ''), 16),
      av: AVATARS.indexOf(store.get('avatar', '')) >= 0 ? store.get('avatar', '') : pick(AVATARS),
    },
    roster: loadRoster(),
    settings: {},
  };
  app.settings.party = loadSettings('party');
  app.settings.online = loadSettings('online');

  function allPacks() {
    var list = PACKS.concat(EMOJI_PACK);
    if (app.custom && app.custom.items.length) {
      list.push({ id: 'custom', name: PACK_INFO.custom.name, icon: PACK_INFO.custom.icon, items: app.custom.items });
    }
    return list;
  }

  function defaultSettings(mode) {
    return {
      cats: PACKS.map(function (p) { return p.id; }),
      diff: 'mixed',
      rounds: 10,
      seconds: mode === 'online' ? 30 : 20,
      reveal: 'zoom',
      hints: true,
      auto: false,
    };
  }

  function loadSettings(mode) {
    var d = defaultSettings(mode), s = store.get('set.v2.' + mode, null) || {};
    var known = PACKS.map(function (p) { return p.id; }).concat('emoji', 'custom');
    var out = {
      cats: Array.isArray(s.cats) ? s.cats.filter(function (id) { return known.indexOf(id) >= 0; }) : d.cats,
      diff: DIFFS.some(function (x) { return x[0] === s.diff; }) ? s.diff : d.diff,
      rounds: ROUNDS.indexOf(s.rounds) >= 0 ? s.rounds : d.rounds,
      seconds: SECONDS.indexOf(s.seconds) >= 0 ? s.seconds : d.seconds,
      reveal: REVEALS.some(function (x) { return x[0] === s.reveal; }) ? s.reveal : d.reveal,
      hints: typeof s.hints === 'boolean' ? s.hints : d.hints,
      auto: typeof s.auto === 'boolean' ? s.auto : d.auto,
    };
    if (!out.cats.length) out.cats = d.cats;
    return out;
  }

  function saveSettings(mode) { store.set('set.v2.' + mode, app.settings[mode]); }

  function loadRoster() {
    var list = store.get('roster', []);
    if (!Array.isArray(list)) return [];
    return list.slice(0, MAX_ROSTER).map(function (p) {
      return {
        pid: typeof p.pid === 'string' && /^r[a-z0-9]{6}$/.test(p.pid) ? p.pid : 'r' + E.rid(6),
        nm: M.clean(p.nm, 16) || 'Player',
        av: AVATARS.indexOf(p.av) >= 0 ? p.av : pick(AVATARS),
      };
    });
  }
  function saveRoster() { store.set('roster', app.roster); }

  function markSeen(id) {
    var seen = store.get('seen', []);
    if (!Array.isArray(seen)) seen = [];
    if (seen.indexOf(id) < 0) seen.push(id);
    store.set('seen', seen.slice(-1500));
  }

  function cfgFrom(set) {
    return {
      seconds: set.seconds,
      hints: set.hints,
      reveal: set.reveal,
      icons: set.cats.map(function (id) { return (PACK_INFO[id] || {}).icon; }).filter(Boolean),
    };
  }

  // Pick candidate puzzles (with spares), fetch their pictures and clip lists,
  // then settle on the final questions.
  function prepareDeck(set, onProgress) {
    var candidates = E.buildDeck({
      packs: allPacks(), cats: set.cats, diff: set.diff, rounds: Math.ceil(set.rounds * 1.6) + 3,
      seen: store.get('seen', []), playable: playable,
    }).map(function (pz) {
      // Media is attached per game; start from a clean copy of the puzzle.
      return Object.assign({}, pz, { media: null });
    });
    return MEDIA.prepare(candidates, onProgress).then(function (ready) {
      return E.trimDeck(ready, set.rounds, set.diff);
    });
  }

  // ------------------------------------------------------------ board view

  function ranksOf(sb) {
    var out = [], rank = 0, last = null;
    sb.forEach(function (r, i) {
      if (r[3] !== last) { rank = i + 1; last = r[3]; }
      out.push(rank);
    });
    return out;
  }

  function tilesHTML(mask, flip) {
    var k = 0, longest = 1;
    var words = mask.map(function (w) {
      var chars = Array.from(w);
      longest = Math.max(longest, chars.length);
      return '<span class="tw">' + chars.map(function (ch) {
        if (ch === '_') return '<span class="tile"></span>';
        if (/[\p{L}\p{N}]/u.test(ch)) {
          return '<span class="tile on' + (flip ? ' flip' : '') + '" style="--i:' + (k++) + '">' + esc(ch) + '</span>';
        }
        return '<span class="tp">' + esc(ch) + '</span>';
      }).join('') + '</span>';
    });
    return '<div class="tiles" style="--len:' + longest + '">' + words.join('') + '</div>';
  }

  function topInner(st, opts) {
    var cat = st.cat || ['', ''];
    return '<span class="pill cat-pill"><span class="pill-icon" aria-hidden="true">' + esc(cat[0]) + '</span>' + esc(cat[1]) + '</span>' +
      (opts.demo ? '' : '<span class="qnum" aria-label="Question ' + st.n + ' of ' + st.of + '">' + st.n + '<small>/' + st.of + '</small></span>') +
      (st.d ? '<span class="pill level l' + st.d + '">' + LEVEL[st.d] + '</span>' : '') +
      '<span class="board-gap"></span>' +
      '<div class="timer" role="timer" aria-label="Seconds left">' +
        '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="t-track" cx="50" cy="50" r="44"/>' +
        '<circle class="t-ring" cx="50" cy="50" r="44" pathLength="100"/></svg>' +
        '<span class="t-num"></span></div>';
  }

  function tileCoverHTML() {
    var cells = '';
    for (var i = 0; i < TILE_COLS * TILE_ROWS; i++) cells += '<span class="cover-tile" data-i="' + i + '"></span>';
    return '<div class="cover" aria-hidden="true">' + cells + '</div>';
  }

  // The clue itself: a photo, a clip (host) / "watch the screen" (phones), or emoji.
  function mediaInner(st, opts) {
    var md = st.md;
    if (md && md.t === 'img') {
      var src = esc(safeUrl(md.src));
      return '<div class="pic' + (md.flat ? ' is-flat' : '') + '">' +
        '<div class="pic-back" style="background-image:url(&quot;' + src + '&quot;)"></div>' +
        '<img class="pic-main fx" src="' + src + '" alt="" draggable="false" referrerpolicy="strict-origin-when-cross-origin">' +
        tileCoverHTML() + '</div>';
    }
    if (md && md.t === 'yt') {
      if (md.poster && !opts.host) {
        var p = esc(safeUrl(md.poster));
        return '<div class="pic is-poster"><div class="pic-back" style="background-image:url(&quot;' + p + '&quot;)"></div>' +
          '<img class="pic-main" src="' + p + '" alt="" draggable="false" referrerpolicy="strict-origin-when-cross-origin"></div>';
      }
      if (opts.host) {
        return '<div class="clip' + (md.a ? ' is-audio' : '') + '">' +
          '<div class="clip-slot fx"></div>' + (md.a ? '' : tileCoverHTML()) +
          '<div class="clip-shield" aria-hidden="true"></div>' +
          (md.a ? '<div class="clip-audio" aria-hidden="true"><div class="eq"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p>Listen…</p></div>' : '') +
          // Shown when the browser wants a click before playing sound; the click
          // passes through it to YouTube's own player underneath.
          '<div class="clip-tap" aria-hidden="true"><span class="clip-tap-icon">' + ICONS.play + '</span><span>Click here to start the clip</span></div>' +
          '<p class="clip-ad" role="status">YouTube is showing an ad first. Skip it when you can: the clip starts right after.</p>' +
          '</div>';
      }
      return '<div class="watch"><span class="watch-icon" aria-hidden="true">' + (md.a ? '🎧' : '📺') + '</span>' +
        '<p>' + (md.a ? 'Listen to the big screen' : 'Watch the big screen') + '</p></div>';
    }
    var gs = M.graphemes(st.clue || '');
    var drawable = !opts.phone || clueDrawable(st.clue);
    var clue = drawable
      ? gs.map(function (g, i) { return '<span class="g" data-i="' + i + '"><span class="gi">' + esc(g) + '</span></span>'; }).join('')
      : '<span class="clue-note">Look at the main screen for this clue</span>';
    return '<div class="clue' + (gs.length > 4 ? ' is-long' : '') + '" aria-label="Clue">' + clue + '</div>';
  }

  function footInner(st) {
    var hint = st.hint && (st.ph === 'rev' || st.hl >= 1) ? st.hint : '';
    var credit = st.ph === 'rev' && st.md && st.md.cr ? st.md.cr : '';
    // The question itself, until the letter tiles take its place.
    var ask = st.ph === 'q' && !st.mask && st.ask ? '<p class="ask">' + esc(st.ask) + '</p>' : '';
    return ask + (st.mask ? tilesHTML(st.mask, st.ph === 'rev') : '') +
      (st.ph === 'rev' ? '<p class="answer" role="status">' + esc(st.ans) + '</p>' : '') +
      (hint ? '<p class="hint"><span class="hint-label">' + (st.ph === 'rev' ? 'About' : 'Hint') + '</span>' + esc(hint) + '</p>' : '') +
      (credit ? '<p class="credit">Photo: ' + esc(credit) + '</p>' : '');
  }

  function veilInner(st, opts) {
    if (!st.pa) return '';
    if (st.pr === 'load') {
      return '<div class="veil veil-load"><span class="spinner" aria-hidden="true"></span>' +
        '<span class="veil-text">' + (opts.host ? 'Loading the clip…' : 'Get ready…') + '</span></div>';
    }
    return '<div class="veil"><span class="veil-text">Paused</span></div>';
  }

  // Draws the board in parts so a playing clip is never re-created by an
  // unrelated update (a hint appearing, a pause, a new guess).
  function renderBoard(board, st, opts, keys) {
    if (!board.firstChild || !board.querySelector('.board-media')) {
      board.innerHTML = '<div class="board-top"></div><div class="board-media"></div><div class="board-foot"></div><div class="board-veil"></div>';
      keys.top = keys.media = keys.foot = keys.veil = null;
    }
    var md = st.md;
    var parts = {
      top: [st.gid, st.n, st.of, (st.cat || []).join(), st.d].join('|'),
      media: [st.gid, st.n, st.rk, md ? md.t + '|' + (md.src || '') + '|' + (opts.host ? '' : md.poster || '') : 'emoji|' + (st.clue || '')].join('|'),
      foot: [st.ph, st.hl, JSON.stringify(st.mask || ''), st.hint || '', (md && md.cr) || '', st.ask || ''].join('|'),
      veil: [st.pa ? 1 : 0, st.pr || ''].join('|'),
    };
    if (parts.top !== keys.top) {
      keys.top = parts.top;
      $('.board-top', board).innerHTML = topInner(st, opts);
    }
    if (parts.media !== keys.media) {
      keys.media = parts.media;
      if (opts.beforeMedia) opts.beforeMedia();
      var area = $('.board-media', board);
      area.innerHTML = mediaInner(st, opts);
      if (md && md.fx) area.setAttribute('data-seed', md.fx.seed);
      if (opts.afterMedia) opts.afterMedia(area);
    }
    if (parts.foot !== keys.foot) {
      keys.foot = parts.foot;
      $('.board-foot', board).innerHTML = footInner(st);
    }
    if (parts.veil !== keys.veil) {
      keys.veil = parts.veil;
      $('.board-veil', board).innerHTML = veilInner(st, opts);
    }
    board.setAttribute('data-ph', st.ph);
    board.setAttribute('data-md', md ? md.t : 'emoji');
    board.setAttribute('data-rs', st.rs || 'zoom');
  }

  // ---------------------------------------------------- animation loop

  // Whatever board is on screen gets its timer and reveal effects painted here.
  var view = null; // { st, at, board, ticks, lastSec }

  function clockOf(st, at, now) {
    var dur = (st.sec || 30) * 1000;
    var left = st.ph === 'q' ? (st.pa ? st.left : Math.max(0, st.left - (now - at))) : 0;
    return { dur: dur, left: left, el: dur - left };
  }

  // A shuffled order for the cover tiles, the same on every screen for a round.
  var orderCache = {};
  function tileOrder(seed) {
    if (orderCache[seed]) return orderCache[seed];
    var n = TILE_COLS * TILE_ROWS, order = [], s = (Number(seed) || 1) >>> 0;
    for (var i = 0; i < n; i++) order.push(i);
    for (var j = n - 1; j > 0; j--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      var k = s % (j + 1), t = order[j];
      order[j] = order[k];
      order[k] = t;
    }
    orderCache = {};
    orderCache[seed] = order;
    return order;
  }

  // Where the picture actually sits inside an <img> drawn with object-fit: contain.
  function contentBox(img) {
    var W = img.clientWidth, H = img.clientHeight, w = img.naturalWidth, h = img.naturalHeight;
    if (!W || !H || !w || !h) return null;
    var k = Math.min(W / w, H / h);
    return { x: (W - w * k) / 2, y: (H - h * k) / 2, w: w * k, h: h * k, W: W, H: H };
  }

  function paint(v) {
    var st = v.st, b = v.board, c = clockOf(st, v.at, Date.now());
    var ring = b.querySelector('.t-ring'), num = b.querySelector('.t-num'), timer = b.querySelector('.timer');
    var secLeft = Math.ceil(c.left / 1000);
    if (ring) ring.style.strokeDashoffset = (100 - (100 * c.left) / c.dur).toFixed(2);
    if (num && num.textContent !== String(secLeft)) num.textContent = String(secLeft);
    if (timer) timer.classList.toggle('low', st.ph === 'q' && secLeft <= 5);
    if (v.ticks && st.ph === 'q' && !st.pa && secLeft !== v.lastSec) {
      if (v.lastSec != null && secLeft > 0 && secLeft <= 10) SFX.play(secLeft <= 5 ? 'tock' : 'tick');
      v.lastSec = secLeft;
    }
    // How much of the clue is showing: 0 at the start, 1 by 80% of the timer.
    var p = st.ph === 'q' ? Math.min(1, c.el / (0.8 * c.dur)) : 1;
    var fxEl = b.querySelector('.fx');
    if (fxEl && st.md) {
      var rs = st.rs;
      if (rs === 'zoom' && st.md.t === 'yt' && !st.md.a) {
        fxEl.style.transformOrigin = '50% 50%';
        fxEl.style.transform = 'scale(' + (1 + 1.6 * Math.pow(1 - p, 1.6)).toFixed(3) + ')';
      } else if (rs === 'zoom' && st.md.t === 'img') {
        // Start close enough that the picture fills the frame, then pull back.
        var fx = st.md.fx || { x: 0.5, y: 0.5 }, box = contentBox(fxEl), from = 5;
        if (box) {
          from = Math.max(5, 2.4 * Math.max(box.W / box.w, box.H / box.h));
          fxEl.style.transformOrigin = (box.x + fx.x * box.w).toFixed(1) + 'px ' + (box.y + fx.y * box.h).toFixed(1) + 'px';
        } else {
          fxEl.style.transformOrigin = fx.x * 100 + '% ' + fx.y * 100 + '%';
        }
        fxEl.style.transform = 'scale(' + (1 + (from - 1) * Math.pow(1 - p, 1.6)).toFixed(3) + ')';
      } else {
        fxEl.style.transform = '';
      }
      // Blur in half-pixel steps: re-blurring a big picture every frame is costly.
      var blur = rs === 'blur' ? Math.round(52 * (1 - p)) / 2 : 0;
      var filter = blur > 0 ? 'blur(' + blur + 'px)' : '';
      if (fxEl.style.filter !== filter) fxEl.style.filter = filter;
      var cover = b.querySelector('.cover');
      if (cover) {
        var tiles = cover.children, n = tiles.length;
        var open = rs === 'tiles' ? Math.min(n, 2 + Math.floor((n - 2) * p)) : n;
        var order = tileOrder(st.md.fx ? st.md.fx.seed : 1);
        for (var i = 0; i < n; i++) tiles[order[i]].classList.toggle('off', i < open);
      }
    }
    var clue = b.querySelector('.clue');
    if (clue) {
      if (st.rs === 'tiles') {
        var gs = clue.querySelectorAll('.g'), count = gs.length, visible = count;
        if (st.ph === 'q' && count > 1) visible = Math.min(count, 1 + Math.floor((c.el * (count - 1)) / (0.6 * c.dur) + 1e-9));
        for (var g = 0; g < count; g++) gs[g].classList.toggle('hidden', g >= visible);
      }
      var clueBlur = st.rs === 'blur' ? Math.round(40 * (1 - p)) / 2 : 0;
      var clueFilter = clueBlur > 0 ? 'blur(' + clueBlur + 'px)' : '';
      if (clue.style.filter !== clueFilter) clue.style.filter = clueFilter;
    }
  }

  function loop() {
    window.requestAnimationFrame(loop);
    if (view && view.board && view.board.isConnected) paint(view);
  }

  // ------------------------------------------------------- shared widgets

  function toast(msg, kind) {
    var box = $('#toasts'), el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 400);
    }, 2800);
  }

  var modalDone = null;
  function modal(html, cls) {
    var m = $('#modal');
    m.innerHTML = '<div class="modal-back" data-act="modal-close"></div>' +
      '<div class="modal-card ' + (cls || '') + '" role="dialog" aria-modal="true" aria-labelledby="modal-title">' + html + '</div>';
    m.hidden = false;
    var first = $('textarea, input, .btn.primary', m);
    if (first) first.focus();
  }
  function closeModal(result) {
    var m = $('#modal');
    if (m.hidden) return;
    m.hidden = true;
    m.innerHTML = '';
    if (modalDone) {
      var fn = modalDone;
      modalDone = null;
      fn(!!result);
    }
  }
  // In-page replacement for confirm(), which artifact viewers block.
  function ask(title, text, okLabel) {
    return new Promise(function (resolve) {
      modal('<h2 id="modal-title">' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p>' +
        '<div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">Stay</button>' +
        '<button type="button" class="btn primary" data-act="modal-ok">' + esc(okLabel) + '</button></div>', 'small');
      modalDone = resolve;
    });
  }

  function copyText(text, label) {
    var done = function () { toast(label || 'Copied'); };
    try {
      navigator.clipboard.writeText(text).then(done, function () { toast('Copy it from the screen: ' + text); });
    } catch (e) {
      toast('Copy it from the screen: ' + text);
    }
  }

  var wakeLock = null;
  function keepAwake(on) {
    if (on) {
      if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(function (w) {
        wakeLock = w;
        w.addEventListener('release', function () { wakeLock = null; });
      }, function () { /* not allowed here */ });
    } else if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  function confetti() {
    if (reduceMotion.matches) return;
    var c = $('#confetti'), ctx = c.getContext && c.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = window.innerWidth, h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = ['#ffd23f', '#2fe0a0', '#ff4d6d', '#9fb4ff', '#fff4dc'];
    var bits = [];
    for (var i = 0; i < 170; i++) {
      bits.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3, y: h * 0.35,
        vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 15 - 4,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
        s: 6 + Math.random() * 7, c: colors[i % colors.length],
      });
    }
    var start = performance.now();
    c.classList.add('on');
    (function frame(t) {
      var age = t - start;
      ctx.clearRect(0, 0, w, h);
      bits.forEach(function (b) {
        b.vy += 0.38; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.globalAlpha = Math.max(0, 1 - age / 3600);
        ctx.fillStyle = b.c;
        ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
        ctx.restore();
      });
      if (age < 3600) window.requestAnimationFrame(frame);
      else { ctx.clearRect(0, 0, w, h); c.classList.remove('on'); }
    })(start);
  }

  // Animate scoreboard rows to their new places (FLIP).
  function flipRows(container, html) {
    var before = {};
    $$('[data-pid]', container).forEach(function (el) { before[el.dataset.pid] = el.getBoundingClientRect().top; });
    container.innerHTML = html;
    if (reduceMotion.matches) return;
    $$('[data-pid]', container).forEach(function (el) {
      var old = before[el.dataset.pid];
      if (old == null || !el.animate) return;
      var dy = old - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) {
        el.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
  }

  function podiumHTML(sb) {
    var ranks = ranksOf(sb);
    var slots = [1, 0, 2].map(function (i) { return sb[i] ? { r: sb[i], place: ranks[i] } : null; });
    return '<div class="podium">' + slots.map(function (s, i) {
      var spot = ['second', 'first', 'third'][i];
      if (!s) return '<div class="pod pod-' + spot + ' pod-empty" aria-hidden="true"><div class="pod-step"></div></div>';
      return '<div class="pod pod-' + spot + '">' +
        '<span class="pod-av" aria-hidden="true">' + esc(s.r[2]) + '</span>' +
        '<span class="pod-nm">' + esc(s.r[1]) + '</span>' +
        '<span class="pod-sc">' + fmt(s.r[3]) + '</span>' +
        '<div class="pod-step"><span>' + ordinal(s.place) + '</span></div></div>';
    }).join('') + '</div>';
  }

  function awardsHTML(aw) {
    var label = { fast: ['⚡', 'Fastest answer'], streak: ['🔥', 'Longest streak'], sharp: ['🎯', 'Most correct'] };
    return (aw || []).map(function (a) {
      var l = label[a[0]];
      if (!l) return '';
      var detail = a[0] === 'fast' ? secs(a[4]) : a[0] === 'streak' ? a[4] + ' in a row' : a[4] + ' right';
      return '<div class="award"><span class="award-icon" aria-hidden="true">' + l[0] + '</span>' +
        '<span class="award-label">' + l[1] + '</span>' +
        '<span class="award-who">' + esc(a[3]) + ' ' + esc(a[2]) + '</span>' +
        '<span class="award-detail">' + esc(detail) + '</span></div>';
    }).join('');
  }

  function cfgLine(cfg) {
    if (!cfg) return '';
    return cfg.r + ' questions · ' + cfg.s + ' seconds each · ' + (cfg.c || []).join(' ');
  }

  // --------------------------------------------------------------- routing

  var cleanup = [];
  function show(name, arg) {
    cleanup.forEach(function (fn) { fn(); });
    cleanup = [];
    view = null;
    app.screen = name;
    document.body.setAttribute('data-screen', name);
    closeModal();
    SCREENS[name](arg);
    updateTopbar();
    window.scrollTo(0, 0);
    try { screenEl.focus({ preventScroll: true }); } catch (e) { screenEl.focus(); }
  }

  function updateTopbar() {
    var mid = $('#topbar-mid'), code = app.sess && app.sess.code ? app.sess.code : app.player ? app.player.code : '';
    mid.innerHTML = code ? '<span class="room-chip">Room <b>' + esc(code) + '</b></span>' : '';
    $('.topbar').classList.toggle('has-room', !!code);
    var snd = $('#btn-sound');
    snd.setAttribute('aria-pressed', String(!SFX.muted()));
    snd.setAttribute('aria-label', SFX.muted() ? 'Sound off' : 'Sound on');
    snd.classList.toggle('is-muted', SFX.muted());
    var full = $('#btn-full');
    full.hidden = !document.fullscreenEnabled;
  }

  // ---------------------------------------------------------------- screens

  var SCREENS = {};

  SCREENS.home = function () {
    var total = PACKS.reduce(function (n, p) { return n + p.items.length; }, 0);
    var onlineOk = app.netReady && app.net;
    screenEl.innerHTML =
      '<section class="home">' +
        '<div class="home-hero">' +
          '<div class="hero-copy">' +
            '<p class="eyebrow">The guessing game show for friends</p>' +
            '<h1 class="logo"><span class="logo-line">Guess<span class="logo-o">-o-</span></span><span class="logo-line">Rama</span></h1>' +
            '<p class="lede">Name the movie from a few seconds of its trailer, the song from its intro, the city or the animal from a zoomed-in photo, ' +
              'before the clock runs out. Like those YouTube quiz videos, except your friends are the contestants.</p>' +
          '</div>' +
          '<div class="marquee hero-board"><div class="board board-demo" id="demo-board" aria-label="Example question"></div></div>' +
        '</div>' +
        '<div class="modes">' +
          '<button type="button" class="mode" data-act="setup-party">' +
            '<span class="mode-icon" aria-hidden="true">📺</span>' +
            '<span class="mode-title">Play on one screen</span>' +
            '<span class="mode-text">Put it on the TV or share your screen on a call. Everyone shouts answers and the host hands out points.</span>' +
          '</button>' +
          '<button type="button" class="mode" data-act="setup-online"' + (onlineOk ? '' : ' disabled') + '>' +
            '<span class="mode-icon" aria-hidden="true">📱</span>' +
            '<span class="mode-title">Host an online game</span>' +
            '<span class="mode-text">Friends join on their phones with a room code and type their guesses. Faster answers score more.</span>' +
          '</button>' +
          '<button type="button" class="mode" data-act="join"' + (onlineOk ? '' : ' disabled') + '>' +
            '<span class="mode-icon" aria-hidden="true">🙋</span>' +
            '<span class="mode-title">Join a game</span>' +
            '<span class="mode-text">Got a room code from the host? Jump in here.</span>' +
          '</button>' +
        '</div>' +
        '<p class="net-note" id="net-note">' + esc(netNote()) + '</p>' +
        '<section class="cat-strip" aria-labelledby="cat-strip-title">' +
          '<h2 class="strip-title" id="cat-strip-title">' + fmt(total) + ' real clips and photos in ' + PACKS.length + ' categories</h2>' +
          '<ul class="cat-list">' + PACKS.map(function (p) {
            return '<li><span class="cl-icon" aria-hidden="true">' + p.icon + '</span>' + esc(p.name) +
              '<b>' + p.items.length + '</b><span class="cl-kind">' + kindLabel(p.kind) + '</span></li>';
          }).join('') + '</ul>' +
          '<p class="strip-note">Clips play through YouTube. Photos come from Wikipedia and Wikimedia Commons and are credited when each answer is revealed.</p>' +
        '</section>' +
      '</section>';
    startDemo();
  };

  function kindLabel(kind) {
    return kind === 'clip' ? 'clips' : kind === 'song' ? 'song clips' : 'photos';
  }

  function netNote() {
    if (!app.netReady) return 'Checking whether online rooms work here…';
    if (app.net && app.net.kind === 'ws') return 'Online rooms are ready. Friends on the same Wi-Fi can join from their phones.';
    if (app.net && app.net.kind === 'mqtt') return 'Online rooms are ready. Friends join on their own phones, wherever they are.';
    return 'Online rooms need a newer browser. One-screen mode works right here.';
  }

  function startDemo() {
    var el = $('#demo-board');
    if (!el) return;
    var keys = {}, timer = 0, alive = true, i = 0;
    cleanup.push(function () { alive = false; clearTimeout(timer); });

    function paintDemo(st) {
      renderBoard(el, st, { demo: true }, keys);
      view = { st: st, at: Date.now(), board: el, ticks: false };
    }
    function cycle(items, toState) {
      if (!alive) return;
      var it = items[i++ % items.length];
      paintDemo(toState(it, false));
      timer = setTimeout(function () {
        if (!alive) return;
        paintDemo(toState(it, true));
        timer = setTimeout(function () { cycle(items, toState); }, 3200);
      }, 6500);
    }
    function emojiState(smp, reveal) {
      return {
        gid: 'demo', ph: reveal ? 'rev' : 'q', n: i, of: 1, sec: 8, rs: 'tiles', clue: smp[0], cat: [smp[2], smp[3]],
        left: reveal ? 0 : 8000, hl: 1, mask: M.mask(smp[1], reveal ? 3 : 1), ans: smp[1],
      };
    }
    function photoState(pz, reveal) {
      return {
        gid: 'demo', ph: reveal ? 'rev' : 'q', n: i, of: 1, sec: 8, rs: 'zoom', cat: pz.cat,
        md: { t: 'img', src: pz.media.src, flat: pz.flat ? 1 : 0, fx: { x: 0.5, y: 0.45, seed: i } },
        left: reveal ? 0 : 8000, hl: 1, mask: M.mask(pz.answer, reveal ? 3 : 1), ans: pz.answer,
      };
    }
    if (reduceMotion.matches) {
      paintDemo(emojiState(DEMO_EMOJI[0], true));
      return;
    }
    paintDemo(emojiState(DEMO_EMOJI[0], false));
    MEDIA.prepare(DEMO_PHOTOS.map(function (p) { return Object.assign({}, p); })).then(function (ready) {
      if (!alive) return;
      clearTimeout(timer);
      if (ready.length >= 2) cycle(ready, photoState);
      else cycle(DEMO_EMOJI, emojiState);
    });
  }

  // ------------------------------------------------------------------ setup

  function segHTML(key, options, value, label) {
    return '<div class="field"><span class="field-label" id="lbl-' + key + '">' + label + '</span>' +
      '<div class="seg" role="group" aria-labelledby="lbl-' + key + '">' + options.map(function (o) {
        var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
        return '<button type="button" data-act="set" data-key="' + key + '" data-val="' + v + '" aria-pressed="' + (String(v) === String(value)) + '">' + t + '</button>';
      }).join('') + '</div></div>';
  }

  function switchHTML(key, checked, label, desc) {
    return '<label class="switch"><input type="checkbox" id="opt-' + key + '" data-setting="' + key + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="switch-ui" aria-hidden="true"></span>' +
      '<span class="switch-text"><b>' + label + '</b>' + (desc ? '<small>' + desc + '</small>' : '') + '</span></label>';
  }

  function rosterHTML() {
    if (!app.roster.length) return '<li class="roster-empty">No players yet. That’s fine: the game still runs, it just won’t keep score.</li>';
    return app.roster.map(function (p, i) {
      return '<li class="roster-row">' +
        '<button type="button" class="av-btn" data-act="cycle-av" data-i="' + i + '" aria-label="Change avatar for ' + esc(p.nm) + '">' + p.av + '</button>' +
        '<input class="roster-name" id="roster-' + i + '" data-roster="' + i + '" value="' + esc(p.nm) + '" maxlength="16" aria-label="Player ' + (i + 1) + ' name">' +
        '<button type="button" class="icon-btn small" data-act="remove-player" data-i="' + i + '" aria-label="Remove ' + esc(p.nm) + '">' + ICONS.x + '</button>' +
      '</li>';
    }).join('');
  }

  function catButton(p, set) {
    var n = p.items.filter(playable).length, on = set.cats.indexOf(p.id) >= 0 && n > 0;
    var sub = p.bonus ? n + ' emoji puzzles' : p.id === 'custom' ? n + ' of yours' : n + ' ' + kindLabel(p.kind);
    return '<button type="button" class="cat' + (on ? ' on' : '') + (p.bonus ? ' cat-bonus' : '') + '" data-act="toggle-cat" data-id="' + p.id + '" aria-pressed="' + on + '"' + (n ? '' : ' disabled') + '>' +
      '<span class="cat-icon" aria-hidden="true">' + p.icon + '</span>' +
      '<span class="cat-name">' + esc(p.name) + '</span>' +
      '<span class="cat-count">' + sub + '</span></button>';
  }

  SCREENS.setup = function (mode) {
    app.mode = mode;
    var set = app.settings[mode];
    var inRoom = mode === 'online' && app.sess && app.sess.kind === 'online';
    var cats = PACKS.map(function (p) { return catButton(p, set); }).join('');
    var extras = catButton(EMOJI_PACK, set) +
      (app.custom.items.length ? catButton({ id: 'custom', name: PACK_INFO.custom.name, icon: PACK_INFO.custom.icon, items: app.custom.items }, set) : '') +
      '<button type="button" class="cat cat-make" data-act="edit-custom">' +
        '<span class="cat-icon" aria-hidden="true">➕</span>' +
        '<span class="cat-name">' + (app.custom.items.length ? 'Edit my puzzles' : 'Add your own') + '</span>' +
        '<span class="cat-count">Your photos, YouTube links or inside jokes</span></button>';

    var players = mode === 'party'
      ? '<div class="panel setup-players"><div class="panel-head"><h2>Players</h2><span class="panel-sub">optional</span></div>' +
          '<p class="muted">Add names to keep score. Tap an avatar to change it.</p>' +
          '<ul class="roster" id="roster">' + rosterHTML() + '</ul>' +
          '<form data-form="add-player" class="add-player"' + (app.roster.length >= MAX_ROSTER ? ' hidden' : '') + '>' +
            '<input id="new-player" maxlength="16" placeholder="Player name" aria-label="New player name" autocomplete="off">' +
            '<button type="submit" class="btn ghost small">Add</button></form>' +
        '</div>'
      : '';

    screenEl.innerHTML =
      '<section class="setup" data-mode="' + mode + '">' +
        '<div class="screen-head">' +
          '<button type="button" class="btn ghost small back" data-act="' + (inRoom ? 'back-to-room' : 'go-home') + '">' + ICONS.back + (inRoom ? 'Room' : 'Home') + '</button>' +
          '<h1 class="screen-title">' + (mode === 'party' ? 'One-screen game' : 'Online game') + '</h1>' +
        '</div>' +
        '<div class="setup-grid">' +
          '<div class="panel setup-cats"><div class="panel-head"><h2>Categories</h2><span class="panel-sub" id="cat-count"></span>' +
            '<span class="panel-tools"><button type="button" class="link-btn" data-act="cats-all">All</button><button type="button" class="link-btn" data-act="cats-none">None</button></span></div>' +
            '<div class="cat-grid">' + cats + '</div>' +
            '<h3 class="cat-subhead">Extras</h3>' +
            '<div class="cat-grid">' + extras + '</div></div>' +
          '<div class="setup-side">' +
            '<div class="panel setup-rules"><div class="panel-head"><h2>Rules</h2></div>' +
              segHTML('diff', DIFFS, set.diff, 'Difficulty') +
              segHTML('rounds', ROUNDS, set.rounds, 'Questions') +
              segHTML('seconds', SECONDS, set.seconds, 'Seconds per question') +
              segHTML('reveal', REVEALS, set.reveal, 'How pictures and clips start') +
              switchHTML('hints', set.hints, 'Letter hints', 'Blank tiles, then first letters, as time runs down') +
              switchHTML('auto', set.auto, 'Keep it moving', 'Go to the next question by itself a few seconds after each answer') +
            '</div>' +
            players +
          '</div>' +
        '</div>' +
        '<div class="setup-go">' +
          '<p class="setup-summary" id="setup-summary"></p>' +
          '<button type="button" class="btn primary big" data-act="' + (mode === 'party' ? 'start-party' : inRoom ? 'room-save' : 'open-room') + '">' +
            (mode === 'party' ? 'Start the show' : inRoom ? 'Save and go back to the room' : 'Open the room') + ICONS.next + '</button>' +
        '</div>' +
      '</section>';
    updateSetupSummary();
  };

  function updateSetupSummary() {
    var set = app.settings[app.mode], el = $('#setup-summary'), cc = $('#cat-count');
    if (!el) return;
    var pool = allPacks().filter(function (p) { return set.cats.indexOf(p.id) >= 0; })
      .reduce(function (n, p) { return n + p.items.filter(playable).length; }, 0);
    if (cc) cc.textContent = set.cats.length + ' picked';
    el.textContent = pool
      ? set.rounds + ' questions from ' + fmt(pool) + ' puzzles' + (pool < set.rounds ? ' (only ' + pool + ' available, so the game will be shorter)' : '')
      : 'Pick at least one category.';
    var go = $('.setup-go .btn.primary');
    if (go) go.disabled = !pool;
  }

  function openCustom() {
    modal(
      '<h2 id="modal-title">Add your own puzzles</h2>' +
      '<p class="muted">One puzzle per line: a picture link, a YouTube link or some emoji, then an equals sign and the answer. ' +
        'Add other accepted answers after <b>/</b> and a hint after <b>|</b>. Great for photos of your friends and inside jokes.</p>' +
      '<pre class="example">https://youtu.be/dQw4w9WgXcQ?t=43 = Never Gonna Give You Up\nhttps://example.com/our-trip.jpg = Barcelona | Summer 2024\n🦁👑 = The Lion King / Lion King</pre>' +
      '<label class="field-label" for="custom-text">Your puzzles</label>' +
      '<textarea id="custom-text" rows="8" spellcheck="false" placeholder="https://youtu.be/… = Song name">' + esc(app.custom.text) + '</textarea>' +
      '<p class="custom-status" id="custom-status" aria-live="polite"></p>' +
      '<div class="modal-actions"><button type="button" class="btn ghost" data-act="modal-close">Cancel</button>' +
      '<button type="button" class="btn primary" data-act="custom-save">Save puzzles</button></div>'
    );
    updateCustomStatus();
  }

  function updateCustomStatus() {
    var ta = $('#custom-text'), out = $('#custom-status');
    if (!ta || !out) return;
    var res = E.parseCustom(ta.value);
    var kinds = { photos: 0, clips: 0, emoji: 0 };
    res.items.forEach(function (it) {
      if (it.kind === 'url-img') kinds.photos++;
      else if (it.kind === 'url-yt') kinds.clips++;
      else kinds.emoji++;
    });
    var parts = [];
    if (kinds.photos) parts.push(kinds.photos + ' picture' + (kinds.photos > 1 ? 's' : ''));
    if (kinds.clips) parts.push(kinds.clips + ' clip' + (kinds.clips > 1 ? 's' : ''));
    if (kinds.emoji) parts.push(kinds.emoji + ' emoji');
    var msg = res.items.length ? 'Ready: ' + parts.join(', ') + '.' : 'Nothing yet.';
    if (res.errors.length) {
      msg += ' Skipping line' + (res.errors.length > 1 ? 's ' : ' ') + res.errors.slice(0, 5).join(', ') + (res.errors.length > 5 ? '…' : '') + ' (needs “clue = answer”).';
    }
    out.textContent = msg;
  }

  // ---------------------------------------------------------- loading view

  SCREENS.loading = function (o) {
    screenEl.innerHTML =
      '<section class="loading">' +
        '<div class="marquee loading-marquee"><div class="board board-loading">' +
          '<p class="eyebrow">Getting the show ready</p>' +
          '<h1 class="loading-title">Loading clips and pictures</h1>' +
          '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" id="load-progress"><div class="progress-bar" id="load-bar"></div></div>' +
          '<p class="muted" id="load-note">' + esc((o && o.note) || 'Picking puzzles…') + '</p>' +
          '<button type="button" class="btn ghost small" data-act="cancel-load">Cancel</button>' +
        '</div></div>' +
      '</section>';
  };

  function loadProgress(done, total) {
    var bar = $('#load-bar'), note = $('#load-note'), pb = $('#load-progress');
    if (!bar) return;
    var pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = Math.max(6, pct) + '%';
    if (pb) pb.setAttribute('aria-valuenow', String(pct));
    if (note) note.textContent = total ? 'Pictures: ' + done + ' of ' + total : 'Fetching clip lists…';
  }

  // ------------------------------------------------------------ stage view

  SCREENS.stage = function () {
    var s = app.sess;
    screenEl.innerHTML =
      '<section class="stage" data-kind="' + s.kind + '">' +
        '<div class="stage-main">' +
          '<div class="marquee stage-marquee"><div class="board board-big" id="board"></div></div>' +
          '<div class="controls" id="controls"></div>' +
        '</div>' +
        '<aside class="panel scores" id="scores" aria-label="Scoreboard"></aside>' +
      '</section>';
    s.keys = {};
    s.boardKeys = {};
    s.view = null;
    stopClip(s);
    refreshStage();
  };

  function refreshStage() {
    var s = app.sess;
    if (!s || app.screen !== 'stage') return;
    var st = s.game.publicState(), board = $('#board');
    renderBoard(board, st, {
      host: true,
      beforeMedia: function () { stopClip(s); },
      afterMedia: function (area) {
        if (st.ph !== 'q' || !st.md || st.md.t !== 'yt') return;
        var pz = s.game.r && s.game.r.pz, slot = $('.clip-slot', area);
        // Not from inside this redraw: starting a clip pauses the game, which redraws the board.
        Promise.resolve().then(function () {
          if (app.sess === s && s.game.r && s.game.r.pz === pz && s.game.phase === 'q' && slot && slot.isConnected) startClip(s, slot);
        });
      },
    }, s.boardKeys);
    if (!s.view || s.keys.n !== st.n) {
      s.keys.n = st.n;
      s.view = { ticks: true, lastSec: null };
    }
    s.view.st = st;
    s.view.at = Date.now();
    s.view.board = board;
    view = s.view;

    var scoresKey = st.ph + JSON.stringify(st.sb);
    if (scoresKey !== s.keys.scores) {
      s.keys.scores = scoresKey;
      renderScores($('#scores'), st, s);
    }
    var controlsKey = [st.ph, st.pa ? 1 : 0, st.pr || '', st.n, s.autoAt ? 1 : 0].join('|');
    if (controlsKey !== s.keys.controls) {
      s.keys.controls = controlsKey;
      $('#controls').innerHTML = controlsHTML(st, s);
    }
    $('.stage').classList.toggle('no-scores', !st.sb.length && s.kind === 'party');
  }

  function controlsHTML(st, s) {
    var html = '';
    if (st.ph === 'q') {
      var loading = st.pa && st.pr === 'load';
      html += '<button type="button" class="btn ghost" data-act="pause"' + (loading ? ' disabled' : '') + '>' + (st.pa && !loading ? ICONS.play + 'Resume' : ICONS.pause + 'Pause') + '</button>';
      html += '<button type="button" class="btn primary" data-act="reveal">Reveal the answer <kbd>Space</kbd></button>';
    } else if (st.ph === 'rev') {
      var last = st.n >= st.of;
      html += '<button type="button" class="btn primary" data-act="next">' + (last ? 'Final scores' : 'Next question') +
        (s.autoAt ? ' <span class="auto-count" id="auto-count"></span>' : '') + ' <kbd>Space</kbd></button>';
    }
    html += '<button type="button" class="btn ghost small end" data-act="end-game">End game</button>';
    return html;
  }

  function renderScores(el, st, s) {
    var party = s.kind === 'party', live = st.ph === 'q' || st.ph === 'rev';
    var head = '<div class="panel-head"><h2>Scoreboard</h2>' +
      (party ? '' : '<span class="panel-sub">' + st.sb.filter(function (r) { return r[6]; }).length + ' playing</span>') + '</div>';
    if (!st.sb.length) {
      el.innerHTML = head + '<p class="scores-empty">' +
        (party ? 'No scores this time. Add players in the setup if you want to keep score.' : 'Nobody here yet.') + '</p>';
      return;
    }
    var order = s.game.players.map(function (p) { return p.pid; });
    var ranks = ranksOf(st.sb);
    var gotCount = st.sb.filter(function (r) { return r[5]; }).length;
    var rows = st.sb.map(function (r, i) {
      var pid = r[0], got = r[5], status = '';
      if (live && got) status = '<span class="s-got">' + (got === 2 ? '⚡ ' : '✓ ') + (party ? '' : secs(r[8])) + '</span>';
      else if (live && !party && st.ph === 'q' && r[9]) status = '<span class="s-tries">' + r[9] + (r[9] === 1 ? ' guess' : ' guesses') + '</span>';
      else if (!party && !r[6]) status = '<span class="s-off">away</span>';
      var key = party && live && order.indexOf(pid) < 9 ? '<kbd class="row-key" title="Shortcut key">' + (order.indexOf(pid) + 1) + '</kbd>' : '';
      var inner =
        '<span class="rank">' + ranks[i] + '</span>' +
        '<span class="av"><span aria-hidden="true">' + esc(r[2]) + '</span>' + key + '</span>' +
        '<span class="nm">' + esc(r[1]) + (r[7] >= 2 ? ' <span class="streak" title="Streak">🔥' + r[7] + '</span>' : '') + '</span>' +
        status +
        '<span class="sc">' + fmt(r[3]) + (live && r[4] ? '<span class="delta">+' + fmt(r[4]) + '</span>' : '') + '</span>';
      var cls = 'srow' + (got && live ? ' is-got' : '') + (r[6] ? '' : ' is-away');
      return party && live
        ? '<li class="' + cls + '" data-pid="' + esc(pid) + '"><button type="button" class="srow-in" data-act="award" data-pid="' + esc(pid) + '" aria-pressed="' + (got ? 'true' : 'false') + '">' + inner + '</button></li>'
        : '<li class="' + cls + '" data-pid="' + esc(pid) + '"><div class="srow-in">' + inner + '</div></li>';
    }).join('');
    var tip = party && live
      ? '<p class="scores-tip">Tap whoever got it right, or press the number on their avatar. Tap again to undo.</p>'
      : !party && live ? '<p class="scores-tip">' + gotCount + ' of ' + st.sb.length + ' got it</p>' : '';
    flipRows(el, head + tip + '<ol class="srows">' + rows + '</ol>');
  }

  // ----------------------------------------------------------- clip control

  // Host only: play the round's clip; the clock waits until it's actually playing.
  function startClip(s, slot) {
    var g = s.game, pz = g.r && g.r.pz;
    if (!slot || !pz || !pz.media || pz.media.type !== 'yt') return;
    var token = { pz: pz };
    s.clip = token;
    g.hold();
    MEDIA.playClip(slot, {
      ids: pz.media.ids,
      audio: pz.media.audio,
      start: pz.media.start,
      custom: pz.media.custom,
      names: [pz.answer].concat(pz.alts || []),
      cancelled: function () { return s.clip !== token || app.sess !== s; },
      onNeedTap: function (on) {
        if (s.clip === token) clipPrompt(on ? 'needs-tap' : '');
      },
      onAd: function () {
        if (s.clip === token) clipPrompt('ad-wait');
      },
    }).then(function (ctl) {
      if (s.clip !== token || app.sess !== s) { ctl.stop(); return; }
      token.ctl = ctl;
      clipPrompt('');
      // A click on the player leaves the keyboard focus inside it; take it back for the shortcuts.
      if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        try { screenEl.focus({ preventScroll: true }); } catch (e) { /* fine */ }
      }
      if (g.r && g.r.pz === pz) g.release();
    }, function () {
      if (s.clip !== token || app.sess !== s) return;
      s.clip = null;
      clipPrompt('');
      clipFailed(s, pz);
    });
  }

  function stopClip(s) {
    clipPrompt('');
    if (!s || !s.clip) return;
    if (s.clip.ctl) s.clip.ctl.stop();
    s.clip = null;
  }

  // While a clip gets going, the board can ask the host for a hand:
  //   needs-tap  the browser won't play sound until someone clicks; the click
  //              goes through to YouTube's own player
  //   ad-wait    YouTube shows an ad first; the player is shown so it can be skipped
  function clipPrompt(kind) {
    var board = $('#board');
    if (!board) return;
    board.classList.toggle('needs-tap', kind === 'needs-tap');
    board.classList.toggle('ad-wait', kind === 'ad-wait');
  }

  // The clip wouldn't play here (removed, blocked in this country, or YouTube
  // is unreachable): show the poster instead, or swap in a spare puzzle.
  function clipFailed(s, pz) {
    var g = s.game;
    if (!g.r || g.r.pz !== pz || (g.phase !== 'q' && g.phase !== 'rev')) return;
    if (pz.poster) {
      pz.media = { type: 'img', src: pz.poster, poster: true, credit: 'Poster via Wikipedia' };
      if (g.phase === 'q') {
        var img = new Image();
        img.onload = img.onerror = function () {
          if (g.r && g.r.pz === pz) g.release();
        };
        img.src = pz.poster;
      }
      refreshStage();
      publishSoon(0);
      return;
    }
    if (g.phase !== 'q') return;
    var spare = s.spare.shift();
    if (spare) {
      g.replaceCurrent(spare);
      return;
    }
    toast('That clip wouldn’t play, so here’s the answer.', 'warn');
    g.release();
    g.reveal('skip');
  }

  // ------------------------------------------------------------ lobby view

  function joinLink(code) {
    var base = location.origin + location.pathname;
    var info = app.net && app.net.info;
    if (info && info.lan && info.lan.length && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
      base = info.lan[0] + location.pathname;
    }
    return base + '#join-' + code;
  }

  // The join link as a QR code, drawn here (js/vendor/qrcode.js).
  function qrSvg(text) {
    if (typeof window.qrcode !== 'function') return '';
    try {
      var qr = window.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    } catch (e) {
      return '';
    }
  }

  SCREENS.lobby = function () {
    var s = app.sess, code = s.code, lan = app.net && app.net.kind === 'ws';
    var link = joinLink(code), qr = qrSvg(link);
    var how = '<div class="join-how"><div class="join-text">' +
        '<p class="join-step">' + (lan ? 'On your phone, go to' : 'On any phone, anywhere, go to') + '</p>' +
        '<p class="join-url">' + esc(link.replace(/^https?:\/\//, '').replace(/#.*$/, '').replace(/\/$/, '')) + '</p>' +
        '<p class="join-step">and type the code' + (qr ? ', or scan this:' : '.') + '</p>' +
        '<div class="join-share">' +
          (navigator.share ? '<button type="button" class="btn ghost small" data-act="share-link">' + ICONS.share + 'Share invite</button>' : '') +
          '<button type="button" class="btn ghost small" data-act="copy-link">' + ICONS.copy + 'Copy invite link</button>' +
        '</div></div>' +
        (qr ? '<div class="qr" role="img" aria-label="QR code that opens the join page">' + qr + '</div>' : '') +
      '</div>';
    screenEl.innerHTML =
      '<section class="lobby">' +
        '<div class="marquee lobby-marquee"><div class="board board-lobby">' +
          '<p class="eyebrow">Room code</p>' +
          '<p class="room-code" aria-label="Room code ' + code.split('').join(' ') + '">' + code.split('').map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</p>' +
          how +
        '</div></div>' +
        '<div class="panel lobby-side">' +
          '<div class="panel-head"><h2>Players</h2><span class="panel-sub" id="lobby-count"></span></div>' +
          '<ul class="lobby-list" id="lobby-list"></ul>' +
          '<p class="lobby-cfg" id="lobby-cfg"></p>' +
          '<p class="lobby-prep" id="lobby-prep"></p>' +
          '<div class="lobby-actions">' +
            '<button type="button" class="btn ghost" data-act="room-settings">Change settings</button>' +
            '<button type="button" class="btn primary big" data-act="room-start" id="room-start">Start the game' + ICONS.next + '</button>' +
          '</div>' +
          '<button type="button" class="link-btn close-room" data-act="end-room">Close the room</button>' +
        '</div>' +
      '</section>';
    refreshLobby();
  };

  function refreshLobby() {
    var s = app.sess;
    if (!s || app.screen !== 'lobby') return;
    var st = s.game.publicState(), list = $('#lobby-list');
    var online = st.sb.filter(function (r) { return r[6]; });
    // Only newcomers pop in; everyone else stays put when the list redraws.
    var known = s.lobbyShown || (s.lobbyShown = {});
    list.innerHTML = st.sb.length
      ? st.sb.map(function (r) {
          var fresh = !known[r[0]];
          known[r[0]] = true;
          return '<li class="lobby-player' + (fresh ? ' is-new' : '') + (r[6] ? '' : ' is-away') + '"><span class="av" aria-hidden="true">' + esc(r[2]) + '</span>' +
            '<span class="nm">' + esc(r[1]) + (r[6] ? '' : ' <small>(away)</small>') + '</span>' +
            '<button type="button" class="icon-btn small" data-act="kick" data-pid="' + esc(r[0]) + '" aria-label="Remove ' + esc(r[1]) + '">' + ICONS.x + '</button></li>';
        }).join('')
      : '<li class="lobby-empty">Waiting for players to join…</li>';
    $('#lobby-count').textContent = online.length + ' / ' + E.MAX_PLAYERS;
    $('#lobby-cfg').textContent = cfgLine(st.cfg);
    var prep = s.prep || {}, prepEl = $('#lobby-prep');
    prepEl.className = 'lobby-prep' + (prep.state === 'error' ? ' is-error' : prep.state === 'ready' ? ' is-ready' : '');
    prepEl.textContent = prep.state === 'ready' ? '✓ Clips and pictures are ready'
      : prep.state === 'error' ? prep.message
      : 'Loading clips and pictures' + (prep.total ? ' (' + prep.done + ' of ' + prep.total + ')' : '') + '…';
    $('#room-start').disabled = !online.length || prep.state !== 'ready';
  }

  // ------------------------------------------------------------ final view

  function recapHTML(deck) {
    return deck.map(function (pz) {
      var md = pz.media || {};
      var thumb = md.type === 'img' && safeUrl(md.src)
        ? '<img class="rc-img" src="' + esc(md.src) + '" alt="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">'
        : '<span class="rc-clue" aria-hidden="true">' + esc(md.type === 'yt' ? (md.audio ? '🎧' : '🎬') : pz.clue || (PACK_INFO[pz.pack] || {}).icon || '❓') + '</span>';
      return '<li>' + thumb + '<span class="rc-ans">' + esc(pz.answer) + '</span></li>';
    }).join('');
  }

  SCREENS.final = function () {
    var s = app.sess, st = s.game.publicState(), sb = st.sb;
    var rest = sb.slice(3), ranks = ranksOf(sb);
    screenEl.innerHTML =
      '<section class="final">' +
        '<p class="eyebrow">' + (s.game.deck.length) + ' questions played</p>' +
        '<h1 class="final-title">' + (sb.length ? (sb.length > 1 && sb[0][3] === sb[1][3] ? 'It’s a tie at the top!' : 'And the winner is ' + esc(sb[0][1]) + '!') : 'That’s a wrap!') + '</h1>' +
        (sb.length ? podiumHTML(sb) : '<p class="lede">How many did you get? Play again for a fresh set.</p>') +
        (st.aw && st.aw.length ? '<div class="awards">' + awardsHTML(st.aw) + '</div>' : '') +
        (rest.length ? '<ol class="final-rest">' + rest.map(function (r, i) {
          return '<li><span class="rank">' + ranks[i + 3] + '</span><span class="av" aria-hidden="true">' + esc(r[2]) + '</span><span class="nm">' + esc(r[1]) + '</span><span class="sc">' + fmt(r[3]) + '</span></li>';
        }).join('') + '</ol>' : '') +
        '<div class="final-actions">' +
          '<button type="button" class="btn primary big" data-act="again">Play again' + ICONS.next + '</button>' +
          '<button type="button" class="btn ghost" data-act="final-settings">Change settings</button>' +
          '<button type="button" class="btn ghost" data-act="' + (s.kind === 'online' ? 'end-room' : 'go-home') + '">' + (s.kind === 'online' ? 'Close the room' : 'Home') + '</button>' +
        '</div>' +
        '<details class="recap"><summary>All the answers</summary><ol>' + recapHTML(s.game.deck) + '</ol></details>' +
      '</section>';
  };

  // ------------------------------------------------------------- join view

  SCREENS.join = function (code) {
    var me = app.me;
    screenEl.innerHTML =
      '<section class="join">' +
        '<div class="panel join-panel">' +
          '<div class="screen-head"><button type="button" class="btn ghost small back" data-act="go-home">' + ICONS.back + 'Home</button></div>' +
          '<h1 class="screen-title">Join a game</h1>' +
          '<form data-form="join" class="join-form" autocomplete="off" novalidate>' +
            '<label class="field-label" for="join-code">Room code</label>' +
            '<input id="join-code" class="code-input" maxlength="4" autocapitalize="characters" spellcheck="false" value="' + esc(code || '') + '" placeholder="BRTK" aria-describedby="join-msg">' +
            '<label class="field-label" for="join-name">Your name</label>' +
            '<input id="join-name" maxlength="16" value="' + esc(me.nm) + '" placeholder="What should we call you?" autocomplete="nickname">' +
            '<fieldset class="avatars"><legend class="field-label">Your avatar</legend><div class="av-grid">' +
              AVATARS.map(function (a) {
                return '<button type="button" class="av-pick" data-act="pick-av" data-av="' + a + '" aria-pressed="' + (a === me.av) + '">' + a + '</button>';
              }).join('') +
            '</div></fieldset>' +
            '<button type="submit" class="btn primary big" id="join-go">Join the game' + ICONS.next + '</button>' +
            '<p class="form-msg" id="join-msg" role="alert"></p>' +
          '</form>' +
        '</div>' +
      '</section>';
    if (app.netReady && !app.net) $('#join-msg').textContent = netNote();
    var focus = code ? $('#join-name') : $('#join-code');
    if (focus && !('ontouchstart' in window)) focus.focus();
  };

  // ------------------------------------------------------------ phone view

  SCREENS.phone = function () {
    var pl = app.player;
    pl.keys = {};
    pl.boardKeys = {};
    screenEl.innerHTML =
      '<section class="phone">' +
        '<div class="phone-bar">' +
          '<span class="me"><span class="av" aria-hidden="true">' + esc(app.me.av) + '</span>' + esc(app.me.nm) + '</span>' +
          '<span class="me-score" id="me-score"></span>' +
          '<button type="button" class="link-btn" data-act="leave-game">Leave</button>' +
        '</div>' +
        '<div class="phone-body" id="phone-body"></div>' +
      '</section>';
    refreshPhone();
  };

  function myRow(st) {
    var sb = (st && st.sb) || [];
    for (var i = 0; i < sb.length; i++) if (sb[i][0] === app.me.pid) return { r: sb[i], rank: ranksOf(sb)[i], of: sb.length };
    return null;
  }

  function refreshPhone() {
    var pl = app.player, body = $('#phone-body');
    if (!pl || !body || app.screen !== 'phone') return;
    var st = pl.st;
    var phaseKey = !st ? (pl.lost ? 'missing' : 'looking') : pl.hostGone ? 'gone' : st.ph + '|' + st.n + '|' + st.gid;
    var mine = st ? myRow(st) : null;
    $('#me-score').textContent = mine ? fmt(mine.r[3]) + ' pts' : '';

    if (phaseKey !== pl.keys.phase) {
      pl.keys = { phase: phaseKey };
      pl.boardKeys = {};
      body.innerHTML = phoneBodyHTML(st, pl);
      if (st && st.ph === 'q' && !(mine && mine.r[5])) {
        var input = $('#guess');
        if (input && !('ontouchstart' in window)) input.focus();
      }
    }
    if (!st || pl.hostGone) return;

    var board = $('#board');
    if (board) {
      renderBoard(board, st, { phone: true }, pl.boardKeys);
      view = { st: st, at: pl.at, board: board, ticks: false };
    }

    if (st.ph === 'lobby') {
      var mp = $('#mini-players');
      if (mp) mp.innerHTML = st.sb.map(function (r) {
        return '<li' + (r[0] === app.me.pid ? ' class="is-me"' : '') + '><span aria-hidden="true">' + esc(r[2]) + '</span>' + esc(r[1]) + '</li>';
      }).join('');
      var cl = $('#cfg-line');
      if (cl) cl.textContent = cfgLine(st.cfg);
    }
    if (st.ph === 'q') {
      var got = mine && mine.r[5];
      var form = $('#guess-form');
      if (form) form.classList.toggle('is-done', !!got);
      $$('#guess-form input, #guess-form button').forEach(function (el) { el.disabled = !!got || !!st.pa; });
      var fb = $('#fb');
      if (got) {
        fb.className = 'fb fb-y';
        fb.textContent = 'You got it! +' + fmt(mine.r[4]) + (mine.r[5] === 2 ? '. First one in!' : '');
      } else if (pl.fb) {
        fb.className = 'fb fb-' + pl.fb.code;
        fb.textContent = pl.fb.text;
      } else if (pl.pending) {
        fb.className = 'fb';
        fb.textContent = 'Checking…';
      } else {
        fb.className = 'fb';
        fb.textContent = '';
      }
      var count = st.sb.filter(function (r) { return r[5]; }).length;
      var stEl = $('#phone-status');
      if (stEl) {
        stEl.textContent = st.pa ? (st.pr === 'load' ? 'The next clue is loading…' : 'The host paused the game.')
          : count + ' of ' + st.sb.length + ' got it';
      }
    }
    if (st.ph === 'rev') {
      var res = $('#result');
      if (res) res.innerHTML = resultHTML(st, mine);
    }
  }

  function phoneBodyHTML(st, pl) {
    if (!st) {
      if (pl.lost) {
        return '<div class="panel phone-card"><p class="big-emoji" aria-hidden="true">🔍</p><h1>No game found</h1>' +
          '<p class="muted">Nobody is hosting room <b>' + esc(pl.code) + '</b> right now. Check the code on the host’s screen.</p>' +
          '<div class="stack"><button type="button" class="btn primary" data-act="retry-join">Try again</button>' +
          '<button type="button" class="btn ghost" data-act="leave-game">Change the code</button></div></div>';
      }
      return '<div class="panel phone-card"><p class="big-emoji spin" aria-hidden="true">🎲</p><h1>Finding room ' + esc(pl.code) + '…</h1></div>';
    }
    if (pl.hostGone) {
      return '<div class="panel phone-card"><p class="big-emoji" aria-hidden="true">📡</p><h1>Lost the host</h1>' +
        '<p class="muted">Waiting for the host’s screen to come back. Your score is safe.</p></div>';
    }
    if (st.ph === 'lobby') {
      return '<div class="panel phone-card"><p class="big-emoji" aria-hidden="true">🎉</p><h1>You’re in!</h1>' +
        '<p class="muted">Keep this screen open. The game starts when the host is ready.</p>' +
        '<ul class="mini-players" id="mini-players"></ul><p class="cfg-line" id="cfg-line"></p></div>';
    }
    if (st.ph === 'q') {
      return '<div class="marquee small"><div class="board board-small" id="board"></div></div>' +
        '<form data-form="guess" class="guess-form" id="guess-form" autocomplete="off">' +
          '<label class="sr-only" for="guess">Your guess</label>' +
          '<input id="guess" maxlength="60" placeholder="Type your guess" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send">' +
          '<button type="submit" class="btn primary">Guess</button>' +
        '</form>' +
        '<p class="fb" id="fb" aria-live="polite"></p>' +
        '<p class="phone-status" id="phone-status"></p>';
    }
    if (st.ph === 'rev') {
      return '<div class="marquee small"><div class="board board-small" id="board"></div></div>' +
        '<div class="panel result" id="result" aria-live="polite"></div>';
    }
    var mine = myRow(st);
    return '<div class="panel phone-card final-me">' +
      (mine ? '<p class="eyebrow">Final score</p><h1>You finished ' + ordinal(mine.rank) + '!</h1><p class="final-pts">' + fmt(mine.r[3]) + ' points</p>' : '<h1>Game over</h1>') +
      podiumHTML(st.sb) +
      (st.aw && st.aw.length ? '<div class="awards">' + awardsHTML(st.aw) + '</div>' : '') +
      '<p class="muted">Stay on this screen if the host starts another game.</p></div>';
  }

  function resultHTML(st, mine) {
    if (!mine) return '<p class="result-line">The answer was <b>' + esc(st.ans) + '</b>.</p>';
    var r = mine.r;
    var head = r[5]
      ? '<p class="result-big good">+' + fmt(r[4]) + '</p><p class="result-line">' + (r[5] === 2 ? 'First to get it, ' : 'Got it in ') + secs(r[8]) + (r[5] === 2 ? '!' : '') + '</p>'
      : '<p class="result-big">No points</p><p class="result-line">The answer was <b>' + esc(st.ans) + '</b>.</p>';
    return head + '<p class="result-rank">You’re ' + ordinal(mine.rank) + ' of ' + mine.of + ' with ' + fmt(r[3]) + ' points' + (r[7] >= 2 ? ' · 🔥 ' + r[7] + ' in a row' : '') + '</p>';
  }

  SCREENS.kicked = function () {
    screenEl.innerHTML = '<section class="join"><div class="panel phone-card"><p class="big-emoji" aria-hidden="true">👋</p>' +
      '<h1>You were removed from the game</h1><p class="muted">The host took you out of the room.</p>' +
      '<button type="button" class="btn primary" data-act="go-home">Home</button></div></section>';
  };

  SCREENS.error = function (msg) {
    screenEl.innerHTML = '<section class="join"><div class="panel phone-card"><p class="big-emoji" aria-hidden="true">😵</p>' +
      '<h1>Something went wrong</h1><p class="muted">' + esc(msg) + '</p>' +
      '<button type="button" class="btn primary" data-act="go-home">Home</button></div></section>';
  };

  // --------------------------------------------------------- party + host

  function startSession(kind, game, set, extra) {
    var s = Object.assign({ kind: kind, game: game, set: set, spare: [], keys: {}, boardKeys: {}, autoAt: 0, view: null, clip: null }, extra || {});
    app.sess = s;
    s.tick = setInterval(function () { game.tick(); }, 200);
    s.autoTimer = setInterval(function () { autoStep(s); }, 250);
    keepAwake(true);
    return s;
  }

  function stopSession() {
    var s = app.sess;
    if (!s) return;
    stopClip(s);
    clearInterval(s.tick);
    clearInterval(s.autoTimer);
    clearInterval(s.beat);
    clearTimeout(s.pubTimer);
    if (s.ch) s.ch.close();
    app.sess = null;
    keepAwake(false);
  }

  function autoStep(s) {
    if (!s.autoAt || app.sess !== s) return;
    var left = s.autoAt - Date.now(), el = $('#auto-count');
    if (el) el.textContent = '(' + Math.max(0, Math.ceil(left / 1000)) + ')';
    if (left <= 0) {
      s.autoAt = 0;
      s.game.next();
    }
  }

  // Engine events -> sounds, screens and (online) the room.
  function onGameChange(what) {
    var s = app.sess;
    if (!s) return;
    var g = s.game;
    if (what === 'round') s.autoAt = 0;
    if (what === 'hint') SFX.play('hint');
    if (what === 'award') SFX.play('correct');
    if (what === 'players' && s.kind === 'online' && app.screen === 'lobby') refreshLobby();
    if (what === 'pause' && s.clip && s.clip.ctl) {
      if (g.paused() && g.r.pr === 'host') s.clip.ctl.pause(); else if (!g.paused()) s.clip.ctl.play();
    }
    if (what === 'reveal') {
      SFX.play(g.r.why === 'time' ? 'timeup' : 'reveal');
      if (g.r.why === 'time') setTimeout(function () { SFX.play('reveal'); }, 650);
      markSeen(g.r.pz.id);
      if (s.clip && s.clip.ctl) s.clip.ctl.volume(45);
      if (s.set.auto) s.autoAt = Date.now() + AUTO_NEXT_MS;
    }
    if (what === 'final') {
      stopClip(s);
      s.autoAt = 0;
      if (s.kind === 'online') publishSoon(0);
      show('final');
      SFX.play('fanfare');
      if (g.players.length) confetti();
      return;
    }
    if (what === 'round' && app.screen !== 'stage') show('stage');
    else refreshStage();
    if (s.kind === 'online') publishSoon(what === 'guess' || what === 'players' ? 80 : 0);
  }

  // Party mode: load the media first, then start straight away.
  function startParty() {
    var set = app.settings.party;
    stopSession();
    var token = {};
    app.loadToken = token;
    show('loading');
    prepareDeck(set, loadProgress).then(function (res) {
      if (app.loadToken !== token) return;
      app.loadToken = null;
      if (!res.deck.length) {
        show('error', 'None of the clips or pictures would load. Check your internet connection, or pick the Emoji Bonus category, which works offline.');
        return;
      }
      if (res.deck.length < set.rounds) toast('Only ' + res.deck.length + ' puzzles loaded, so this game is shorter.');
      var game = new E.Game({ mode: 'party', deck: res.deck, cfg: cfgFrom(set), packInfo: PACK_INFO, onChange: function (w) { onGameChange(w); } });
      app.roster.forEach(function (p) { game.addPlayer(p.pid, p.nm, p.av); });
      var s = startSession('party', game, set, { spare: res.spare });
      SFX.play('start');
      game.start();
      return s;
    }, function () {
      if (app.loadToken === token) show('error', 'Couldn’t load the puzzles. Check your internet connection and try again.');
    });
  }

  function playAgain() {
    var s = app.sess;
    if (!s) return;
    if (s.kind === 'online') {
      prepareRoom(s);
      show('lobby');
      return;
    }
    var token = {};
    app.loadToken = token;
    stopClip(s);
    show('loading');
    prepareDeck(s.set, loadProgress).then(function (res) {
      if (app.loadToken !== token || app.sess !== s) return;
      app.loadToken = null;
      if (!res.deck.length) { show('error', 'None of the clips or pictures would load. Check your internet connection.'); return; }
      s.spare = res.spare;
      s.game.cfg = Object.assign(s.game.cfg, cfgFrom(s.set));
      s.game.reset(res.deck);
      s.keys = {};
      SFX.play('start');
      s.game.start();
    });
  }

  // ------------------------------------------------------------ online host

  function openRoom(attempt) {
    attempt = attempt || 1;
    var set = app.settings.online;
    var btn = $('[data-act="open-room"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening the room…'; }
    var code = E.roomCode();
    N.detect().then(function (net) {
      if (!net) throw new Error(netNote());
      return N.open(net, code);
    }).then(function (ch) {
      // Make sure nobody else is already hosting with this code.
      setTimeout(function () {
        var taken = ch.peers().some(function (x) { return x.p && x.p.r === 'host'; });
        if (taken && attempt < 4) {
          ch.close();
          openRoom(attempt + 1);
          return;
        }
        stopSession();
        var game = new E.Game({ mode: 'online', deck: [], cfg: cfgFrom(set), packInfo: PACK_INFO, onChange: function (w) { onGameChange(w); } });
        var s = startSession('online', game, set, { ch: ch, code: code, pubTimer: 0 });
        ch.onPeers(function (peers) { hostPeers(s, peers); });
        ch.onStatus(function (status) { hostStatus(s, status); });
        hostPeers(s, ch.peers());
        s.beat = setInterval(function () {
          if (game.phase === 'q' || game.phase === 'lobby') publishSoon(0);
        }, 1000);
        publishSoon(0);
        prepareRoom(s);
        show('lobby');
      }, app.net && app.net.kind === 'ws' ? 150 : 50);
    }, function (err) {
      if (btn) { btn.disabled = false; btn.innerHTML = 'Open the room' + ICONS.next; }
      toast('Couldn’t open a room: ' + (err && err.message ? err.message : 'connection failed') + '. Try again.');
    });
  }

  // Load the room's clips and pictures while players join.
  function prepareRoom(s) {
    var token = {};
    s.prepToken = token;
    s.prep = { state: 'loading', done: 0, total: 0 };
    s.game.reset([]);
    s.game.cfg = Object.assign(s.game.cfg, cfgFrom(s.set));
    refreshLobby();
    prepareDeck(s.set, function (done, total) {
      if (s.prepToken !== token) return;
      s.prep.done = done;
      s.prep.total = total;
      refreshLobby();
    }).then(function (res) {
      if (s.prepToken !== token || app.sess !== s) return;
      if (!res.deck.length) {
        s.prep = { state: 'error', message: 'None of the clips or pictures would load. Check the internet connection or change the categories.' };
      } else {
        s.prep = { state: 'ready' };
        s.spare = res.spare;
        s.game.reset(res.deck);
      }
      publishSoon(0);
      refreshLobby();
    }, function () {
      if (s.prepToken !== token) return;
      s.prep = { state: 'error', message: 'Couldn’t load the puzzles. Check the internet connection and change the settings to try again.' };
      refreshLobby();
    });
  }

  function hostPeers(s, peers) {
    if (app.sess !== s) return;
    var g = s.game, here = {};
    peers.forEach(function (peer) {
      var p = peer.p || {};
      if (p.r !== 'player' || p.code !== s.code || typeof p.pid !== 'string' || !/^p[a-z0-9]{8}$/.test(p.pid)) return;
      var nm = M.clean(p.nm, 16) || 'Player', av = firstGrapheme(p.av) || '🙂';
      here[p.pid] = true;
      var existing = g.byPid(p.pid);
      if (!existing) {
        if (g.kicked[p.pid]) return;
        if (g.addPlayer(p.pid, nm, av)) {
          SFX.play('join');
          if (app.screen === 'stage') toast(av + ' ' + nm + ' joined');
        }
      } else if (existing.nm !== nm || existing.av !== av || !existing.on) {
        g.addPlayer(p.pid, nm, av);
      }
      var guess = p.g;
      if (Array.isArray(guess) && guess[0] === g.gid && typeof guess[1] === 'number' && typeof guess[2] === 'number' && typeof guess[3] === 'string') {
        g.guess(p.pid, guess[1], guess[2], guess[3]);
      }
    });
    g.players.forEach(function (pl) { if (pl.on && !here[pl.pid]) g.setOnline(pl.pid, false); });
  }

  function hostStatus(s, status) {
    if (app.sess !== s) return;
    if (status === 'reconnecting') toast('Connection dropped. Reconnecting…', 'warn');
    else if (status === 'failed') toast('Lost the connection to the room.', 'warn');
    else if (status === 'ok') publishSoon(0);
  }

  function publishSoon(delay) {
    var s = app.sess;
    if (!s || s.kind !== 'online') return;
    if (s.pubTimer) return;
    s.pubTimer = setTimeout(function () {
      s.pubTimer = 0;
      if (app.sess !== s) return;
      s.ch.setPresence({ r: 'host', v: E.PROTO, code: s.code, s: fitState(s.game.publicState()) });
    }, delay || 0);
  }

  // The host's state goes to every phone several times a second: keep it
  // under 4 KB, trimming the least useful parts first.
  function fitState(st) {
    var LIMIT = 3800;
    function size(x) { return E.utf8Bytes(JSON.stringify(x)); }
    if (size(st) <= LIMIT) return st;
    var out = JSON.parse(JSON.stringify(st));
    if (out.fb) {
      Object.keys(out.fb).forEach(function (pid) { if (out.fb[pid][2] === 'y') delete out.fb[pid]; });
    }
    if (size(out) <= LIMIT) return out;
    if (out.md && out.md.cr) delete out.md.cr;
    out.sb = out.sb.map(function (r) { r = r.slice(); r[1] = Array.from(r[1]).slice(0, 8).join(''); return r; });
    while (size(out) > LIMIT && out.sb.length > 3) out.sb.pop();
    return out;
  }

  // ---------------------------------------------------------- online player

  function joinRoom(code, nm, av) {
    var msg = $('#join-msg'), go = $('#join-go');
    if (go) { go.disabled = true; go.textContent = 'Joining…'; }
    N.detect().then(function (net) {
      if (!net) throw new Error('offline');
      return N.open(net, code, { seek: true });
    }).then(function (ch) {
      stopPlayer();
      var pl = { ch: ch, code: code, st: null, at: 0, deadline: 0, gid: null, qn: 0, attempt: 0, fb: null, pending: false, hostId: null, started: Date.now(), missingSince: 0, lost: false, hostGone: false, keys: {}, boardKeys: {} };
      app.player = pl;
      ch.onPeers(function (peers) { playerPeers(pl, peers); });
      ch.onStatus(function (status) {
        if (app.player !== pl) return;
        if (status === 'reconnecting') toast('Connection dropped. Reconnecting…', 'warn');
      });
      publishPlayer(pl, null);
      pl.watch = setInterval(function () { playerWatch(pl); }, 500);
      keepAwake(true);
      show('phone');
      playerPeers(pl, ch.peers());
    }, function (err) {
      if (go) { go.disabled = false; go.innerHTML = 'Join the game' + ICONS.next; }
      if (msg) msg.textContent = err && err.message === 'offline' ? netNote() : 'Couldn’t reach the game. Check your connection and try again.';
    });
  }

  function publishPlayer(pl, guess) {
    pl.ch.setPresence({ r: 'player', v: E.PROTO, code: pl.code, pid: app.me.pid, nm: app.me.nm, av: app.me.av, g: guess });
  }

  function stopPlayer() {
    var pl = app.player;
    if (!pl) return;
    clearInterval(pl.watch);
    clearTimeout(pl.sendTimer);
    pl.ch.close();
    app.player = null;
    keepAwake(false);
  }

  // Notice when no host shows up, or when the host disappears mid-game.
  function playerWatch(pl) {
    if (app.player !== pl) return;
    var now = Date.now();
    if (!pl.st && !pl.lost && now - pl.started > NO_HOST_MS) { pl.lost = true; refreshPhone(); }
    var gone = !!pl.st && !!pl.missingSince && now - pl.missingSince > HOST_LOST_MS;
    if (gone !== pl.hostGone) { pl.hostGone = gone; refreshPhone(); }
    if (pl.pending && now - pl.sentAt > 4000) {
      pl.pending = false;
      pl.fb = { code: 'w', text: 'No reply from the host yet. Try again.' };
      refreshPhone();
    }
  }

  function playerPeers(pl, peers) {
    if (app.player !== pl) return;
    var hosts = peers.filter(function (x) { return x.p && x.p.r === 'host' && x.p.code === pl.code && x.p.s; });
    var host = null;
    for (var i = 0; i < hosts.length; i++) if (hosts[i].id === pl.hostId) host = hosts[i];
    host = host || hosts[0];
    if (!host) {
      if (!pl.missingSince) pl.missingSince = Date.now();
      return;
    }
    pl.missingSince = 0;
    if (pl.hostGone) pl.hostGone = false;
    pl.hostId = host.id;
    if (host.p.s !== pl.raw) {
      pl.raw = host.p.s;
      applyHostState(pl, host.p.s);
    }
  }

  function applyHostState(pl, st) {
    if (!st || typeof st !== 'object' || !Array.isArray(st.sb)) return;
    if (st.v !== E.PROTO) { stopPlayer(); show('error', 'This game is running a different version. Ask the host to reload, then reload this page.'); return; }
    if (st.kick && st.kick.indexOf(app.me.pid) >= 0) { stopPlayer(); show('kicked'); return; }
    var prev = pl.st, now = Date.now();
    if (st.gid !== pl.gid) { pl.gid = st.gid; pl.qn = 0; }
    if (st.n !== pl.qn) { pl.qn = st.n; pl.attempt = 0; pl.fb = null; pl.pending = false; pl.fbSeen = 0; }
    // Smooth the countdown: only re-sync when it drifts noticeably.
    var deadline = now + (st.left || 0);
    if (!prev || prev.ph !== st.ph || prev.n !== st.n || st.pa || prev.pa || Math.abs(deadline - pl.deadline) > 350) pl.deadline = deadline;
    pl.at = pl.deadline - (st.left || 0);
    pl.st = st;
    pl.lost = false;

    var mine = st.fb && st.fb[app.me.pid];
    if (st.ph === 'q' && Array.isArray(mine) && mine[0] === st.n && mine[1] === pl.attempt && pl.fbSeen !== mine[1]) {
      pl.fbSeen = mine[1];
      pl.pending = false;
      feedback(pl, mine[2]);
    }
    if (prev && prev.ph !== st.ph) {
      if (st.ph === 'rev') {
        var row = myRow(st);
        SFX.play(row && row.r[5] ? 'reveal' : 'timeup');
      } else if (st.ph === 'final') {
        SFX.play('fanfare');
        var me = myRow(st);
        if (me && me.rank <= 3) confetti();
      } else if (st.ph === 'q' && prev.ph === 'lobby') {
        SFX.play('start');
      }
    }
    refreshPhone();
  }

  function feedback(pl, code) {
    if (code === 'y') {
      pl.fb = null;
      SFX.play('correct');
      if (navigator.vibrate) { try { navigator.vibrate([40, 40, 80]); } catch (e) { /* ignore */ } }
    } else if (code === 'c') {
      pl.fb = { code: 'c', text: '“' + pl.lastGuess + '” is close! Keep going.' };
      SFX.play('close');
    } else {
      pl.fb = { code: 'n', text: '“' + pl.lastGuess + '” isn’t it. Try again.' };
      SFX.play('wrong');
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
    }
  }

  function submitGuess(form) {
    var pl = app.player, st = pl && pl.st, input = $('#guess', form);
    if (!st || st.ph !== 'q' || st.pa) return;
    var text = M.clean(input.value, 60);
    if (!text) return;
    var mine = myRow(st);
    if (mine && mine.r[5]) return;
    input.value = '';
    // Guesses go out at most every 350 ms; a quicker one waits its turn.
    clearTimeout(pl.sendTimer);
    var wait = 350 - (Date.now() - (pl.sentAt || 0));
    if (wait > 0) {
      pl.pending = true;
      pl.fb = null;
      pl.sendTimer = setTimeout(function () { sendGuess(pl, text); }, wait);
      refreshPhone();
      return;
    }
    sendGuess(pl, text);
  }

  function sendGuess(pl, text) {
    var st = pl.st, mine = st && myRow(st);
    if (app.player !== pl || !st || st.ph !== 'q' || st.pa || (mine && mine.r[5])) {
      pl.pending = false;
      refreshPhone();
      return;
    }
    var now = Date.now();
    pl.sentAt = now;
    pl.attempt = Math.max(now, pl.attempt + 1);
    pl.lastGuess = text;
    pl.pending = true;
    pl.fb = null;
    publishPlayer(pl, [st.gid, st.n, pl.attempt, text]);
    refreshPhone();
  }

  // ---------------------------------------------------------- user actions

  function inGame() { return !!(app.sess || app.player); }

  function leaveEverything() {
    app.loadToken = null;
    stopSession();
    stopPlayer();
    show('home');
  }

  var ACTIONS = {
    'go-home': function () {
      if (!inGame() || app.screen === 'final' && app.sess && app.sess.kind === 'party' || app.screen === 'kicked' || app.screen === 'error') {
        leaveEverything();
        return;
      }
      ask(app.player ? 'Leave this game?' : 'End this game?', app.player ? 'You can rejoin with the same code while the game is running.' : 'Everyone’s scores will be lost.', app.player ? 'Leave' : 'End game')
        .then(function (yes) { if (yes) leaveEverything(); });
    },
    'setup-party': function () { show('setup', 'party'); },
    'setup-online': function () { show('setup', 'online'); },
    join: function () { show('join', ''); },
    'toggle-sound': function () {
      SFX.setMuted(!SFX.muted());
      updateTopbar();
    },
    'toggle-full': function () {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(function () { toast('Full screen isn’t available here.'); });
      } catch (e) {
        toast('Full screen isn’t available here.');
      }
    },
    set: function (el) {
      var set = app.settings[app.mode], key = el.dataset.key, val = el.dataset.val;
      set[key] = isNaN(Number(val)) ? val : Number(val);
      saveSettings(app.mode);
      $$('[data-act="set"][data-key="' + key + '"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
      updateSetupSummary();
    },
    'toggle-cat': function (el) {
      var set = app.settings[app.mode], id = el.dataset.id, i = set.cats.indexOf(id);
      if (i >= 0) set.cats.splice(i, 1); else set.cats.push(id);
      el.classList.toggle('on', i < 0);
      el.setAttribute('aria-pressed', String(i < 0));
      saveSettings(app.mode);
      updateSetupSummary();
    },
    'cats-all': function () {
      var set = app.settings[app.mode];
      set.cats = PACKS.map(function (p) { return p.id; }).concat(app.custom.items.length ? ['custom'] : []);
      saveSettings(app.mode);
      show('setup', app.mode);
    },
    'cats-none': function () {
      app.settings[app.mode].cats = [];
      saveSettings(app.mode);
      show('setup', app.mode);
    },
    'edit-custom': function () { openCustom(); },
    'custom-save': function () {
      var text = $('#custom-text').value.slice(0, 40000);
      app.custom = { text: text, items: E.parseCustom(text).items };
      store.set('custom', text);
      Object.keys(playableCache).forEach(function (id) { if (id.indexOf('custom:') === 0) delete playableCache[id]; });
      ['party', 'online'].forEach(function (mode) {
        var cats = app.settings[mode].cats, i = cats.indexOf('custom');
        if (app.custom.items.length && i < 0) cats.push('custom');
        if (!app.custom.items.length && i >= 0) cats.splice(i, 1);
        saveSettings(mode);
      });
      closeModal();
      toast(app.custom.items.length ? 'Saved ' + app.custom.items.length + ' puzzles' : 'Your puzzles were cleared');
      show('setup', app.mode);
    },
    'modal-close': function () { closeModal(false); },
    'modal-ok': function () { closeModal(true); },
    'cycle-av': function (el) {
      var p = app.roster[Number(el.dataset.i)];
      if (!p) return;
      p.av = AVATARS[(AVATARS.indexOf(p.av) + 1) % AVATARS.length];
      el.textContent = p.av;
      saveRoster();
    },
    'remove-player': function (el) {
      app.roster.splice(Number(el.dataset.i), 1);
      saveRoster();
      show('setup', 'party');
    },
    'start-party': startParty,
    'open-room': function () { openRoom(1); },
    'cancel-load': function () {
      app.loadToken = null;
      if (app.sess && app.sess.kind === 'party') stopSession();
      show('setup', 'party');
    },
    pause: function () {
      var g = app.sess && app.sess.game;
      if (!g || g.loading()) return;
      if (g.paused()) g.resume(); else g.pause();
    },
    reveal: function () {
      var g = app.sess && app.sess.game;
      if (!g) return;
      g.release();
      g.reveal('host');
    },
    next: function () {
      if (!app.sess) return;
      app.sess.autoAt = 0;
      app.sess.game.next();
    },
    award: function (el) {
      var s = app.sess;
      if (!s || s.kind !== 'party') return;
      var pid = el.dataset.pid;
      if (s.game.gotEntry(pid)) s.game.unaward(pid); else s.game.award(pid);
    },
    'end-game': function () {
      var s = app.sess;
      if (!s) return;
      ask('End the game now?', 'You’ll go straight to the final scores.', 'End game').then(function (yes) {
        if (yes && app.sess === s) s.game.finish();
      });
    },
    again: playAgain,
    'final-settings': function () {
      if (app.sess && app.sess.kind === 'online') { show('setup', 'online'); return; }
      stopSession();
      show('setup', 'party');
    },
    'room-settings': function () { show('setup', 'online'); },
    'back-to-room': function () { show(app.sess && app.sess.game.phase === 'final' ? 'final' : 'lobby'); },
    'room-save': function () {
      var s = app.sess;
      if (!s) return;
      s.set = app.settings.online;
      prepareRoom(s);
      publishSoon(0);
      show('lobby');
    },
    'room-start': function () {
      var s = app.sess;
      if (!s || !s.game.deck.length || !s.game.players.some(function (p) { return p.on; })) return;
      SFX.play('start');
      s.game.start();
    },
    'end-room': function () {
      ask('Close the room?', 'Everyone in the room will be disconnected.', 'Close room').then(function (yes) {
        if (yes) leaveEverything();
      });
    },
    kick: function (el) {
      var s = app.sess;
      if (!s) return;
      s.game.kick(el.dataset.pid);
    },
    'copy-link': function () { if (app.sess) copyText(joinLink(app.sess.code), 'Invite link copied'); },
    'share-link': function () {
      var s = app.sess;
      if (!s || !navigator.share) return;
      navigator.share({ title: 'Guess-o-Rama', text: 'Join my Guess-o-Rama game! Room code ' + s.code, url: joinLink(s.code) })
        .catch(function () { /* closed the share sheet */ });
    },
    'pick-av': function (el) {
      app.me.av = el.dataset.av;
      store.set('avatar', app.me.av);
      $$('.av-pick').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); });
    },
    'leave-game': function () {
      var code = app.player ? app.player.code : '';
      stopPlayer();
      show('join', code);
    },
    'retry-join': function () {
      var code = app.player ? app.player.code : '';
      stopPlayer();
      joinFromForm(code);
    },
  };

  function joinFromForm(code) {
    show('join', code);
    var nm = app.me.nm;
    if (code && nm) joinRoom(code, nm, app.me.av);
  }

  var FORMS = {
    'add-player': function (form) {
      var input = $('#new-player', form), nm = M.clean(input.value, 16);
      if (!nm || app.roster.length >= MAX_ROSTER) return;
      var used = app.roster.map(function (p) { return p.av; });
      var av = AVATARS.filter(function (a) { return used.indexOf(a) < 0; })[0] || pick(AVATARS);
      app.roster.push({ pid: 'r' + E.rid(6), nm: nm, av: av });
      saveRoster();
      show('setup', 'party');
      var again = $('#new-player');
      if (again) again.focus();
    },
    join: function (form) {
      var code = $('#join-code', form).value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      var nm = M.clean($('#join-name', form).value, 16);
      var msg = $('#join-msg');
      if (code.length !== 4) { msg.textContent = 'Room codes are 4 letters. Check the host’s screen.'; $('#join-code').focus(); return; }
      if (!nm) { msg.textContent = 'Type a name so everyone knows who you are.'; $('#join-name').focus(); return; }
      app.me.nm = nm;
      store.set('name', nm);
      msg.textContent = '';
      joinRoom(code, nm, app.me.av);
    },
    guess: submitGuess,
  };

  // --------------------------------------------------------------- wiring

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    SFX.unlock();
    fn(el, e);
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    SFX.unlock();
    var fn = FORMS[form.dataset.form];
    if (fn) fn(form);
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches && el.matches('[data-setting]')) {
      app.settings[app.mode][el.dataset.setting] = el.checked;
      saveSettings(app.mode);
    }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches('[data-roster]')) {
      var p = app.roster[Number(el.dataset.roster)];
      if (p) { p.nm = M.clean(el.value, 16) || 'Player'; saveRoster(); }
    } else if (el.id === 'custom-text') {
      updateCustomStatus();
    } else if (el.id === 'join-code') {
      var v = el.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      if (v !== el.value) el.value = v;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#modal').hidden) { closeModal(false); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!$('#modal').hidden) return;
    var s = app.sess;
    if (e.key === 'm' || e.key === 'M') { ACTIONS['toggle-sound'](); return; }
    if (!s || app.screen !== 'stage') return;
    if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('button, a, summary')) {
      e.preventDefault();
      s.autoAt = 0;
      SFX.unlock();
      if (s.game.phase === 'q') s.game.release();
      s.game.next();
    } else if (e.key === 'p' || e.key === 'P') {
      ACTIONS.pause();
    } else if (s.kind === 'party' && /^[1-9]$/.test(e.key)) {
      var p = s.game.players[Number(e.key) - 1];
      if (p) ACTIONS.award({ dataset: { pid: p.pid } });
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && inGame()) keepAwake(true);
  });
  document.addEventListener('fullscreenchange', function () {
    $('#btn-full').classList.toggle('is-on', !!document.fullscreenElement);
  });

  // ------------------------------------------------------------------ boot

  function routeFromHash() {
    var m = /^#join-([A-Za-z]{4})$/.exec(location.hash || '');
    return m ? m[1].toUpperCase() : null;
  }

  var hashCode = routeFromHash();
  show(hashCode ? 'join' : 'home', hashCode || undefined);
  window.requestAnimationFrame(loop);

  N.detect().then(function (net) {
    app.net = net;
    app.netReady = true;
    if (app.screen === 'home') {
      var note = $('#net-note');
      if (note) note.textContent = netNote();
      $$('.mode[data-act="setup-online"], .mode[data-act="join"]').forEach(function (b) { b.disabled = !net; });
    } else if (app.screen === 'join' && !net) {
      var msg = $('#join-msg');
      if (msg) msg.textContent = netNote();
    }
  });

  // Exposed for automated tests only.
  window.__gor = { app: app, Emoji: Emoji };
})();
