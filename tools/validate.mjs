#!/usr/bin/env node
/**
 * Проверка коллекции: данные, страницы, доступность, контраст, офлайн-режим.
 *
 * Запуск: node tools/validate.mjs [папка] [--json] [--quiet]
 * Код возврата: 0 — ошибок нет, 1 — есть ошибки, 2 — неверный вызов.
 *
 * Только встроенные модули Node; проверяются каталог и страницы сайтов.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const targetArg = argv.find((a) => !a.startsWith('--'));
const ROOT = targetArg
  ? resolve(targetArg)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = flags.has('--json');
const QUIET = flags.has('--quiet');

if (!existsSync(ROOT)) {
  console.error('Нет такой папки: ' + ROOT);
  process.exit(2);
}

const findings = [];
const push = (level, file, message) => findings.push({ level, file, message });
const error = (file, message) => push('error', file, message);
const warn = (file, message) => push('warn', file, message);
const info = (file, message) => push('info', file, message);

const readText = (rel) => {
  const path = join(ROOT, rel);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
};
const readJsonFile = (rel) => {
  const text = readText(rel);
  if (text === null) return null;
  try { return JSON.parse(text); } catch (e) { error(rel, 'не разбирается как JSON: ' + e.message); return null; }
};

/* ---------- 1. Состав файлов ---------- */

const REQUIRED = [
  'index.html',
  'assets/style.css', 'assets/app.js', 'assets/favicon.svg', 'assets/logo.svg',
  'data/sites.json', 'data/taxonomy.json', 'data/palette.json', 'data/SCHEMA.md',
  'tools/build.mjs', 'tools/validate.mjs', 'screens'
];
for (const rel of REQUIRED) {
  if (!existsSync(join(ROOT, rel))) error(rel, 'обязательный файл или папка отсутствует');
}

const taxonomy = readJsonFile('data/taxonomy.json') || {};
const sitesDoc = readJsonFile('data/sites.json') || { sites: [] };
const paletteDoc = readJsonFile('data/palette.json') || { images: {} };
const sites = sitesDoc.sites || [];

/* ---------- 2. Таксономия ---------- */

const collect = (list) => (list || []).map((item) => item.id);
const uniq = (list, label) => {
  const seen = new Set();
  for (const id of list) {
    if (seen.has(id)) error('data/taxonomy.json', `повтор id «${id}» в списке ${label}`);
    seen.add(id);
  }
};

const ids = (list) => new Set(collect(list));
const CATS = ids(taxonomy.categories);
const AUD = ids(taxonomy.audiences);
const TYPES = ids(taxonomy.site_types);
const STYLES = ids(taxonomy.styles);
const TECHS = ids(taxonomy.techniques);
const LANGS = ids(taxonomy.languages);
const LINKS = ids(taxonomy.link_states);

uniq(collect(taxonomy.categories), 'categories');
uniq(collect(taxonomy.audiences), 'audiences');
uniq(collect(taxonomy.site_types), 'site_types');
uniq(collect(taxonomy.styles), 'styles');
uniq(collect(taxonomy.techniques), 'techniques');
uniq(collect(taxonomy.languages), 'languages');
uniq(collect(taxonomy.link_states), 'link_states');

for (const category of taxonomy.categories || []) {
  uniq(collect(category.subs), `subs категории ${category.id}`);
}
for (const item of taxonomy.link_states || []) {
  if (item.id === 'alive' && item.title !== 'Действующий сайт') {
    error('data/taxonomy.json', 'состояние «alive» должно называться «Действующий сайт»');
  }
  if (item.id === 'dead' && item.title !== 'Недействующий сайт') {
    error('data/taxonomy.json', 'состояние «dead» должно называться «Недействующий сайт»');
  }
}

const SUBS = new Map();
for (const category of taxonomy.categories || []) {
  for (const sub of category.subs || []) SUBS.set(sub.id, category.id);
}

/* ---------- 3. Записи сайтов ---------- */

