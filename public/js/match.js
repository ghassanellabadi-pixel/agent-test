/* Answer matching: forgiving enough for a party (case, accents, punctuation,
 * "the", number words, small typos) but strict on short answers so "Mars"
 * never counts for "Cars". Also builds the letter-tile mask used for hints. */
(function (G) {
  'use strict';

  var ARTICLES = { the: 1, a: 1, an: 1 };
  var STOP = {
    the: 1, a: 1, an: 1, of: 1, and: 1, in: 1, on: 1, to: 1, for: 1, with: 1, at: 1, by: 1,
    from: 1, is: 1, it: 1, its: 1, my: 1, your: 1, you: 1, me: 1, i: 1, no: 1, not: 1,
  };
  // Words a guess may add around the answer: "the lion king movie", "flag of brazil".
  var FILLER = {
    the: 1, a: 1, an: 1, of: 1, is: 1, it: 1, its: 1, i: 1, think: 1, maybe: 1, guess: 1,
    movie: 1, film: 1, show: 1, series: 1, tv: 1, song: 1, game: 1, trailer: 1, theme: 1,
    city: 1, country: 1, flag: 1,
  };
  var ABBR = { dr: 'doctor', mr: 'mister', mrs: 'missus', st: 'saint', vs: 'versus', v: 'versus', n: 'and' };
  var UNITS = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
  };
  var TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // "Ocean's Eleven!" -> ['oceans', '11']
  function words(s) {
    var ws = String(s == null ? '' : s)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/&/g, ' and ')
      .replace(/['’‘`´]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map(function (w) { return has(ABBR, w) ? ABBR[w] : w; });
    return numerize(ws);
  }

  // Number words become digits so "Big Hero Six" == "Big Hero 6" and
  // "one hundred and one" == "101".
  function small(ws, k) {
    var a = ws[k];
    if (has(TENS, a)) {
      var b = ws[k + 1];
      if (has(UNITS, b) && UNITS[b] > 0 && UNITS[b] < 10) return { value: TENS[a] + UNITS[b], end: k + 2 };
      return { value: TENS[a], end: k + 1 };
    }
    if (has(UNITS, a)) return { value: UNITS[a], end: k + 1 };
    return null;
  }
  function numerize(ws) {
    var out = [];
    var i = 0;
    while (i < ws.length) {
      var s = small(ws, i);
      if (!s) { out.push(ws[i]); i++; continue; }
      if (s.value >= 1 && s.value <= 9 && ws[s.end] === 'hundred') {
        var k = s.end + 1;
        var rest = small(ws, ws[k] === 'and' ? k + 1 : k);
        if (rest) { out.push(String(s.value * 100 + rest.value)); i = rest.end; continue; }
        out.push(String(s.value * 100)); i = k; continue;
      }
      out.push(String(s.value)); i = s.end;
    }
    return out;
  }

  // Comparable forms: "full" drops only articles, "loose" also drops small words.
  function forms(s) {
    var ws = words(s);
    return {
      words: ws,
      full: ws.filter(function (w) { return !has(ARTICLES, w); }).join(''),
      loose: ws.filter(function (w) { return !has(STOP, w); }).join(''),
    };
  }

  // Optimal string alignment distance (Levenshtein + adjacent swaps).
  function dist(a, b) {
    a = Array.from(a); b = Array.from(b);
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev2 = null, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
      }
      prev2 = prev; prev = cur;
    }
    return prev[n];
  }

  // How many typos an answer of this length tolerates.
  function allowance(len) {
    if (len <= 4) return 0;
    if (len <= 7) return 1;
    if (len <= 12) return 2;
    return 3;
  }

  function sigWords(ws) {
    return ws.filter(function (w) { return w.length >= 3 && !has(STOP, w); });
  }

  // 'y' correct, 'c' close, 'n' no. puzzle.not lists look-alike answers
  // ("Ireland" for Iceland): a guess at least as near to one of those is no typo.
  function judge(guess, puzzle) {
    var g = forms(guess);
    if (!g.full) return 'n';
    var answers = [puzzle.answer].concat(puzzle.alts || []);
    var others = (puzzle.not || []).map(forms);
    function nearerToOther(d, key) {
      return others.some(function (o) { return o[key] && dist(g[key], o[key]) <= d; });
    }
    var close = false;
    for (var i = 0; i < answers.length; i++) {
      var a = forms(answers[i]);
      if (!a.full) continue;
      if (g.full === a.full) return 'y';
      var d = dist(g.full, a.full);
      // Typos are forgiven, but a different number is a different film ("Toy Story 2").
      var typoOk = numbers(g.words) === numbers(a.words);
      if (typoOk && d <= allowance(a.full.length) && !nearerToOther(d, 'full')) return 'y';
      var dl = g.loose ? dist(g.loose, a.loose) : Infinity;
      if (typoOk && a.loose.length >= 6 && dl <= allowance(a.loose.length) && !nearerToOther(dl, 'loose')) return 'y';
      // "the lion king movie" still counts; "avengers endgame" for "The Avengers" doesn't
      if (onlyFillerAdded(g.words, a.words)) return 'y';
      if (!close) close = isClose(g, a, d);
    }
    return close ? 'c' : 'n';
  }

  function numbers(ws) {
    return ws.filter(function (w) { return /^\d+$/.test(w); }).sort().join(' ');
  }

  function onlyFillerAdded(guessWords, answerWords) {
    var rest = guessWords.slice();
    for (var i = 0; i < answerWords.length; i++) {
      var k = rest.indexOf(answerWords[i]);
      if (k < 0) return false;
      rest.splice(k, 1);
    }
    return rest.every(function (w) { return has(FILLER, w); });
  }

  function isClose(g, a, d) {
    var len = a.full.length;
    var extra = len <= 4 ? 1 : len <= 8 ? 2 : Math.ceil(len * 0.25);
    if (d <= allowance(len) + extra) return true;
    if (g.full.length >= 4 && (a.full.indexOf(g.full) >= 0 || g.full.indexOf(a.full) >= 0)) return true;
    var gw = sigWords(g.words), aw = sigWords(a.words);
    for (var i = 0; i < gw.length; i++) {
      for (var j = 0; j < aw.length; j++) {
        if (gw[i] === aw[j]) return true;
        if (aw[j].length >= 5 && dist(gw[i], aw[j]) <= 1) return true;
      }
    }
    return false;
  }

  function isWordChar(ch) { return /[\p{L}\p{N}]/u.test(ch); }

  // Letter tiles for the hint board, one string per word.
  // level 1: every letter hidden ('_'), level 2: first letter of each word,
  // level 3: everything shown. Punctuation is always shown.
  function mask(answer, level) {
    return String(answer).split(/\s+/).filter(Boolean).map(function (w) {
      var out = '', first = true;
      Array.from(w).forEach(function (ch) {
        if (isWordChar(ch)) {
          out += level >= 3 || (level === 2 && first) ? ch : '_';
          first = false;
        } else {
          out += ch;
          if (ch === '-' || ch === '/') first = true;
        }
      });
      return out;
    });
  }

  var segmenter = null;
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  } catch (e) { segmenter = null; }

  // Split a clue into visible symbols, keeping ZWJ sequences, keycaps and flags whole.
  function graphemes(s) {
    s = String(s || '');
    var out = segmenter
      ? Array.from(segmenter.segment(s), function (x) { return x.segment; })
      : graphemesFallback(s);
    return out.filter(function (g) { return g.trim() !== ''; });
  }

  // For browsers without Intl.Segmenter (Firefox before 125).
  function graphemesFallback(s) {
    return s.match(/\p{Regional_Indicator}{2}|[^\p{M}\u{200D}](?:[\p{M}\u{1F3FB}-\u{1F3FF}]|\u{200D}[^\p{M}\u{200D}])*/gu) || [];
  }

  // Strip control and invisible formatting characters (keeping the joiners
  // emoji need), collapse whitespace and cap the length.
  function clean(s, max) {
    s = String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, function (ch) {
        var c = ch.codePointAt(0);
        return c === 0x200d || (c >= 0xe0020 && c <= 0xe007f) ? ch : '';
      })
      .trim();
    if (max) {
      var cps = Array.from(s);
      if (cps.length > max) s = cps.slice(0, max).join('').trim();
    }
    return s;
  }

  G.match = {
    words: words,
    forms: forms,
    dist: dist,
    allowance: allowance,
    judge: judge,
    mask: mask,
    graphemes: graphemes,
    graphemesFallback: graphemesFallback,
    clean: clean,
  };
})(window.GOR = window.GOR || {});
