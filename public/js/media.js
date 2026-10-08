/* Real media for the clues, prepared in the host's browser while a game loads:
 *   - photos: the main image of a Wikipedia article (free licences only, with credits)
 *   - clips:  YouTube trailers / music videos through YouTube's embedded player,
 *             falling back to Wikidata's trailer links and then the film's poster.
 * Nothing is downloaded or hosted by the game itself. */
(function (G) {
  'use strict';

  var M = G.match;
  var WIKI_API = 'https://en.wikipedia.org/w/api.php';
  var WDQS = 'https://query.wikidata.org/sparql';
  var THUMB = 1280;                 // a standard Wikimedia thumbnail size
  var CACHE_KEY = 'gor.media.v1';
  var CACHE_MS = 7 * 24 * 3600 * 1000;

  // ------------------------------------------------------------ helpers

  function chunk(arr, n) {
    var out = [];
    for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }
  function unique(arr) {
    return arr.filter(function (x, i) { return x && arr.indexOf(x) === i; });
  }
  // videos.js values: "id", "id@seconds" or a list of those.
  function entries(v) {
    return [].concat(v || []).filter(function (e) { return /^[A-Za-z0-9_-]{11}(@\d+)?$/.test(e); });
  }

  function fetchJson(url, ms) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 12000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function wiki(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return fetchJson(WIKI_API + '?' + qs + '&format=json&formatversion=2&origin=*');
  }

  // Lookups are cached for a week so repeat games start fast and go easy on Wikipedia.
  var cache = (function () {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      return c && typeof c === 'object' ? c : {};
    } catch (e) {
      return {};
    }
  })();
  function cached(key) {
    var e = cache[key];
    return e && Date.now() - e.t < CACHE_MS ? e.v : undefined;
  }
  function remember(key, v) { cache[key] = { t: Date.now(), v: v }; }
  function saveCache() {
    var now = Date.now();
    Object.keys(cache).forEach(function (k) { if (now - cache[k].t > CACHE_MS) delete cache[k]; });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* storage full or blocked */ }
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  // Plain text of the HTML snippets Commons uses for authors and licences.
  function textOf(html) {
    if (!html) return '';
    var text;
    try {
      text = new DOMParser().parseFromString(String(html), 'text/html').body.textContent || '';
    } catch (e) {
      text = String(html).replace(/<[^>]*>/g, '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, e) {
        if (e[0] !== '#') return ENTITIES[e.toLowerCase()] || m;
        var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      });
    }
    return M.clean(text.replace(/\u00a0/g, ' '), 80);
  }

  // ------------------------------------------------------ Wikipedia lookups

  // { title: { thumb, file, qid } | null } for each requested article title.
  function pages(titles, license) {
    var out = {}, todo = [];
    unique(titles).forEach(function (t) {
      var c = cached('p:' + license + ':' + t);
      if (c !== undefined) out[t] = c; else todo.push(t);
    });
    return Promise.all(chunk(todo, 50).map(function (batch) {
      return wiki({
        action: 'query', prop: 'pageimages|pageprops', piprop: 'thumbnail|name', pithumbsize: THUMB,
        pilicense: license, ppprop: 'wikibase_item', redirects: 1, titles: batch.join('|'),
      }).then(function (data) {
        var q = data.query || {}, to = {}, byTitle = {};
        batch.forEach(function (t) { to[t] = t; });
        function follow(list) {
          (list || []).forEach(function (n) {
            Object.keys(to).forEach(function (k) { if (to[k] === n.from) to[k] = n.to; });
          });
        }
        follow(q.normalized);
        follow(q.redirects);
        (q.pages || []).forEach(function (p) { byTitle[p.title] = p; });
        batch.forEach(function (t) {
          var p = byTitle[to[t]];
          var info = p && !p.missing ? {
            thumb: (p.thumbnail && p.thumbnail.source) || '',
            file: p.pageimage || '',
            qid: (p.pageprops && p.pageprops.wikibase_item) || '',
          } : null;
          out[t] = info;
          remember('p:' + license + ':' + t, info);
        });
      }).catch(function () { /* offline or rate-limited: these puzzles are skipped this time */ });
    })).then(function () { return out; });
  }

  // { fileName: 'Photographer · CC BY-SA 4.0' } for Wikimedia Commons files.
  function credits(files) {
    var out = {}, todo = [];
    unique(files).forEach(function (f) {
      var c = cached('c:' + f);
      if (c !== undefined) out[f] = c; else todo.push(f);
    });
    return Promise.all(chunk(todo, 50).map(function (batch) {
      return wiki({
        action: 'query', prop: 'imageinfo', iiprop: 'extmetadata',
        iiextmetadatafilter: 'Artist|LicenseShortName', titles: batch.map(function (f) { return 'File:' + f; }).join('|'),
      }).then(function (data) {
        var q = data.query || {}, to = {};
        (q.normalized || []).forEach(function (n) { to[n.to] = n.from; });
        (q.pages || []).forEach(function (p) {
          var meta = p.imageinfo && p.imageinfo[0] && p.imageinfo[0].extmetadata;
          if (!meta) return;
          var file = (to[p.title] || p.title).replace(/^File:/, '');
          var artist = textOf(meta.Artist && meta.Artist.value);
          var license = textOf(meta.LicenseShortName && meta.LicenseShortName.value);
          out[file] = [artist, license].filter(Boolean).join(' · ');
          remember('c:' + file, out[file]);
        });
      }).catch(function () {});
    })).then(function () { return out; });
  }

  // { Q123: ['youtubeId', ...] } from Wikidata's "YouTube video ID" (P1651).
  function wikidataVideos(qids) {
    qids = unique(qids);
    if (!qids.length) return Promise.resolve({});
    var query = 'SELECT ?item ?yt WHERE { VALUES ?item { ' + qids.map(function (q) { return 'wd:' + q; }).join(' ') +
      ' } ?item wdt:P1651 ?yt }';
    return fetchJson(WDQS + '?format=json&query=' + encodeURIComponent(query), 10000).then(function (data) {
      var out = {};
      ((data.results && data.results.bindings) || []).forEach(function (b) {
        var q = b.item.value.split('/').pop(), id = b.yt.value;
        if (/^[A-Za-z0-9_-]{11}$/.test(id)) (out[q] = out[q] || []).push(id);
      });
      return out;
    }).catch(function () { return {}; });
  }

  function preload(src, ms) {
    return new Promise(function (resolve) {
      var img = new Image(), done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        resolve(ok);
      }
      var timer = setTimeout(function () { finish(false); }, ms || 15000);
      img.onload = function () { clearTimeout(timer); finish(img.naturalWidth > 0); };
      img.onerror = function () { clearTimeout(timer); finish(false); };
      img.referrerPolicy = 'strict-origin-when-cross-origin';
      img.src = src;
    });
  }

  // Attach playable media to each puzzle; resolves the puzzles that have some.
  // onProgress(done, total) reports image preloading.
  function prepare(list, onProgress) {
    var photos = list.filter(function (p) { return p.kind === 'photo'; });
    var clips = list.filter(function (p) { return p.kind === 'clip'; });
    var videos = G.VIDEOS || {};
    var needYouTube = list.some(function (p) { return p.kind === 'clip' || p.kind === 'song' || p.kind === 'url-yt'; });
    // Find out now whether YouTube is reachable, so a blocked network means
    // posters from the start instead of a stalled clip every round.
    var youTube = needYouTube ? loadYouTube().then(function () { return true; }, function () { return false; }) : Promise.resolve(false);

    return Promise.all([
      photos.length ? pages(photos.map(function (p) { return p.wiki; }), 'free') : {},
      clips.length ? pages(clips.map(function (p) { return p.wiki; }), 'any') : {},
    ]).then(function (res) {
      var ph = res[0], cl = res[1];
      photos.forEach(function (p) {
        var info = ph[p.wiki];
        // An SVG lead image is usually a map, seal or logo rather than a photo.
        if (info && info.thumb && (p.flat || !/\.svg$/i.test(info.file))) {
          p.media = { type: 'img', src: info.thumb, file: info.file };
        }
      });
      var needWikidata = [];
      clips.forEach(function (p) {
        var info = cl[p.wiki];
        p.poster = info && info.thumb ? info.thumb : '';
        p.qid = info ? info.qid : '';
        if (!entries(videos[p.v]).length && p.qid) needWikidata.push(p.qid);
      });
      var files = photos.filter(function (p) { return p.media && !p.flat; }).map(function (p) { return p.media.file; });
      return Promise.all([credits(files), wikidataVideos(needWikidata), youTube]);
    }).then(function (res) {
      var cr = res[0], wd = res[1], ytOk = res[2];
      list.forEach(function (p) {
        if (p.kind === 'photo' && p.media) {
          p.media.credit = p.flat ? 'Wikimedia Commons' : (cr[p.media.file] || 'Wikimedia Commons');
        } else if (p.kind === 'clip') {
          var ids = ytOk ? unique(entries(videos[p.v]).concat(wd[p.qid] || [])) : [];
          if (ids.length) p.media = { type: 'yt', ids: ids, audio: !!p.audio };
          else if (p.poster) p.media = { type: 'img', src: p.poster, poster: true, credit: 'Poster via Wikipedia' };
        } else if (p.kind === 'song') {
          var songIds = ytOk ? entries(videos[p.v]) : [];
          if (songIds.length) p.media = { type: 'yt', ids: songIds, audio: true };
        } else if (p.kind === 'url-img') {
          p.media = { type: 'img', src: p.img, credit: '' };
        } else if (p.kind === 'url-yt') {
          if (ytOk) p.media = { type: 'yt', ids: [p.yt], start: p.start, custom: true };
        } else if (p.kind === 'emoji') {
          p.media = { type: 'emoji' };
        }
      });
      saveCache();
      var imgs = list.filter(function (p) { return p.media && p.media.type === 'img'; });
      var done = 0;
      if (onProgress) onProgress(0, imgs.length);
      return Promise.all(imgs.map(function (p) {
        return preload(p.media.src).then(function (ok) {
          if (!ok) p.media = null;
          done++;
          if (onProgress) onProgress(done, imgs.length);
        });
      }));
    }).then(function () {
      return list.filter(function (p) { return p.media; });
    });
  }

  // ------------------------------------------------------------ YouTube

  var ytLoading = null, ytDownAt = 0;
  function loadYouTube() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    // Recently unreachable: don't make every round wait to find out again.
    if (ytDownAt && Date.now() - ytDownAt < 60000) return Promise.reject(new Error('YouTube could not be reached'));
    if (ytLoading) return ytLoading;
    ytLoading = new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (!(window.YT && window.YT.Player)) failed('YouTube took too long');
      }, 15000);
      function failed(msg) {
        clearTimeout(timer);
        ytLoading = null;
        ytDownAt = Date.now();
        reject(new Error(msg));
      }
      var prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === 'function') prev();
        clearTimeout(timer);
        ytDownAt = 0;
        resolve(window.YT);
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () { failed('YouTube could not be reached'); };
      document.head.appendChild(s);
    });
    return ytLoading;
  }

  // Does a YouTube title look like the video we asked for? Guards against
  // stale or wrong IDs: at least 60% of the answer's main words must appear.
  function titleMatches(videoTitle, names) {
    var have = M.words(videoTitle).join(' ');
    return names.some(function (name) {
      var need = M.words(name).filter(function (w) { return w.length >= 3; });
      if (!need.length) return true;
      var hit = need.filter(function (w) { return have.indexOf(w) >= 0; }).length;
      return hit / need.length >= 0.6;
    });
  }

  // Play a clip in `slot`. Tries each id until one plays, starting part-way in
  // so studio logos and title cards are skipped. Resolves a controller once the
  // clip is actually playing; rejects if none of the ids work.
  //   opts.ids, opts.audio, opts.start, opts.custom, opts.names
  //   opts.cancelled()     true once the round has moved on
  //   opts.onNeedTap(on)   the browser wants a click before it plays sound; the
  //                        page should let the next click through to the player
  //   opts.onAd()          YouTube is showing an ad first; the page can show the
  //                        player so the host can skip it
  function playClip(slot, opts) {
    var ids = opts.ids.slice();
    return loadYouTube().then(function (YT) {
      return (function next() {
        if (opts.cancelled && opts.cancelled()) return Promise.reject(new Error('cancelled'));
        if (!ids.length) return Promise.reject(new Error('No playable clip'));
        return attempt(YT, ids.shift()).catch(function (err) {
          if (err.message === 'cancelled') throw err;
          return next();
        });
      })();
    });

    function attempt(YT, entry) {
      var at = entry.indexOf('@');
      var id = at > 0 ? entry.slice(0, at) : entry;
      var fixedStart = at > 0 ? Number(entry.slice(at + 1)) : opts.start;
      var PLAYING = YT.PlayerState.PLAYING, BUFFERING = YT.PlayerState.BUFFERING;
      return new Promise(function (resolve, reject) {
        slot.innerHTML = '<div class="yt-target"></div>';
        var player = null, settled = false, stopped = false, checked = false;
        var readyAt = 0, deadline = Date.now() + 15000, tapAsked = false, adShown = false, stuckSince = 0;
        var startAt = 0, endAt = Infinity, placedFor = 0, lastSeek = 0;

        // One watchdog per attempt: gives up on clips that never start, notices
        // a round that has moved on, sits out ads, and loops before the closing
        // title cards.
        var watch = setInterval(function () {
          if (opts.cancelled && opts.cancelled()) {
            if (settled) ctl.stop(); else fail('cancelled');
            return;
          }
          if (settled) {
            place();                       // an ad may have stood in for the video's length
            if (time() > endAt) seek(startAt);
            return;
          }
          if (state() === PLAYING) { check(); return; }
          if (tapAsked || adShown) return;
          var now = Date.now();
          if (now > deadline) { fail('timeout'); return; }
          // Ready but silent after a few seconds (and not just buffering): the
          // browser is waiting for a click before it plays sound.
          if (readyAt && now - readyAt > 3500 && opts.onNeedTap && state() !== BUFFERING) {
            tapAsked = true;
            opts.onNeedTap(true);
          }
        }, 400);

        function state() { try { return player.getPlayerState(); } catch (e) { return -1; } }
        function time() { try { return player.getCurrentTime() || 0; } catch (e) { return 0; } }
        function duration() { try { return player.getDuration() || 0; } catch (e) { return 0; } }
        function seek(t) {
          lastSeek = Date.now();
          try { player.seekTo(t, true); } catch (e) { /* not ready */ }
        }
        function destroy() {
          clearInterval(watch);
          try { if (player && player.destroy) player.destroy(); } catch (e) { /* already gone */ }
        }
        function fail(why) {
          if (settled) return;
          settled = true;
          destroy();
          reject(new Error(why));
        }
        // Wrong video behind this id (reused or taken down)? Checked once the title is known.
        function titleOk() {
          if (checked || opts.custom || !opts.names) return true;
          var data = typeof player.getVideoData === 'function' ? player.getVideoData() : null;
          if (!data || !data.title) return true;
          checked = true;
          if (titleMatches(data.title, opts.names)) return true;
          fail('unexpected video: ' + data.title);
          return false;
        }
        // Where to play from, once the video's real length is known (while an ad
        // plays, YouTube can report the ad's). Worked out again if it changes.
        function place() {
          var dur = duration();
          if (placedFor && (!dur || Math.abs(dur - placedFor) < 5)) return true;
          if (fixedStart == null && !(dur >= (opts.custom ? 1 : 30))) return false;
          placedFor = dur || -1;
          var lo = opts.audio ? 0.22 : 0.25, hi = opts.audio ? 0.4 : 0.45;
          startAt = fixedStart != null ? fixedStart : Math.floor(dur * (lo + Math.random() * (hi - lo)));
          if (dur && fixedStart == null && startAt > dur - 25) startAt = Math.max(0, Math.floor(dur * 0.3));
          // Loop before the closing seconds, where trailers show the title.
          endAt = !dur ? Infinity : fixedStart != null ? dur - 1 : Math.max(startAt + 8, dur - (opts.audio ? 6 : 22));
          if (Math.abs(time() - startAt) > 1.5) seek(startAt);
          return true;
        }
        // The player says it's playing: has it reached the part we want to show?
        function check() {
          if (settled || !titleOk()) return;
          var now = Date.now();
          deadline = Math.max(deadline, now + 10000);
          if (tapAsked) {
            tapAsked = false;
            opts.onNeedTap(false);
          }
          if (place() && time() + 1.5 >= startAt) {
            settled = true;
            resolve(ctl);
            return;
          }
          // Not there yet: the seek is still landing, or YouTube is showing an ad first.
          if (placedFor && now - lastSeek > 1500) seek(startAt);
          if (!stuckSince) stuckSince = now;
          if (!adShown && now - stuckSince > 5000) {
            adShown = true;
            if (opts.onAd) opts.onAd();
            else { settled = true; resolve(ctl); }
          }
        }

        var ctl = {
          id: id,
          stop: function () {
            if (stopped) return;
            stopped = settled = true;
            destroy();
          },
          volume: function (v) { try { player.setVolume(v); } catch (e) { /* not ready */ } },
          play: function () { try { player.playVideo(); } catch (e) { /* not ready */ } },
          pause: function () { try { player.pauseVideo(); } catch (e) { /* not ready */ } },
        };
        var vars = {
          autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3,
          modestbranding: 1, playsinline: 1, rel: 0,
        };
        if (/^https?:/.test(location.origin)) vars.origin = location.origin;
        player = new YT.Player(slot.firstChild, {
          videoId: id,
          width: '100%',
          height: '100%',
          playerVars: vars,
          events: {
            onReady: function () {
              if (settled || !titleOk()) return;
              readyAt = Date.now();
              place();
              player.playVideo();
            },
            onStateChange: function (e) {
              if (stopped) return;
              if (e.data === YT.PlayerState.ENDED) {
                seek(startAt);
                player.playVideo();
              } else if (e.data === PLAYING && !settled) {
                check();
              }
            },
            onError: function (e) { fail('YouTube error ' + e.data); },
          },
        });
      });
    }
  }

  // ------------------------------------------------- custom puzzle links

  // "https://youtu.be/ID?t=42" -> { id, start }, or null.
  function parseYouTube(url) {
    var m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
    if (!m) return null;
    var t = /[?&#](?:t|start)=(?:(\d+)h)?(?:(\d+)m)?(\d+)s?/.exec(url);
    var start = t ? (Number(t[1] || 0) * 3600 + Number(t[2] || 0) * 60 + Number(t[3] || 0)) : null;
    return { id: m[1], start: start };
  }

  G.media = {
    prepare: prepare,
    playClip: playClip,
    loadYouTube: loadYouTube,
    titleMatches: titleMatches,
    parseYouTube: parseYouTube,
  };
})(window.GOR = window.GOR || {});
