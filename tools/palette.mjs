#!/usr/bin/env node
/**
 * Извлекает палитру и реальные размеры скриншотов из screens/*.webp.
 *
 * Как это работает: генерируется временная HTML-страница, которая рисует каждое изображение
 * в canvas, считает доминирующие цвета (квантование 4 бита на канал + слияние близких),
 * среднюю яркость и насыщенность. Результат кодируется в base64 и складывается в <pre>,
 * откуда его забирает Node через `chrome --headless --dump-dom`. Node-зависимостей нет.
 *
 * Запуск: node tools/palette.mjs            — обойти screens/ и обновить data/palette.json
 *         node tools/palette.mjs --dry-run  — показать результат, файл не писать
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS = join(ROOT, 'screens');
const OUT = join(ROOT, 'data', 'palette.json');
const TMP = join(ROOT, '.tmp');
const DRY = process.argv.includes('--dry-run');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('Не найден Chrome/Edge. Укажи путь в переменной окружения CHROME_PATH.');
  process.exit(2);
}

if (!existsSync(SCREENS)) {
  console.error('Нет папки screens/: ' + SCREENS);
  process.exit(2);
}

const images = readdirSync(SCREENS)
  .filter((name) => /\.(webp|png|jpe?g|avif)$/i.test(name))
  .sort();

if (!images.length) {
  console.error('В screens/ нет изображений.');
  process.exit(2);
}

/* ---------- Страница-анализатор ---------- */

const page = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>palette</title></head>
<body>
<pre id="result">pending</pre>
<script>
const FILES = ${JSON.stringify(images.map((name) => pathToFileURL(join(SCREENS, name)).href))};
const NAMES = ${JSON.stringify(images)};

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();
}
function srgb(c) { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }
function lum(r, g, b) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }

function analyze(img) {
  const maxW = 900;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  const buckets = new Map();
  let lumSum = 0, satSum = 0, count = 0;
  const step = 2;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      count += 1;
      lumSum += lum(r, g, b);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
      buckets.set(key, bucket);
    }
  }

  const list = Array.from(buckets.values())
    .map(function (b) { return { r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n), n: b.n }; })
    .sort(function (a, b) { return b.n - a.n; });

  // Слияние близких цветов (евклидово расстояние в RGB < 40)
  const merged = [];
  for (const c of list) {
    const near = merged.find(function (m) {
      return Math.sqrt(Math.pow(m.r - c.r, 2) + Math.pow(m.g - c.g, 2) + Math.pow(m.b - c.b, 2)) < 40;
    });
    if (near) {
      const total = near.n + c.n;
      near.r = Math.round((near.r * near.n + c.r * c.n) / total);
      near.g = Math.round((near.g * near.n + c.g * c.n) / total);
      near.b = Math.round((near.b * near.n + c.b * c.n) / total);
      near.n = total;
    } else {
      merged.push({ r: c.r, g: c.g, b: c.b, n: c.n });
    }
  }
  merged.sort(function (a, b) { return b.n - a.n; });

  const meanLum = count ? lumSum / count : 0;
  const meanSat = count ? satSum / count : 0;
  const share = function (lo, hi) {
    let n = 0;
    for (const c of merged) { const l = lum(c.r, c.g, c.b); if (l >= lo && l < hi) n += c.n; }
    return count ? n / count : 0;
  };
  const dark = share(0, 0.15), light = share(0.7, 1.01);

  // Режим определяем по самому частому цвету (это фон кадра), а не по средней яркости:
  // большой светлый медиаблок на тёмном сайте не должен превращать сайт в «светлый».
  const top = merged[0] || { r: 255, g: 255, b: 255, n: 1 };
  const topLum = lum(top.r, top.g, top.b);
  const topSat = Math.max(top.r, top.g, top.b) === 0 ? 0 : (Math.max(top.r, top.g, top.b) - Math.min(top.r, top.g, top.b)) / Math.max(top.r, top.g, top.b);
  let mode;
  if (topLum < 0.15) mode = 'dark';
  else if (topLum > 0.7 && topSat < 0.35) mode = 'light';
  else if (dark > 0.3 && light > 0.3) mode = 'contrast';
  else if (meanSat > 0.3) mode = 'colorful';
  else mode = 'light';

  // Оттенок фона для фильтра «цвет»
  let hue = 'mono';
  if (topSat > 0.12) {
    const r = top.r / 255, g = top.g / 255, b = top.b / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    if (h < 20 || h >= 330) hue = 'red';
    else if (h < 45) hue = 'orange';
    else if (h < 70) hue = 'yellow';
    else if (h < 165) hue = 'green';
    else if (h < 260) hue = 'blue';
    else if (h < 330) hue = 'purple';
  }

  return {
    width: img.naturalWidth, height: img.naturalHeight,
    meanLum: Math.round(meanLum * 1000) / 1000,
    meanSat: Math.round(meanSat * 1000) / 1000,
    mode: mode,
    hue: hue,
    colors: merged.slice(0, 6).map(function (c) {
      return { hex: rgbToHex(c.r, c.g, c.b), share: Math.round((c.n / count) * 1000) / 1000 };
    })
  };
}

