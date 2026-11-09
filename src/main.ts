import { setupUpdates } from './updates';
import { toCentered } from './coordinates';

import './style.css';
import branding from './branding.json' with { type: 'json' };

import { translateNodes, translateNodesPreview, key, drawingEndpoint, addMember, PROFILES, ROPE_PRICE, projectCost, MAX_LENGTH, GAME_VERSION, emptyProject, resizeProject, toggleNode, boundary, cloneProject, exportProject, fromKey, History, importProject, projectChecksumWarning, inside, nodes, type BeamProfile, type JointType, type Material, type Member, type Point, type Project } from './model';

import { example, exampleNames, starterProject, type Example } from './examples';

import { Renderer, type Tool } from './renderer';

import { copySelection, pastedSelection, selectionNodes, selectionContains, translatedSelection, memberSelected, rectangleSelection, removeSelection, selectionKey, type Selection } from './selection';

import { fragmentPreview, pasteFragment, transformFragment, type Fragment, type FragmentPlacement } from './fragment';

import type { Frame, PhysicsMember, SoundEvent, StressBed } from './physics';
import { SoundEngine } from './sound';
import { SOLVERS, type Solver } from './solver-strategies';

const PROJECT_STORAGE_KEY = 'bar-lab:last-project:v1';
const SEEN_VERSION_KEY = 'bar-lab:seen-version:v1';
const CLEAR_IN_APP_KEY = 'bar-lab:clear-in-app:v1';
const CLEAR_IN_BROWSER_KEY = 'bar-lab:clear-in-browser:v1';
const COPYRIGHT = branding.copyright;
const BASE64_CONVERSION_CHUNK_BYTES = 32 * 1024;
let restoreNotice = '';
let shareLinkError = '';
let storageWarningShown = false;
let sharedProjectLoaded = false;
async function loadSavedProject(): Promise<Project> {
  try {
    if (location.hash.startsWith('#project=')) {
      let shared: { project: Project; warning: string | null } | null = null;
      try {
        shared = await decodeShareProject(location.hash.slice('#project='.length));
      } catch (error) {
        historyReplaceWithoutShareHash();
        shareLinkError = (error as Error).message;
        return emptyProject();
      }
      if (shared) {
        historyReplaceWithoutShareHash();
        if (shared.warning && !confirmChecksumWarning(shared.warning)) restoreNotice = 'Opening the shared project was canceled.';
        else {
          sharedProjectLoaded = true;
          restoreNotice = shared.warning ? 'Shared project opened after accepting the checksum warning.' : 'Shared project loaded as a local copy.';
          return shared.project;
        }
      }
    }
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (saved === null) return starterProject();
    const project = importProject(saved);
    const warning = projectChecksumWarning(saved);
    if (warning && !confirmChecksumWarning(warning)) {
      restoreNotice = 'Opening the saved project was canceled.';
      return starterProject();
    }
    if (warning) restoreNotice = 'Saved project opened after accepting the checksum warning.';
    return project;
  } catch {
    restoreNotice = 'Saved project could not be restored. The starter project is open.';
    return starterProject();
  }
}

async function decodeShareProject(encoded: string): Promise<{ project: Project; warning: string | null }> {
  if (!encoded || encoded.length > 1_500_000) throw new Error('The project link is empty or too large.');
  // The z: marker identifies the current compressed link format, so obsolete uncompressed links are rejected clearly.
  if (!encoded.startsWith('z:')) throw new Error('Unsupported project link format. Create a new share link from the current version.');
  const checksumSeparator = encoded.lastIndexOf('.');
  // A CRC-32 is written as exactly eight lowercase hexadecimal digits (four bytes, two digits per byte).
  if (checksumSeparator < 3 || !/^[0-9a-f]{8}$/.test(encoded.slice(checksumSeparator + 1))) {
    throw new Error('Project link is missing its checksum or has an unsupported format.');
  }
  const payload = encoded.slice(0, checksumSeparator);
  // Check the URL-safe payload before decoding or inflating it, so damaged links fail early and cheaply.
  if (checksumSharePayload(payload) !== encoded.slice(checksumSeparator + 1)) {
    throw new Error('Project link checksum does not match. The link may be incomplete or changed; the project was not opened.');
  }
  const token = payload.slice(2);
  // Base64 decoding recovers the compressed bytes; decompression below turns them back into project JSON.
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  let bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed project links. Open the project in a recent browser.');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 1024 * 1024) { await reader.cancel(); throw new Error('Decompressed project text is larger than 1 MiB.'); }
    chunks.push(value);
  }
  bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { project: importProject(text), warning: projectChecksumWarning(text) };
}

function confirmChecksumWarning(warning: string): boolean {
  return window.confirm(`WARNING: The project checksum is invalid. ${warning}\n\nOpen this project anyway? Select Cancel to stop opening it.`);
}

function historyReplaceWithoutShareHash(): void {
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
}

async function encodeShareProject(project: Project): Promise<string> {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot create compressed project links. Copy the project text instead.');
  const source = new TextEncoder().encode(exportProject(project));
  if (source.length > 1024 * 1024) throw new Error('This project is too large to share in a link. Copy the project text instead.');
  // Compress the JSON first because Base64 makes binary data larger, not smaller.
  const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('deflate'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  // Encode manageable chunks to avoid exceeding the argument limit of String.fromCharCode.
  for (let i = 0; i < bytes.length; i += BASE64_CONVERSION_CHUNK_BYTES) binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CONVERSION_CHUNK_BYTES));
  // Convert compressed bytes to URL-safe Base64, then append a CRC so truncation or accidental edits are noticed.
  const payload = `z:${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  return `${payload}.${checksumSharePayload(payload)}`;
}

function checksumSharePayload(payload: string): string {
  // CRC-32 folds each UTF-8 byte into a 32-bit state using the standard reflected polynomial;
  // this compact check catches common link damage before the more expensive decompression step.
  // 0xedb88320 is the reflected bit-order form of the standard IEEE CRC-32 polynomial (0x04c11db7).
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

const paths: Record<string, string> = {

  // The compact tower keeps the icon's tapered legs, platforms, and open arch readable in the header.
  logo: '<path d="M12 2v2M12 4 4.5 21M12 4 19.5 21M8.1 21c.6-2.6 1.9-4 3.9-4s3.3 1.4 3.9 4M9.4 9h5.2M7.6 13.5h8.8M5.8 17h12.4M9.4 9l7 4.5m-1.8-4.5-7 4.5"/>',

  beam: '<path d="m5 19 14-14M3 17l4 4M17 3l4 4"/><circle cx="5" cy="19" r="1"/><circle cx="19" cy="5" r="1"/>',

  rope: '<path d="M4 5c0 17 16 17 16 0"/><circle cx="4" cy="5" r="1.5"/><circle cx="20" cy="5" r="1.5"/>',

  select: '<path d="m5 3 14 9-7 1-3 7z"/>',

  erase: '<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H8l-4-4a2 2 0 0 1 0-3zM8 9l8 8M12 20h9"/>',

  undo: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',

  redo: '<path d="m16 4 5 5-5 5m5-5H10a6 6 0 0 0 0 12"/>',

  play: '<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',

  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',

  stopSquare: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',

  stop: '<path d="m9 4-6 6 6 6M3 10h10a7 7 0 0 1 7 7"/>',

  code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',

  down: '<path d="m7 10 5 5 5-5"/>',

  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',

  rigidJoint: '<path d="M3 12h6m6 0h6M12 3v6"/><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none"/>',

  hingeJoint: '<path d="M3 12h5m8 0h5M12 3v5"/><circle cx="12" cy="12" r="4"/>',

  stress: '<path d="M4 12h16M4 9v6m16-6v6M8 4v4m-2-2 2 2 2-2M16 20v-4m-2 2 2-2 2 2"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/>',
  soundOff: '<path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6"/>',

  folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',

  settings: '<path d="M10 2h4l.6 2.3 1.8.8 2.1-1.2 2.8 2.8-1.2 2.1.8 1.8 2.3.6v4l-2.3.6-.8 1.8 1.2 2.1-2.8 2.8-2.1-1.2-1.8.8L14 22h-4l-.6-2.3-1.8-.8-2.1 1.2-2.8-2.8 1.2-2.1-.8-1.8L1 14v-4l2.3-.6.8-1.8-1.2-2.1 2.8-2.8 2.1 1.2 1.8-.8z"/><circle cx="12" cy="12" r="3"/>',

  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8"/>',

  close: '<path d="m6 6 12 12M6 18 18 6"/>',

  paste: '<path d="M8 5H5v16h14V5h-3"/><rect x="8" y="2" width="8" height="5" rx="1"/><path d="M8 11h8M8 15h8"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',

  check: '<path d="m5 12 4 4 10-10"/>',

  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',

  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',

  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M4 13c0 10 16 10 16 0M2 15l2-3 3 2m10 0 3-2 2 3"/>',

  bolt: '<path d="m13 2-8 12h6l-1 8 9-13h-6z"/>',

};

const icon = (name: string, extra = '') => `<svg ${extra} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;

const $ = <T extends HTMLElement>(id: string): T => {

  const element = document.getElementById(id);

  if (!element) throw new Error(`Required interface element is missing: ${id}`);

  return element as T;

};

// Draw thumbnails from the actual example geometry so previews stay in sync.
function exampleThumbnail(name: Example): string {
  const project = example(name);
  const [width, height] = project.size;
  const scale = Math.min(136 / width, 76 / height);
  const left = (160 - width * scale) / 2, top = (100 - height * scale) / 2;
  const segment = ([x1, y1, x2, y2]: Member) => `${left + x1 * scale},${top + y1 * scale} ${left + x2 * scale},${top + y2 * scale}`;
  const grid = Array.from({ length: 5 }, (_, i) => `<path d="M${left + width * scale * i / 4} ${top}v${height * scale} M${left} ${top + height * scale * i / 4}h${width * scale}"/>`).join('');
  const lines = (members: Member[]) => members.map(member => `<polyline points="${segment(member)}"/>`).join('');
  return `<svg viewBox="0 0 160 100" aria-hidden="true" focusable="false"><rect x="${left}" y="${top}" width="${width * scale}" height="${height * scale}" class="example-board"/><g class="example-grid">${grid}</g><g class="example-beams">${lines(project.beams.map(beam => beam.endpoints))}</g><g class="example-ropes">${lines(project.ropes)}</g></svg>`;
}
const exampleChoices: Example[] = ['bridge', 'eiffel', 'goldenGate', 'sydneyHarbour', 'blank'];
const solverChoices = Object.entries(SOLVERS).map(([id, name]) => `<label class="solver-option"><input type="radio" name="solver" value="${id}" ${id === 'serpentine' ? 'checked' : ''}><span>${name}</span></label>`).join('');