const slots = new Set();
const slugs = new Set();
const screens = existsSync(join(ROOT, 'screens'))
  ? readdirSync(join(ROOT, 'screens')).filter((name) => /\.(webp|png|jpe?g|avif)$/i.test(name))
  : [];
const usedscreens = new Set();

/* Поля, которые бриф удалил: их присутствие — признак старой записи */
const LEGACY_FIELDS = ['typography', 'design', 'unverified', 'personal'];

const checkIds = (site, field, set, label) => {
  for (const id of site[field] || []) {
    if (!set.has(id)) error('data/sites.json', `${site.slot}: ${label} «${id}» нет в taxonomy.json`);
  }
};

for (const site of sites) {
  const where = 'data/sites.json';
  const tag = site.slot || '(без номера)';

  if (!/^\d{3}$/.test(site.slot || '')) error(where, `${tag}: номер должен быть из трёх цифр`);
  else if (slots.has(site.slot)) error(where, `${tag}: номер повторяется`);
  else slots.add(site.slot);

  if (!/^[a-z0-9-]+$/.test(site.slug || '')) error(where, `${tag}: slug должен быть латиницей в kebab-case`);
  else if (slugs.has(site.slug)) error(where, `${tag}: slug повторяется`);
  else slugs.add(site.slug);

  if (!site.name) error(where, `${tag}: не заполнено name`);
  if (!/^https:\/\//.test(site.url || '')) error(where, `${tag}: url должен начинаться с https://`);
  if (site.domain && site.url && !site.url.includes(site.domain)) warn(where, `${tag}: домен не встречается в url`);
  if (!site.description_own) error(where, `${tag}: не заполнено description_own`);
  if (!(site.description_own || '').trim().endsWith('.')) warn(where, `${tag}: описание без точки в конце`);
  if (!site.description_short) warn(where, `${tag}: нет description_short — в карточке покажется первое предложение`);
  else {
    const short = site.description_short.trim();
    if (short.length > 90) warn(where, `${tag}: description_short длиннее 90 символов`);
    if (/[.!?]$/.test(short)) warn(where, `${tag}: description_short заканчивается знаком — в списке он лишний`);
  }

  for (const field of LEGACY_FIELDS) {
    if (site[field] !== undefined) warn(where, `${tag}: осталось устаревшее поле «${field}» — удали его`);
  }

  if (!site.categories || !site.categories.length) error(where, `${tag}: не указана ни одна категория`);
  checkIds(site, 'categories', CATS, 'категория');
  checkIds(site, 'subcategories', SUBS, 'подкатегория');
  checkIds(site, 'audience', AUD, 'аудитория');
  checkIds(site, 'styles', STYLES, 'стиль');
  checkIds(site, 'techniques', TECHS, 'приём');
  if (!TYPES.has(site.site_type)) error(where, `${tag}: неизвестный тип сайта «${site.site_type}»`);
  if (!LINKS.has(site.link_state)) error(where, `${tag}: неизвестное состояние ссылки «${site.link_state}»`);

  const facts = site.facts || {};
  if (facts.language !== undefined) error(where, `${tag}: старый формат языка — замени facts.language на массив facts.languages`);
  for (const lang of facts.languages || []) {
    if (!LANGS.has(lang)) error(where, `${tag}: язык «${lang}» нет в taxonomy.json`);
  }

  for (const sub of site.subcategories || []) {
    const parent = SUBS.get(sub);
    if (parent && !(site.categories || []).includes(parent)) {
      warn(where, `${tag}: подкатегория ${sub} относится к категории ${parent}, которой нет у сайта`);
    }
  }

  if (site.added && !/^\d{4}-\d{2}-\d{2}$/.test(site.added)) {
    warn(where, `${tag}: added не в формате YYYY-MM-DD`);
  }

  if (site.screenshot) {
    if (!screens.includes(site.screenshot)) error(where, `${tag}: нет файла screens/${site.screenshot}`);
    else usedscreens.add(site.screenshot);
  } else {
    warn(where, `${tag}: скриншот ещё не добавлен — карточка будет без превью`);
  }

  const colors = (site.palette && site.palette.colors) || [];
  if (!colors.length) warn(where, `${tag}: палитра не заполнена`);
  for (const hex of colors) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) error(where, `${tag}: цвет «${hex}» не в формате #RRGGBB`);
  }

  const measuredPalette = site.screenshot && paletteDoc.images ? paletteDoc.images[site.screenshot] : null;
  if (measuredPalette && !measuredPalette.error && colors.length) {
    const measured = new Set((measuredPalette.colors || []).map((c) => c.hex.toUpperCase()));
    const overlap = colors.filter((hex) => measured.has(hex.toUpperCase()));
    if (!overlap.length) {
      warn(where, `${tag}: ни один цвет палитры не совпал с измеренными из скриншота (${[...measured].slice(0, 3).join(', ')})`);
    }
  }

  for (const item of site.tech || []) {
    if (!item.name || !item.evidence) error(where, `${tag}: технология без доказательства: ${JSON.stringify(item)}`);
    else if (/^[^\p{L}\p{N}]/u.test(item.name)) {
      info(where, `${tag}: имя технологии «${item.name}» начинается с символа — в фильтрах покажется как «${item.name}» после замены build.mjs`);
    }
  }

  const page = `pages/${site.slot}-${site.slug}.html`;
  if (!existsSync(join(ROOT, page))) error(page, 'страница сайта не собрана — запусти node tools/build.mjs');
}

