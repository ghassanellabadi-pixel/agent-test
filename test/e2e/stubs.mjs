// Stand-ins for Wikipedia, Wikidata, Wikimedia images and YouTube, so the
// browser tests run offline and can make clips fail or wait for a click.

function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

const SHAPES = [[1280, 853], [1280, 960], [1280, 720], [853, 1280], [1024, 1024], [1280, 548]];

// A made-up "photo": sky, sun, hills and a lake, coloured by the file name.
function sceneSvg(name) {
  const h0 = hash(name);
  if (/^Flag_of_/i.test(name)) {
    const hue = h0 % 360;
    return { w: 1280, h: 853, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="853" viewBox="0 0 1280 853">` +
      `<rect width="1280" height="853" fill="hsl(${hue},70%,45%)"/><rect y="284" width="1280" height="285" fill="#fff"/>` +
      `<rect y="569" width="1280" height="284" fill="hsl(${(hue + 140) % 360},70%,40%)"/>` +
      `<circle cx="640" cy="426" r="110" fill="hsl(${(hue + 60) % 360},85%,55%)"/></svg>` };
  }
  const [w, h] = SHAPES[h0 % SHAPES.length];
  const hue = h0 % 360, hue2 = (hue + 35) % 360, ground = (hue + 150) % 360;
  const sx = 0.2 + ((h0 >> 8) % 60) / 100, sy = 0.18 + ((h0 >> 4) % 20) / 100;
  const ridge = (k, amp, base) => {
    let d = `M0 ${h}`;
    for (let i = 0; i <= 12; i++) {
      const x = (w / 12) * i;
      const y = h * base - amp * h * Math.abs(Math.sin((i + k) * 1.3 + (h0 % 7)));
      d += ` L${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    return d + ` L${w} ${h} Z`;
  };
  return { w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},65%,42%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2},80%,78%)"/></linearGradient>` +
    `<radialGradient id="sun"><stop offset="0" stop-color="#fff7cc"/><stop offset="1" stop-color="#ffcf4a"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
    `<circle cx="${(w * sx).toFixed(0)}" cy="${(h * sy).toFixed(0)}" r="${(Math.min(w, h) * 0.09).toFixed(0)}" fill="url(#sun)"/>` +
    `<path d="${ridge(0, 0.28, 0.72)}" fill="hsl(${ground},30%,38%)"/>` +
    `<path d="${ridge(3, 0.18, 0.84)}" fill="hsl(${ground},40%,26%)"/>` +
    `<rect y="${(h * 0.86).toFixed(0)}" width="${w}" height="${(h * 0.14).toFixed(0)}" fill="hsl(${hue},55%,30%)" opacity=".85"/>` +
    `<g fill="#fff" opacity=".9">${[0, 1, 2, 3].map((i) => `<rect x="${(w * (0.55 + i * 0.07)).toFixed(0)}" y="${(h * (0.5 - i * 0.04)).toFixed(0)}" width="${(w * 0.045).toFixed(0)}" height="${(h * (0.36 + i * 0.04)).toFixed(0)}" fill="hsl(${(hue + 200 + i * 20) % 360},25%,${80 - i * 8}%)"/>`).join('')}</g>` +
    `</svg>` };
}

function wikiResponse(url) {
  const q = new URL(url).searchParams;
  const titles = (q.get('titles') || '').split('|').filter(Boolean);
  if ((q.get('prop') || '').includes('pageimages')) {
    return {
      batchcomplete: true,
      query: {
        pages: titles.map((t, i) => {
          const file = (/^Flag of /.test(t) ? t + '.svg' : t + '.jpg').replace(/ /g, '_');
          const { w, h } = sceneSvg(file);
          return {
            pageid: 1000 + i, ns: 0, title: t,
            thumbnail: { source: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(file)}/1280px-${encodeURIComponent(file)}.png`, width: w, height: h },
            pageimage: file,
            pageprops: { wikibase_item: 'Q' + (hash(t) % 900000 + 1000) },
          };
        }),
      },
    };
  }
  if (q.get('prop') === 'imageinfo') {
    return {
      query: {
        pages: titles.map((t) => ({
          ns: 6, title: t,
          imageinfo: [{ extmetadata: { Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Test">Test&nbsp;Photographer</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }],
        })),
      },
    };
  }
  return { query: {} };
}

// The YouTube IFrame API, as far as the game uses it. Behaviour is set per
// test through window.__ytStub: { blockAutoplay, errorAll, wrongTitles, titles }.
const YT_STUB = `(function () {
  var cfg = window.__ytStub || {};
  var S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  var players = {}, seq = 0;
  window.__ytLog = [];
  function titleFor(id) {
    if (cfg.titles && cfg.titles[id]) return cfg.titles[id];
    if (cfg.wrongTitles) return 'Top 10 Funniest Cat Videos';
    var G = window.GOR || {}, V = G.VIDEOS || {}, found = '';
    Object.keys(V).forEach(function (key) {
      if (found || ![].concat(V[key]).some(function (e) { return e.split('@')[0] === id; })) return;
      (G.PACKS || []).forEach(function (p) { p.items.forEach(function (it) {
        if (it.v === key && !found) found = it.answer + (it.artist ? ' - ' + it.artist + ' (Official Video)' : ' - Official Trailer');
      }); });
    });
    return found;
  }
  function Player(el, o) {
    var self = this;
    this.pid = 'p' + (++seq);
    this.vid = o.videoId;
    this.ev = o.events || {};
    this.state = S.UNSTARTED;
    this.base = 0; this.t0 = 0; this.playing = false; this.clicked = false; this.dead = false; this.volume = 100;
    var f = document.createElement('iframe');
    f.className = 'yt-stub';
    f.setAttribute('allow', 'autoplay');
    f.srcdoc = '<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}body{background:linear-gradient(120deg,#d9485f,#6741d9,#1c7ed6,#0ca678);background-size:400% 400%;animation:a 6s ease infinite;cursor:pointer}' +
      '@keyframes a{50%{background-position:100% 50%}}b{position:absolute;left:3%;bottom:16%;font:700 14px sans-serif;color:#fff;opacity:.7}</style><b>test clip</b>' +
      '<script>document.addEventListener("click",function(){parent.postMessage({ytStubClick:"' + this.pid + '"},"*")})<\\/script>';
    el.parentNode.replaceChild(f, el);
    this.iframe = f;
    players[this.pid] = this;
    window.__ytLog.push(['new', this.vid]);
    setTimeout(function () {
      if (self.dead) return;
      self.fire('onReady', {});
      if (cfg.errorAll) setTimeout(function () { if (!self.dead) self.fire('onError', { data: cfg.errorAll }); }, 100);
    }, 200);
  }
  Player.prototype.fire = function (name, e) { var fn = this.ev[name]; if (fn) { e.target = this; fn(e); } };
  Player.prototype.set = function (s) { this.state = s; window.__ytLog.push(['state', this.vid, s]); this.fire('onStateChange', { data: s }); };
  Player.prototype.getCurrentTime = function () { return this.playing ? this.base + (Date.now() - this.t0) / 1000 : this.base; };
  Player.prototype.getDuration = function () { return 150; };
  Player.prototype.getPlayerState = function () { return this.state; };
  Player.prototype.getVideoData = function () { return { video_id: this.vid, title: titleFor(this.vid), author: 'Test' }; };
  Player.prototype.playVideo = function () {
    var self = this;
    if (this.dead || this.playing || cfg.errorAll) return;
    if (cfg.blockAutoplay && !this.clicked) return;
    this.set(S.BUFFERING);
    setTimeout(function () { if (self.dead) return; self.t0 = Date.now(); self.playing = true; self.set(S.PLAYING); }, 120);
  };
  Player.prototype.pauseVideo = function () {
    if (!this.playing) return;
    this.base = this.getCurrentTime(); this.playing = false; this.set(S.PAUSED);
  };
  Player.prototype.seekTo = function (t) {
    var self = this, was = this.playing;
    window.__ytLog.push(['seek', this.vid, t]);
    this.base = t; this.t0 = Date.now();
    if (!was) return;
    this.playing = false; this.set(S.BUFFERING);
    setTimeout(function () { if (self.dead) return; self.t0 = Date.now(); self.playing = true; self.set(S.PLAYING); }, 80);
  };
  Player.prototype.setVolume = function (v) { this.volume = v; window.__ytLog.push(['volume', this.vid, v]); };
  Player.prototype.mute = function () {};
  Player.prototype.unMute = function () {};
  Player.prototype.destroy = function () {
    this.dead = true; window.__ytLog.push(['destroy', this.vid]);
    if (this.iframe && this.iframe.parentNode) this.iframe.parentNode.removeChild(this.iframe);
  };
  window.addEventListener('message', function (e) {
    var p = e.data && players[e.data.ytStubClick];
    if (p && !p.dead) { p.clicked = true; p.playVideo(); }
  });
  window.YT = { Player: Player, PlayerState: S };
  setTimeout(function () { if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady(); }, 30);
})();`;

export async function installStubs(context, opts = {}) {
  await context.addInitScript((cfg) => { window.__ytStub = cfg; }, opts.youtube || {});
  await context.route('https://en.wikipedia.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(wikiResponse(route.request().url())),
  }));
  await context.route('https://query.wikidata.org/**', (route) => route.fulfill({
    status: 200, contentType: 'application/sparql-results+json', headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ results: { bindings: [] } }),
  }));
  await context.route('https://upload.wikimedia.org/**', (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const file = decodeURIComponent(parts[parts.length - 2] || 'x');
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: sceneSvg(file).svg });
  });
  await context.route('https://www.youtube.com/iframe_api', (route) => (opts.noYouTube
    ? route.abort('blockedbyclient')
    : route.fulfill({ status: 200, contentType: 'text/javascript', body: YT_STUB })));
}
