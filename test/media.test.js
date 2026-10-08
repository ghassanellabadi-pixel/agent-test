'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

// A small stand-in for the Wikipedia, Wikidata and YouTube endpoints, answering
// in the same shapes as the real APIs (formatversion=2).
function fakeWeb(opts) {
  opts = opts || {};
  const calls = [];
  const redirects = { 'Big Ben': 'Elizabeth Tower' };
  const svgLead = new Set(['Some Country Map']);
  const missing = new Set(['No Such Article']);
  const noImage = new Set(['Imageless Article']);
  const brokenImages = new Set(opts.brokenImages || []);

  function fileFor(title) {
    return /^Flag of /.test(title) || svgLead.has(title) ? title.replace(/ /g, '_') + '.svg' : title.replace(/ /g, '_') + '.jpg';
  }
  function wikiApi(q) {
    const titles = q.get('titles').split('|');
    if (q.get('prop') === 'pageimages|pageprops') {
      const out = { query: { pages: [] } };
      const redir = titles.filter((t) => redirects[t]).map((t) => ({ from: t, to: redirects[t] }));
      if (redir.length) out.query.redirects = redir;
      for (const asked of titles) {
        const t = redirects[asked] || asked;
        if (missing.has(t)) { out.query.pages.push({ ns: 0, title: t, missing: true }); continue; }
        const page = { pageid: t.length, ns: 0, title: t, pageprops: { wikibase_item: 'Q' + t.length } };
        if (!noImage.has(t)) {
          const file = fileFor(t);
          page.pageimage = file;
          page.thumbnail = { source: 'https://upload.wikimedia.org/thumb/' + encodeURIComponent(file) + '/1280px.png', width: 1280, height: 853 };
        }
        out.query.pages.push(page);
      }
      return out;
    }
    if (q.get('prop') === 'imageinfo') {
      // The API answers with the normalised title (underscores become spaces).
      const normalized = [], pages = [];
      for (const t of titles) {
        const norm = t.replace(/_/g, ' ');
        if (norm !== t) normalized.push({ from: t, to: norm });
        pages.push({ ns: 6, title: norm, imageinfo: [{ extmetadata: {
          Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jane">Jane&nbsp;Doe</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        } }] });
      }
      return { query: { normalized, pages } };
    }
    throw new Error('unexpected query ' + q);
  }
  function fetch(url) {
    calls.push(url);
    const u = new URL(url);
    let body;
    if (opts.offline) return Promise.reject(new TypeError('Failed to fetch'));
    if (u.host === 'en.wikipedia.org') body = wikiApi(u.searchParams);
    else if (u.host === 'query.wikidata.org') {
      const qids = [...u.searchParams.get('query').matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
      body = { results: { bindings: qids.map((q) => ({ item: { value: 'http://www.wikidata.org/entity/' + q }, yt: { value: ('wd' + q + 'xxxxxxxxx').slice(0, 11) } })) } };
    } else return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  }
  class Image {
    set src(v) {
      this._src = v;
      setTimeout(() => {
        if (brokenImages.has(v)) { this.naturalWidth = 0; this.onerror && this.onerror(); }
        else { this.naturalWidth = 1280; this.onload && this.onload(); }
      }, 1);
    }
    get src() { return this._src; }
  }
  const storage = {};
  const localStorage = { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } };
  const document = {
    createElement: () => ({}),
    head: {
      appendChild(s) {
        setTimeout(() => {
          if (opts.noYouTube) { s.onerror && s.onerror(); return; }
          ctx.YT = { Player: function () {}, PlayerState: {} };
          ctx.onYouTubeIframeAPIReady && ctx.onYouTubeIframeAPIReady();
        }, 1);
      },
    },
  };
  const ctx = { fetch, Image, localStorage, document, AbortController, URL, location: { origin: 'http://localhost' } };
  return { globals: ctx, calls, storage };
}

function setup(opts) {
  const web = fakeWeb(opts);
  const G = load(['data.js', 'videos.js', 'match.js', 'media.js'], web.globals);
  return { G, web };
}

test('parseYouTube reads the common link shapes', () => {
  const { G } = setup();
  const P = (u) => plain(G.media.parseYouTube(u));
  assert.deepEqual(P('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', start: null });
  assert.deepEqual(P('https://youtu.be/dQw4w9WgXcQ?t=43'), { id: 'dQw4w9WgXcQ', start: 43 });
  assert.deepEqual(P('https://www.youtube.com/watch?list=x&v=dQw4w9WgXcQ&t=1m30s'), { id: 'dQw4w9WgXcQ', start: 90 });
  assert.deepEqual(P('https://youtube.com/shorts/dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ', start: null });
  assert.deepEqual(P('https://www.youtube.com/embed/dQw4w9WgXcQ?start=12'), { id: 'dQw4w9WgXcQ', start: 12 });
  assert.equal(G.media.parseYouTube('https://vimeo.com/123'), null);
});

test('titleMatches accepts the real video and rejects a stranger', () => {
  const { G } = setup();
  const ok = (title, names) => G.media.titleMatches(title, names);
  assert.ok(ok('Titanic (1997) Official Trailer #1 - Leonardo DiCaprio Movie HD', ['Titanic']));
  assert.ok(ok('Harry Potter and the Sorcerer\'s Stone - Official Trailer', ["Harry Potter and the Philosopher's Stone", 'Harry Potter']));
  assert.ok(ok('Luis Fonsi - Despacito ft. Daddy Yankee', ['Despacito']));
  assert.ok(ok('E.T. The Extra-Terrestrial | Official Trailer', ['E.T. the Extra-Terrestrial', 'E.T.']));
  assert.ok(!ok('Top 10 Cutest Puppies', ['Titanic']));
  assert.ok(!ok('Frozen II Official Trailer', ['Finding Nemo']));
});

test('prepare attaches photos with credits, clips, posters and songs', async () => {
  const { G } = setup();
  const list = [
    { id: 'l:big-ben', kind: 'photo', wiki: 'Big Ben', answer: 'Big Ben' },                    // redirected article
    { id: 'f:brazil', kind: 'photo', wiki: 'Flag of Brazil', flat: true, answer: 'Brazil' },    // SVG allowed for flags
    { id: 'c:map', kind: 'photo', wiki: 'Some Country Map', answer: 'Map' },                    // SVG lead image: skipped
    { id: 'x:missing', kind: 'photo', wiki: 'No Such Article', answer: 'Nothing' },
    { id: 'x:noimg', kind: 'photo', wiki: 'Imageless Article', answer: 'Nothing' },
    { id: 'm:titanic', kind: 'clip', wiki: 'Titanic (1997 film)', v: 'titanic', answer: 'Titanic' },
    { id: 'm:psycho', kind: 'clip', wiki: 'Psycho (1960 film)', v: 'psycho', answer: 'Psycho' },  // no known clip: Wikidata
    { id: 's:despacito', kind: 'song', v: 'despacito', answer: 'Despacito' },
    { id: 's:none', kind: 'song', v: 'no-such-key', answer: 'Silence' },                          // no clip: dropped
  ];
  const progress = [];
  const ready = await G.media.prepare(list, (d, t) => progress.push([d, t]));
  const byId = Object.fromEntries(ready.map((p) => [p.id, p]));
  assert.deepEqual(Object.keys(byId).sort(), ['f:brazil', 'l:big-ben', 'm:psycho', 'm:titanic', 's:despacito']);
  assert.equal(byId['l:big-ben'].media.type, 'img');
  assert.match(byId['l:big-ben'].media.src, /Elizabeth_Tower\.jpg/);
  assert.equal(byId['l:big-ben'].media.credit, 'Jane Doe · CC BY-SA 4.0');
  assert.equal(byId['f:brazil'].media.credit, 'Wikimedia Commons');
  assert.deepEqual(plain(byId['m:titanic'].media.ids), plain([].concat(G.VIDEOS.titanic)));
  assert.match(byId['m:titanic'].poster, /^https:\/\/upload\.wikimedia\.org\//);
  assert.equal(byId['m:psycho'].media.type, 'yt');
  assert.match(byId['m:psycho'].media.ids[0], /^wdQ\d+x+$/);
  assert.equal(byId['s:despacito'].media.audio, true);
  assert.deepEqual(plain(progress[progress.length - 1]), [2, 2]);
});

test('without YouTube, clips fall back to posters and songs are left out', async () => {
  const { G } = setup({ noYouTube: true });
  const ready = await G.media.prepare([
    { id: 'm:titanic', kind: 'clip', wiki: 'Titanic (1997 film)', v: 'titanic', answer: 'Titanic' },
    { id: 's:despacito', kind: 'song', v: 'despacito', answer: 'Despacito' },
    { id: 'u:yt', kind: 'url-yt', yt: 'dQw4w9WgXcQ', answer: 'Rick' },
  ]);
  assert.equal(ready.length, 1);
  assert.equal(ready[0].media.type, 'img');
  assert.equal(ready[0].media.poster, true);
});

test('pictures that fail to load are left out', async () => {
  const src = 'https://upload.wikimedia.org/thumb/' + encodeURIComponent('Paris.jpg') + '/1280px.png';
  const { G } = setup({ brokenImages: [src] });
  const ready = await G.media.prepare([
    { id: 'c:paris', kind: 'photo', wiki: 'Paris', answer: 'Paris' },
    { id: 'c:rome', kind: 'photo', wiki: 'Rome', answer: 'Rome' },
  ]);
  assert.deepEqual(ready.map((p) => p.id), ['c:rome']);
});

test('offline: nothing loads, nothing throws', async () => {
  const { G } = setup({ offline: true, noYouTube: true });
  const ready = await G.media.prepare([
    { id: 'c:paris', kind: 'photo', wiki: 'Paris', answer: 'Paris' },
    { id: 'm:titanic', kind: 'clip', wiki: 'Titanic (1997 film)', v: 'titanic', answer: 'Titanic' },
    { id: 'e:x', kind: 'emoji', clue: '🦁👑', answer: 'The Lion King' },
  ]);
  assert.deepEqual(ready.map((p) => p.id), ['e:x']);
});

test('lookups are cached between games', async () => {
  const { G, web } = setup();
  const make = () => [{ id: 'c:paris', kind: 'photo', wiki: 'Paris', answer: 'Paris' }];
  await G.media.prepare(make());
  const first = web.calls.length;
  assert.ok(first >= 2);
  const again = await G.media.prepare(make());
  assert.equal(web.calls.length, first, 'no new requests');
  assert.equal(again[0].media.credit, 'Jane Doe · CC BY-SA 4.0');
  assert.ok(web.storage['gor.media.v1'].includes('p:free:Paris'));
});