for (const file of screens) {
  if (!usedscreens.has(file)) warn('screens/' + file, 'скриншот не привязан ни к одному сайту в data/sites.json');
}

/* ---------- 4. Проверка HTML ---------- */

const lineAt = (text, position) => text.slice(0, position).split('\n').length;
const eachMatch = (text, re, fn) => {
  re.lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) fn(match);
};

const htmlFiles = ['index.html']
  .concat(sites.map((site) => `pages/${site.slot}-${site.slug}.html`));

function checkDocument(text, file) {
  const dir = dirname(join(ROOT, file));
  if (!/<html[^>]*\slang="ru"/i.test(text)) error(file, 'нет <html lang="ru">');
  if (!/<meta[^>]*charset="?UTF-8"?/i.test(text)) error(file, 'нет meta charset UTF-8');
  if (!/<meta[^>]*name="viewport"/i.test(text)) error(file, 'нет meta viewport');
  if (!/<link[^>]*rel="stylesheet"[^>]*assets\/style\.css/.test(text)) error(file, 'не подключён assets/style.css');
  if (!/id="main"/.test(text)) error(file, 'нет id="main"');
  if (!/class="skip-link"/.test(text) || !/href="#main"/.test(text)) error(file, 'нет skip-link «Перейти к содержимому» → #main');
  if (!/classList\.add\('js'\)/.test(text)) warn(file, 'нет inline-класса .js');
  if (!/assets\/logo\.svg/.test(text)) error(file, 'нет логотипа assets/logo.svg — бриф требует логотип на каждой странице');

  const title = text.match(/<title>([\s\S]*?)<\/title>/i);
  if (!title || !title[1].trim()) error(file, 'пустой <title>');
  else if (title[1].trim().length > 65) warn(file, `title длиной ${title[1].trim().length} символов — обрежется в выдаче`);

  const description = text.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i);
  if (!description || !description[1].trim()) error(file, 'нет meta description');
  else if (description[1].length > 175) warn(file, 'meta description длиннее 175 символов');

  const levels = [];
  eachMatch(text, /<h([1-6])\b/gi, (m) => levels.push(Number(m[1])));
  const h1Count = levels.filter((level) => level === 1).length;
  if (h1Count !== 1) error(file, `тегов <h1>: ${h1Count}, нужен ровно один`);
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      error(file, `пропуск уровня заголовков: h${levels[i - 1]} → h${levels[i]}`);
      break;
    }
  }

  eachMatch(text, /\s(?:src|href)="([^"]+)"/gi, (m) => {
    const ref = m[1];
    if (/^(https?:)?\/\//i.test(ref) || /^(mailto:|tel:|data:|javascript:)/i.test(ref)) return;
    if (ref.startsWith('#')) return;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return;
    if (!existsSync(join(dir, clean))) error(file, `локальный ресурс не найден: ${clean}`);
  });

  eachMatch(text, /<img\b[^>]*>/gi, (m) => {
    const tag = m[0];
    const line = lineAt(text, m.index);
    if (!/\salt="([^"]*)"/i.test(tag)) error(`${file}:${line}`, '<img> без атрибута alt');
    if (!/\swidth=/i.test(tag) || !/\sheight=/i.test(tag)) warn(`${file}:${line}`, '<img> без width/height — макет прыгнет при загрузке');
    if (!/\sloading="lazy"/i.test(tag) && !/\sfetchpriority="high"/i.test(tag)) {
      warn(`${file}:${line}`, 'нет loading="lazy" и нет fetchpriority="high"');
    }
    if (/\starget="_blank"/i.test(tag) && !/\srel="[^"]*noopener/i.test(tag)) {
      warn(`${file}:${line}`, 'target="_blank" без rel="noopener noreferrer"');
    }
  });

  eachMatch(text, /<a\b[^>]*>\s*<\/a>/gi, (m) => warn(`${file}:${lineAt(text, m.index)}`, 'пустая ссылка'));
}

