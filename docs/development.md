# Development Guide

## Requirements

- Node.js 24 LTS and npm.
- Git.
- For browser checks and documentation screenshots, a Chromium browser: installed Google Chrome, Microsoft Edge, or Playwright's Chromium (`npx playwright install chromium`). Set `FRAME_LAB_CHROMIUM` for browser checks; documentation capture also detects standard Windows Chrome/Edge locations.
- FFmpeg to generate animated documentation GIFs (`ffmpeg` on `PATH`, or set `FFMPEG` to its executable path).
- Optional: Android Platform Tools (`adb`) and an authorized USB-debugging phone for a real-device documentation screenshot.

## Get started

Clone the repository, then install the locked dependencies and start Vite:

```sh
git clone <repository-url>
cd frame-lab
npm ci
npm run dev
```

Open the local URL printed by Vite. Changes to source files reload automatically. Stop the server with `Ctrl+C`.

## Navigate the code

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Application startup, interface events, editing state, persistence, and worker coordination. |
| `src/renderer.ts` | Canvas drawing, camera, previews, and visual state. |
| `src/model.ts` | Project model, validation, history, prices, and `GAME_VERSION`. |
| `src/selection.ts` | Selection geometry, group handles, deletion, clipboard extraction and selection after edits. |
| `src/fragment.ts` | Clipboard fragment coordinates, reflections, paste previews and atomic paste validation. |
| `src/coordinates.ts` | Conversion between centered project coordinates and internal grid coordinates. |
| `src/physics.ts` and `src/simulation.worker.ts` | Physics solver and its Web Worker entry point. |
| `src/solver-strategies.ts` | Serpentine member ordering and support-rooted backward load propagation. |
| `src/style.css` | Application layout, responsive behavior, and visual styles. |
| `src/examples.ts` | Starter structure and built-in examples. |
| `tests/` | Model, coordinate, and physics checks. |
| `scripts/` | Build helpers, browser checks, screenshot capture, benchmark, and optional deployment utility. |

Open the repository folder in your IDE. Start with `src/main.ts` for user interactions, follow imports to the relevant subsystem, and use `src/style.css` for appearance changes. The interface and source are in English.

Basic XPBD Solver keeps the original XPBD constraint ordering. Serpentine is selected when the app opens; the Settings dialog can change the solver for the current page session. Alternative solvers retain stable member IDs and change constraint visit order rather than exported geometry. Serpentine also selects each welded joint's reference member in scan order; changing sweeps alone would leave that directional bias in place. Each Serpentine start independently samples `Math.random() < 0.5` for its starting side. No previous side is stored. The worker receives that explicit side, so the trajectory is reproducible once the choice is known; pause/resume does not redraw it.

The backward solver builds breadth-first layers from positional supports, accumulates gravity force and lever-arm moment from distal branches, and visits constraints from leaves toward supports with a return sweep. Trees count each particle's weight once; cyclic frames split loads between equally short inward paths, weighted by axial stiffness. Same-layer cross-links remain in XPBD but are omitted from the gravity estimate. Hinges and ropes release moment; pinned supports have no estimated reaction moment, and ropes do not propagate compressive gravity loads. Unsupported components have no static reaction. Fractured midpoint welds trigger graph rebuilding. Estimated force and moment are normalized using the rods' axial/bending stiffness and existing strain/curvature limits, then combined with dynamic deformation for stress and damage. This estimate describes gravity load paths, not inertial or contact forces or a full stiffness-matrix solution.

Detailed solver explanations include labelled figures, worked numerical examples and actual solver animations: [Overview and common fixture](solvers/README.md), [Basic XPBD Solver](solvers/original.md), [Serpentine](solvers/serpentine.md), [Backward](solvers/backward.md). Recreate the media with `node --import tsx scripts/generate-solver-docs.ts` followed by `python scripts/render-solver-docs.py` (Python 3 and Pillow required). The first command audits the worked force/moment example and writes measurements; the second renders the diagrams and GIFs from the sampled World trajectories.

## Configuration and versions

`src/model.ts` is the source of truth for beam profile properties, material prices, length limits, project model, and `GAME_VERSION`. The status bar and exported project metadata use `GAME_VERSION`; increment it after every application change. `vite.config.js` sets relative asset URLs and the generated output directory. `index.html` is the HTML build template. Dependencies and common commands are declared in `package.json`.

## Checks and build

```sh
npm test
npm run benchmark
npm run build
npm run test:browser
```

`npm run build` type-checks and creates a production site in `public_html/`, including `index.html`, compiled assets, icons, the web app manifest, and the generated service worker. `public_html/` is generated and ignored by Git; do not edit it manually. `npm run test:browser` builds the app and checks production behavior in Chromium. Install the browser with `npx playwright install chromium` if needed. To use a system Chromium, set `FRAME_LAB_CHROMIUM` to its executable path.

After a build, `node scripts/browser-smoke.mjs --solvers-only` checks Settings, solver routing, and canvas resizing on desktop, portrait touch, and landscape touch. Use the full suite for release validation.

## Refresh documentation screenshots

After any visual UI change, build the production files and run:

```sh
npm run screenshots
```

The command writes desktop and mobile browser captures plus looping simulation, basic-construction, repeated-paste and mirrored-paste GIFs to `docs/images/`. FFmpeg is optional for still screenshots; without it, animations are skipped and the browser captures and device attempt still complete. It also looks for an authorized Android device through ADB. If one is connected, it opens the local build through USB port forwarding and saves `docs/images/frame-lab-android.png`. If ADB or an authorized device is unavailable, it reports that fact and still succeeds. If Android SDK is installed in a custom location, set `ADB` to the `adb` executable path. When the Android image is absent, retry the capture at the next documentation update.

To refresh only the two clipboard animations, preserving other images and skipping the Android capture, run:

```sh
npm run screenshots -- --clipboard-only
```

`scripts/capture-doc-clipboard.mjs` records actual selection, Copy, Paste, reflection and Place actions. It adds explanatory captions and pointer rings, then checks the saved geometry and shared endpoint counts before encoding the GIFs. `frame-lab-copy-repeat.gif` shows one Copy and two Pastes joined at their outer nodes; `frame-lab-paste-mirrored.gif` shows a reflected asymmetric frame joined to the original. Frames use local temporary directories, and the GIFs loop at four frames per second.

Screenshots committed to the repository belong in `docs/images/`; the root `screenshots/` directory is ignored and used for local artifacts.

## Host the production build

Bar Lab is a static site. Upload the **contents** of `public_html/` to a static web host that serves `index.html`, JavaScript, CSS, fonts, icons, the manifest, and `sw.js` with standard MIME types. HTTPS is required for service workers and offline PWA features. Relative asset URLs allow hosting at a domain root or a URL subdirectory. Node.js is needed to build the site, not on the production web server.

The repository includes `scripts/deploy.ps1` for PowerShell and `scripts/deploy.sh` for Linux or Ubuntu in WSL2. Both build and publish to a configured SSH/SCP server. Copy `scripts/deploy.local.example.json` to the ignored `scripts/deploy.local.json` and fill in the server settings; never commit local credentials or deployment configuration. Run `./scripts/deploy.ps1` in PowerShell or `bash scripts/deploy.sh` in Bash. Both require Node.js/npm and OpenSSH `scp` and `ssh`. Public hosting setup is separate from using the app at [barlab.jakubreiter.pl](https://barlab.jakubreiter.pl/).