function run() {
  let pending = FILES.length;
  const out = {};
  if (!pending) { document.getElementById('result').textContent = btoa('{}'); return; }
  FILES.forEach(function (src, index) {
    const img = new Image();
    img.onload = function () {
      try { out[NAMES[index]] = analyze(img); }
      catch (e) { out[NAMES[index]] = { error: String(e && e.message || e) }; }
      done();
    };
    img.onerror = function () {
      out[NAMES[index]] = { error: 'не загрузилось' };
      done();
    };
    img.src = src;
  });
  function done() {
    pending -= 1;
    if (pending > 0) return;
    const json = JSON.stringify(out, null, 2);
    document.getElementById('result').textContent = btoa(unescape(encodeURIComponent(json)));
  }
}
run();
</script>
</body></html>`;

if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
const pagePath = join(TMP, 'palette.html');
writeFileSync(pagePath, page, 'utf8');

/* ---------- Запуск Chrome ---------- */

// Свой профиль на каждый запуск: иначе Chrome переиспользует уже открытый
// браузер пользователя, игнорирует флаги и мешает его работе.
const profileDir = join(TMP, 'chrome-profile-palette');

const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--allow-file-access-from-files',
  '--hide-scrollbars',
  `--user-data-dir=${profileDir}`,
  '--virtual-time-budget=15000',
  '--dump-dom',
  pathToFileURL(pagePath).href
];

let dom = '';
try {
  dom = execFileSync(chrome, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  console.error('Chrome не отработал: ' + e.message);
  if (e.stdout) dom = String(e.stdout);
  if (!dom) process.exit(1);
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

const match = dom.match(/<pre id="result">([A-Za-z0-9+/=]+)<\/pre>/);
if (!match) {
  console.error('Не нашёл результат в DOM. Первые 500 символов:');
  console.error(dom.slice(0, 500));
  process.exit(1);
}

const result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));

for (const [name, info] of Object.entries(result)) {
  if (info.error) console.log('  ' + name + ' — ошибка: ' + info.error);
  else console.log('  ' + name + ' — ' + info.width + '×' + info.height + ', режим ' + info.mode +
    ', цвета: ' + info.colors.map((c) => c.hex + ' ' + Math.round(c.share * 100) + '%').join(', '));
}

if (DRY) {
  console.log('\n--dry-run: файл не записан.');
} else {
  writeFileSync(OUT, JSON.stringify({
    _comment: 'Сгенерировано tools/palette.mjs из screens/. Руками не править — перезапишется.',
    generated_from: 'screens/',
    images: result
  }, null, 2) + '\n', 'utf8');
  console.log('\nЗаписано: data/palette.json');
}