for (const file of htmlFiles) {
  const text = readText(file);
  if (text === null) { error(file, 'файл отсутствует'); continue; }
  checkDocument(text, file);
}

/* ---------- 5. CSS и JS ---------- */

const css = readText('assets/style.css');
if (css) {
  if (!/:root\s*\{/.test(css)) error('assets/style.css', 'нет блока :root с токенами');
  if (!/:focus-visible/.test(css)) error('assets/style.css', 'нет :focus-visible — фокус не видно');
  if (!/@media\s*\(\s*prefers-reduced-motion/.test(css)) error('assets/style.css', 'нет prefers-reduced-motion');
  if (!/scroll-margin-top/.test(css)) warn('assets/style.css', 'нет scroll-margin-top');
  if (!/overflow-x/.test(css)) warn('assets/style.css', 'нет overflow-x: clip — риск горизонтальной прокрутки');
  if (/overflow-x:\s*hidden/.test(css)) {
    warn('assets/style.css', 'overflow-x: hidden на html/body ломает position: sticky — используй overflow-x: clip');
  }
  if (/position:\s*sticky/.test(css) && !/overflow-x:\s*clip/.test(css)) {
    warn('assets/style.css', 'есть position: sticky, но нет overflow-x: clip');
  }
  if (!/@media\s*\(max-width/.test(css)) error('assets/style.css', 'нет адаптивных breakpoint-ов (@media max-width) — бриф требует адаптивность');
  if (/min-width:\s*1280px/.test(css)) error('assets/style.css', 'остался min-width: 1280px — сайт больше не только десктопный');
}

const js = readText('assets/app.js');
if (js) {
  if (!/Escape/.test(js)) warn('assets/app.js', 'Escape не обрабатывается (сброс поиска)');
  if (/window\.innerWidth/.test(js)) warn('assets/app.js', 'innerWidth в JS: раскладку должен решать CSS');
}

/* ---------- 6. Контраст токенов ---------- */

const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const parseColor = (value) => {
  const hex = String(value || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

if (css) {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (block) {
    const vars = {};
    eachMatch(block[1], /(--[\w-]+)\s*:\s*([^;]+);/g, (m) => { vars[m[1]] = m[2].trim(); });
    const pairs = [
      ['--text', '--bg', 4.5], ['--text', '--bg-elevated', 4.5], ['--text', '--bg-sunken', 4.5],
      ['--text-muted', '--bg', 4.5], ['--text-muted', '--bg-elevated', 4.5], ['--text-muted', '--bg-sunken', 4.5],
      ['--accent', '--bg', 4.5], ['--accent-hover', '--bg', 4.5],
      ['--on-accent', '--accent', 4.5], ['--on-accent', '--accent-hover', 4.5],
      ['--ok', '--bg', 4.5], ['--danger', '--bg', 4.5], ['--warn', '--bg', 4.5],
      ['--danger', '--danger-soft', 4.5], ['--warn', '--warn-soft', 4.5],
      ['--border-strong', '--bg', 3], ['--border-strong', '--bg-elevated', 3], ['--border-strong', '--bg-sunken', 3]
    ];
    for (const [fg, bg, min] of pairs) {
      const fgColor = parseColor(vars[fg]);
      const bgColor = parseColor(vars[bg]);
      if (!fgColor || !bgColor) continue;
      const ratio = contrast(fgColor, bgColor);
      const message = `контраст ${fg} на ${bg} = ${ratio.toFixed(2)}:1 (нужно ≥ ${min}:1)`;
      if (ratio < min) error('assets/style.css', message);
      else info('assets/style.css', message);
    }
  }
}

/* ---------- 7. Офлайн-режим и заглушки ---------- */

const externalHosts = new Map();
for (const file of htmlFiles.concat(['assets/style.css', 'assets/app.js'])) {
  const text = readText(file);
  if (!text) continue;
  eachMatch(text, /\s(?:src|href)="((?:https?:)?\/\/[^"]+)"/gi, (m) => {
    try {
      const url = new URL(m[1], 'https://example.invalid');
      if (m[1].startsWith('//')) { externalHosts.set('протокол-относительный: ' + m[1], file); return; }
      externalHosts.set(url.host, file);
    } catch (e) { /* игнорируем */ }
  });
}
if (externalHosts.size) {
  const list = [...externalHosts.keys()].join(', ');
  info('внешние ссылки', `исходящие ссылки на: ${list} — это ссылки на сайты коллекции, ресурсы страницы локальные`);
}

let placeholderCount = 0;
for (const file of htmlFiles) {
  const text = readText(file);
  if (!text) continue;
  const visible = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const found = visible.match(/\[[^\]\n]{2,60}\]/g) || [];
  if (found.length) info(file, 'заглушки в тексте: ' + [...new Set(found)].join('  '));
  placeholderCount += (text.match(/class="[^"]*\bplaceholder\b[^"]*"/g) || []).length;
}
if (placeholderCount) info('страницы', `элементов .placeholder (не заполнено): ${placeholderCount}`);

/* ---------- 8. Сводка по данным ---------- */

if (!AS_JSON) {
  for (const site of sites) {
    const langs = (site.facts && site.facts.languages) || [];
    info('данные', `${site.slot} ${site.name}: ${(site.observations || []).length} наблюдений, ` +
      `${(site.tech || []).length} технологий, языки: ${langs.join(', ') || '—'}`);
  }
}

/* ---------- 9. Итог ---------- */

const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.level] - order[b.level]);
const counts = { error: 0, warn: 0, info: 0 };
for (const finding of findings) counts[finding.level] += 1;

const labels = { error: 'ERROR', warn: 'WARN ', info: 'INFO ' };

if (AS_JSON) {
  console.log(JSON.stringify({ root: ROOT, counts, findings }, null, 2));
} else {
  for (const finding of findings) {
    if (QUIET && finding.level !== 'error') continue;
    console.log(labels[finding.level] + ' ' + finding.file + '  ' + finding.message);
  }
  console.log('');
  console.log('Проект: ' + ROOT);
  console.log('Ошибок: ' + counts.error + ', предупреждений: ' + counts.warn + ', заметок: ' + counts.info);
  console.log(counts.error ? 'Результат: есть ошибки.' : 'Результат: ошибок нет.');
}

process.exit(counts.error ? 1 : 0);