$('app').innerHTML = `

<header class="header"><a class="brand" href="./" aria-label="Bar Lab home"><span class="brand-symbol">${icon('logo')}</span><span>bar<span class="brand-light">lab</span><span class="brand-dot">.</span></span></a><div class="header-divider"></div><span class="brand-note">A structural playground</span><div class="header-spacer"></div></header>

<main class="workbench">

<section class="stage" aria-label="Construction workspace"><canvas id="canvas" tabindex="0" aria-label="Construction canvas. Choose Beam or Rope, then two grid points. Double-click a node to toggle its connection. Ctrl+click to select. In Select, drag empty space for a selection box, or drag a selected element or its endpoint to move the group. Drag an unselected node or beam to clear the group and move that object. Copy and Paste duplicate a selection; placement controls can flip either axis. Drag from an existing node in Beam or Rope to build. Beams: 6 units; ropes: 10 units."></canvas>



<aside id="inspector" class="inspector"><div class="inspector-heading"><span class="eyebrow" id="inspector-eyebrow">THE IDEA IS SIMPLE</span><button id="hide-inspector" class="mini-button" aria-label="Hide tips">${icon('minus')}</button></div><h1 id="inspector-title">Build. Test.<br>Try again.</h1><p id="inspector-copy">A few beams. A little gravity.<br>See what holds together.</p><div class="inspector-rule"></div><div id="inspector-body"><div class="material-row"><span class="material-swatch beam-swatch"></span><span>Steel beams</span><strong id="beam-count">0</strong></div><div class="material-row"><span class="material-swatch rope-swatch"></span><span>Steel ropes</span><strong id="rope-count">0</strong></div><div class="inspector-note">${icon('anchor')}Orange markers are fixed supports.</div></div><div id="cost-breakdown" class="cost-breakdown"></div><div id="selected-profile" hidden><span class="field-label">Beam profile</span><div class="segmented"><button data-change-profile="l">Light</button><button data-change-profile="s">Standard</button><button data-change-profile="h">Heavy</button></div></div><div id="node-controls" hidden><span class="field-label">Connection</span><div class="segmented"><button data-node="x">Rigid</button><button data-node="o">Hinge</button></div><div id="anchor-controls"><span class="field-label">Boundary support</span><div class="segmented"><button data-anchor="x">Fixed</button><button data-anchor="o">Pinned</button></div></div></div><button id="delete-selection" class="delete-button" hidden>${icon('trash')}Delete selection</button></aside>

<div id="stress-legend" class="stress-legend" hidden><span>RELATIVE STRESS</span><div></div><p><span>Relaxed</span><span>At limit</span></p></div>

<div class="zoom-controls"><button id="zoom-in" aria-label="Zoom in" title="Zoom in">${icon('plus')}</button><span id="zoom-value">100%</span><button id="zoom-out" aria-label="Zoom out" title="Zoom out">${icon('minus')}</button><span class="zoom-divider"></span><button id="fit" aria-label="Fit canvas" title="Fit canvas">${icon('fit')}</button></div>

<div class="canvas-note"><span class="coordinate" id="coordinate">X — &nbsp; Y —</span><span>1 square = 1 unit · Y ↑</span></div>

<div class="toolbar-wrap"><div id="paste-actions" class="paste-actions" role="group" aria-label="Paste placement" hidden><button id="paste-flip-x" class="outline-button" aria-pressed="false">Flip left–right</button><button id="paste-flip-y" class="outline-button" aria-pressed="false">Flip up–down</button><button id="paste-place" class="primary-button">Place</button><button id="paste-cancel" class="outline-button">Cancel</button></div><div id="touch-actions" class="touch-actions" hidden><button id="cancel-draw" class="outline-button">Cancel</button></div><div id="profile-picker" class="profile-picker" role="group" aria-label="Beam profile" hidden><span>Beam profile</span><button data-profile="l">${icon('beam')}<span>Light (L)</span></button><button data-profile="s" class="active">${icon('beam')}<span>Standard (S)</span></button><button data-profile="h">${icon('beam')}<span>Heavy (H)</span></button><span id="material-rate">8 cr / unit</span></div><div class="toolbar" role="toolbar" aria-label="Construction tools"><button data-tool="select" title="Select (V)" aria-label="Select">${icon('select')}<span>Select</span><kbd>V</kbd></button><span class="tool-divider"></span><button data-tool="beam" class="active" title="Beam (B) — hold or press Down arrow to choose profile" aria-label="Beam — hold or press Down arrow to choose profile" aria-haspopup="true" aria-expanded="false">${icon('beam')}<span>Beam <small id="beam-profile-indicator">S</small></span><kbd>B</kbd></button><button data-tool="rope" title="Rope (R)" aria-label="Rope">${icon('rope')}<span>Rope</span><kbd>R</kbd></button><button data-tool="erase" title="Erase (E)" aria-label="Erase">${icon('erase')}<span>Erase</span><kbd>E</kbd></button><span class="tool-divider"></span><div class="joint-choice" role="group" aria-label="New node connection type"><button data-joint="x" class="active" title="Rigid connections" aria-label="Rigid connections">${icon('rigidJoint')}</button><button data-joint="o" title="Hinge connections" aria-label="Hinge connections">${icon('hingeJoint')}</button></div><button id="copy-selection" class="icon-button" title="Copy selection (Ctrl/⌘ C)" aria-label="Copy selection">${icon('copy')}</button><button id="paste-selection" class="icon-button" title="Paste selection (Ctrl/⌘ V)" aria-label="Paste selection">${icon('paste')}</button><button id="guide" class="icon-button" aria-label="Info" title="Info">${icon('info')}</button><button id="undo" class="icon-button" title="Undo (Ctrl/⌘ Z)" aria-label="Undo">${icon('undo')}</button><button id="redo" class="icon-button" title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo">${icon('redo')}</button><button id="settings" class="icon-button" title="Settings" aria-label="Settings" aria-haspopup="dialog" aria-controls="settings-dialog">${icon('settings')}</button><button id="clear-canvas" class="icon-button" title="Clear the canvas (can be undone)" aria-label="Clear canvas">${icon('trash')}</button><button id="examples" class="icon-button" aria-label="Load an example" title="Load an example" aria-haspopup="dialog">${icon('folder')}</button><button id="project-text" class="outline-button" aria-label="Project text" title="Project text">${icon('code')}<span>Project text</span></button><button id="run" class="icon-button" aria-label="Run simulation" title="Run simulation (Space)">${icon('play')}</button><button id="sound" class="sound-control" type="button" aria-label="Mute sounds" aria-pressed="true" title="Mute sounds"></button><button id="stress" class="stress-control" type="button" aria-label="Show stress" title="Show stress" aria-pressed="false">${icon('stress')}</button></div><div class="toolbar-caption" id="hint">Choose a start point, then an endpoint. <span>Beams: 6 · Ropes: 10 units.</span></div></div>

<div id="simulation-controls" class="simulation-controls" hidden><button id="pause" class="outline-button" aria-label="Pause simulation" title="Pause simulation">${icon('pause')}</button><button id="back" class="primary-button" aria-label="Stop simulation and return to build" title="Stop simulation and return to build">${icon('stopSquare')}</button></div>

<div id="toast" role="status" aria-live="polite"></div>

</section><div class="status-bar"><strong id="total-cost" class="cost-total">Cost: 0 cr</strong><div class="status-message"><span class="status-dot"></span><span id="status">${COPYRIGHT}</span></div><div class="status-right"><span id="performance"></span><span id="board-size">32 × 18 GRID</span><button id="install-app" type="button" title="Install Bar Lab on this device">Install app</button><button type="button" class="version" aria-label="App version information">v${GAME_VERSION}</button></div></div></main>

<dialog id="examples-dialog" class="examples-dialog" aria-labelledby="examples-title"><div class="dialog-heading"><h2 id="examples-title">Load an example</h2><button id="close-examples" class="icon-button" aria-label="Close examples">${icon('close')}</button></div><div class="examples-grid">${exampleChoices.map(name => `<button class="example-card" data-example="${name}">${exampleThumbnail(name)}<span>${exampleNames[name]}</span></button>`).join('')}</div></dialog>

<dialog id="settings-dialog" class="settings-dialog" aria-labelledby="settings-title"><div class="dialog-heading"><div><span class="eyebrow">WORKSPACE SETTINGS</span><h2 id="settings-title">Settings</h2></div><button id="close-settings" type="button" class="icon-button" aria-label="Close settings">${icon('close')}</button></div><fieldset class="solver-options"><legend>Simulation solver</legend><p>Choose how the simulation visits and evaluates the structure.</p><div class="solver-options-list">${solverChoices}</div><p>Serpentine randomly chooses its starting side for each run.</p></fieldset><section class="canvas-settings" aria-labelledby="canvas-size-title"><h3 id="canvas-size-title">Canvas size</h3><p>Choose an even width from 12 to 64 and height from 8 to 40 grid squares. Existing elements keep their grid positions.</p><form id="canvas-size-form" novalidate><div class="size-fields"><label>Width <span>(12-64, even)</span><input id="canvas-width" type="number" inputmode="numeric" min="12" max="64" step="2" required></label><label>Height <span>(8-40, even)</span><input id="canvas-height" type="number" inputmode="numeric" min="8" max="40" step="2" required></label></div><p id="canvas-size-error" class="error-message" role="alert"></p><div class="dialog-footer"><span>Squares - 1 unit each</span><button type="submit" class="primary-button">Apply size</button></div></form></section></dialog><dialog id="text-dialog"><div class="dialog-heading"><div><span class="eyebrow">TAKE YOUR IDEAS WITH YOU</span><h2>Project text</h2></div><button id="close-text" class="icon-button" aria-label="Close project text">${icon('close')}</button></div><p>Copy this project, or paste one to rebuild it. Coordinates start at the center; positive Y points up. Uses metadata and objects sections. Board width: 12–64; height: 8–40, even numbers only.</p><label class="sr-only" for="project-json">Project JSON</label><textarea id="project-json" spellcheck="false" autocomplete="off"></textarea><p id="import-error" class="error-message" role="alert"></p><div class="dialog-footer"><span>JSON · format 3 · origin at center</span><div><button id="copy" class="outline-button">${icon('copy')}Copy</button><button id="share-link" class="outline-button">Share link</button><button id="load" class="primary-button">Load project${icon('check')}</button></div></div></dialog>

<dialog id="guide-dialog" class="info-dialog" aria-labelledby="info-title"><div class="dialog-heading"><div><span class="eyebrow">FRAME LAB</span><h2 id="info-title">Info</h2></div><button id="close-guide" class="icon-button" aria-label="Close info">${icon('close')}</button></div><p>Build structures with beams and ropes, then run a simulation to see how they respond to gravity. Use Select to move and edit elements, Undo to reverse changes, and Project text to save or share a design.</p><p><a href="./user-guide.html">Read the user guide</a></p><div class="info-copyright">${COPYRIGHT}</div></dialog>`;

