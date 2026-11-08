import { toCentered } from './coordinates';
import { drawingEndpoint, MAX_LENGTH, PROFILES, ROPE_PRICE, projectCost, addMember, boundary, fromKey, key, nodes, validateMember, type BeamProfile, type JointType, type Material, type Point, type Project } from './model';
import type { Frame, PhysicsMember } from './physics';
export type Tool = Material | 'select' | 'erase';
import { memberSelected, type Selection } from './selection';
export interface RenderState { editMove?: { targets: Point[]; error: string | null; mergeTargets: Point[]; kind: 'node' | 'beam' | 'group' | 'paste' } | null; project: Project; tool: Tool; cursor: Point | null; start: Point | null; selected: Selection[]; marquee: [Point, Point] | null; frame: Frame | null; members: PhysicsMember[]; stress: boolean; joint: JointType; profile: BeamProfile; baseCost: number }
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private previewErrorSince: number | null = null;
  private background = document.createElement('canvas'); private backgroundKey = '';
  width = 0; height = 0; dpr = 1; scale = 1; origin: Point = [0, 0]; zoom = 1; pan: Point = [0, 0];
  constructor(readonly canvas: HTMLCanvasElement) { this.ctx = canvas.getContext('2d')!; }
  resize(): void { const rect = this.canvas.getBoundingClientRect(); this.width = rect.width; this.height = rect.height; this.dpr = Math.min(window.devicePixelRatio || 1, 2); this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr); this.backgroundKey = ''; }
  fit(): void { this.zoom = 1; this.pan = [0, 0]; this.backgroundKey = ''; }
  camera(size: Point): void { const margin = this.height < 400 ? 20 : this.width < 600 ? 30 : 58; const fit = Math.min((this.width - margin * 2) / size[0], (this.height - margin * 2) / size[1]); this.scale = Math.max(0.01, fit * this.zoom); this.origin = [(this.width - size[0] * this.scale) / 2 + this.pan[0], (this.height - size[1] * this.scale) / 2 + this.pan[1]]; }
  screen(p: Point): Point { return [this.origin[0] + p[0] * this.scale, this.origin[1] + p[1] * this.scale]; }
  world(p: Point): Point { return [(p[0] - this.origin[0]) / this.scale, (p[1] - this.origin[1]) / this.scale]; }
  snap(p: Point): Point { const w = this.world(p); return [Math.round(w[0]), Math.round(w[1])]; }
  zoomAt(factor: number, point: Point): void { const before = this.world(point); const old = this.zoom; this.zoom = Math.max(0.65, Math.min(6, old * factor)); const ratio = this.zoom / old; this.pan[0] += (point[0] - this.width / 2 - this.pan[0]) * (1 - ratio); this.pan[1] += (point[1] - this.height / 2 - this.pan[1]) * (1 - ratio); void before; }
  private paintBackground(size: Point): void {
    const id = [this.width, this.height, this.dpr, this.scale, ...this.origin, ...size].join(':'); if (id === this.backgroundKey) return; this.backgroundKey = id;
    this.background.width = this.canvas.width; this.background.height = this.canvas.height;
    const c = this.background.getContext('2d')!; c.scale(this.dpr, this.dpr);
    c.fillStyle = '#eaece8'; c.fillRect(0, 0, this.width, this.height);
    c.strokeStyle = '#d9ddd7'; c.lineWidth = 1;
    c.beginPath(); for (let x = -this.height; x < this.width; x += 10) { c.moveTo(x, 0); c.lineTo(x + this.height, this.height); } c.stroke();
    const [ox, oy] = this.origin, w = size[0] * this.scale, h = size[1] * this.scale;
    c.fillStyle = '#fafbf7'; c.fillRect(ox, oy, w, h);
    c.save(); c.beginPath(); c.rect(ox, oy, w, h); c.clip();
    for (let x = 0; x <= size[0]; x++) { const sx = ox + x * this.scale; if (sx < -1 || sx > this.width + 1) continue; c.strokeStyle = (x - size[0] / 2) % 4 === 0 ? '#e0e5df' : '#edf0e9'; c.beginPath(); c.moveTo(sx, oy); c.lineTo(sx, oy + h); c.stroke(); }
    for (let y = 0; y <= size[1]; y++) { const sy = oy + y * this.scale; if (sy < -1 || sy > this.height + 1) continue; c.strokeStyle = (size[1] / 2 - y) % 4 === 0 ? '#e0e5df' : '#edf0e9'; c.beginPath(); c.moveTo(ox, sy); c.lineTo(ox + w, sy); c.stroke(); }
    const cx = ox + w / 2, cy = oy + h / 2;
    c.strokeStyle = '#a5b7ac'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(cx, oy); c.lineTo(cx, oy + h); c.moveTo(ox, cy); c.lineTo(ox + w, cy); c.stroke();
    c.beginPath(); c.moveTo(ox + w - 6, cy - 3); c.lineTo(ox + w, cy); c.lineTo(ox + w - 6, cy + 3);
    c.moveTo(cx - 3, oy + 6); c.lineTo(cx, oy); c.lineTo(cx + 3, oy + 6); c.stroke();
    c.fillStyle = '#6d8578'; c.font = '10px "Courier New", monospace'; c.textAlign = 'right';
    c.fillText('X', ox + w - 10, cy - 7); c.textAlign = 'left'; c.fillText('Y', cx + 8, oy + 14);
    c.restore(); c.strokeStyle = '#a9b7aa'; c.lineWidth = 1.4; c.strokeRect(ox, oy, w, h);
    c.fillStyle = '#829085'; c.font = '10px "Courier New", monospace'; c.textAlign = 'center';
    const xStep = this.scale >= 18 ? 4 : 8, yStep = this.scale >= 18 ? 2 : 4;
    for (let x = Math.ceil(-size[0] / 2 / xStep) * xStep; x <= size[0] / 2; x += xStep) {
      const sx = ox + (x + size[0] / 2) * this.scale;
      if (sx >= 0 && sx <= this.width) c.fillText(String(x), sx, oy + h + 20);
    }
    c.textAlign = 'right';
    for (let y = Math.ceil(-size[1] / 2 / yStep) * yStep; y <= size[1] / 2; y += yStep) {
      const sy = oy + (size[1] / 2 - y) * this.scale;
      if (sy >= 0 && sy < this.height) c.fillText(String(y), ox - 12, sy + 3);
    }

  }
  draw(state: RenderState, now = performance.now()): boolean {
    let animatePreview = false;
    if (!this.width || !this.height) this.resize(); this.camera(state.project.size); this.paintBackground(state.project.size);
    const c = this.ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height); c.drawImage(this.background, 0, 0); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.save(); c.translate(...this.origin); c.scale(this.scale, this.scale); c.beginPath(); c.rect(0, 0, ...state.project.size); c.clip(); c.lineCap = 'round'; c.lineJoin = 'round';
    if (state.frame) {
      state.members.forEach((member, i) => {
        const points = state.frame!.positions, broken = !!state.frame!.broken[i], stress = state.frame!.stresses[i];
        let color = member.material === 'beam' ? PROFILES[member.profile].color : '#a2824b'; if (state.stress && !broken) color = this.stressColor(stress); if (broken) color = '#9a7469';
        c.lineWidth = member.material === 'beam' ? PROFILES[member.profile].width : 0.065; c.strokeStyle = color;
        for (let side = 0; side < 2; side++) {
          const start = member.start + side * member.half; c.beginPath(); c.moveTo(points[start * 2], points[start * 2 + 1]);
          for (let j = 1; j < member.half; j++) c.lineTo(points[(start + j) * 2], points[(start + j) * 2 + 1]); c.stroke();
          if (member.material === 'beam' && member.profile === 'h') { c.strokeStyle = '#aab8c2'; c.lineWidth = 0.035; c.stroke(); c.strokeStyle = color; c.lineWidth = PROFILES.h.width; }
        }
        const original = member.material === 'beam' ? state.project.beams[i].endpoints : state.project.ropes[i - state.project.beams.length];
        for (const [id, endpoint] of [[member.start, 0], [member.start + member.count - 1, 2]]) {
          const nodeId = key([original[endpoint], original[endpoint + 1]]);
          this.drawNode([points[id * 2], points[id * 2 + 1]], state.project.joints[nodeId] || 'x', color);
        }
        if (broken) { c.fillStyle = '#df744f'; for (const id of [member.start + member.half - 1, member.start + member.half]) { c.beginPath(); c.arc(points[id * 2], points[id * 2 + 1], 0.09, 0, Math.PI * 2); c.fill(); } }
      });
    } else {
      for (const [material, list] of [['beam', state.project.beams.map(b => b.endpoints)], ['rope', state.project.ropes]] as const) list.forEach((m, index) => {
        const profile = material === 'beam' ? state.project.beams[index].profile : 's', properties = PROFILES[profile];
        const selected = memberSelected(state.selected, material, m);
        if (selected) { c.strokeStyle = '#edb89b'; c.lineWidth = 0.34; c.beginPath(); c.moveTo(m[0], m[1]); c.lineTo(m[2], m[3]); c.stroke(); }
        c.strokeStyle = material === 'beam' ? properties.color : '#a2824b'; c.lineWidth = material === 'beam' ? properties.width : 0.065;
        c.beginPath(); c.moveTo(m[0], m[1]); c.lineTo(m[2], m[3]); c.stroke();
        if (material === 'beam' && profile !== 'l') { c.strokeStyle = profile === 'h' ? '#aab8c2' : '#6d9290'; c.lineWidth = 0.035; c.beginPath(); c.moveTo(m[0], m[1] - 0.025); c.lineTo(m[2], m[3] - 0.025); c.stroke(); }
      });
      for (const [id, p] of nodes(state.project)) {
        if (state.selected.some(s => 'node' in s && s.node === id)) { c.fillStyle = '#f2b59888'; c.beginPath(); c.arc(...p, 0.32, 0, Math.PI * 2); c.fill(); }
        this.drawNode(p, state.project.joints[id] || 'x');
      }
    }
    c.restore();
    if (state.marquee) {
      const [a, b] = state.marquee;
      c.fillStyle = '#527b7022'; c.strokeStyle = '#527b70'; c.lineWidth = 1;
      c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    this.drawOrigin(state.project.size);
    // Boundary markers remain at their original attachment positions.
    for (const [id, pt] of nodes(state.project)) if (boundary(pt, state.project.size)) this.anchor(pt, state.project.anchors[id] || 'x', state.project.size);
    if (state.editMove) {
      // The preview project already contains the proposed geometry. Use the first
      // moved endpoint's canvas position (CSS pixels) to position its label.
      const move = state.editMove, [x, y] = this.screen(move.targets[0]);
      const color = move.error ? '#ce5c49' : '#3979b7';
      c.save(); c.strokeStyle = color; c.lineWidth = 3;
      // Iterate over every beam and rope in the preview. Each m contains both
      // endpoints in grid units: [startX, startY, endX, endY].
      for (const m of [...state.project.beams.map(b => b.endpoints), ...state.project.ropes]) {
        // Highlight members attached to any moved endpoint; t is a target grid point.
        if (move.targets.some(t => (m[0] === t[0] && m[1] === t[1]) || (m[2] === t[0] && m[3] === t[1]))) {
          // a and b are the member's endpoints converted to canvas CSS pixels.
          const a = this.screen([m[0], m[1]]), b = this.screen([m[2], m[3]]);
          c.globalAlpha = 0.65; c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.stroke();
        }
      }
      c.globalAlpha = 1;
      // Iterate over the unique target nodes of the dragged object or group.
      for (const target of move.targets) {
        const [tx,ty] = this.screen(target);
        // A larger ring marks a target that will merge with a stationary node.
        const merge = move.mergeTargets.some(t => key(t) === key(target));
        c.beginPath(); c.arc(tx,ty,merge ? 13 : 9,0,Math.PI*2); c.stroke();
      }
      c.font = '12px "Courier New", monospace'; c.textAlign = 'left';
      // Signed cost difference between the preview and the committed project.
      const delta = projectCost(state.project).total - state.baseCost;
      const label = move.error ?? `${move.kind === 'paste' ? 'Paste selection' : move.kind === 'group' ? 'Move selection' : move.kind === 'beam' ? 'Move beam' : move.mergeTargets.length ? 'Merge nodes' : 'Move node'} · ${delta >= 0 ? '+' : ''}${delta} cr`;
      // Label box width in CSS pixels: measured text plus 8 px padding per side,
      // capped at the canvas width (this.width).
      const width = Math.min(this.width, c.measureText(label).width + 16);
      // Label box's left edge: prefer 16 px right of the endpoint, but keep it on canvas.
      const left = Math.max(0, Math.min(this.width - width, x + 16));
      // Text baseline, not the box's top edge: prefer 18 px above the endpoint.
      // The background starts at top - 17; these bounds keep it inside the canvas.
      const top = Math.max(22, Math.min(this.height - 8, y - 18));
      c.fillStyle = move.error ? '#fff0eb' : '#eef5fc'; c.fillRect(left, top - 17, width, 24);
      c.fillStyle = color; c.fillText(label, left + 8, top, width - 16); c.restore();
    }
    if (!state.editMove && !state.frame && state.cursor) {
      const drawing = state.start && (state.tool === 'beam' || state.tool === 'rope');
      const pt = drawing ? drawingEndpoint(state.start!, state.cursor, state.tool as Material, state.project.size) : state.cursor;
      const [sx, sy] = this.screen(pt); let error: string | null = null;
      const shortened = pt[0] !== state.cursor[0] || pt[1] !== state.cursor[1];
      const dist = drawing ? Math.hypot(pt[0] - state.start![0], pt[1] - state.start![1]) : 0;
      if (drawing && dist > 1e-8) error = validateMember(state.project, state.tool as Material, [...state.start!, ...pt]);
      if (error) { this.previewErrorSince ??= now; animatePreview = true; }
      else this.previewErrorSince = null;
      const previewColor = error ? '#ce5c49' : '#3979b7';
      if (drawing && dist > 1e-8) {
        const [ax, ay] = this.screen(state.start!);
        if (shortened) {
          const [tx, ty] = this.screen(state.cursor);
          c.save(); c.strokeStyle = '#879ba8'; c.globalAlpha = 0.55; c.lineWidth = 1; c.setLineDash([4, 6]);
          c.beginPath(); c.moveTo(sx, sy); c.lineTo(tx, ty); c.stroke(); c.restore();
        }
        const visible = !error || (now - this.previewErrorSince!) % 1000 < 650;
        if (visible) {
          c.save(); c.strokeStyle = previewColor;
          c.lineWidth = state.tool === 'beam' ? Math.max(2, PROFILES[state.profile].width * this.scale) : 2;
          c.globalAlpha = error ? 1 : 0.9; c.setLineDash(error ? [8, 5] : []);
          c.beginPath(); c.moveTo(ax, ay); c.lineTo(sx, sy); c.stroke(); c.restore();
        }
        let delta = '';
        if (!error) {
          const next = addMember(state.project, state.tool as Material, [...state.start!, ...pt], state.joint, state.profile);
          delta = ` · +${projectCost(next).total - state.baseCost} cr`;
        }
        const lines = [`${dist.toFixed(2)} / ${MAX_LENGTH[state.tool as Material]} units${delta}`];
        if (shortened && !error) lines.push('Shortened to length limit');
        c.font = '11px "Courier New", monospace';
        if (error) {
          const reason = error.startsWith('Maximum ') ? `Too long — maximum ${MAX_LENGTH[state.tool as Material]} units` : error;
          let line = '';
          // Iterate over error-message words to wrap the preview label into lines.
          for (const word of reason.split(' ')) {
            if (line && c.measureText(`${line} ${word}`).width > this.width - 26) { lines.push(line); line = word; }
            else line += `${line ? ' ' : ''}${word}`;
          }
          if (line) lines.push(line);
        }
        // Drawing-preview label dimensions in CSS pixels: widest text line plus
        // horizontal padding, and one 16 px row per line plus vertical padding.
        const width = Math.min(this.width, Math.max(...lines.map(line => c.measureText(line).width)) + 18);
        const height = lines.length * 16 + 7;
        // Unlike the drag label above, left/top are the background box's top-left
        // corner. Center it above the member's midpoint, clamped to the canvas.
        const left = Math.max(0, Math.min(this.width - width, (ax + sx) / 2 - width / 2));
        const top = Math.max(0, Math.min(this.height - height, (ay + sy) / 2 - height - 9));
        c.fillStyle = error ? '#fff0eb' : '#eef5fc'; c.fillRect(left, top, width, height);
        c.fillStyle = error ? '#b4402e' : '#285b89'; c.textAlign = 'center';
        // Draw each label line on its own baseline; i is the zero-based row index.
        lines.forEach((line, i) => c.fillText(line, left + width / 2, top + 15 + i * 16));
      }
      c.strokeStyle = previewColor; c.fillStyle = '#fefaf0'; c.lineWidth = 2;
      c.beginPath(); c.arc(sx, sy, 7, 0, Math.PI * 2); c.fill(); c.stroke(); c.beginPath(); c.moveTo(sx - 12, sy); c.lineTo(sx - 9, sy); c.moveTo(sx + 9, sy); c.lineTo(sx + 12, sy); c.moveTo(sx, sy - 12); c.lineTo(sx, sy - 9); c.moveTo(sx, sy + 9); c.lineTo(sx, sy + 12); c.stroke();
    }
    if (!animatePreview) this.previewErrorSince = null;
    return animatePreview;
  }
  private drawOrigin(size: Point): void {
    const c = this.ctx, [x, y] = this.screen([size[0] / 2, size[1] / 2]);
    const label = `(${toCentered([size[0] / 2, size[1] / 2], size).join(', ')})`;
    c.save(); c.strokeStyle = '#527b70'; c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(x - 7, y); c.lineTo(x + 7, y); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke();
    c.font = '10px "Courier New", monospace'; c.textAlign = 'left';
    c.fillStyle = '#fafbf7e8'; c.fillRect(x + 10, y - 21, c.measureText(label).width + 8, 15);
    c.fillStyle = '#527b70'; c.fillText(label, x + 14, y - 10); c.restore();
  }
  private drawNode(p: Point, type: JointType, color = '#345a60'): void {
    const c = this.ctx; c.fillStyle = type === 'o' ? '#fafbf7' : color; c.strokeStyle = color; c.lineWidth = 0.055;
    c.beginPath();
    if (type === 'o') c.arc(...p, 0.13, 0, Math.PI * 2);
    else c.rect(p[0] - 0.12, p[1] - 0.12, 0.24, 0.24);
    c.fill(); c.stroke();
  }
  private stressColor(stress: number): string { const t = Math.min(1, Math.max(0, stress)); const a = [58, 126, 107], b = [214, 84, 51]; return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; }
  private anchor(pt: Point, type: JointType, size: Point): void {
    const c = this.ctx, [sx, sy] = this.screen(pt); c.save(); c.translate(sx, sy);
    const angle = pt[0] === 0 ? Math.PI / 2 : pt[0] === size[0] ? -Math.PI / 2 : pt[1] === 0 ? Math.PI : 0; c.rotate(angle);
    c.fillStyle = '#d86635'; c.strokeStyle = '#fafbf7'; c.lineWidth = 1.5;
    if (type === 'o') { c.beginPath(); c.moveTo(0, -1); c.lineTo(-8, 11); c.lineTo(8, 11); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#fafbf7'; c.beginPath(); c.arc(0, 0, 3, 0, Math.PI * 2); c.fill(); }
    else { c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10); }
    c.restore();
  }
}
