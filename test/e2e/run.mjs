// Browser tests: a party game, the online game with two phones, and the clip
// fallbacks. Wikipedia, Wikimedia and YouTube are replaced by local stand-ins
// (stubs.mjs), so this runs offline. Needs a Chromium for playwright-core:
//   npx playwright install chromium     (or set CHROMIUM_PATH)
// Screenshots go to test-results/e2e/.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { installStubs } from './stubs.mjs';

const require = createRequire(import.meta.url);
const { createServer } = require('../../server.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.SHOTS_DIR || path.join(ROOT, 'test-results', 'e2e');
mkdirSync(SHOTS, { recursive: true });

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

function check(cond, msg) { if (!cond) throw new Error(msg); }

async function shot(page, name) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

// Console errors and page crashes fail the scenario.
function watch(page, errors, label) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
}

const state = (page) => page.evaluate(() => {
  const s = window.__gor.app.sess;
  if (!s) return null;
  const g = s.game;
  return { phase: g.phase, n: g.qi + 1, of: g.deck.length, paused: g.paused(), pr: g.r && g.r.pr, answer: g.r && g.r.pz.answer, md: g.r && g.r.pz.media && g.r.pz.media.type };
});

async function waitQuestion(page, n, timeout = 15000) {
  await page.waitForFunction((k) => { const s = window.__gor.app.sess; return s && s.game.phase === 'q' && s.game.qi + 1 === k; }, n, { timeout });
}
async function waitPlaying(page, timeout = 10000) {
  await page.waitForFunction(() => { const g = window.__gor.app.sess.game; return g.phase !== 'q' || !g.paused(); }, null, { timeout });
}

async function chooseSetup(page, mode, cats, rounds, seconds) {
  await page.click(`[data-act="setup-${mode}"]`);
  await page.click('[data-act="cats-none"]');
  for (const id of cats) await page.click(`[data-act="toggle-cat"][data-id="${id}"]`);
  await page.click(`[data-act="set"][data-key="rounds"][data-val="${rounds}"]`);
  await page.click(`[data-act="set"][data-key="seconds"][data-val="${seconds}"]`);
}