try {
  const previousVersion = sessionStorage.getItem(SEEN_VERSION_KEY) ?? localStorage.getItem(SEEN_VERSION_KEY);
  sessionStorage.setItem(SEEN_VERSION_KEY, GAME_VERSION);
  localStorage.setItem(SEEN_VERSION_KEY, GAME_VERSION);
  if (previousVersion !== GAME_VERSION && (previousVersion !== null || navigator.serviceWorker?.controller)) {
    const versionLabel = document.querySelector<HTMLElement>('.status-bar .version')!;
    versionLabel.classList.add('version-highlight');
    setTimeout(() => versionLabel.classList.remove('version-highlight'), 5000);
  }
} catch { /* Storage is optional; the version stays readable without the highlight. */ }

const installDialog = document.createElement('dialog');
installDialog.id = 'install-dialog';
installDialog.innerHTML = `<div class="dialog-heading"><h2>Install Bar Lab</h2><button id="close-install" class="icon-button" aria-label="Close install help">${icon('close')}</button></div><p id="install-help"></p><div class="dialog-footer"><span>Available offline after game files are ready.</span><div><button id="dismiss-install" class="primary-button">Got it</button></div></div>`;
document.body.append(installDialog);
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let installPrompt: InstallPromptEvent | null = null;
const installButton = $<HTMLButtonElement>('install-app');
const installReminder = document.createElement('div');
installReminder.id = 'install-reminder';
installReminder.hidden = true;
installReminder.innerHTML = `<p>Install Bar Lab for a more convenient, full-screen way to play—even offline once game files are ready.</p><button id="dismiss-install-reminder" type="button" aria-label="Dismiss install reminder">${icon('close')}</button>`;
document.body.append(installReminder);
const readClearCount = (key: string): number => {
  const value = Number(localStorage.getItem(key));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};
