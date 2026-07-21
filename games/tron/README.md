# GRID: Awakening

A single-file, Tron-inspired mini-experience for the phone. Canvas + Web Audio.
No dependencies, no build step, no network calls, no analytics.

## The arc

Three phases, matching the emotional arc:

1. **THE CAGE** — you are a program. Slow trail, dim grid, patrols close in.
   Sparse minor-key drone, four-on-the-floor kick. Feels stuck.
2. **AWAKENING** — the pattern cracks. Speed rises, trail brightens.
   Arpeggios and backbeat snare come in.
3. **TRANSCENDENCE** — you are the User. The Grid warms; enemies flee; your
   trail derezzes them. Full synthwave: pad, lead, driving hats. Escape.

Progression is by fragments collected per phase (15 → 25 → 20).

## How to play on your phone

The game is one file (`index.html`). You have three good options:

**1. Local Wi-Fi (fastest to try right now)**

```sh
cd games/tron
python3 -m http.server 8000
# then, from your phone on the same Wi-Fi, open:
#   http://<your-computer-lan-ip>:8000
```

**2. GitHub Pages**

Enable Pages for this repo (branch → `main` → `/games/tron`), then visit
`https://<user>.github.io/the-light-app/`. Add to Home Screen for full-screen.

**3. Just email/AirDrop the file**

`index.html` is fully self-contained. Open it in mobile Safari or Chrome and
it works. First tap unlocks audio (browsers require a gesture).

## Controls

- **Tap left / right half of screen** — turn 90° left / right
- **Swipe** — set an absolute direction
- **Arrow keys / WASD** (desktop) — set direction
- **Q / E** (desktop) — turn CCW / CW
- **M** — mute

## What it does

- Procedural synthwave score generated live in the Web Audio API (no
  copyrighted samples, no CDN). Bass, kick, hats, snare, arpeggio, pad, and
  lead voices layer in as phases advance; tempo climbs 102 → 122 → 138 BPM
  and the master lowpass opens from 900 Hz to ~5 kHz.
- Cell-based light-cycle movement with persistent glowing trails.
- Grid renders with cyan Tron aesthetic that warms to amber in Phase III.
- Fully offline once loaded.

## Design notes

The color language: deep cyan for imprisonment, brighter cyan for awakening,
warm amber for the User. Enemies are red/orange until Phase III when they
retreat and your own trail derezzes theirs on contact — an inversion that
sells the "you are more than what you were" beat.