const scenarios = {
  async home({ browser, base, errors }) {
    for (const [label, opts] of [['home', DESKTOP], ['home-phone', PHONE]]) {
      const ctx = await browser.newContext(opts);
      await installStubs(ctx);
      const page = await ctx.newPage();
      watch(page, errors, label);
      await page.goto(base);
      await page.waitForSelector('#demo-board .pic-main', { timeout: 10000 });
      await page.waitForTimeout(1500);
      await shot(page, label);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${label}: page scrolls sideways by ${overflow}px`);
      await ctx.close();
    }
  },

  async party({ browser, base, errors }) {
    const ctx = await browser.newContext(DESKTOP);
    await installStubs(ctx);
    const page = await ctx.newPage();
    watch(page, errors, 'party');
    await page.goto(base);
    await chooseSetup(page, 'party', ['movies', 'cities', 'songs', 'animals', 'flags'], 5, 15);
    await page.click('[data-act="set"][data-key="reveal"][data-val="zoom"]');
    for (const nm of ['Ann', 'Bob', 'Cy']) {
      await page.fill('#new-player', nm);
      await page.press('#new-player', 'Enter');
    }
    await shot(page, 'party-setup');
    await page.click('[data-act="start-party"]');
    const seen = {};
    for (let q = 1; q <= 5; q++) {
      await waitQuestion(page, q);
      const md = await page.getAttribute('#board', 'data-md');
      if (md === 'yt') {
        await waitPlaying(page);
        check(await page.$('#board .clip-slot iframe.yt-stub'), 'the clip player is on the board');
        check(!(await page.$('#board .veil')), 'no veil once the clip plays');
        const audio = await page.$('#board .clip-audio');
        // Pause and resume pause the clip too.
        await page.keyboard.press('p');
        await page.waitForSelector('#board .veil');
        await page.keyboard.press('p');
        await page.waitForFunction(() => !document.querySelector('#board .veil'));
        const log = await page.evaluate(() => window.__ytLog.map((e) => e.join(':')).join(' '));
        check(/state:\S+:2 /.test(log + ' '), 'pausing the game paused the clip: ' + log);
        if (!seen[audio ? 'song' : 'clip']) { seen[audio ? 'song' : 'clip'] = 1; await page.waitForTimeout(600); await shot(page, audio ? 'party-song' : 'party-clip'); }
      } else if (md === 'img') {
        await page.waitForFunction(() => { const i = document.querySelector('#board .pic-main'); return i && i.complete && i.naturalWidth > 0; });
        const scale = await page.$eval('#board .pic-main', (el) => new DOMMatrix(getComputedStyle(el).transform).a);
        check(scale > 2, `photo starts zoomed in (scale ${scale})`);
        if (!seen.photo) { seen.photo = 1; await page.waitForTimeout(2500); await shot(page, 'party-photo'); }
      }
      await page.keyboard.press(String((q % 2) + 1));       // Ann or Bob called it
      await page.waitForSelector('#scores .srow.is-got');
      await page.keyboard.press('Space');                   // reveal
      await page.waitForSelector('#board[data-ph="rev"] .answer');
      const st = await state(page);
      check((await page.textContent('#board .answer')) === st.answer, 'answer shown on the reveal');
      if (md === 'img') {
        await page.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#board .pic-main')).transform).a - 1) < 0.01,
          null, { timeout: 3000 }).catch(() => { throw new Error('whole photo on the reveal'); });
        check(/Photo: /.test(await page.textContent('#board .board-foot')), 'photo credit on the reveal');
      }
      if (md === 'yt') {
        const vol = await page.evaluate(() => window.__ytLog.some((e) => e[0] === 'volume' && e[2] === 45));
        check(vol, 'clip turned down for the reveal');
      }
      if (!seen['rev-' + md]) { seen['rev-' + md] = 1; await page.waitForTimeout(900); await shot(page, 'party-reveal-' + md); }
      await page.keyboard.press('Space');                   // next
    }
    await page.waitForSelector('.final-title');
    check(/Ann|Bob|tie/.test(await page.textContent('.final-title')), 'winner announced');
    await page.click('.recap summary');
    check((await page.$$('.recap .rc-img')).length >= 1, 'recap shows the pictures');
    await page.waitForTimeout(1200);
    await shot(page, 'party-final');
    // Playing again loads a fresh set.
    await page.click('[data-act="again"]');
    await waitQuestion(page, 1);
    await ctx.close();
  },

  async autoplayBlocked({ browser, base, errors }) {
    const ctx = await browser.newContext(DESKTOP);
    await installStubs(ctx, { youtube: { blockAutoplay: true } });
    const page = await ctx.newPage();
    watch(page, errors, 'autoplay');
    await page.goto(base);
    await chooseSetup(page, 'party', ['movies'], 5, 20);
    await page.click('[data-act="start-party"]');
    await waitQuestion(page, 1);
    await page.waitForSelector('#board.needs-tap', { timeout: 10000 });
    check((await state(page)).paused, 'clock waits for the click');
    await shot(page, 'autoplay-click');
    const box = await (await page.$('#board .board-media')).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);   // lands on the player itself
    await waitPlaying(page, 5000);
    check(!(await page.$('#board.needs-tap')), 'prompt gone once the clip plays');
    // Keyboard shortcuts still work after clicking into the player.
    await page.keyboard.press('Space');
    await page.waitForSelector('#board[data-ph="rev"]');
    await ctx.close();
  },

  async clipFallbacks({ browser, base, errors }) {
    // Every clip errors: movies show their posters instead.
    for (const [label, youtube] of [['errors', { errorAll: 150 }], ['wrong-titles', { wrongTitles: true }]]) {
      const ctx = await browser.newContext(DESKTOP);
      await installStubs(ctx, { youtube });
      const page = await ctx.newPage();
      watch(page, errors, label);
      await page.goto(base);
      await chooseSetup(page, 'party', ['movies'], 5, 20);
      await page.click('[data-act="start-party"]');
      await waitQuestion(page, 1);
      await page.waitForSelector('#board[data-md="img"] .pic-main', { timeout: 15000 });
      await waitPlaying(page);
      const st = await state(page);
      check(st.md === 'img' && !st.paused, `${label}: poster shown and the clock runs`);
      if (label === 'errors') await shot(page, 'fallback-poster');
      await ctx.close();
    }
    // Songs have no poster: spares are tried, then the question is skipped.
    const ctx = await browser.newContext(DESKTOP);
    await installStubs(ctx, { youtube: { errorAll: 150 } });
    const page = await ctx.newPage();
    watch(page, errors, 'songs');
    await page.goto(base);
    await chooseSetup(page, 'party', ['songs'], 5, 20);
    await page.click('[data-act="start-party"]');
    await page.waitForFunction(() => { const s = window.__gor.app.sess; return s && s.game.phase === 'rev'; }, null, { timeout: 30000 });
    check((await page.evaluate(() => window.__gor.app.sess.spare.length)) === 0, 'spares were used first');
    await ctx.close();
    // YouTube unreachable: movie posters from the start, songs left out.
    const ctx2 = await browser.newContext(DESKTOP);
    await installStubs(ctx2, { noYouTube: true });
    const page2 = await ctx2.newPage();
    watch(page2, [], 'noyt');     // the blocked YouTube script logs a load error by design
    await page2.goto(base);
    await chooseSetup(page2, 'party', ['movies', 'songs'], 5, 20);
    await page2.click('[data-act="start-party"]');
    await waitQuestion(page2, 1);
    const deck = await page2.evaluate(() => window.__gor.app.sess.game.deck.map((p) => p.kind + ':' + p.media.type));
    check(deck.every((d) => d === 'clip:img'), 'only movie posters without YouTube: ' + deck.join(' '));
    await ctx2.close();
  },

  async online({ browser, base, errors }) {
    const hostCtx = await browser.newContext(DESKTOP);
    await installStubs(hostCtx);
    const host = await hostCtx.newPage();
    watch(host, errors, 'host');
    await host.goto(base);
    await host.waitForSelector('.mode[data-act="setup-online"]:not([disabled])');
    await chooseSetup(host, 'online', ['cities', 'movies', 'animals'], 5, 30);
    await host.click('[data-act="open-room"]');
    await host.waitForSelector('#lobby-prep.is-ready', { timeout: 15000 });
    const code = (await host.$$eval('.room-code span', (els) => els.map((e) => e.textContent).join('')));
    check(/^[A-Z]{4}$/.test(code), 'room code ' + code);

    const phones = [];
    for (const nm of ['Dana', 'Eli']) {
      const ctx = await browser.newContext(PHONE);
      await installStubs(ctx);
      const page = await ctx.newPage();
      watch(page, errors, nm);
      await page.goto(base + '#join-' + code);
      await page.fill('#join-name', nm);
      await page.click('#join-go');
      await page.waitForSelector('.phone-card h1:has-text("You’re in")');
      phones.push({ nm, ctx, page });
    }
    await host.waitForFunction(() => document.querySelectorAll('#lobby-list .lobby-player').length === 2);
    await host.waitForTimeout(600);
    await shot(host, 'online-lobby');
    await shot(phones[0].page, 'online-phone-lobby');
    await host.click('[data-act="room-start"]');

    const seen = {};
    for (let q = 1; q <= 5; q++) {
      await waitQuestion(host, q);
      await waitPlaying(host);
      const st = await state(host);
      const [a, b] = phones.map((p) => p.page);
      await a.waitForSelector(`#board[data-ph="q"]`);
      if (st.md === 'img') {
        await a.waitForSelector('#board .pic-main');
        if (!seen.photo) { seen.photo = 1; await a.waitForTimeout(1500); await shot(a, 'online-phone-photo'); await shot(host, 'online-host-photo'); }
      } else {
        await a.waitForSelector('#board .watch');
        if (!seen.clip) { seen.clip = 1; await shot(a, 'online-phone-clip'); }
      }
      await b.fill('#guess', 'definitely not it');
      await b.press('#guess', 'Enter');
      await b.waitForSelector('#fb.fb-n, #fb.fb-c');
      await a.fill('#guess', st.answer.toLowerCase());
      await a.press('#guess', 'Enter');
      await a.waitForSelector('#fb.fb-y');
      if (!seen.got) { seen.got = 1; await shot(a, 'online-phone-correct'); await shot(host, 'online-host-scores'); }
      await b.fill('#guess', st.answer);
      await b.press('#guess', 'Enter');
      // Everyone has it: the reveal comes by itself.
      await host.waitForSelector('#board[data-ph="rev"]', { timeout: 5000 }).catch(async (e) => {
        const dbg = await host.evaluate(() => { const g = window.__gor.app.sess.game; return JSON.stringify({ ph: g.phase, ans: g.r.pz.answer, got: g.r.got, tries: g.r.tries, fb: g.r.fb, endAt: g.r.endAt, players: g.players.map((p) => [p.pid, p.nm, p.on]) }); });
        const fbB = await b.textContent('#fb').catch(() => '?');
        throw new Error(e.message.split('\n')[0] + ' state=' + dbg + ' phoneB=' + fbB + ' guessB=' + (await b.inputValue('#guess').catch(() => '?')));
      });
      await a.waitForSelector('#result .result-big');
      if (!seen.rev) { seen.rev = 1; await a.waitForTimeout(700); await shot(a, 'online-phone-reveal'); }
      await host.keyboard.press('Space');
    }
    await host.waitForSelector('.final-title');
    for (const p of phones) await p.page.waitForSelector('.final-me');
    const dana = await phones[0].page.textContent('.final-me h1');
    check(/1st/.test(dana), 'Dana answered first every time: ' + dana);
    await phones[0].page.waitForTimeout(1200);
    await shot(phones[0].page, 'online-phone-final');
    await shot(host, 'online-host-final');
    for (const p of phones) await p.ctx.close();
    await hostCtx.close();
  },
};

async function main() {
  const only = process.argv.slice(2);
  const { server } = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let failed = 0;
  for (const [name, run] of Object.entries(scenarios)) {
    if (only.length && !only.includes(name)) continue;
    const errors = [];
    const t0 = Date.now();
    try {
      await run({ browser, base, errors });
      const real = errors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT|youtube\.com\/iframe_api/.test(e));
      if (real.length) throw new Error('console errors:\n  ' + real.join('\n  '));
      console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed++;
      console.log(`FAIL ${name}: ${err.message}`);
    }
  }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} scenario(s) failed` : `\nall scenarios passed · screenshots in ${path.relative(process.cwd(), SHOTS)}`);
  process.exit(failed ? 1 : 0);
}

main();