let clearCountsAvailable = true;
let clearInApp = 0;
try {
  clearInApp = readClearCount(CLEAR_IN_APP_KEY);
} catch { clearCountsAvailable = false; }
const hideInstallReminder = () => { installReminder.hidden = true; };
const positionInstallReminder = () => {
  if (installReminder.hidden) return;
  // The reminder sits above the version panel, whose bottom edge follows the status bar.
  const versionPanel = document.querySelector<HTMLElement>('#version-panel');
  const anchor = installButton.getBoundingClientRect();
  const updateButton = document.querySelector<HTMLButtonElement>('#update-app');
  const top = versionPanel && !versionPanel.hidden ? Math.min(anchor.top, versionPanel.getBoundingClientRect().top) : updateButton && !updateButton.hidden ? Math.min(anchor.top, updateButton.getBoundingClientRect().top) : anchor.top;
  const width = installReminder.offsetWidth;
  installReminder.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.right - width))}px`;
  installReminder.style.bottom = `${Math.max(8, innerHeight - top + 9)}px`;
};
$('dismiss-install-reminder').onclick = hideInstallReminder;
window.addEventListener('resize', positionInstallReminder);
window.addEventListener('scroll', positionInstallReminder, true);
const ua = navigator.userAgent;
const appleMobile = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const android = /Android/i.test(ua);
const iosSafari = appleMobile && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
const iosChrome = appleMobile && /CriOS/i.test(ua) && (() => {
  const version = /OS (\d+)_(\d+)/i.exec(ua);
  return version !== null && (Number(version[1]) > 16 || (Number(version[1]) === 16 && Number(version[2]) >= 4));
})();
const desktopChrome = !appleMobile && !android && /Chrome|Chromium/i.test(ua) && !/Edg|OPR|SamsungBrowser/i.test(ua);
const desktopEdge = !appleMobile && !android && /Edg\//i.test(ua);
const androidChrome = android && /Chrome/i.test(ua) && !/EdgA|OPR|SamsungBrowser/i.test(ua);
const supportedInstallBrowser = iosSafari || iosChrome || desktopChrome || desktopEdge || androidChrome;
let appInstalled = false;
const installedMode = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const updateInstallButton = () => {
  installButton.hidden = appInstalled || installedMode() || !isSecureContext || !('serviceWorker' in navigator) || !('caches' in window) || !(supportedInstallBrowser || installPrompt);
  if (installButton.hidden || clearInApp > 0) hideInstallReminder();
  else positionInstallReminder();
};
type RelatedAppNavigator = Navigator & { getInstalledRelatedApps?: () => Promise<Array<{ platform: string; id?: string }>> };
let installationCheck = 0;
const checkInstalledApp = async () => {
  const getInstalledRelatedApps = (navigator as RelatedAppNavigator).getInstalledRelatedApps;
  if (!getInstalledRelatedApps || appInstalled || installedMode()) return;
  const check = ++installationCheck;
  try {
    const apps = await getInstalledRelatedApps.call(navigator);
    if (check === installationCheck && apps.some(app => app.platform === 'webapp')) {
      appInstalled = true;
      updateInstallButton();
    }
  } catch { /* This optional API is unavailable in some browsers and contexts. */ }
};
const recordClear = async () => {
  if (!clearCountsAvailable) return;
  const inApp = installedMode();
  const key = inApp ? CLEAR_IN_APP_KEY : CLEAR_IN_BROWSER_KEY;
  try {
    const count = readClearCount(key) + 1;
    localStorage.setItem(key, String(count));
    if (inApp) {
      clearInApp = count;
      hideInstallReminder();
      return;
    }
    clearInApp = readClearCount(CLEAR_IN_APP_KEY);
    if (clearInApp !== 0 || count <= 5 || count % 3 !== 0 || installButton.hidden) return;
    await checkInstalledApp();
    if (clearInApp === 0 && !installButton.hidden && !installedMode()) {
      installReminder.hidden = false;
      positionInstallReminder();
    }
  } catch {
    clearCountsAvailable = false;
    hideInstallReminder();
  }
};
updateInstallButton();
matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButton);
window.addEventListener('focus', () => { void checkInstalledApp(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void checkInstalledApp(); });
window.addEventListener('storage', event => {
  if (event.key !== CLEAR_IN_APP_KEY) return;
  try {
    clearInApp = readClearCount(CLEAR_IN_APP_KEY);
    updateInstallButton();
  } catch { clearCountsAvailable = false; hideInstallReminder(); }
});
void checkInstalledApp();
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event as InstallPromptEvent;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  appInstalled = true;
  updateInstallButton();
  installDialog.close();
});
const closeInstallDialog = () => installDialog.close();
$('close-install').onclick = closeInstallDialog;
$('dismiss-install').onclick = closeInstallDialog;
installButton.onclick = async () => {
  hideInstallReminder();
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') return;
    } catch { /* Chrome may withdraw its install offer. Show manual steps below. */ }
  }
  $('install-help').textContent = iosSafari
    ? `In Safari on your ${/iPad/i.test(ua) || navigator.platform === 'MacIntel' ? 'iPad' : 'iPhone'}, tap Share, then “Add to Home Screen” and Add. Open the new icon once while online and wait for the offline-ready message.`
    : iosChrome
      ? 'In Chrome, tap Share beside the address bar, then “Add to Home Screen” and Add. Open the new icon once while online and wait for the offline-ready message.'
      : androidChrome
        ? 'In Chrome, open the three-dot menu and choose “Install app” under “Install app or create shortcut”. If Install is unavailable, reopen this page while online and wait for the game files to finish loading.'
        : desktopEdge
          ? 'In Microsoft Edge, open the three-dot menu, then choose “More tools” → “Apps” → “Install this site as an app”.'
          : 'In Chrome, use the Install icon at the right side of the address bar or open the three-dot menu and choose “Cast, save, and share” → “Install page as app”. If installation is unavailable, reopen this page while online.';
  installDialog.showModal();
};

// Place persistent tools around the drawing surface; temporary paste controls
// overlay it without changing the canvas size during a placement.
const stage = document.querySelector<HTMLElement>('.stage')!;
const drawingArea = document.createElement('div'); drawingArea.className = 'drawing-area';
const controls = document.createElement('div'); controls.className = 'workspace-controls';
const rightControls = document.createElement('div'); rightControls.className = 'right-controls';
const splitControls = matchMedia('(orientation:landscape) and (max-height:500px) and (max-width:900px) and (hover:none) and (pointer:coarse)');
const toolbar = document.querySelector<HTMLElement>('.toolbar-wrap')!;
toolbar.insertBefore($('touch-actions'), document.querySelector('.toolbar')!.nextSibling);
const statusBar = document.querySelector<HTMLElement>('.status-bar')!;
const counts = document.createElement('div'); counts.className = 'material-counts';
counts.append(...Array.from(document.querySelectorAll<HTMLElement>('#inspector-body .material-row')));
statusBar.prepend(counts);
statusBar.querySelector('div:not(.material-counts)')!.append($('hint'));
statusBar.querySelector('.status-right')!.prepend(document.querySelector('.canvas-note')!);
const mobileZoom = document.createElement('span'); mobileZoom.id = 'mobile-zoom'; mobileZoom.textContent = '100%'; mobileZoom.setAttribute('aria-label', 'Zoom level');
statusBar.insertBefore(mobileZoom, statusBar.querySelector('.status-right'));
drawingArea.append($('canvas'), $('inspector'), $('paste-actions'));
controls.append(toolbar, $('simulation-controls'), document.querySelector('.zoom-controls')!);
statusBar.append($('stress-legend'));
stage.prepend(controls, drawingArea, rightControls);
document.body.append($('profile-picker'));
const runButton = $<HTMLButtonElement>('run');
$('hide-inspector').setAttribute('aria-label', 'Close selection properties');

const canvas = $<HTMLCanvasElement>('canvas'), renderer = new Renderer(canvas), history = new History(await loadSavedProject()), sound = new SoundEngine();

let profile: BeamProfile = 's';

let cost = projectCost(history.project);

let tool: Tool = 'beam', joint: JointType = 'x', cursor: Point | null = null, start: Point | null = null, selected: Selection[] = [];

let frame: Frame | null = null, members: PhysicsMember[] = [], worker: Worker | null = null, running = false, paused = false, busy = false, touch = false;
// Serpentine has no direction history.
let solver: Solver = 'serpentine';

let stress = false, recycled: { positions: ArrayBuffer; stresses: ArrayBuffer; broken: ArrayBuffer } | undefined, elapsed = 0, needsDraw = true, previewAnimating = false;

let toastTimer: ReturnType<typeof setTimeout>, lastName = 'Warren bridge';

let fps = 60, frames = 0, fpsStart = performance.now(), lastTime = performance.now(), lastStats = 0;

function notify(message: string): void { const el = $('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3500); }

function saveProject(): void {
  try { localStorage.setItem(PROJECT_STORAGE_KEY, exportProject(history.project)); }
  catch {
    if (!storageWarningShown) notify('This browser could not save the project. Copy its project text as a backup.');
    storageWarningShown = true;
  }
}

function recordProject(project: Project): void { history.commit(project); saveProject(); }

function invalidate(): void { needsDraw = true; }

function refreshUI(): void {

  const p = history.project;

  cost = projectCost(p);

  $('total-cost').textContent = `Cost: ${cost.total} cr`;

  $('cost-breakdown').innerHTML = Object.entries(cost.breakdown).filter(([, value]) => value > 0).map(([type, value]) => `<div><span>${type === 'r' ? 'Rope' : PROFILES[type as BeamProfile].name}</span><strong>${value} cr</strong></div>`).join('');

  if (running) closeProfilePicker();
  runButton.dataset.solver = solver;
  runButton.title = `Run simulation (Space) — ${SOLVERS[solver]}`;
  document.querySelectorAll<HTMLInputElement>('#settings-dialog input[name="solver"]').forEach(input => { input.checked = input.value === solver; });

  $('beam-profile-indicator').textContent = profile.toUpperCase();
  const beamButton = document.querySelector<HTMLButtonElement>('[data-tool="beam"]')!;
  beamButton.dataset.profile = profile;
  beamButton.title = `Beam: ${PROFILES[profile].name} (B) — hold or press Down arrow to choose profile`;
  beamButton.setAttribute('aria-label', beamButton.title);

  $('material-rate').textContent = `${PROFILES[profile].price} cr / unit`;

  document.querySelectorAll<HTMLButtonElement>('#profile-picker [data-profile]').forEach(b => { b.classList.toggle('active', b.dataset.profile === profile); b.setAttribute('aria-pressed', String(b.dataset.profile === profile)); });

  $('beam-count').textContent = String(p.beams.length); $('rope-count').textContent = String(p.ropes.length); $('board-size').textContent = `${p.size[0]} × ${p.size[1]} GRID`;

  $<HTMLButtonElement>('undo').disabled = running || !history.canUndo; $<HTMLButtonElement>('redo').disabled = running || !history.canRedo;

  $<HTMLButtonElement>('examples').disabled = running;

  $<HTMLButtonElement>('settings').disabled = running;

  $<HTMLButtonElement>('clear-canvas').disabled = !p.beams.length && !p.ropes.length;


  const focusedControl = document.activeElement;
  // Restore the common layout before applying the current simulation and screen state.
  const editingToolbar = document.querySelector<HTMLElement>('.toolbar')!;
  if ($('run').parentElement !== editingToolbar) editingToolbar.append($('run'));
  if ($('undo').parentElement !== editingToolbar) {
    editingToolbar.insertBefore($('undo'), $('settings'));
    editingToolbar.insertBefore($('redo'), $('settings'));
  }
  if ($('pause').parentElement !== $('simulation-controls')) $('simulation-controls').append($('pause'), $('back'));
  const zoomControls = document.querySelector<HTMLElement>('.zoom-controls')!;
  if ($('fit').parentElement !== zoomControls) zoomControls.append($('fit'));
  const guideContainer = running ? $('simulation-controls') : editingToolbar;
  if ($('guide').parentElement !== guideContainer) {
    if (running) guideContainer.prepend($('guide'));
    else editingToolbar.insertBefore($('guide'), $('settings'));
  }
  if ($('project-text').parentElement !== editingToolbar) editingToolbar.insertBefore($('project-text'), $('run'));
  const stressContainer = running ? $('simulation-controls') : editingToolbar;
  if ($('stress').parentElement !== stressContainer) stressContainer.append($('stress'));
  if ($('sound').parentElement !== stressContainer) stressContainer.insertBefore($('sound'), $('stress'));
  const focusSimulation = running && focusedControl === $('run');
  const focusRun = !running && (focusedControl === $('pause') || focusedControl === $('back')); 
  $('run').hidden = running;
  document.querySelector('.toolbar-wrap')!.classList.toggle('hidden', running); $('simulation-controls').hidden = !running;
  rightControls.hidden = !splitControls.matches;
  if (splitControls.matches) {
    if (running) rightControls.append($('pause'), $('back'));
    else rightControls.append($('undo'), $('redo'), $('project-text'), $('run'));
    rightControls.append($('sound'), $('stress'), $('fit'));
  }
  if (focusSimulation) $('pause').focus();
  if (focusRun) $('run').focus();
  else if (!focusSimulation && focusedControl instanceof HTMLElement && focusedControl.isConnected && document.activeElement !== focusedControl && focusedControl.getClientRects().length) focusedControl.focus();

  $('pause').innerHTML = icon(paused ? 'play' : 'pause');
  $('pause').setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
  $('pause').title = paused ? 'Resume simulation' : 'Pause simulation';
  $('back').classList.toggle('simulation-active', running && !paused);

  $<HTMLButtonElement>('copy-selection').disabled = running || !!pasteState || !copySelection(p,selected);
  $<HTMLButtonElement>('paste-selection').disabled = running || !clipboardFragment;
  $('paste-actions').hidden = !pasteState;

  $('touch-actions').hidden = running || !start || dragStarted || gestureUsed;

  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => { b.classList.toggle('active', b.dataset.tool === tool); b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); });

  document.querySelectorAll<HTMLButtonElement>('[data-joint]').forEach(b => { b.classList.toggle('active', b.dataset.joint === joint); b.setAttribute('aria-pressed', String(b.dataset.joint === joint)); });

  $('stress-legend').hidden = !stress;
  $('stress').setAttribute('aria-pressed', String(stress));
  $('stress').classList.toggle('active', stress);
  $('sound').setAttribute('aria-pressed', String(sound.enabled));
  $('sound').setAttribute('aria-label', sound.enabled ? 'Mute sounds' : 'Turn on sounds');
  $('sound').title = sound.enabled ? 'Mute sounds' : 'Turn on sounds';
  $('sound').innerHTML = icon(sound.enabled ? 'sound' : 'soundOff');
  $('sound').classList.toggle('active', sound.enabled);

  const allNodes = selected.length > 0 && selected.every(s => 'node' in s);

  const allBeams = selected.length > 0 && selected.every(s => 'material' in s && s.material === 'beam');

  const nodeIds = selected.flatMap(s => 'node' in s ? [s.node] : []);

  const allBoundary = allNodes && nodeIds.every(id => boundary(fromKey(id), p.size));

  const profiles = p.beams.filter(b => memberSelected(selected, 'beam', b.endpoints)).map(b => b.profile);

  const common = <T,>(values: T[]): T | undefined => values.length && values.every(v => v === values[0]) ? values[0] : undefined;

  const selectedProfile = common(profiles);

  const connection = common(nodeIds.map(id => p.joints[id] || 'x'));

  const support = common(nodeIds.map(id => p.anchors[id] || 'x'));

  $('selected-profile').hidden = !allBeams || running;

  $('node-controls').hidden = !allNodes || running;

  $('anchor-controls').hidden = !allBoundary;

  $('delete-selection').hidden = !selected.length || running;
  // Property edits target the committed selection, not the temporary pasted copy.
  document.querySelectorAll<HTMLButtonElement>('#selected-profile button, #node-controls button, #delete-selection').forEach(b => { b.disabled = !!pasteState; });



  $('inspector-eyebrow').textContent = 'YOUR SELECTION';

  if (selected.length) {

    $('inspector-title').textContent = `${selected.length} selected ${selected.length === 1 ? 'element' : 'elements'}`;

    let description = allBeams ? `Beam profile: ${selectedProfile ? PROFILES[selectedProfile].name : 'Mixed'}.` : allNodes ? `Connection: ${connection === undefined ? 'Mixed' : connection === 'x' ? 'Rigid' : 'Hinge'}.` : 'Select only beams or only nodes to change their type.';

    if (allBoundary) { description += ` Support: ${support === undefined ? 'Mixed' : support === 'x' ? 'Fixed' : 'Pinned'}.`; }

    if (selected.length === 1 && 'node' in selected[0]) { const [x,y] = toCentered(fromKey(selected[0].node), p.size); description = `Grid point (${x}, ${y}). ${description}`; }

    $('inspector-copy').textContent = description;

  } else {
    $('inspector-title').textContent = 'No selection';
    $('inspector-copy').textContent = 'Drag empty space in Select to draw a selection box.';
  }

  document.querySelectorAll<HTMLButtonElement>('[data-change-profile]').forEach(b => b.classList.toggle('active', allBeams && b.dataset.changeProfile === selectedProfile));

  document.querySelectorAll<HTMLButtonElement>('[data-node]').forEach(b => b.classList.toggle('active', allNodes && b.dataset.node === connection));

  document.querySelectorAll<HTMLButtonElement>('[data-anchor]').forEach(b => b.classList.toggle('active', allBoundary && b.dataset.anchor === support));

  const inspector = $('inspector');
  const hideInspector = !selected.length || running;
  // Freeze the workspace layout while a pointer gesture is pending or active.
  // Selection controls can update immediately without moving the board under the pointer.
  if (!editDrag && !selectionBox && !pasteState && inspector.hidden !== hideInspector) {
    inspector.hidden = hideInspector;
    renderer.resize(); renderer.camera(p.size);
  }

  $('hint').innerHTML = tool === 'select' ? 'Drag empty space to select; drag selected elements to move the group. <span>Ctrl+click to toggle · Ctrl+drag to add · Shift+drag over elements · Ctrl/⌘ C to copy · Ctrl/⌘ V to paste.</span>' : tool === 'erase' ? 'Click an element to remove it. <span>Ctrl+click to select instead.</span>' : start ? `${dragStarted ? 'Release to place the endpoint.' : 'Choose an endpoint. Click or tap to keep drawing.'} <span>Esc to cancel · Up to ${MAX_LENGTH[tool as Material]} units.</span>` : 'Choose two points, or drag to draw. Continue from each new endpoint.';


  if (pasteState) { $('hint').textContent = 'Position the copy. Click or press Place to confirm; Esc cancels. Flip either axis before placing.'; updatePaste(); }
  invalidate();

}

function commit(p: Project): void { recordProject(p); resetInteraction(); selected = []; lastName = 'Untitled structure'; refreshUI(); }

function chooseTool(next: Tool): void { if (running) return; resetInteraction(); tool = next; start = null; selected = []; refreshUI(); }

function stopSimulation(): void { sound.setSimulationActive(false); worker?.terminate(); worker = null; running = paused = busy = false; frame = null; recycled = undefined; elapsed = 0; members = []; $('status').textContent = 'Original design restored. Try another idea.'; refreshUI(); }

function runSimulation(): void {

  if (running) { stopSimulation(); return; }

  if (!history.project.beams.length && !history.project.ropes.length) { notify('Add a beam or rope first.'); return; }
  sound.setSimulationActive(true);

  // Draw once per Serpentine run, independently of previous runs. Passing the
  // chosen side to the worker keeps the entire trajectory deterministic thereafter.
  const serpentineFromRight = solver === 'serpentine' && Math.random() < 0.5;

  resetInteraction(); selected = []; start = null; cursor = null; running = true; paused = false; busy = true; elapsed = 0;

  try {

    worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });

    worker.onmessage = ({ data }: MessageEvent<{ type: string; frame: Frame; members?: PhysicsMember[]; sounds?: SoundEvent[]; beds?: StressBed[] }>) => {

      if (frame) recycled = { positions: frame.positions.buffer as ArrayBuffer, stresses: frame.stresses.buffer as ArrayBuffer, broken: frame.broken.buffer as ArrayBuffer };

      frame = data.frame; if (data.members) members = data.members; busy = false; invalidate();
      if (!paused && data.sounds) for (const event of data.sounds) sound.playSimulation(event, history.project.size[0]);
      if (!paused && data.beds) sound.updateBeds(data.beds, history.project.size[0]);

    };

    worker.onerror = () => { stopSimulation(); notify('Simulation could not start. Please reload and try again.'); };

    worker.postMessage({ type: 'start', project: history.project, options: { solver, serpentineFromRight } });
    $('status').textContent = `Serpentine${serpentineFromRight ? ' · ↙' : ' · ↘'} · Gravity is doing its thing.`;

  } catch { stopSimulation(); notify('Web Workers are unavailable in this browser.'); }

  refreshUI();

}

function togglePause(): void { if (!running) return; paused = !paused; sound.setSimulationActive(!paused); elapsed = 0; refreshUI(); }

function finishMember(): void {

  if (!start || !cursor || (tool !== 'beam' && tool !== 'rope')) return;

  const end = drawingEndpoint(start, cursor, tool, history.project.size);
  if (end[0] === start[0] && end[1] === start[1]) return;
  try {
    const beamCenterX = (start[0] + end[0]) / (2 * history.project.size[0]);
    const next = addMember(history.project, tool, [...start, ...end], joint, profile);
    const createdNode = !nodes(history.project).has(key(end));
    recordProject(next); start = end; selected = []; lastClick = null; lastName = 'Untitled structure';
    if (tool === 'beam') sound.playEdit('beamPlace', beamCenterX);
    if (createdNode) sound.playEdit('nodeCreate', end[0] / history.project.size[0]);
    $('status').textContent = 'Element added. Choose the next endpoint.'; refreshUI();
  }

  catch (error) { notify((error as Error).message); }

}

function distanceToSegment(pt: Point, m: Member): number { const dx = m[2] - m[0], dy = m[3] - m[1], t = Math.max(0, Math.min(1, ((pt[0] - m[0]) * dx + (pt[1] - m[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(pt[0] - m[0] - t * dx, pt[1] - m[1] - t * dy); }

function hitTest(screen: Point): Selection | null {

  const w = renderer.world(screen), threshold = (touch ? 15 : 9) / renderer.scale;

  for (const [id, p] of nodes(history.project)) if (Math.hypot(w[0] - p[0], w[1] - p[1]) < threshold) return { node: id };

  let best = threshold, hit: Selection | null = null;

  for (const [material, list] of [['beam', history.project.beams.map(b => b.endpoints)], ['rope', history.project.ropes]] as const) list.forEach(m => { const distance = distanceToSegment(w, m); if (distance <= best) { best = distance; hit = { material, endpoints: m }; } });

  return hit;

}

function deleteSelection(): void {

  if (!selected.length || running) return;

  commit(removeSelection(history.project, selected));

}

function changeSelection(kind: 'profile' | 'node' | 'anchor', value: string): void {

  if (running || !selected.length) return;

  const p = cloneProject(history.project);

  if (kind === 'profile') {

    if (!selected.every(s => 'material' in s && s.material === 'beam')) return;

    for (const beam of p.beams) if (memberSelected(selected, 'beam', beam.endpoints)) beam.profile = value as BeamProfile;

  } else {

    if (!selected.every(s => 'node' in s)) return;

    const ids = selected.flatMap(s => 'node' in s ? [s.node] : []);

    if (kind === 'anchor' && !ids.every(id => boundary(fromKey(id), p.size))) return;

    const settings = kind === 'node' ? p.joints : p.anchors;

    for (const id of ids) { if (value === 'x') delete settings[id]; else settings[id] = value as JointType; }

  }

  recordProject(p); lastName = 'Untitled structure'; refreshUI();

}

const contextMenu = document.createElement('div');

contextMenu.id = 'context-menu'; contextMenu.role = 'menu'; contextMenu.hidden = true;

document.body.append(contextMenu);

function closeMenu(): void { const focused = contextMenu.contains(document.activeElement); contextMenu.hidden = true; if (focused) canvas.focus(); }

function openMenu(p: Point): void {

  const hit = hitTest(p); resetInteraction();

  if (!hit) { refreshUI(); return; }

  if (!selected.some(s => selectionKey(s) === selectionKey(hit))) selected = [hit];

  refreshUI(); contextMenu.replaceChildren();

  const add = (label: string, action: () => void) => {

    const button = document.createElement('button'); button.role = 'menuitem'; button.textContent = label;

    button.onclick = () => { action(); closeMenu(); }; contextMenu.append(button);

  };

  if (selected.every(s => 'material' in s && s.material === 'beam')) for (const value of ['l', 's', 'h'] as const) add(`${PROFILES[value].name} beam`, () => changeSelection('profile', value));

  if (selected.every(s => 'node' in s)) {

    add('Rigid connection', () => changeSelection('node', 'x')); add('Hinge connection', () => changeSelection('node', 'o'));

    if (selected.every(s => 'node' in s && boundary(fromKey(s.node), history.project.size))) {

      add('Fixed support', () => changeSelection('anchor', 'x')); add('Pinned support', () => changeSelection('anchor', 'o'));

    }

  }

  add('Delete selection', deleteSelection);

  contextMenu.hidden = false;

  const rect = canvas.getBoundingClientRect();

  contextMenu.style.left = `${Math.max(0, Math.min(rect.left + p[0], innerWidth - contextMenu.offsetWidth))}px`;

  contextMenu.style.top = `${Math.max(0, Math.min(rect.top + p[1], innerHeight - contextMenu.offsetHeight))}px`;

  contextMenu.querySelector('button')?.focus();

}

contextMenu.addEventListener('keydown', e => {

  const buttons = [...contextMenu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);

  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {

    e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;

    buttons[next]?.focus();

  } else if (e.key === 'Tab') closeMenu();

});

document.addEventListener('pointerdown', e => { if (!contextMenu.contains(e.target as Node)) closeMenu(); });

window.addEventListener('resize', closeMenu);

const pointers = new Map<number, Point>(); let gesture: { distance: number; center: Point } | null = null;

let pointerDown: Point | null = null, panning = false, gestureUsed = false;

let dragStart: Point | null = null, dragStarted = false, moved = false;
interface EditDrag {
  // Sources/targets and delta are in grid units; delta is shared by every node.
  sources: Point[]; targets: Point[]; delta: Point; mergeTargets: Point[];
  // grab is the initial pointer position in grid space. moving retains the
  // original selection entries, including members whose endpoints are implicit.
  kind: 'node' | 'beam' | 'group'; grab: Point; moving: Selection[];
  active: boolean; preview: Project; valid: Project | null; error: string | null;
  // For an outside grab this is empty, so cancellation cannot restore the old group.
  restoreSelection: Selection[];
}
let editDrag: EditDrag | null = null;

// The clipboard is a detached snapshot, retained across edits and project loads
// in this tab only. Placement state is temporary and never enters project storage.
let clipboardFragment: Fragment | null = null;
let pasteState: { fragment: Fragment; placement: FragmentPlacement; restoreSelection: Selection[];
  preview: Project; valid: Project | null; error: string | null; changed: boolean } | null = null;

function copyGroup(): void {
  if (running || pasteState) return;
  const fragment = copySelection(history.project,selected);
  if (!fragment) { notify('Select beams, ropes, or both ends of a connection to copy.'); return; }
  clipboardFragment = fragment; sound.playEdit('copy'); notify('Selection copied. Paste it as many times as you like.'); refreshUI();
}

function beginPaste(): void {
  if (running || !clipboardFragment) return;
  resetInteraction(); tool = 'select'; renderer.camera(history.project.size);
  const fragment = clipboardFragment;
  // Center the bounding box in the visible part of the board, in whole grid units.
  const a = renderer.world([0,0]), b = renderer.world([renderer.width,renderer.height]);
  const center: Point = [(Math.max(0,a[0])+Math.min(history.project.size[0],b[0]))/2,
    (Math.max(0,a[1])+Math.min(history.project.size[1],b[1]))/2];
  pasteState = {fragment,placement:{origin:[Math.round(center[0]-fragment.size[0]/2),Math.round(center[1]-fragment.size[1]/2)],flipX:false,flipY:false},
    restoreSelection:[...selected],preview:history.project,valid:null,error:null,changed:false};
  refreshUI();
}

function updatePaste(p?: Point): void {
  const state = pasteState; if (!state) return;
  if (p) state.placement.origin = renderer.snap(p);
  state.preview = fragmentPreview(history.project,state.fragment,state.placement);
  state.valid = null;
  try { const result = pasteFragment(history.project,state.fragment,state.placement); state.valid = result.project; state.changed = result.changed; state.error = null; }
  catch (error) { state.error = (error as Error).message; }
  if (p && !insideBuildArea(p)) { state.valid = null; state.error = 'Stay inside the build area.'; }
  $<HTMLButtonElement>('paste-place').disabled = !state.valid;
  for (const [id,active] of [['paste-flip-x',state.placement.flipX],['paste-flip-y',state.placement.flipY]] as const) {
    $(id).setAttribute('aria-pressed',String(active)); $(id).classList.toggle('active',active);
  }
  const price = projectCost(state.valid ?? state.preview).total;
  $('total-cost').textContent = `Cost: ${price} cr (${price-cost.total >= 0 ? '+' : ''}${price-cost.total})`;
  $('status').textContent = state.error ?? 'Position the copy, then place it.';
  invalidate();
}

function placePaste(): void {
  const state = pasteState; if (!state) return;
  if (!state.valid) { notify(state.error ?? 'Choose a valid position.'); return; }
  pasteState = null; pointerDown = null; lastClick = null;
  if (state.changed) { recordProject(state.valid); lastName = 'Untitled structure'; sound.playEdit('paste', (state.placement.origin[0] + state.fragment.size[0] / 2) / history.project.size[0]); }
  selected = pastedSelection(state.valid,state.fragment,state.placement);
  $('status').textContent = state.changed ? 'Selection pasted.' : 'Existing elements selected; no new elements added.';
  refreshUI();
}


function dragSelection(project: Project, drag: EditDrag): Selection[] {
  return translatedSelection(project,drag.moving,drag.delta);
}
let drawingPointer: Point | null = null, edgeSince: number | null = null;
const EDGE_PAN_ZONE = 32, EDGE_PAN_DELAY = 150, EDGE_PAN_SPEED = 240;

let marquee: [Point, Point] | null = null, selectionClick = false;
// Keep a pending box separate from its visible rectangle until movement exceeds
// the click threshold. Coordinates here are canvas CSS pixels, not grid units.
let selectionBox: { origin: Point; selection: Selection[]; additive: boolean } | null = null;

function cancelEditingPreview(): void {
  if (pasteState) { selected = pasteState.restoreSelection; pasteState = null; }
  if (editDrag) selected = editDrag.restoreSelection;
  if (selectionBox) selected = selectionBox.selection;
  editDrag = null; selectionBox = null; marquee = null;
}

function beginSelectionBox(p: Point, additive: boolean): void {
  start = null; lastClick = null; selectionClick = false;
  selectionBox = { origin: p, selection: [...selected], additive };
  refreshUI();
}

function updateSelectionBox(p: Point): void {
  if (selectionBox && moved) { marquee = [selectionBox.origin,p]; invalidate(); }
}

let lastClick: { node: string; point: Point; time: number } | null = null;

let idleAtDown = false;

function resetInteraction(): void {
  cancelEditingPreview();

  closeMenu(); start = null; pointerDown = null; dragStart = null; dragStarted = false; stopEdgePan();

  marquee = null; lastClick = null; panning = false; gesture = null; pointers.clear(); selectionClick = false; gestureUsed = false;

}

function updateEditDrag(p: Point): void {
  if (!editDrag || !moved) return;
  const drag = editDrag;
  drag.active = true;
  const world = renderer.world(p);
  // Single-node dragging keeps its established snap-to-cursor behavior. Groups
  // use a rounded displacement from the grab point, preserving every relative offset.
  const snapped = renderer.snap(p);
  drag.delta = drag.kind === 'node'
    ? [snapped[0]-drag.sources[0][0],snapped[1]-drag.sources[0][1]]
    : [Math.round(world[0]-drag.grab[0]),Math.round(world[1]-drag.grab[1])];
  drag.targets = drag.sources.map(source => [source[0]+drag.delta[0],source[1]+drag.delta[1]]);
  const stationary = nodes(history.project);
  for (const source of drag.sources) stationary.delete(key(source));
  drag.mergeTargets = drag.targets.filter(t => stationary.has(key(t)));
  drag.preview = translateNodesPreview(history.project,drag.sources,drag.delta);
  drag.valid = null;
  try { drag.valid = translateNodes(history.project,drag.sources,drag.delta); drag.error = null; }
  catch (error) { drag.error = (error as Error).message; }
  if (!insideBuildArea(p)) { drag.valid = null; drag.error = 'Stay inside the build area.'; }
  const price = drag.valid ? projectCost(drag.valid).total : cost.total;
  $('total-cost').textContent = drag.valid ? `Cost: ${price} cr (${price - cost.total >= 0 ? '+' : ''}${price - cost.total})` : `Cost: ${cost.total} cr`;
  invalidate();
}

function clearDrawingDrag(): void {
  if (dragStarted && idleAtDown) start = null;
  dragStart = null; dragStarted = false; stopEdgePan();
}

function stopEdgePan(): void {
  drawingPointer = null; edgeSince = null;
}

function panWhileDrawing(now: number, delta: number): void {
  if (!dragStarted || !drawingPointer || document.hidden) return;
  const [x, y] = drawingPointer;
  const rect = canvas.getBoundingClientRect();
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const right = Math.min(document.documentElement.clientWidth, rect.right);
  const bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
  if (x < left || x >= right || y < top || y >= bottom || document.elementFromPoint(x, y) !== canvas) {
    edgeSince = null; return;
  }

  const size = history.project.size;
  renderer.camera(size);
  const [boardLeft, boardTop] = renderer.screen([0, 0]);
  const [boardRight, boardBottom] = renderer.screen(size);
  const edgeStrength = (distance: number) => Math.max(0, 1 - distance / EDGE_PAN_ZONE);
  const vx = (boardLeft < left - rect.left ? edgeStrength(x - left) : 0)
    - (boardRight > right - rect.left ? edgeStrength(right - x) : 0);
  const vy = (boardTop < top - rect.top ? edgeStrength(y - top) : 0)
    - (boardBottom > bottom - rect.top ? edgeStrength(bottom - y) : 0);
  if (!vx && !vy) { edgeSince = null; return; }
  edgeSince ??= now;
  const step = Math.min(delta, Math.max(0, (now - edgeSince - EDGE_PAN_DELAY) / 1000))
    * EDGE_PAN_SPEED / Math.max(1, Math.hypot(vx, vy));
  if (!step) return;

  if (vx > 0) renderer.pan[0] += Math.min(vx * step, left - rect.left - boardLeft);
  if (vx < 0) renderer.pan[0] += Math.max(vx * step, right - rect.left - boardRight);
  if (vy > 0) renderer.pan[1] += Math.min(vy * step, top - rect.top - boardTop);
  if (vy < 0) renderer.pan[1] += Math.max(vy * step, bottom - rect.top - boardBottom);
  renderer.camera(size);
  updateCursor([x - rect.left, y - rect.top]);
}

function trackPointerMovement(p: Point): void {
  if (!pointerDown || Math.hypot(p[0] - pointerDown[0], p[1] - pointerDown[1]) <= (touch ? 10 : 6)) return;
  moved = true; lastClick = null;
}

function beginDrawingDrag(): void {
  if (!dragStart || !moved || dragStarted) return;
  start ??= dragStart; dragStarted = true; selected = []; refreshUI();
}

const eventPoint = (e: MouseEvent): Point => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

function updateCursor(p: Point): void { cursor = renderer.snap(p); const [x, y] = toCentered(cursor, history.project.size); $('coordinate').textContent = `X ${x}   Y ${y}`; invalidate(); }

function insideBuildArea([x, y]: Point): boolean {
  const [left, top] = renderer.screen([0, 0]);
  const [right, bottom] = renderer.screen(history.project.size);
  return x >= left && x <= right && y >= top && y <= bottom;
}

canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (!running && !pasteState) openMenu(eventPoint(e)); });

canvas.addEventListener('pointerdown', e => {

  if (running) return;

  canvas.focus(); touch = e.pointerType !== 'mouse'; const p = eventPoint(e);

  pointers.set(e.pointerId, p); canvas.setPointerCapture(e.pointerId); pointerDown = p;

  if (pointers.size >= 2) {

    cancelEditingPreview();
    clearDrawingDrag(); lastClick = null;
    const a = [...pointers.values()]; gesture = { distance: Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]), center: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2] };
    gestureUsed = true; refreshUI(); return;

  }

  gestureUsed = false; dragStarted = false; dragStart = null; moved = false;

  renderer.camera(history.project.size);
  const onBoard = insideBuildArea(p);
  panning = e.button === 1 || (e.button === 0 && (e.altKey || (e.pointerType === 'touch' && !onBoard)));

  if (panning || e.button !== 0) { lastClick = null; return; }

  updateCursor(p);
  if (pasteState) { updatePaste(p); return; }
  idleAtDown = !start;

  selectionClick = !touch && (e.ctrlKey || e.metaKey);

  // Modifier/navigation gestures take precedence over grabbing an object.
  if (!touch && e.shiftKey) { beginSelectionBox(p,selectionClick); return; }

  const hit = tool === 'select' && onBoard ? hitTest(p) : null;
  if (tool === 'select' && onBoard && !hit) {
    beginSelectionBox(p,selectionClick); return;
  }
  if (selectionClick) { start = null; lastClick = null; refreshUI(); return; }

  if (tool === 'select' && onBoard && hit) {
    const inGroup = selectionContains(selected,hit);
    if ('node' in hit || hit.material === 'beam' || inGroup) {
      const moving: Selection[] = inGroup ? [...selected] : [hit];
      // Grabbing outside the group immediately clears it. Its cancellation
      // snapshot is therefore empty; cancelling must not resurrect that group.
      if (!inGroup) selected = [];
      const sources = selectionNodes(moving);
      // Keep familiar labels/snapping for a single node or beam. Mixed selections
      // and rope-only selections use the common group translation path.
      const kind = moving.length === 1 ? ('node' in moving[0] ? 'node' : moving[0].material === 'beam' ? 'beam' : 'group') : 'group';
      editDrag = { sources, targets: sources, delta: [0,0], mergeTargets: [], kind, grab: renderer.world(p), moving,
        active: false, preview: history.project, valid: history.project, error: null, restoreSelection: [...selected] };
      refreshUI();
    }
  }

  if ((tool === 'beam' || tool === 'rope') && (start || onBoard)) {
    const hit = start ? null : hitTest(p);
    dragStart = start ?? (hit && 'node' in hit ? fromKey(hit.node) : cursor);
  }

});

canvas.addEventListener('pointermove', e => {

  if (running) return; const p = eventPoint(e), previous = pointers.get(e.pointerId); if (previous) pointers.set(e.pointerId, p);

  if (previous) trackPointerMovement(p);

  if (pointers.size >= 2 && gesture) {

    const a = [...pointers.values()], center: Point = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2], distance = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]);

    renderer.zoomAt(distance / Math.max(gesture.distance, 1), center); renderer.pan[0] += center[0] - gesture.center[0]; renderer.pan[1] += center[1] - gesture.center[1]; gesture = { distance, center }; invalidate(); return;

  }

  if (gestureUsed) return;

  if (panning && previous) { renderer.pan[0] += p[0] - previous[0]; renderer.pan[1] += p[1] - previous[1]; invalidate(); return; }

  if (pasteState) { if (e.pointerType === 'mouse' || previous) updatePaste(p); return; }

  if (selectionBox) {
    if (previous && e.pointerType === 'mouse' && !(e.buttons & 1)) { resetInteraction(); refreshUI(); return; }
    updateSelectionBox(p); return;
  }

  if (selectionClick) return;

  if (dragStarted && previous && e.pointerType === 'mouse' && !(e.buttons & 1)) {
    resetInteraction(); refreshUI(); return;
  }
  if (editDrag && previous && e.pointerType === 'mouse' && !(e.buttons & 1)) {
    resetInteraction(); refreshUI(); return;
  }
  updateCursor(p);
  if (editDrag && previous) { updateEditDrag(p); return; }
  if (previous) beginDrawingDrag();
  if (dragStarted && previous) {
    drawingPointer = [e.clientX, e.clientY];
    panWhileDrawing(performance.now(), 0);
  }

});

canvas.addEventListener('pointerup', e => {

  if (!pointers.delete(e.pointerId)) return;
  stopEdgePan();
  const p = eventPoint(e);

  if (pointers.size < 2) gesture = null;

  if (running || panning || gestureUsed) {
    if (!pointers.size) {
      const endedGesture = gestureUsed;
      panning = false; gestureUsed = false; pointerDown = null;
      if (endedGesture) refreshUI();
    }
    return;
  }

  if (!pointerDown || e.button !== 0) return;

  trackPointerMovement(p);

  if (dragStart) renderer.camera(history.project.size);
  updateCursor(p);
  if (pasteState) {
    updatePaste(p); pointerDown = null;
    if (e.pointerType === 'mouse') placePaste();
    return;
  }
  if (editDrag) {
    updateEditDrag(p);
    const drag = editDrag;
    editDrag = null;
    if (drag.active) {
      pointerDown = null; lastClick = null;
      if (drag.valid && drag.delta.some(value => value !== 0)) {
        recordProject(drag.valid); lastName = 'Untitled structure';
        selected = dragSelection(drag.valid,drag);
        $('status').textContent = drag.kind === 'group' ? 'Selection moved.' : drag.kind === 'beam' ? 'Beam moved.' : drag.mergeTargets.length ? 'Nodes merged.' : 'Node moved.';
      } else {
        selected = drag.restoreSelection;
        if (drag.error) notify(drag.error);
      }
      refreshUI(); return;
    }
  }
  pointerDown = null;

  beginDrawingDrag();
  if (dragStarted) {
    const bounds = canvas.getBoundingClientRect();
    if (p[0] >= 0 && p[1] >= 0 && p[0] < bounds.width && p[1] < bounds.height) finishMember();
    if (dragStarted) { dragStart = null; dragStarted = false; refreshUI(); }
    return;
  }
  const canStartDrawing = dragStart !== null && insideBuildArea(p);
  dragStart = null;

  if (selectionBox) {
    updateSelectionBox(p);
    const box = selectionBox;
    const hits = marquee ? rectangleSelection(history.project,renderer.world(box.origin),renderer.world(p)) : [];
    selected = [...new Map([...(box.additive ? box.selection : []),...hits].map(item => [selectionKey(item),item])).values()];
    selectionBox = null; marquee = null; selectionClick = false; lastClick = null;
    refreshUI(); return;
  }

  const hit = hitTest(p);

  if (selectionClick) {

    selectionClick = false;

    if (hit && !moved) { const id = selectionKey(hit); selected = selected.some(s => selectionKey(s) === id) ? selected.filter(s => selectionKey(s) !== id) : [...selected, hit]; }

    refreshUI(); return;

  }

  if (!touch && !moved && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && tool === 'select' && hit && 'node' in hit) {

    if (lastClick && lastClick.node === hit.node && performance.now() - lastClick.time <= 350 && Math.hypot(p[0] - lastClick.point[0], p[1] - lastClick.point[1]) <= 6) {

      start = null; lastClick = null; recordProject(toggleNode(history.project, hit.node)); selected = [hit]; lastName = 'Untitled structure'; refreshUI(); return;

    }

    lastClick = idleAtDown ? { node: hit.node, point: p, time: performance.now() } : null;

  } else lastClick = null;

  // Node toggles belong to Select; construction tools always draw from nodes.

  if (touch && !start && tool === 'select' && hit && 'node' in hit) {

    recordProject(toggleNode(history.project, hit.node)); selected = [hit]; lastName = 'Untitled structure'; refreshUI(); return;

  }

  if (tool === 'select' || tool === 'erase') {
    selected = hit ? [hit] : [];
    if (tool === 'erase') deleteSelection();
    // Keep the board stationary between the two clicks of a node double-click.
    if (tool === 'select' && !touch && hit && 'node' in hit && $('inspector').hidden && lastClick) {
      const click = lastClick; invalidate();
      setTimeout(() => { if (lastClick === click) { lastClick = null; refreshUI(); } }, 360);
    } else refreshUI();
    return;
  }

  if ((!start && !canStartDrawing) || !cursor || (!start && !inside(cursor, history.project.size))) { notify('Choose a point inside the build area.'); return; }

  if (!start) { start = [...cursor]; refreshUI(); } else finishMember();

});

canvas.addEventListener('pointercancel', () => { resetInteraction(); refreshUI(); });

canvas.addEventListener('lostpointercapture', e => {
  if (pointers.has(e.pointerId)) { resetInteraction(); refreshUI(); }
});

canvas.addEventListener('pointerleave', () => { if (!pointers.size && !touch) { cursor = null; invalidate(); } });

canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), [e.clientX - r.left, e.clientY - r.top]); invalidate(); }, { passive: false });

const beamButton = document.querySelector<HTMLButtonElement>('[data-tool="beam"]')!;
const profilePicker = $('profile-picker');
let profileHold: ReturnType<typeof setTimeout> | undefined;
let profilePointerStart: [number, number] | null = null;
let profileHoldOpened = false;
function closeProfilePicker(): void { profilePicker.hidden = true; beamButton.setAttribute('aria-expanded', 'false'); }
function openProfilePicker(): void {
  if (running) return;
  closeMenu(); chooseTool('beam');
  profilePicker.hidden = false; beamButton.setAttribute('aria-expanded', 'true');
  const anchor = beamButton.getBoundingClientRect(), box = profilePicker.getBoundingClientRect();
  // Keep the menu away from the held button so releasing a finger cannot select an item.
  const left = anchor.right + box.width + 8 <= window.innerWidth ? anchor.right + 8 : Math.max(4, anchor.left - box.width - 8);
  const top = Math.max(4, Math.min(anchor.top, window.innerHeight - box.height - 4));
  profilePicker.style.left = `${left}px`;
  profilePicker.style.top = `${top}px`;
}
beamButton.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  profileHoldOpened = false; profilePointerStart = [e.clientX, e.clientY];
  clearTimeout(profileHold); profileHold = setTimeout(() => { profileHoldOpened = true; openProfilePicker(); }, 500);
});
beamButton.addEventListener('pointermove', e => { if (profilePointerStart && Math.hypot(e.clientX - profilePointerStart[0], e.clientY - profilePointerStart[1]) > 10) clearTimeout(profileHold); });
for (const event of ['pointerup', 'pointercancel', 'pointerleave'] as const) beamButton.addEventListener(event, () => { clearTimeout(profileHold); profilePointerStart = null; });
beamButton.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(profileHold); profileHoldOpened = true; openProfilePicker(); });
beamButton.addEventListener('click', e => { if (profileHoldOpened) { e.stopImmediatePropagation(); e.preventDefault(); profileHoldOpened = false; } }, true);
beamButton.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openProfilePicker(); profilePicker.querySelector<HTMLButtonElement>('[data-profile]')?.focus(); } });
document.addEventListener('pointerdown', e => { if (!profilePicker.hidden && !profilePicker.contains(e.target as Node) && e.target !== beamButton && !beamButton.contains(e.target as Node)) closeProfilePicker(); });
document.querySelectorAll<HTMLButtonElement>('#profile-picker [data-profile]').forEach(b => b.onclick = () => { profile = b.dataset.profile as BeamProfile; closeProfilePicker(); refreshUI(); beamButton.focus(); });

document.querySelectorAll<HTMLButtonElement>('[data-change-profile]').forEach(b => b.onclick = () => changeSelection('profile', b.dataset.changeProfile!));

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.onclick = () => chooseTool(b.dataset.tool as Tool));

document.querySelectorAll<HTMLButtonElement>('[data-joint]').forEach(b => b.onclick = () => { joint = b.dataset.joint as JointType; refreshUI(); });

document.querySelectorAll<HTMLButtonElement>('[data-node], [data-anchor]').forEach(b => b.onclick = () => changeSelection(b.dataset.node ? 'node' : 'anchor', (b.dataset.node || b.dataset.anchor)!));

$('delete-selection').onclick = deleteSelection;

$('clear-canvas').onclick = () => {

  if (running) stopSimulation();

  const blank = emptyProject(); blank.size = [...history.project.size];

  commit(blank); start = cursor = null; lastName = 'Untitled structure';

  $('status').textContent = 'Canvas cleared. Undo brings your design back.'; refreshUI();
  void recordClear();

};

$('run').onclick = runSimulation; $('back').onclick = stopSimulation; $('pause').onclick = togglePause;

$('copy-selection').onclick = copyGroup;
$('paste-selection').onclick = beginPaste;
$('paste-place').onclick = placePaste;
$('paste-cancel').onclick = () => { resetInteraction(); refreshUI(); };
$('paste-flip-x').onclick = () => { if (pasteState) { pasteState.placement.flipX = !pasteState.placement.flipX; updatePaste(); } };
$('paste-flip-y').onclick = () => { if (pasteState) { pasteState.placement.flipY = !pasteState.placement.flipY; updatePaste(); } };

$('cancel-draw').onclick = () => { resetInteraction(); refreshUI(); };

$('undo').onclick = () => { if (running) return; resetInteraction(); if (history.undo()) { saveProject(); selected = []; start = null; lastName = 'Untitled structure'; } refreshUI(); };

$('redo').onclick = () => { if (running) return; resetInteraction(); if (history.redo()) { saveProject(); selected = []; start = null; lastName = 'Untitled structure'; } refreshUI(); };

const examplesDialog = $<HTMLDialogElement>('examples-dialog');
$('examples').onclick = () => { if (pasteState) { resetInteraction(); refreshUI(); } if (!running) examplesDialog.showModal(); };
$('close-examples').onclick = () => examplesDialog.close();
document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(button => button.onclick = () => {
  if (running) return;
  const value = button.dataset.example as Example;
  commit(example(value)); lastName = exampleNames[value]; renderer.fit(); start = cursor = null;
  examplesDialog.close(); refreshUI();
});

$('zoom-in').onclick = () => { renderer.zoomAt(1.25, [renderer.width / 2, renderer.height / 2]); invalidate(); };

$('zoom-out').onclick = () => { renderer.zoomAt(0.8, [renderer.width / 2, renderer.height / 2]); invalidate(); };

$('fit').onclick = () => { renderer.fit(); invalidate(); };

$('stress').onclick = () => { stress = !stress; refreshUI(); };
$('stress').addEventListener('keydown', e => { if (e.code === 'Space') e.stopPropagation(); });
$('sound').onclick = () => { sound.setEnabled(!sound.enabled); sound.activate(); refreshUI(); };
$('sound').addEventListener('keydown', e => { if (e.code === 'Space') e.stopPropagation(); });

$('hide-inspector').onclick = () => { selected = []; refreshUI(); };

const textDialog = $<HTMLDialogElement>('text-dialog'), textarea = $<HTMLTextAreaElement>('project-json');

const settingsDialog = $<HTMLDialogElement>('settings-dialog');
const canvasSizeForm = $<HTMLFormElement>('canvas-size-form');
const settingsButton = $<HTMLButtonElement>('settings');
settingsButton.onclick = () => { if (pasteState) { resetInteraction(); refreshUI(); }
  closeProfilePicker();
  $<HTMLInputElement>('canvas-width').value = String(history.project.size[0]);
  $<HTMLInputElement>('canvas-height').value = String(history.project.size[1]);
  $('canvas-size-error').textContent = '';
  settingsDialog.showModal();
};
$('close-settings').onclick = () => settingsDialog.close();
settingsDialog.addEventListener('close', () => settingsButton.focus());
// Solver choice changes this page session immediately; project geometry and history stay untouched.
settingsDialog.querySelectorAll<HTMLInputElement>('input[name="solver"]').forEach(input => input.onchange = () => {
  solver = input.value as Solver; refreshUI();
});
canvasSizeForm.onsubmit = e => {
  e.preventDefault();
  try {
    const size: Point = [$<HTMLInputElement>('canvas-width').valueAsNumber, $<HTMLInputElement>('canvas-height').valueAsNumber];
    const next = resizeProject(history.project, size);
    commit(next); renderer.fit(); settingsDialog.close();
    notify(`Canvas resized to ${size[0]} × ${size[1]} grid.`);
  } catch (error) { $('canvas-size-error').textContent = (error as Error).message; }
};

$('project-text').onclick = () => { if (pasteState) { resetInteraction(); refreshUI(); } textarea.value = exportProject(history.project); $('import-error').textContent = ''; textDialog.showModal(); };

$('close-text').onclick = () => textDialog.close();

$('copy').onclick = async () => { try { await navigator.clipboard.writeText(textarea.value); notify('Project text copied to clipboard.'); $('copy').innerHTML = `${icon('check')}Copied`; setTimeout(() => { $('copy').innerHTML = `${icon('copy')}Copy`; }, 1800); } catch { textarea.focus(); textarea.select(); $('import-error').textContent = 'Clipboard is unavailable. The text is selected; copy it manually.'; } };

$('share-link').onclick = async () => {
  try {
    const link = `${location.origin}${location.pathname}${location.search}#project=${await encodeShareProject(history.project)}`;
    if (link.length > 1_500_000) throw new Error('This project is too large to share in a link. Copy the project text instead.');
    try {
      await navigator.clipboard.writeText(link);
      $('import-error').textContent = 'Share link copied. Anyone with the link can view this project.';
    } catch {
      textarea.value = link; textarea.focus(); textarea.select();
      $('import-error').textContent = 'Clipboard is unavailable. The share link is selected; copy it manually.';
    }
  } catch (error) { $('import-error').textContent = (error as Error).message; }
};

