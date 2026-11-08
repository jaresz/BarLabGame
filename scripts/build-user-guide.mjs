import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import branding from '../src/branding.json' with { type: 'json' };

const source = await readFile(resolve('docs/user-guide.md'), 'utf8');
// Vite serves public/ during development and copies it into public_html/ for production.
const outputDir = resolve('public');

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  // Keep solver references readable without creating links to Markdown files the app does not publish.
  html = html.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/g, '$1');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

const lines = source.split(/\r?\n/);
const blocks = [];
let paragraph = [];
let listType = '';
let listItems = [];
let tableRows = [];

function flushParagraph() {
  if (paragraph.length) blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  paragraph = [];
}

function flushList() {
  if (listItems.length) blocks.push(`<${listType}>${listItems.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</${listType}>`);
  listItems = [];
  listType = '';
}

function flushTable() {
  if (tableRows.length) {
    const rows = tableRows.filter(row => !/^\|?\s*:?-{3,}/.test(row));
    const [header, ...body] = rows;
    const cells = row => row.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
    blocks.push(`<div class="table-scroll"><table><thead><tr>${cells(header).map(cell => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${cells(row).map(cell => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }
  tableRows = [];
}

// Parse the guide's Markdown blocks so the shipped page stays readable without a runtime library.
for (const line of lines) {
  if (line.startsWith('|')) {
    flushParagraph();
    flushList();
    tableRows.push(line);
    continue;
  }
  flushTable();
  const heading = /^(#{1,3})\s+(.+)$/.exec(line);
  if (heading) {
    flushParagraph();
    flushList();
    const level = heading[1].length;
    blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    continue;
  }
  const ordered = /^\d+\.\s+(.+)$/.exec(line);
  const unordered = /^-\s+(.+)$/.exec(line);
  if (ordered || unordered) {
    flushParagraph();
    const nextType = ordered ? 'ol' : 'ul';
    if (listType && listType !== nextType) flushList();
    listType = nextType;
    listItems.push((ordered || unordered)[1]);
    continue;
  }
  if (!line.trim()) {
    flushParagraph();
    flushList();
    continue;
  }
  paragraph.push(line.trim());
}
flushParagraph();
flushList();
flushTable();

const content = blocks.join('\n').replaceAll('images/', 'user-guide-images/');
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Player Guide · Frame Lab</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#253c50;background:#f7f8f2;line-height:1.7}body{margin:0;padding:36px 20px}main{max-width:850px;margin:0 auto;background:#fffefa;padding:clamp(22px,5vw,56px);border:1px solid #dfe5d7;border-radius:14px;box-shadow:0 12px 48px #25391b0c}h1,h2,h3{font-family:system-ui,sans-serif;line-height:1.25;color:#334a40}h1{font-size:clamp(30px,5vw,42px);letter-spacing:-1.5px}h2{margin-top:2.2em;padding-top:.4em;border-top:1px solid #e4e9dd;font-size:25px}h3{margin-top:1.8em;font-size:19px}p,li{color:#657362}a{color:#b9552c;text-underline-offset:3px}img{display:block;max-width:100%;height:auto;margin:24px auto;border-radius:8px}code{background:#f0f3ea;padding:2px 5px;border-radius:4px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px 12px;border:1px solid #dfe5d7;text-align:left}.table-scroll{overflow-x:auto;margin:18px 0}footer{border-top:1px solid #e4e9dd;margin-top:42px;padding-top:18px;color:#8c9882;font-size:13px}@media(max-width:520px){body{padding:12px}main{padding:20px 16px}li{padding-left:2px}}
</style></head><body><main>${content}<footer>${branding.copyright}</footer></main></body></html>`;

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'user-guide.html'), page);
await cp(resolve('docs/images'), resolve(outputDir, 'user-guide-images'), { recursive: true });
console.log('Generated the in-app player guide.');
