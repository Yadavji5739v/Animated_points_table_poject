# Esports Broadcast Graphics — What Was Added

Your existing upload → parse → points table → **Download PNG** flow is
**100% unchanged** (`script.js`, the parsing regex, the sort/tiebreak
logic, and `downloadImage()` are untouched). Everything below is new,
additive functionality.

## New files

| File | Purpose |
|---|---|
| `overlay-data.js` | Reads your existing standings from `localStorage`, encodes a snapshot into a shareable link. |
| `overlay-buttons.js` | Adds the 3 new buttons next to "Download PNG" on `standings.html` / `bg.html` / `ver.html`. |
| `premium-ui.css` | Dark/orange/gold glass theme for page chrome + buttons only. It never touches `.poster`, `.table-head`, `.row`, etc., so your PNG export looks exactly like before. |
| `live.html` / `live.css` / `live.js` | The OBS-ready animated overlay page. |
| `vendor/gsap.min.js` | GSAP, vendored locally (no CDN dependency at runtime — more reliable for a page that has to load instantly in OBS). |

## How the 4 buttons work

After generating a points table you'll now see:

1. **Download PNG** — unchanged, still `html2canvas` under the hood.
2. **Generate Animated Overlay** — snapshots the current standings + title
   into a link. No backend/database is used: the standings data is encoded
   directly into the URL, and also cached in `localStorage` for convenience.
   This is what makes it work in OBS, whose Browser Source runs an isolated
   Chromium profile that doesn't share your normal browser's storage.
3. **Open Live Overlay** — opens the overlay in a new tab with a small
   control bar visible (Replay / Winner Reveal / Export Video / Transparent
   BG toggle), so you can preview and drive it manually.
4. **Copy Overlay Link** — copies the **clean OBS link** (`controls=0`,
   no control bar) straight to your clipboard. Paste this into an OBS
   **Browser Source**.

## OBS Browser Source setup

1. Click **Generate Animated Overlay**, then **Copy Overlay Link**.
2. In OBS: `Sources → Add → Browser Source` → paste the link.
3. Set the Browser Source's width/height to whichever you're producing for:
   - `1920 x 1080` (landscape broadcast)
   - `1080 x 1350` (4:5, Instagram feed style)
   - `1080 x 1920` (9:16, Reels/Shorts/vertical stream)
4. Check **"Refresh browser when scene becomes active"** so it replays the
   entrance animation each time you switch to that scene.
5. For a transparent overlay on top of your gameplay capture, add
   `&bg=transparent` to the end of the copied link before pasting it in OBS.

The page has zero scrollbars, zero browser chrome, and detects the aspect
ratio automatically (`layout-16x9` / `layout-4x5` / `layout-9x16`) to scale
fonts and row height without distortion.

## Winner Reveal

On the **Open Live Overlay** (preview) tab, click **🏆 Winner Reveal**:
standings fade out, a trophy + "CHAMPION" + confetti sequence plays for the
#1 team, then it automatically returns to the standings after ~6 seconds.
You can also trigger it automatically by adding `&reveal=1` to a link.

## Export Animated Video

Click **🎥 Export Animated Video** on the overlay tab. This renders a fresh
~9 second, 1080×1920 animation (background → title → rows animating in with
counting stats → winner highlight) directly on a `<canvas>` and records it
client-side with `MediaRecorder` — **no server, no ffmpeg required**.

- Downloads as `champion-reveal.mp4` when your browser supports MP4 capture.
- Falls back to `.webm` automatically on browsers that don't (still opens
  fine in Telegram/WhatsApp/Discord; a free online converter can turn it
  into `.mp4` if a specific platform insists on that extension).
- Sized for vertical short-form (Reels/Shorts); tested output is a valid,
  playable MP4/VP9 file.

## Notes / things worth knowing

- The "smooth re-order when rankings change" animation currently plays as
  a stagger-in reveal each time the overlay (re)loads or **Replay** is
  clicked — this is the standard broadcast-style reveal. If you want true
  live re-ranking mid-stream (without reloading the Browser Source) that
  would need a small polling/websocket layer; happy to add that as a
  follow-up if you want the overlay to update automatically without
  regenerating the link.
- Everything is plain HTML/CSS/JS + GSAP, no build step, no backend —
  matches your "lightweight, easy to maintain" requirement.