$('load').onclick = () => { try { const warning = projectChecksumWarning(textarea.value); if (warning && !confirmChecksumWarning(warning)) return; const p = importProject(textarea.value); if (running) stopSimulation(); commit(p); start = cursor = null; renderer.fit(); lastName = 'Imported structure'; refreshUI(); textDialog.close(); notify(warning ? 'Project opened after accepting the checksum warning.' : 'Project loaded. Your previous design is available with Undo.'); } catch (e) { $('import-error').textContent = (e as Error).message; } };

const guideDialog = $<HTMLDialogElement>('guide-dialog'); $('guide').onclick = () => guideDialog.showModal(); $('close-guide').onclick = () => guideDialog.close();

// Apply the same backdrop gesture rules to every editor dialog. A click can target
// the dialog even when it began in a child input and ended outside during selection.
for (const dialog of [textDialog, guideDialog, settingsDialog, examplesDialog]) {
  let backdropPointer: number | null = null;
  let backdropClick = false;
  const outside = (event: MouseEvent) => {
    // Pointer coordinates and dialog box edges are both measured in viewport pixels.
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  const resetGesture = () => { backdropPointer = null; backdropClick = false; };
  dialog.addEventListener('pointerdown', event => {
    resetGesture();
    if (event.isPrimary && event.button === 0 && outside(event)) backdropPointer = event.pointerId;
  });
  dialog.addEventListener('pointerup', event => {
    // Require both ends of the same primary gesture to be on the backdrop;
    // leave native text selection untouched and let the subsequent click dismiss.
    backdropClick = event.pointerId === backdropPointer && event.button === 0 && outside(event);
    backdropPointer = null;
  });
  dialog.addEventListener('click', event => {
    const dismiss = backdropClick && event.button === 0 && outside(event);
    resetGesture();
    if (dismiss) dialog.close();
  });
  dialog.addEventListener('pointercancel', resetGesture);
  dialog.addEventListener('close', resetGesture);
}

document.addEventListener('keydown', e => {

  if ((e.target as HTMLElement).matches('input, textarea, select') || textDialog.open || guideDialog.open || settingsDialog.open || examplesDialog.open) return;

  if (e.key === 'Escape') { e.preventDefault(); if (!profilePicker.hidden) { closeProfilePicker(); beamButton.focus(); } else if (!contextMenu.hidden) closeMenu(); else if (pasteState || start || marquee || pointerDown) resetInteraction(); else selected = []; refreshUI(); return; }

  if (!contextMenu.hidden) return;

  if ((e.ctrlKey || e.metaKey) && ['c','v'].includes(e.key.toLowerCase())) { e.preventDefault(); if (!e.repeat) { if (e.key.toLowerCase() === 'c') copyGroup(); else beginPaste(); } return; }

  if (pasteState && e.key === 'Enter' && e.target === canvas) { e.preventDefault(); placePaste(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); $(e.shiftKey ? 'redo' : 'undo').click(); return; }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); $('redo').click(); return; }

  if (e.code === 'Space') {
    e.preventDefault(); if (!e.repeat) { if (running) togglePause(); else runSimulation(); } return;
  }

  if (pasteState && (e.key === 'Delete' || e.key === 'Backspace')) return;

  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }

  const tools: Record<string, Tool> = { b: 'beam', r: 'rope', v: 'select', e: 'erase' }; if (tools[e.key.toLowerCase()]) chooseTool(tools[e.key.toLowerCase()]);

});

