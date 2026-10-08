'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load');

const G = load(['data.js', 'videos.js', 'data-emoji.js', 'match.js']);
const M = G.match;
const ID_RE = /^[A-Za-z0-9_-]{11}(@\d+)?$/;

test('every media category has enough puzzles at every level', () => {
  assert.ok(G.PACKS.length >= 10);
  for (const p of G.PACKS) {
    assert.match(p.kind, /^(photo|clip|song)$/, p.id);
    assert.ok(p.items.length >= 40, `${p.id} has ${p.items.length} puzzles`);
    for (const d of [1, 2, 3]) {
      assert.ok(p.items.filter((it) => it.d === d).length >= 5, `${p.id} needs more level-${d} puzzles`);
    }
  }
});

test('puzzle ids are unique and fields are filled in', () => {
  const ids = new Set();
  for (const p of G.PACKS.concat(G.EMOJI_PACK)) {
    for (const it of p.items) {
      assert.ok(!ids.has(it.id), `duplicate id ${it.id}`);
      ids.add(it.id);
      assert.equal(it.pack, p.id);
      assert.ok([1, 2, 3].includes(it.d), `${it.id} difficulty`);
      assert.ok(M.forms(it.answer).full, `${it.id} answer`);
      assert.ok(Array.isArray(it.alts));
      for (const a of it.alts) assert.ok(M.forms(a).full, `${it.id} alt "${a}"`);
      if (p.kind === 'photo' || p.kind === 'clip') assert.ok(typeof it.wiki === 'string' && it.wiki.trim() === it.wiki && it.wiki, `${it.id} article`);
      if (p.kind === 'song') assert.ok(it.artist && it.v, `${it.id} artist and clip`);
      if (p.kind === 'emoji') assert.ok(M.graphemes(it.clue).length >= 1, `${it.id} clue`);
    }
  }
});

test('clip keys point at well-formed YouTube ids', () => {
  for (const [key, v] of Object.entries(G.VIDEOS)) {
    const list = [].concat(v);
    assert.ok(list.length, key);
    for (const e of list) assert.match(e, ID_RE, `videos.js "${key}"`);
  }
  for (const p of G.PACKS) {
    for (const it of p.items) {
      if (it.v) assert.ok(p.kind !== 'photo', `${it.id}: photos don't use clips`);
    }
  }
  // Every song needs a clip: there is no picture to fall back to.
  for (const it of G.PACKS.find((p) => p.id === 'songs').items) {
    assert.ok(G.VIDEOS[it.v], `no clip for ${it.id}`);
  }
});

test('no answer in a category is mistaken for another one', () => {
  for (const p of G.PACKS) {
    for (const a of p.items) {
      for (const b of p.items) {
        if (a === b) continue;
        assert.notEqual(M.judge(a.answer, b), 'y', `"${a.answer}" would count as "${b.answer}" (${p.id})`);
      }
    }
  }
});

test('a clip answer is never given away by its own hint', () => {
  for (const p of G.PACKS) {
    for (const it of p.items) {
      if (!it.hint) continue;
      const hint = M.forms(it.hint).full, ans = M.forms(it.answer).full;
      if (ans.length >= 4) assert.ok(!hint.includes(ans), `${it.id}: hint "${it.hint}" contains the answer`);
    }
  }
});
