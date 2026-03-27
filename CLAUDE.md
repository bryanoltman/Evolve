# Evolve Idle

Browser-based incremental/idle game (v1.4.9, MPL-2.0).
Upstream: github.com/pmotschmann/Evolve

Single-page app, no backend — all state in localStorage.
Two entry points: game (`index.html`) and wiki (`wiki.html`).

## Tech Stack

- Vanilla JavaScript (ES modules, no TypeScript)
- Vue 2.7 + Buefy 0.9 (UI components) — loaded from CDN
- jQuery 3.6 — DOM manipulation, AJAX
- esbuild — JS bundling
- LESS + csso — CSS compilation
- No test framework, no linter, no CI

## Build & Dev Commands

- `npm run build` — full production build (JS + CSS for game and wiki)
- `npm run build-debug` — debug build with sourcemaps
- `npm run serve` — dev server on localhost:4400
- `npm run deploy` — deploy to GitHub Pages via gh-pages
- Individual: `npm run evolve`, `npm run wiki`, `npm run evolve-less`, `npm run wiki-less`

## Directory Layout

```
├── index.html          # Game entry point (loads CDN deps + evolve/main.js)
├── wiki.html           # Wiki entry point (loads wiki/wiki.js)
├── save.html           # Save export utility
├── src/                # Source code (24 JS modules + LESS)
│   ├── main.js         # Game entry + game loop (13K lines)
│   ├── vars.js         # Global mutable state object
│   ├── index.js        # Root Vue instance, tab management, save/load
│   ├── functions.js    # Core utilities (vBind, popover, modRes, gameLoop)
│   ├── locale.js       # i18n system (loc() function)
│   ├── actions.js      # Building/structure definitions
│   ├── tech.js         # Technology tree (largest file, 16K lines)
│   ├── races.js        # Species, traits, biomes
│   ├── resources.js    # Resource system, trading, crafting
│   ├── jobs.js         # Citizen job system
│   ├── industry.js     # Smelters, factories, power grid
│   ├── civics.js       # Government, military, espionage
│   ├── space.js        # Space exploration regions
│   ├── portal.js       # Hell dimension, mechs
│   ├── edenic.js       # Eden dimension
│   ├── truepath.js     # Tau Ceti star system
│   ├── arpa.js         # ARPA projects (genetics, supercollider, etc.)
│   ├── governor.js     # Auto-management AI governor
│   ├── prod.js         # Production calculations
│   ├── events.js       # Random event system
│   ├── resets.js       # Prestige/reset mechanics
│   ├── achieve.js      # Achievements, feats, mastery
│   ├── seasons.js      # Weather and astrology
│   ├── debug.js        # Debug/expose mode
│   ├── evolve.less     # Game stylesheet
│   └── wiki/           # Wiki source (30 JS modules + wiki.less)
├── evolve/             # Build output (game bundle + CSS)
├── wiki/               # Build output (wiki bundle + CSS)
├── strings/            # i18n locale JSON files (14 locales)
├── lib/                # Vendored third-party libraries
└── font/               # Weather icon webfont
```

## Architecture & Key Patterns

**Global state:** Single mutable `global` object exported from `vars.js`. Serialized to/from localStorage via LZString compression. Contains all game state: `resource`, `tech`, `city`, `space`, `civic`, `race`, `evolution`, etc.

**Game loop:** Three tiers in `main.js`:
- `fastLoop()` (line ~882) — resource ticks, production, UI updates
- `midLoop()` (line ~8133) — caps, unlocks, building effects
- `longLoop()` (line ~11531) — power grid, slower periodic checks, auto-save

All run via Web Worker timer (`evolve/evolve.js` posts messages to trigger `execGameLoops`). Base tick: 250ms fast, 1s mid, 5s long. Rates modified by race traits.

**UI pattern:** Vue 2 instances created via `vBind()` helper (functions.js), one per UI section. Not a single Vue app — multiple independent instances. Popovers via `popover()` helper using Popper.js. Settings panel uses Buefy components (`b-field`, `b-input`, `b-collapse`, `b-switch`, `b-tab-item`).

**Actions/buildings:** Defined as a massive nested object in `actions.js`, keyed by category > subcategory > action. Each action has: `id`, `title()`, `desc()`, `cost`, `effect()`, `action()`, `queue_complete()`, `condition()`.

**Tech tree:** Similar structure in `tech.js`. Each tech has `reqs` (prerequisites), `grant` (what it unlocks), `cost`, `action()`, `condition()`.

**i18n:** `loc(key, [variables])` function in `locale.js`. Strings stored in `strings/strings.json` (English) with locale overrides. Tokens use `%0`, `%1` etc. Flat key-value JSON, no nesting.

**Race/trait system:** `races.js` defines all species with genus, traits (positive/negative), biome associations. Traits modify gameplay calculations throughout all modules.

**Resource system:** ~40 resources defined in `resources.js`. `modRes()` in `functions.js` handles resource changes. Resources have `amount`, `max`, `diff` (rate), `display` (visibility).

**Save system:** Auto-saves every longLoop tick (~5s) via `save.setItem('evolved', LZString.compressToUTF16(JSON.stringify(global)))`. Export uses `LZString.compressToBase64()`. Import validates structure (`evolution`, `settings`, `stats`, `stats.plasmid` keys), applies migration patches, saves to localStorage, reloads page. Backup stored under `evolveBak` key before prestige resets.

## Key Conventions

- No TypeScript — all vanilla JS with ES module imports/exports
- Mutable global state everywhere — no immutability patterns
- jQuery for DOM, Vue 2 for data-bound UI sections
- String-keyed lookups prevalent (e.g., `global.city['bank']`, `actions.city.bank`)
- Functions often check `global.race['trait_name']` for conditional behavior
- `loc()` for all user-visible strings
- Build output (`evolve/`, `wiki/`) is committed to repo (marked binary in .gitattributes)

## File Sizes (lines, descending)

```
tech.js       15,726    # Technology definitions
main.js       12,996    # Game loop + orchestration
actions.js     9,744    # Building/structure definitions
races.js       9,534    # Species and traits
portal.js      9,112    # Hell dimension
space.js       8,654    # Space regions
truepath.js    6,431    # Tau Ceti system
functions.js   3,521    # Core utilities
resources.js   3,309    # Resource system
achieve.js     2,930    # Achievements
arpa.js        2,640    # ARPA projects
civics.js      2,498    # Government, military
edenic.js      2,484    # Eden dimension
vars.js        2,443    # Global state
industry.js    1,917    # Factories, smelters
governor.js    1,855    # AI governor
index.js       1,506    # App entry, UI setup
resets.js      1,360    # Prestige mechanics
events.js      1,215    # Random events
jobs.js        1,053    # Job system
prod.js          580    # Production calcs
seasons.js       417    # Seasonal effects
locale.js        105    # i18n loader
debug.js          48    # Debug tools
evolve.less    5,513    # Game stylesheet
```