const observer = new ResizeObserver(() => { renderer.resize(); invalidate(); }); observer.observe(canvas);

document.addEventListener('visibilitychange', () => {
  elapsed = 0; lastTime = performance.now();
  if (document.hidden && (dragStarted || editDrag || selectionBox || pasteState)) { resetInteraction(); refreshUI(); }
});

function animate(now: number): void {

  const delta = Math.min(0.1, (now - lastTime) / 1000); lastTime = now;

  if (running && !paused && !document.hidden) {

    elapsed = Math.min(elapsed + delta, 8 / 120);

    if (worker && !busy && elapsed >= 1 / 120) { const transfer = recycled ? [recycled.positions, recycled.stresses, recycled.broken] : []; worker.postMessage({ type: 'tick', elapsed, recycled }, transfer); recycled = undefined; busy = true; elapsed = 0; }

  }

  panWhileDrawing(now, delta);
  if (needsDraw || previewAnimating) {
    const project = pasteState ? (pasteState.valid ?? pasteState.preview) : editDrag?.active ? (editDrag.valid ?? editDrag.preview) : history.project;
    // Transform the clipboard's unique local nodes once. Stationary nodes are
    // looked up in the committed project, never in the combined paste preview.
    const pasteTargets = pasteState ? transformFragment(pasteState.fragment,pasteState.placement).nodes.map(n => n.point) : [];
    const stationary = pasteState ? nodes(history.project) : new Map<string,Point>();
    previewAnimating = renderer.draw({ project,
      editMove: pasteState ? {targets:pasteTargets,error:pasteState.error,mergeTargets:pasteTargets.filter(p=>stationary.has(key(p))),kind:'paste'}
        : editDrag?.active ? {targets:editDrag.targets,error:editDrag.error,mergeTargets:editDrag.mergeTargets,kind:editDrag.kind} : null,
      tool,cursor,start,selected:pasteState ? pastedSelection(project,pasteState.fragment,pasteState.placement)
        : editDrag?.active ? dragSelection(project,editDrag) : selected,
      marquee,frame,members,stress,joint,profile,baseCost:cost.total },now);
    needsDraw = false;
  }

  frames++; if (now - fpsStart > 1000) { fps = Math.round(frames * 1000 / (now - fpsStart)); fpsStart = now; frames = 0; }

  if (now - lastStats > 250) {

    const zoomText = `${Math.round(renderer.zoom * 100)}%`;
    $('zoom-value').textContent = zoomText; mobileZoom.textContent = zoomText;

    $('performance').textContent = frame ? `${fps} FPS · ${frame.stepMs.toFixed(1)} MS/STEP · ${frame.time.toFixed(1)} S` : '';

    if (frame) { const broken = frame.broken.reduce((a, b) => a + b, 0); $('status').textContent = paused ? 'Paused. Take a closer look.' : broken ? `${broken} ${broken === 1 ? 'element' : 'elements'} broken. Back to build restores your design.` : 'Gravity is doing its thing.'; }

    lastStats = now;

  }

  requestAnimationFrame(animate);

}

