#!/usr/bin/env node
/**
 * Самопроверка окружения и целостности проекта.
 *
 * Отвечает на вопросы «где я, всё ли на месте, можно ли запускать браузер». Ничего не пишет
 * на диск — безопасен для сессии в режиме только чтения.
 *
 * Запуск: node tools/doctor.mjs
 * Коды выхода: 0 — всё в порядке, 1 — есть предупреждения, 2 — есть ошибки.
 */
import { existsSync, readdirSync, readFileSync, statSync, accessSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCREENS = join(ROOT, 'Screens');
const DATA = join(ROOT, 'data');
const PAGES = join(ROOT, 'pages');

let errors = 0;
let warnings = 0;
const ok = (what, note = '') => console.log(`OK    ${what}${note ? '  ' + note : ''}`);
const warn = (what, note = '') => { warnings += 1; console.log(`WARN  ${what}${note ? '  ' + note : ''}`); };
const fail = (what, note = '') => { errors += 1; console.log(`ERROR ${what}${note ? '  ' + note : ''}`); };

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

console.log(`Проект: ${ROOT}\n`);

/* ---------- Окружение ---------- */

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok('Node', `v${process.versions.node}`);
else fail('Node', `v${process.versions.node} — нужен 20 или новее`);

try {
  accessSync(ROOT, constants.W_OK);
  ok('запись в папку проекта', 'доступна (сессия может собирать страницы)');
} catch {
  warn('запись в папку проекта', 'недоступна — это нормально для сессии только для чтения');
}

const freeGb = os.freemem() / 1024 ** 3;
if (freeGb >= 4) ok('свободная память', `${freeGb.toFixed(2)} ГБ — браузерные замеры допустимы`);
else warn('свободная память', `${freeGb.toFixed(2)} ГБ — меньше 4 ГБ, браузер не запускать`);

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const chrome = chromeCandidates.find((p) => existsSync(p));
if (chrome) ok('Chrome', chrome);
else warn('Chrome', 'не найден — palette.mjs и check-widths.mjs работать не будут');

/* ---------- Файлы ---------- */

const required = [
  'index.html',
  'assets/style.css', 'assets/app.js', 'assets/logo.svg',
  'data/sites.json', 'data/taxonomy.json', 'data/palette.json',
  'tools/build.mjs', 'tools/validate.mjs', 'tools/palette.mjs', 'tools/check-widths.mjs', 'tools/add-site.mjs',
  'README.md', 'AGENTS.md', 'STATE.md'
];
const missing = required.filter((rel) => !existsSync(join(ROOT, rel)));
if (!missing.length) ok('обязательные файлы', `${required.length} шт. на месте`);
else fail('обязательные файлы', `нет: ${missing.join(', ')}`);

/* ---------- Данные ---------- */

let sites = [];
try {
  sites = readJson('data/sites.json').sites;
  const taxonomy = readJson('data/taxonomy.json');

  const slots = sites.map((s) => s.slot);
  const unique = new Set(slots);
  if (unique.size === slots.length) ok('слоты уникальны', `${slots.length} сайтов`);
  else fail('слоты', 'есть повторы номеров');

  const ids = (list) => new Set((taxonomy[list] || []).map((x) => x.id));
  const CATS = ids('categories'), AUD = ids('audiences'), TYPES = ids('site_types'),
    STYLES = ids('styles'), TECHS = ids('techniques'), LANGS = ids('languages'), LINKS = ids('link_states'),
    SUBS = new Set((taxonomy.categories || []).flatMap((c) => (c.subs || []).map((s) => s.id)));
  const bad = [];
  for (const s of sites) {
    const check = (field, set) => {
      const values = Array.isArray(s[field]) ? s[field] : s[field] ? [s[field]] : [];
      for (const v of values) if (!set.has(v)) bad.push(`${s.slot}.${field}=${v}`);
    };
    check('categories', CATS); check('subcategories', SUBS); check('audience', AUD);
    check('site_type', TYPES); check('styles', STYLES); check('techniques', TECHS);
    for (const v of (s.facts && s.facts.languages) || []) if (!LANGS.has(v)) bad.push(`${s.slot}.languages=${v}`);
    if (!LINKS.has(s.link_state)) bad.push(`${s.slot}.link_state=${s.link_state}`);
  }
  if (!bad.length) ok('справочники', 'все id из taxonomy существуют');
  else fail('справочники', bad.slice(0, 8).join(', ') + (bad.length > 8 ? ` … ещё ${bad.length - 8}` : ''));
} catch (e) {
  fail('данные', e.message);
}

/* ---------- Скриншоты и страницы ---------- */

const screens = existsSync(SCREENS) ? readdirSync(SCREENS).filter((n) => /\.(webp|png|jpe?g|avif)$/i.test(n)) : [];
if (!screens.length) fail('Screens/', 'нет изображений');
else ok('скриншоты', `${screens.length} файлов`);

const referenced = new Set(sites.map((s) => s.screenshot).filter(Boolean));
const lostShots = [...referenced].filter((name) => !screens.includes(name));
if (lostShots.length) fail('скриншоты сайтов', `не найдены: ${lostShots.join(', ')}`);
const orphans = screens.filter((name) => !referenced.has(name));
if (orphans.length) warn('скриншоты без сайта', orphans.join(', '));

const pageFiles = existsSync(PAGES) ? readdirSync(PAGES).filter((n) => n.endsWith('.html')) : [];
if (pageFiles.length === sites.length) ok('страницы сайтов', `${pageFiles.length} файлов`);
else warn('страницы сайтов', `${pageFiles.length} файлов при ${sites.length} сайтах — возможно, нужна пересборка`);

const expectedPages = new Set(sites.map((s) => `${s.slot}-${s.slug}.html`));
const missingPages = [...expectedPages].filter((n) => !pageFiles.includes(n));
if (missingPages.length) warn('нет страниц', missingPages.slice(0, 5).join(', '));

/* ---------- Свежесть сборки ---------- */

try {
  const built = statSync(join(ROOT, 'index.html')).mtimeMs;
  const dataFiles = ['data/sites.json', 'data/taxonomy.json', 'data/palette.json'];
  const newer = dataFiles.filter((rel) => existsSync(join(ROOT, rel)) && statSync(join(ROOT, rel)).mtimeMs > built);
  if (!newer.length) ok('сборка свежая', 'данные старше страниц');
  else warn('нужна пересборка', `изменены после сборки: ${newer.join(', ')} → node tools/build.mjs`);
} catch (e) {
  warn('свежесть сборки', e.message);
}

console.log('');
if (errors) console.log(`Ошибок: ${errors}, предупреждений: ${warnings}. Нужно починить перед работой.`);
else if (warnings) console.log(`Ошибок нет, предупреждений: ${warnings}.`);
else console.log('Всё в порядке: файлы на месте, данные целы, сборка свежая.');
process.exit(errors ? 2 : warnings ? 1 : 0);
