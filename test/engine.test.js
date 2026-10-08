'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const G = load(['data.js', 'videos.js', 'data-emoji.js', 'match.js', 'engine.js', 'media.js']);
const E = G.engine;

function photo(id, answer, d) {
  return { id, pack: 'cities', kind: 'photo', answer, alts: [], hint: 'A hint', d: d || 2,
    media: { type: 'img', src: 'https://upload.wikimedia.org/x/' + id + '.jpg', credit: 'Jane · CC BY-SA 4.0' } };
}
function clip(id, answer) {
  return { id, pack: 'movies', kind: 'clip', answer, alts: [], hint: '', d: 1, poster: 'https://upload.wikimedia.org/p/' + id + '.jpg',
    media: { type: 'yt', ids: ['aaaaaaaaaaa'], audio: false } };
}

// A game on a hand-cranked clock.
function setup(mode, deck, seconds) {
  let now = 1000000;
  const events = [];
  const game = new E.Game({
    mode, deck, now: () => now, cfg: { seconds: seconds || 20, hints: true, reveal: 'zoom' },
    packInfo: { cities: { icon: '🏙️', name: 'Cities' }, movies: { icon: '🎬', name: 'Movies' } },
    onChange: (w) => events.push(w),
  });
  return { game, events, advance: (ms) => { now += ms; game.tick(); } };
}

test('points fall from 1000 to 400 over the clock', () => {
  assert.equal(E.pointsFor(0, 20000), 1000);
  assert.equal(E.pointsFor(10000, 20000), 700);
  assert.equal(E.pointsFor(20000, 20000), 400);
  assert.equal(E.pointsFor(99999, 20000), 400);
});

test('online round: typed guesses, first-answer bonus, early reveal', () => {
  const { game, events, advance } = setup('online', [photo('a', 'Paris'), photo('b', 'Rome')]);
  game.addPlayer('p1', 'Ann', '🦊');
  game.addPlayer('p2', 'Bob', '🐼');
  game.start();
  advance(2000);
  assert.equal(game.guess('p1', 1, 1, 'london'), 'n');
  assert.equal(game.guess('p1', 1, 1, 'paris'), null, 'same attempt number is ignored');
  assert.equal(game.guess('p1', 1, 2, 'paris'), 'y');
  assert.equal(game.guess('p1', 1, 3, 'paris'), null, 'already answered');
  advance(2000);
  assert.equal(game.guess('p2', 1, 1, 'Paris'), 'y');
  const [ann, bob] = ['p1', 'p2'].map((id) => game.byPid(id));
  assert.equal(ann.score, E.pointsFor(2000, 20000) + E.FIRST_BONUS);
  assert.equal(bob.score, E.pointsFor(4000, 20000));
  assert.equal(game.phase, 'q');
  advance(1300);                                  // everyone has it: reveal shortly after
  assert.equal(game.phase, 'rev');
  assert.ok(events.includes('reveal'));
  game.next();
  assert.equal(game.phase, 'q');
  assert.equal(game.guess('p1', 1, 9, 'paris'), null, 'guess for an old question');
});

test('hints appear at 40% and 70% of the clock, then time runs out', () => {
  const { game, advance } = setup('party', [photo('a', 'Paris')], 10);
  game.start();
  advance(3900);
  assert.equal(game.r.hl, 0);
  advance(200);
  assert.equal(game.r.hl, 1);
  assert.deepEqual(plain(game.publicState().mask), ['_____']);
  advance(3000);
  assert.equal(game.r.hl, 2);
  assert.deepEqual(plain(game.publicState().mask), ['P____']);
  advance(3000);
  assert.equal(game.phase, 'rev');
  assert.equal(game.r.why, 'time');
});

test('the clock waits while a clip loads', () => {
  const { game, advance } = setup('online', [clip('c', 'Titanic'), photo('a', 'Paris')]);
  game.addPlayer('p1', 'Ann', '🦊');
  game.start();
  game.hold();
  assert.ok(game.loading());
  assert.equal(game.publicState().pr, 'load');
  advance(15000);
  assert.equal(game.elapsed(), 0);
  assert.equal(game.r.hl, 0, 'no hints while loading');
  assert.equal(game.guess('p1', 1, 1, 'titanic'), null, 'no guesses before the clip shows');
  game.pause();                                    // the host can't pause on top of a load
  assert.equal(game.r.pr, 'load');
  game.release();
  assert.ok(!game.loading() && !game.paused());
  advance(1000);
  assert.equal(game.elapsed(), 1000);
  assert.equal(game.guess('p1', 1, 2, 'titanic'), 'y');
});

test('release only undoes a load, not the host pausing', () => {
  const { game } = setup('party', [photo('a', 'Paris')]);
  game.start();
  game.pause();
  game.release();
  assert.ok(game.paused());
  game.resume();
  assert.ok(!game.paused());
});

test('a clip that will not play can be swapped for a spare', () => {
  const { game, events } = setup('party', [clip('c', 'Titanic'), photo('a', 'Paris')]);
  game.start();
  game.hold();
  const before = game.publicState().rk;
  const spare = photo('s', 'Lisbon');
  assert.ok(game.replaceCurrent(spare));
  assert.equal(game.qi, 0);
  assert.equal(game.r.pz, spare);
  assert.equal(game.deck[0], spare);
  assert.ok(!game.paused(), 'fresh clock for the new question');
  assert.notEqual(game.publicState().rk, before, 'screens can tell the new round apart');
  assert.equal(events.filter((e) => e === 'round').length, 2);
});