// Lay out the tool rail in as many columns as the available height requires.
const resizeToolRail = () => {
  const rows = Math.max(1, Math.floor((stage.clientHeight - 8 + 2) / 38));
  controls.style.setProperty('--tool-rows', String(rows));
  rightControls.style.setProperty('--tool-rows', String(rows));
};
new ResizeObserver(resizeToolRail).observe(stage);
resizeToolRail();
splitControls.addEventListener('change', refreshUI);
if (sharedProjectLoaded) saveProject();
refreshUI(); requestAnimationFrame(animate);

if (restoreNotice) $('status').textContent = restoreNotice;

if (shareLinkError) {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'share-link-failure-title');
  dialog.setAttribute('aria-describedby', 'share-link-failure-message');
  dialog.innerHTML = `<div class="dialog-heading"><h2 id="share-link-failure-title">Project link could not be opened</h2></div><p id="share-link-failure-message"><strong>The project from this link was not imported.</strong> A blank workspace is open instead. Your previously saved project has not been changed.</p><p class="error-message"></p><div class="dialog-footer"><span>Create or request a new share link, then open it again.</span><button type="button" class="primary-button">Got it</button></div>`;
  dialog.querySelector('.error-message')!.textContent = shareLinkError;
  dialog.querySelector('button')!.addEventListener('click', () => dialog.close());
  document.body.append(dialog);
  dialog.showModal();
}

setupUpdates(notify, saveProject, positionInstallReminder);
