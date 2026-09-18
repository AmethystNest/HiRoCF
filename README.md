# HiRoCF

Top-down mobile racing game project.

Target: iPhone Safari / iOS PWA, Android Chrome, PC browser.

This repository is the canonical development repository for HiRoCF.

## Structure

- `index.html` — page shell, HUD, touch controls. Loads `src/main.js` as an ES module.
- `src/` — game source (ES modules, no bundler required to run).
  - `main.js`, `config.js`, `pixi.js` (bundled PixiJS)
  - `game/` — player physics, rival AI, race progression
  - `track/` — track centreline, stage layouts, stage path definitions
  - `render/` — surfaces, ribbons, minimap, props, effects

## Development

```
npm install
npm run dev     # serve locally (http-server)
npm test        # vitest
npm run lint    # eslint src
```
