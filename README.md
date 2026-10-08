# Guess-o-Rama

A guessing game show for friends, like the "guess the movie / city / song" quiz videos on YouTube, except your friends are the contestants.

Name the movie from a few seconds of its trailer, the song from its music video's audio, or the city, landmark, country, flag, animal, food or famous face from a zoomed-in photo, before the clock runs out. Every clue is a real photo or a real clip:

- **Photos** are the main pictures of Wikipedia articles (freely licensed images only). The photographer and licence are shown when the answer is revealed.
- **Clips** play through YouTube's own embedded player, starting part-way into the trailer so logos and title cards are skipped.

There are 12 categories with about 750 questions: Movies, Animated Movies, TV Shows, Songs, Video Games, Cities, Landmarks, Countries, Flags, Animals, Food and Famous Faces. There is also an optional **Emoji Bonus** round, and you can **add your own** questions (photos of your friends, YouTube links, inside jokes).

## Play

**On your phone (no computer needed):** open https://ghassanellabadi-pixel.github.io/agent-test/ once GitHub Pages is switched on (see [Hosting](#hosting)).

**On a computer** with [Node.js](https://nodejs.org) 18 or newer:

```sh
npm install
npm start
```

Then open http://localhost:3000 on the computer connected to the TV, or share that browser tab on a video call.

Either way, there are two modes:

- **Play on one screen.** Everyone watches the same screen and shouts their answers. The host taps whoever got it first, or presses the number shown on that player's avatar.
- **Host an online game.** Friends scan the QR code, open the invite link or type the room code on their own phones, then type their guesses. Answering faster scores more: 1000 points for an instant answer, down to 400 at the buzzer, plus 100 for being first. Photos show on every phone. With `npm start`, friends join over the same Wi-Fi; on the hosted link, they can join from anywhere.

Keyboard shortcuts on the big screen: **Space** reveals the answer or goes to the next question, **P** pauses, **1–9** award points in one-screen mode, and **M** mutes the sounds.

### Settings

- **How pictures and clips start:** *Zoomed in* (the picture pulls back as time runs down), *Blurry*, *Tiles* (squares come off one by one) or *Clear*.
- **Letter hints:** after 40% of the time the answer's blank letter tiles appear, and after 70% the first letters fill in.
- **Difficulty**, **number of questions** and **seconds per question**.

### Add your own

On the setup screen, open **Add your own** and put one question per line, in the form `clue = answer`. Add other accepted answers after `/` and a hint after `|`:

```text
https://youtu.be/dQw4w9WgXcQ?t=43 = Never Gonna Give You Up / Rickroll
https://example.com/our-trip.jpg = Barcelona | Summer 2024
🦁👑 = The Lion King
```

## Good to know

- **Keep the internet on.** Photos load from Wikipedia and Wikimedia Commons, and clips stream from YouTube. Nothing is downloaded or re-hosted. The game fetches everything for a round while it loads and leaves out anything that won't load.
- **Open the game through `npm start`, not by double-clicking `index.html`.** YouTube won't play embedded videos on pages opened straight from a file.
- **If a clip won't play** (taken down, blocked in your country, or not allowed in embeds), the game tries other copies of it, then the film's poster, and otherwise swaps in a spare question. If YouTube can't be reached at all, movies and shows use their posters and songs are left out.
- **Ads:** YouTube sometimes plays an ad before a clip. The clock waits and the ad shows on the big screen so you can click "Skip ad". The clip starts right after.
- **"Click here to start the clip":** some browsers, Safari especially, won't play sound until you click. Click the picture once and the clip starts, with the clock waiting until it does.
- **Phones can't connect to `npm start`?** They must be on the same Wi-Fi as the computer, and its firewall has to allow incoming connections to Node. Use the address the server prints under "On your Wi-Fi", not `localhost`.
- **Rooms on the hosted link** pass through a free public message relay (HiveMQ's or EMQX's public MQTT broker), since there's no game server behind GitHub Pages. Anyone who knows a room's code could watch that room's game, so keep player names friendly. With `npm start`, rooms stay on your own computer.

## Hosting

The game is a static site, so any web host can serve it. Rooms then go through the public relay above. To host it with GitHub Pages:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, then pick the branch with the game and the **/ (root)** folder, and save.
3. After a minute or two the game is at `https://<your-user>.github.io/<repository>/`. The `index.html` at the root forwards to `public/`.

## Development

```sh
npm test            # unit tests: answer matching, puzzle data, game engine, media loading, server, relay
npm run test:e2e    # browser tests (needs Chromium: npx playwright install chromium)
```

The tests run offline. Wikipedia, Wikimedia and YouTube are replaced with stand-ins (`test/e2e/stubs.mjs`) that can also make clips fail, refuse to autoplay or play an ad first, and a local MQTT broker (aedes) stands in for the public relay. Screenshots are saved to `test-results/e2e/`.

| File | What it does |
| --- | --- |
| `public/js/data.js` | Questions for each category: the answer, the Wikipedia article whose photo (or poster) is used, difficulty, other accepted answers and a hint |
| `public/js/videos.js` | YouTube video ids for the clip and song questions |
| `public/js/media.js` | Looks up photos, credits and clips, and plays clips with YouTube's player |
| `public/js/engine.js` | Rounds, timer, hints and scoring. It runs on the big screen only |
| `public/js/match.js` | Forgiving answer checking: case, accents, "the", typos and number words. Look-alikes stay apart (Austria/Australia, *Toy Story 2*) |
| `public/js/app.js` | Screens and controls |
| `public/js/net.js` | Connects the phones to the host's room: through `server.js` when it's running, otherwise through a public MQTT relay |
| `server.js` | Serves the game and relays rooms over WebSocket on your own network |

To fix or add a clip, put its YouTube id in `public/js/videos.js` under the question's `v` key. Before a clip plays, the game checks that the YouTube video's title matches the answer, so a wrong id is skipped rather than shown. If a clip question has no id, the game uses Wikidata's trailer link, then the poster.

## Credits

Photos come from Wikipedia and Wikimedia Commons, and each one is credited with its author and licence on the reveal. Film posters are only a fallback and are shown the way Wikipedia shows them. Clips are played with YouTube's embedded player and stay on YouTube. Fonts are [Bungee](https://fonts.google.com/specimen/Bungee) and [Nunito](https://fonts.google.com/specimen/Nunito). This is meant for playing with friends, not for commercial use.
