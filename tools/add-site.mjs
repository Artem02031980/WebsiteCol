#!/usr/bin/env node
/**
 * Добавляет черновик записи о новом сайте в data/sites.json.
 *
 * Запуск: node tools/add-site.mjs <url> [--slot 006] [--name "Название"] [--slug slug]
 *
 * Скрипт намеренно ничего не выдумывает: он создаёт каркас с null и подсказывает,
 * что заполнить. Скриншот нужно положить в Screens/NNN.webp самому —
 * автоматическая съёмка не делается. Чемпионата в проекте больше нет:
 * оценок и баллов в данных нет.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));

const option = (name) => {
  const i = argv.indexOf('--' + name);
  return i === -1 ? null : argv[i + 1];
};

if (!url) {
  console.error('Использование: node tools/add-site.mjs <url> [--slot 006] [--name "Название"] [--slug slug]');
  process.exit(2);
}

let parsed;
try {
  parsed = new URL(url);
} catch (e) {
  console.error('Не разобрал адрес: ' + url);
  process.exit(2);
}

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const writeJson = (rel, data) => writeFileSync(join(ROOT, rel), JSON.stringify(data, null, 2) + '\n', 'utf8');

const sitesDoc = readJson('data/sites.json');
const screens = existsSync(join(ROOT, 'Screens'))
  ? readdirSync(join(ROOT, 'Screens')).filter((name) => /\.(webp|png|jpe?g|avif)$/i.test(name))
  : [];

const maxSlot = sitesDoc.sites.reduce((max, site) => Math.max(max, Number(site.slot) || 0), 0);
const slot = option('slot') || String(maxSlot + 1).padStart(3, '0');

if (!/^\d{3}$/.test(slot)) {
  console.error('Номер должен быть из трёх цифр, например 006.');
  process.exit(2);
}
if (sitesDoc.sites.some((site) => site.slot === slot)) {
  console.error('Сайт с номером ' + slot + ' уже есть в sites.json.');
  process.exit(2);
}

const slugify = (value) => value.toLowerCase()
  .replace(/[а-яё]/g, (ch) => ({
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
    л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  }[ch] || ch))
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const name = option('name') || parsed.hostname.replace(/^www\./, '');
const slug = option('slug') || slugify(name) || slugify(parsed.hostname);
const screenshot = screens.find((file) => file.startsWith(slot + '.')) || null;

const draft = {
  slot,
  slug,
  name,
  url,
  domain: parsed.hostname.replace(/^www\./, ''),
  screenshot,
  added: new Date().toISOString().slice(0, 10),
  link_state: 'unknown',
  description_user: null,
  description_own: null,
  description_short: null,
  categories: [],
  subcategories: [],
  audience: [],
  site_type: null,
  styles: [],
  techniques: [],
  palette: { mode: null, colors: [] },
  tech: [],
  observations: [],
  facts: {
    https: parsed.protocol === 'https:',
    country: null,
    languages: [],
    author: null,
    year: null,
    mobile: { viewport_meta: null, overflow_375: null },
    seo: { title: null, title_len: null, description: null, description_len: null, og: null, sitemap: null, robots: null, structured_data: null },
    links: { checked: 0, broken: [] },
    contacts: null,
    legal: null,
    analytics: []
  },
  notes: ''
};

sitesDoc.sites.push(draft);
sitesDoc.updated = new Date().toISOString().slice(0, 10);
writeJson('data/sites.json', sitesDoc);

console.log('Добавлен черновик ' + slot + ' — ' + name + ' (' + draft.domain + ')');
console.log('Скриншот: ' + (screenshot ? 'Screens/' + screenshot : 'НЕ НАЙДЕН — положи файл Screens/' + slot + '.webp'));
console.log('');
console.log('Что заполнить в data/sites.json (правила — data/SCHEMA.md):');
console.log('  description_own — что это, одним абзацем, человеческим языком; description_user — словами владельца');
console.log('  description_short — одна фраза до 90 символов без точки в конце');
console.log('  categories, subcategories, audience, site_type, styles, techniques, palette.colors');
console.log('  facts.country — просто «Австрия, Вена», без пояснений; facts.author — «Edoardo Lunardi — частный разработчик»');
console.log('  facts.languages — массив id из taxonomy.languages; у мультиязычных перечислить языки');
console.log('  tech (с доказательствами), observations, notes');
console.log('');
console.log('Дальше: node tools/palette.mjs && node tools/build.mjs && node tools/validate.mjs');