test('public state describes the media without giving the answer away', () => {
  const { game } = setup('online', [photo('a', 'Paris'), clip('c', 'Titanic')]);
  game.start();
  let st = game.publicState();
  assert.equal(st.md.t, 'img');
  assert.match(st.md.src, /^https:\/\/upload\.wikimedia\.org\//);
  assert.ok(st.md.fx.x >= 0.25 && st.md.fx.x <= 0.75);
  assert.equal(st.ans, undefined);
  assert.equal(st.md.cr, undefined, 'credit only on the reveal (it can name the place)');
  game.reveal('host');
  st = game.publicState();
  assert.equal(st.ans, 'Paris');
  assert.equal(st.md.cr, 'Jane · CC BY-SA 4.0');
  game.next();
  st = game.publicState();
  assert.deepEqual(plain(st.md), { t: 'yt', a: 0 });
  game.reveal('host');
  assert.equal(game.publicState().md.poster, 'https://upload.wikimedia.org/p/c.jpg');
});

test('public state stays small enough to share with a full room', () => {
  const deck = [photo('a', "Harry Potter and the Philosopher's Stone")];
  deck[0].media.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/' + 'x'.repeat(160) + '.jpg';
  const { game } = setup('online', deck);
  for (let i = 0; i < E.MAX_PLAYERS; i++) game.addPlayer('p' + String(i).padStart(8, '0'), 'Ｗ'.repeat(16), '👩‍🚀');
  game.start();
  for (let i = 0; i < E.MAX_PLAYERS; i++) game.guess('p' + String(i).padStart(8, '0'), 1, 1, 'nope');
  const bytes = E.utf8Bytes(JSON.stringify(game.publicState()));
  assert.ok(bytes < 3800, `public state is ${bytes} bytes`);
});

test('trimDeck keeps the easy-to-hard ramp and returns spares', () => {
  const list = [];
  for (let i = 0; i < 9; i++) list.push(photo('x' + i, 'City ' + i, (i % 3) + 1));
  const { deck, spare } = E.trimDeck(list, 5, 'mixed');
  assert.equal(deck.length, 5);
  assert.equal(spare.length, 4);
  const levels = plain(deck.map((p) => p.d));
  assert.deepEqual(levels, [...levels].sort());
  const same = E.trimDeck(list, 5, 'hard');
  assert.equal(same.deck.length, 5);
  assert.equal(same.spare.length, 4);
});

test('buildDeck picks from the chosen categories and prefers unseen puzzles', () => {
  const packs = G.PACKS;
  const deck = E.buildDeck({ packs, cats: ['cities', 'animals'], diff: 'mixed', rounds: 12, seen: [] });
  assert.equal(deck.length, 12);
  assert.ok(deck.every((p) => p.pack === 'cities' || p.pack === 'animals'));
  assert.equal(new Set(deck.map((p) => p.id)).size, 12);
  const cities = packs.find((p) => p.id === 'cities').items;
  const seen = cities.slice(0, cities.length - 5).map((p) => p.id);
  const fresh = E.buildDeck({ packs, cats: ['cities'], diff: 'easy', rounds: 5, seen });
  const unseenEasy = cities.filter((p) => !seen.includes(p.id) && p.d === 1);
  for (const p of unseenEasy.slice(0, 5)) assert.ok(fresh.some((f) => f.id === p.id), `unseen ${p.id} comes first`);
  const hard = E.buildDeck({ packs, cats: ['movies'], diff: 'hard', rounds: 5, seen: [] });
  assert.ok(hard.every((p) => p.d === 3));
});

test('custom puzzles: pictures, YouTube links and emoji', () => {
  const text = [
    'https://youtu.be/dQw4w9WgXcQ?t=43 = Never Gonna Give You Up / Rickroll | 1987',
    'https://www.youtube.com/watch?v=kJQP7kiw5Fk = Despacito',
    'https://example.com/trip.jpg = Barcelona | Summer 2024',
    'https://example.com/pic?id=7=Grandma',
    '🦁👑 = The Lion King',
    '# a comment',
    'no equals sign here',
    '= missing clue',
  ].join('\n');
  const { items, errors } = E.parseCustom(text);
  assert.deepEqual(plain(errors), [7, 8]);
  assert.equal(items.length, 5);
  assert.equal(items[0].kind, 'url-yt');
  assert.equal(items[0].yt, 'dQw4w9WgXcQ');
  assert.equal(items[0].start, 43);
  assert.deepEqual(plain(items[0].alts), ['Rickroll']);
  assert.equal(items[0].hint, '1987');
  assert.equal(items[1].kind, 'url-yt');
  assert.equal(items[1].start, null);
  assert.equal(items[2].kind, 'url-img');
  assert.equal(items[2].img, 'https://example.com/trip.jpg');
  assert.equal(items[3].img, 'https://example.com/pic?id=7');
  assert.equal(items[3].answer, 'Grandma');
  assert.equal(items[4].kind, 'emoji');
  assert.equal(items[4].clue, '🦁👑');
});
