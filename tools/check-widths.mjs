#!/usr/bin/env node
/**
 * Проверка горизонтального переполнения на десктопных ширинах.
 *
 * Сайт рассчитан на десктоп от 1280 px, мобильной вёрстки нет, поэтому проверяются
 * только широкие экраны: по умолчанию 1280, 1440 и 1920 px.
 *
 * Запуск: node tools/check-widths.mjs [1280,1440,1920]
 * Требует Chrome или Edge; путь можно задать переменной окружения CHROME_PATH.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const WIDTHS = (process.argv[2] || '1280,1440,1920').split(',').map((n) => parseInt(n.trim(), 10)).filter(Boolean);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!chrome) {
  console.error('Не найден Chrome/Edge. Укажи путь в CHROME_PATH.');
  process.exit(2);
}

const sitesDoc = JSON.parse(readFileSync(join(ROOT, 'data', 'sites.json'), 'utf8'));
const PAGES = ['index.html', 'champ.html', 'categories.html']
  .concat(sitesDoc.sites.map((site) => `pages/${site.slot}-${site.slug}.html`));

const page = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>widths</title>
<style>body{margin:0;font:12px sans-serif}iframe{border:0;display:block;height:640px}</style></head>
<body>
<pre id="result">pending</pre>
<div id="frames"></div>
<script>
const PAGES = ${JSON.stringify(PAGES)};
const WIDTHS = ${JSON.stringify(WIDTHS)};
const ROOT = ${JSON.stringify(pathToFileURL(ROOT + '/').href)};
const MAX_FRAMES = 4;
const out = [];
const jobs = [];
for (const file of PAGES) for (const width of WIDTHS) jobs.push({ file: file, width: width });
let active = 0;
let finished = false;
function finish() {
  if (finished || active > 0 || jobs.length) return;
  finished = true;
  document.getElementById('result').textContent =
    btoa(unescape(encodeURIComponent(JSON.stringify(out))));
}
function measure(job, frame) {
  try {
    const doc = frame.contentDocument;
    const root = doc.documentElement;
    const wide = [];
    doc.querySelectorAll('body *').forEach(function (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > root.clientWidth + 1 && rect.height > 0) {
        wide.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + '=' + Math.round(rect.width));
      }
    });
    out.push({ file: job.file, width: job.width, overflow: root.scrollWidth - root.clientWidth, wide: wide.slice(0, 5) });
  } catch (e) {
    out.push({ file: job.file, width: job.width, error: String(e && e.message || e) });
  }
}
function pump() {
  const container = document.getElementById('frames');
  while (active < MAX_FRAMES && jobs.length) {
    const job = jobs.shift();
    active += 1;
    const frame = document.createElement('iframe');
    frame.width = job.width;
    frame.addEventListener('load', function () {
      measure(job, frame);
      frame.remove();
      active -= 1;
      pump();
      finish();
    });
    frame.src = ROOT + job.file;
    container.appendChild(frame);
  }
  finish();
}
pump();
</script>
</body></html>`;

if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
const pagePath = join(TMP, 'widths.html');
writeFileSync(pagePath, page, 'utf8');

// Свой профиль на каждый запуск: иначе Chrome переиспользует уже открытый
// браузер пользователя, игнорирует флаги и мешает его работе.
const profileDir = join(TMP, 'chrome-profile-widths');

let dom;
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--hide-scrollbars',
    `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=20000', '--dump-dom', pathToFileURL(pagePath).href
  ], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

const match = dom.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/);
if (!match) {
  console.error('Не нашёл результат в DOM — проверь, что страницы собраны (node tools/build.mjs).');
  process.exit(1);
}

const rows = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
let problems = 0;
for (const row of rows) {
  const status = row.error ? 'ОШИБКА: ' + row.error
    : row.overflow > 0 ? 'ПЕРЕПОЛНЕНИЕ ' + row.overflow + 'px' + (row.wide.length ? ' :: ' + row.wide.join(', ') : '')
      : 'ок';
  if (row.error || row.overflow > 0) problems += 1;
  console.log(String(row.width).padStart(5) + 'px  ' + row.file.padEnd(30) + status);
}
console.log('');
console.log(problems ? `Проблем: ${problems}` : 'Горизонтального переполнения нет.');
process.exit(problems ? 1 : 0);
