'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./helpers/load');

const { match: M } = load(['match.js']);
const pz = (answer, alts) => ({ answer, alts: alts || [] });

test('words: case, accents, punctuation, number words', () => {
  assert.deepEqual(plain(M.words("Ocean's Eleven!")), ['oceans', '11']);
  assert.deepEqual(plain(M.words('Pokémon')), ['pokemon']);
  assert.deepEqual(plain(M.words('Big Hero Six')), ['big', 'hero', '6']);
  assert.deepEqual(plain(M.words('One Hundred and One Dalmatians')), ['101', 'dalmatians']);
  assert.deepEqual(plain(M.words('Twenty-One Pilots')), ['21', 'pilots']);
  assert.deepEqual(plain(M.words('Dr. Who & Me')), ['doctor', 'who', 'and', 'me']);
});

test('judge accepts the answer however it is typed', () => {
  assert.equal(M.judge('the lion king', pz('The Lion King')), 'y');
  assert.equal(M.judge('LION KING', pz('The Lion King')), 'y');
  assert.equal(M.judge('lion kng', pz('The Lion King')), 'y');           // one typo
  assert.equal(M.judge('big hero 6', pz('Big Hero 6')), 'y');
  assert.equal(M.judge('big hero six', pz('Big Hero 6')), 'y');
  assert.equal(M.judge('sao paulo', pz('São Paulo')), 'y');
  assert.equal(M.judge('the lion king movie', pz('The Lion King')), 'y');
  assert.equal(M.judge('Sorcerers Stone', pz("Harry Potter and the Philosopher's Stone", ["Sorcerer's Stone"])), 'y');
});

test('judge is strict on short answers', () => {
  assert.notEqual(M.judge('mars', pz('Cars')), 'y');                   // close, never correct
  assert.equal(M.judge('car', pz('Cars')), 'c');
  assert.equal(M.judge('up', pz('Up')), 'y');
  assert.notEqual(M.judge('us', pz('Up')), 'y');
});

test('judge reports near misses as close', () => {
  assert.equal(M.judge('toy', pz('Toy Story')), 'c');
  assert.equal(M.judge('finding dory', pz('Finding Nemo')), 'c');
  assert.equal(M.judge('pizza', pz('Paris')), 'n');
  assert.equal(M.judge('', pz('Paris')), 'n');
  assert.equal(M.judge('!!!', pz('Paris')), 'n');
});

test('judge refuses a pasted list of guesses', () => {
  assert.notEqual(M.judge('paris london rome berlin madrid lisbon', pz('Rome')), 'y');
});

test('mask hides letters by level, keeps punctuation', () => {
  assert.deepEqual(plain(M.mask('Spider-Man: No Way Home', 1)), ['______-___:', '__', '___', '____']);
  assert.deepEqual(plain(M.mask('Spider-Man: No Way Home', 2)), ['S_____-M__:', 'N_', 'W__', 'H___']);
  assert.deepEqual(plain(M.mask('E.T.', 3)), ['E.T.']);
});

test('graphemes keep emoji sequences whole', () => {
  assert.deepEqual(plain(M.graphemes('🏊‍♂️🇧🇷1️⃣')), ['🏊‍♂️', '🇧🇷', '1️⃣']);
  assert.deepEqual(plain(M.graphemesFallback('🏊‍♂️🇧🇷👍🏽')), ['🏊‍♂️', '🇧🇷', '👍🏽']);
});

test('clean strips invisible characters but keeps emoji joiners', () => {
  assert.equal(M.clean('  a\u0000b\u200Bc  ', 10), 'abc');
  assert.equal(M.clean('👩‍🚀', 10), '👩‍🚀');
  assert.equal(M.clean('abcdefghij', 4), 'abcd');
});

test('extra words around an answer only count when they are filler', () => {
  assert.equal(M.judge('the lion king movie', pz('The Lion King')), 'y');
  assert.equal(M.judge('flag of brazil', pz('Brazil')), 'y');
  assert.equal(M.judge('new york city', pz('New York')), 'y');
  assert.notEqual(M.judge('avengers endgame', pz('The Avengers', ['Avengers'])), 'y');
  assert.notEqual(M.judge('toy story 2', pz('Toy Story')), 'y');
});

test('typos are forgiven but numbers must match', () => {
  assert.equal(M.judge('big hero 6', pz('Big Hero 6')), 'y');
  assert.notEqual(M.judge('big hero 5', pz('Big Hero 6')), 'y');
  assert.notEqual(M.judge('blade runner', pz('Blade Runner 2049')), 'y');
  assert.equal(M.judge('oceans 11', pz("Ocean's Eleven")), 'y');
  assert.equal(M.judge('frozn', pz('Frozen')), 'y');
});

test('look-alike answers are not taken for typos', () => {
  const austria = { answer: 'Austria', alts: [], not: ['Australia'] };
  const australia = { answer: 'Australia', alts: [], not: ['Austria'] };
  assert.notEqual(M.judge('australia', austria), 'y');
  assert.notEqual(M.judge('australa', austria), 'y');      // a typo of the other one
  assert.equal(M.judge('austira', austria), 'y');          // a typo of this one
  assert.notEqual(M.judge('austria', australia), 'y');
  assert.equal(M.judge('australia', australia), 'y');
  assert.equal(M.judge('australai', australia), 'y');
});
