#!/usr/bin/env node
/**
 * Сборка коллекции: data/*.json → index.html, champ.html, categories.html, pages/*.html
 *
 * Запуск: node tools/build.mjs [--quiet]
 * Зависимостей нет, только встроенные модули Node.
 *
 * Страницы генерируются целиком: разметка каталога, страниц сайтов и чемпионата живёт здесь.
 * Руками сгенерированные файлы не правим — перезапишутся.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const taxonomy = readJson('data/taxonomy.json');
const weights = readJson('data/weights.json');
const sitesDoc = readJson('data/sites.json');
const champDoc = readJson('data/champ.json');
const paletteDoc = existsSync(join(ROOT, 'data', 'palette.json')) ? readJson('data/palette.json') : { images: {} };

const sites = sitesDoc.sites;

/* ============================================================
   Утилиты
   ============================================================ */

const esc = (value) => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const index = (list) => new Map(list.map((item) => [item.id, item]));
const CATS = index(taxonomy.categories);
const AUD = index(taxonomy.audiences);
const TYPES = index(taxonomy.site_types);
const STYLES = index(taxonomy.styles);
const TECHS = index(taxonomy.techniques);
const LANGS = index(taxonomy.languages);
const MODES = index(taxonomy.palette_modes);
const LINKS = index(taxonomy.link_states);
const SECTIONS = index(taxonomy.champ_sections.list);

const TOTAL_CRITERIA = taxonomy.champ_sections.list
  .reduce((sum, section) => sum + ((weights.criteria[section.id] || []).length), 0);

/* Плоский список критериев чемпионата: каждый критерий — отдельная номинация */
const ALL_CRITERIA = taxonomy.champ_sections.list.flatMap((section) =>
  (weights.criteria[section.id] || []).map((criterion) => ({
    key: section.id + '.' + criterion.id,
    id: criterion.id,
    title: criterion.title,
    measured: criterion.measured,
    section: section.id,
    sectionTitle: section.title
  })));

const SUBS = new Map();
for (const category of taxonomy.categories) {
  for (const sub of category.subs) SUBS.set(sub.id, { ...sub, parent: category.id, parentTitle: category.title });
}

const titles = (map, ids) => (ids || []).map((id) => (map.get(id) || { title: id }).title);
const title = (map, id) => (map.get(id) || { title: id }).title;

const HUE_TITLES = {
  red: 'Красный', orange: 'Оранжевый', yellow: 'Жёлтый',
  green: 'Зелёный', blue: 'Синий', purple: 'Фиолетовый', mono: 'Нейтральный'
};

const HUE_SWATCHES = {
  red: '#D42A1F', orange: '#D97706', yellow: '#C9A227',
  green: '#1B6B3A', blue: '#1A4FBF', purple: '#6D28D9', mono: '#9A9A94'
};

const fmt = (value, digits = 1) => (value == null ? null : Number(value).toFixed(digits).replace(/\.0$/, ''));
const fmtWeight = (value) => (value == null ? null : Number(value).toFixed(2).replace(/\.?0+$/, '').replace('.', ','));
const orDash = (value) => (value == null || value === '' ? '<span class="placeholder">не измерено</span>' : esc(value));
const yesNo = (value) => (value === true ? 'да' : value === false ? 'нет' : '<span class="placeholder">не измерено</span>');
const joinOr = (list, fallback = '<span class="placeholder">не указано</span>') =>
  (list && list.length ? list.map(esc).join(', ') : fallback);

/* ============================================================
   Чемпионат: расчёт баллов
   ============================================================ */

function criterionValue(entry, key) {
  const raw = entry && entry.criteria ? entry.criteria[key] : undefined;
  if (typeof raw === 'number') return { v: raw, note: '' };
  if (raw && typeof raw === 'object' && typeof raw.v === 'number') {
    return { v: raw.v, note: raw.note || '' };
  }
  return { v: null, note: '' };
}

function computeChamp(site) {
  const entry = (champDoc.sites && champDoc.sites[site.slot]) || {};
  const profileId = (site.champ && site.champ.profile)
    || weights.nomination_profiles.by_category[(site.categories || [])[0]]
    || 'showcase';
  const profile = weights.profiles[profileId];

  const criteria = ALL_CRITERIA.map((criterion) => {
    const list = weights.criteria[criterion.section] || [];
    const sectionWeight = profile.weights[criterion.section] || 0;
    const value = criterionValue(entry, criterion.key);
    return {
      ...criterion,
      weight: list.length ? sectionWeight / list.length : 0,
      v: value.v,
      note: value.note
    };
  });

  const measured = criteria.filter((criterion) => criterion.v != null);
  const weightSum = measured.reduce((sum, criterion) => sum + criterion.weight, 0);
  const weighted = measured.reduce((sum, criterion) => sum + criterion.weight * criterion.v, 0);

  return {
    profileId,
    profile,
    criteria,
    total: weightSum ? (weighted / weightSum) * 10 : null,
    critTotal: criteria.length,
    critMeasured: measured.length,
    sectionNotes: entry.section_notes || {}
  };
}

const champ = new Map();
for (const site of sites) champ.set(site.slot, computeChamp(site));

function assignRanks(entries) {
  const sorted = entries.slice().sort((a, b) => (b.value == null ? -1 : b.value) - (a.value == null ? -1 : a.value));
  const places = new Map();
  let place = 0;
  let previous = null;
  sorted.forEach((entry, i) => {
    if (entry.value == null) { places.set(entry.slot, null); return; }
    if (previous === null || entry.value !== previous) { place = i + 1; previous = entry.value; }
    places.set(entry.slot, place);
  });
  return places;
}

const overallRanks = assignRanks(sites.map((site) => ({ slot: site.slot, value: champ.get(site.slot).total })));

/* Места по каждому критерию: критерий и есть номинация */
const criterionRanks = new Map();
for (const criterion of ALL_CRITERIA) {
  criterionRanks.set(criterion.key, assignRanks(sites.map((site) => {
    const found = champ.get(site.slot).criteria.find((item) => item.key === criterion.key);
    return { slot: site.slot, value: found ? found.v : null };
  })));
}

/* Сводка побед и призовых мест по критериям */
for (const site of sites) {
  const data = champ.get(site.slot);
  data.wins = [];
  data.soloWins = [];
  data.sharedWins = [];
  data.podiums = [];
  for (const criterion of data.criteria) {
    const ranks = criterionRanks.get(criterion.key);
    const place = ranks.get(site.slot);
    criterion.place = place || null;
    criterion.leadersCount = sites.filter((other) => ranks.get(other.slot) === 1).length;
    if (place === 1) {
      data.wins.push(criterion);
      if (criterion.leadersCount === 1) data.soloWins.push(criterion);
      else data.sharedWins.push(criterion);
    }
    if (place && place <= 3) data.podiums.push(criterion);
  }
  data.best = data.criteria
    .filter((criterion) => criterion.place != null)
    .sort((a, b) => (a.place - b.place) || (b.v - a.v))[0] || null;
}

const champion = sites
  .slice()
  .sort((a, b) => (champ.get(b.slot).total || 0) - (champ.get(a.slot).total || 0))[0];

/* ============================================================
   Общие части разметки
   ============================================================ */

const NAV = [
  { href: 'index.html', label: 'Коллекция' },
  { href: 'champ.html', label: 'Чемпионат' },
  { href: 'categories.html', label: 'Категории' }
];

function header(prefix, current) {
  return `<header class="header">
  <div class="container header__inner">
    <a class="logo" href="${prefix}/index.html">
      Коллекция сайтов
      <span class="logo__count">${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])}</span>
    </a>
    <nav class="nav" id="nav" aria-label="Основная навигация">
      <ul class="nav__list">
        ${NAV.map((item) => `<li><a class="nav__link" href="${prefix}/${item.href}"${item.href === current ? ' aria-current="page"' : ''}>${esc(item.label)}</a></li>`).join('\n        ')}
      </ul>
    </nav>
  </div>
</header>`;
}

function footer(prefix) {
  return `<footer class="footer">
  <div class="container footer__grid">
    <div>
      <h2>Коллекция</h2>
      <p>${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])} в подборке. Данные лежат в <code>data/sites.json</code>,
      страницы собираются командой <code>node tools/build.mjs</code>.</p>
    </div>
    <div>
      <h2>Разделы</h2>
      <p><a href="${prefix}/index.html">Каталог с поиском</a></p>
      <p><a href="${prefix}/champ.html">Чемпионат сайтов</a></p>
      <p><a href="${prefix}/categories.html">Категории и аудитории</a></p>
    </div>
    <div>
      <h2>Как это устроено</h2>
      <p>Оценки чемпионата выставляются по ${TOTAL_CRITERIA} критериям: каждый критерий — отдельная номинация, вес зависит от категории сайта.</p>
      <p>Чего не измерили — помечено как <span class="placeholder">не измерено</span>, а не выдумано.</p>
    </div>
  </div>
  <div class="container footer__note">
    <p>Собранный вручную каталог референсов. Скриншоты — в папке <code>Screens/</code>, схемы данных — в <code>data/SCHEMA.md</code>.</p>
  </div>
</footer>`;
}

function plural(n, forms) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

const points = (value) => `${fmt(value)} ${plural(Math.round(value), ['балл', 'балла', 'баллов'])}`;

function pageShell({ prefix, current, title: pageTitle, description, body, mainClass = '' }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="${prefix}/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${prefix}/assets/style.css">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<script>document.documentElement.classList.add('js');</script>
</head>
<body>
<a class="skip-link" href="#main">Перейти к содержимому</a>
${header(prefix, current)}
<main id="main"${mainClass ? ` class="${mainClass}"` : ''}>
${body}
</main>
${footer(prefix)}
<script src="${prefix}/assets/app.js"></script>
</body>
</html>
`;
}

/* ============================================================
   Каталог: карточки и фасеты
   ============================================================ */

function paletteFor(site) {
  const image = site.screenshot ? paletteDoc.images[site.screenshot] : null;
  const colors = (site.palette && site.palette.colors) || (image && image.colors ? image.colors.map((c) => c.hex) : []);
  return {
    colors: colors.slice(0, 5),
    mode: (site.palette && site.palette.mode) || (image && image.mode) || null,
    hue: (image && image.hue) || null,
    width: image && image.width,
    height: image && image.height,
    share: image && image.colors ? image.colors.map((c) => c.share) : []
  };
}

function searchIndex(site) {
  const parts = [
    site.name, site.domain, site.url, site.slot,
    site.description_own, site.description_user,
    (site.observations || []).join(' '),
    titles(CATS, site.categories).join(' '),
    titles(SUBS, site.subcategories).join(' '),
    titles(AUD, site.audience).join(' '),
    title(TYPES, site.site_type),
    titles(STYLES, site.styles).join(' '),
    titles(TECHS, site.techniques).join(' '),
    (site.tech || []).map((t) => t.name).join(' '),
    site.facts ? [site.facts.country, site.facts.author, site.facts.language].join(' ') : '',
    site.notes || ''
  ];
  return parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
}

function swatches(colors, size) {
  if (!colors.length) return '';
  return `<span class="swatches${size === 'big' ? ' swatches--big' : ''}" aria-hidden="true">${
    colors.map((hex) => `<span class="swatch" style="background:${esc(hex)}"></span>`).join('')
  }</span>`;
}

function card(site) {
  const data = champ.get(site.slot);
  const palette = paletteFor(site);
  const href = `pages/${site.slot}-${site.slug}.html`;
  const shot = site.screenshot;
  const total = data.total;

  const media = shot
    ? `<a class="card__media" href="${href}" tabindex="-1" aria-hidden="true">
        <img src="Screens/${esc(shot)}" alt="" width="${palette.width || 1600}" height="${palette.height || 1000}" loading="lazy" decoding="async">
      </a>`
    : `<span class="card__media card__media--empty">Скриншот ещё не добавлен в Screens/</span>`;

  const facetValues = {
    cat: (site.categories || []).join(' '),
    sub: (site.subcategories || []).join(' '),
    aud: (site.audience || []).join(' '),
    type: site.site_type || '',
    style: (site.styles || []).join(' '),
    tech: (site.techniques || []).join(' '),
    stack: (site.tech || []).map((t) => slugify(t.name)).join(' '),
    lang: site.facts && site.facts.language ? site.facts.language : '',
    mode: palette.mode || '',
    hue: palette.hue || '',
    shot: shot ? 'yes' : 'no',
    link: site.link_state || 'unknown'
  };

  const attrs = Object.entries(facetValues)
    .map(([key, value]) => `data-${key}="${esc(value)}"`)
    .join('\n      ');

  const tags = [
    ...titles(CATS, (site.categories || []).slice(0, 1)).map((t) => `<span class="tag">${esc(t)}</span>`),
    `<span class="tag">${esc(title(TYPES, site.site_type))}</span>`,
    ...titles(STYLES, (site.styles || []).slice(0, 2)).map((t) => `<span class="tag tag--muted">${esc(t)}</span>`)
  ].join('');

  return `<article class="card"
      ${attrs}
      data-slot="${esc(site.slot)}"
      data-name="${esc(site.name)}"
      data-search="${esc(searchIndex(site))}"
      data-score="${total == null ? '' : total.toFixed(2)}"
      data-added="${esc(site.added || '')}">
    ${media}
    <div class="card__body">
      <div class="card__top">
        <span class="card__slot">${esc(site.slot)}</span>
        <h3 class="card__title"><a href="${href}">${esc(site.name)}</a></h3>
      </div>
      <p class="card__domain">${esc(site.domain)}</p>
      <p class="card__desc">${esc(site.description_own)}</p>
      <div class="card__meta">${tags}</div>
      <div class="card__foot">
        <span class="score"><span class="score__value">${total == null ? '—' : Math.round(total)}</span><span class="score__of">/100 · чемпионат</span></span>
        ${swatches(palette.colors)}
        <a class="btn btn--ghost btn--small" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">Открыть сайт</a>
      </div>
    </div>
  </article>`;
}

function slugify(value) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return value.toLowerCase().replace(/[а-яё]/g, (ch) => map[ch] || ch)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function facetGroup({ group, title: groupTitle, values, open }) {
  const items = values
    .map((value) => `<label class="check${value.swatch ? ' check--swatch' : ''}">
          <input type="checkbox" data-group="${group}" data-group-title="${esc(groupTitle)}" data-label="${esc(value.title)}" value="${esc(value.id)}">
          <span${value.swatch ? ` style="--dot:${esc(value.swatch)}"` : ''}>${esc(value.title)}</span>
          <span class="facet__count">${value.count}</span>
        </label>`)
    .join('\n        ');

  if (!items) return '';
  return `<details class="facet"${open ? ' open' : ''}>
      <summary>${esc(groupTitle)}</summary>
      <div class="facet__body">
        ${items}
      </div>
    </details>`;
}

function countBy(predicate) {
  return sites.filter(predicate).length;
}

function buildFacets() {
  const usedCats = taxonomy.categories.filter((c) => countBy((s) => (s.categories || []).includes(c.id)));
  const usedSubs = [...SUBS.values()].filter((sub) => countBy((s) => (s.subcategories || []).includes(sub.id)));
  const usedAud = taxonomy.audiences.filter((a) => countBy((s) => (s.audience || []).includes(a.id)));
  const usedTypes = taxonomy.site_types.filter((t) => countBy((s) => s.site_type === t.id));
  const usedStyles = taxonomy.styles.filter((st) => countBy((s) => (s.styles || []).includes(st.id)));
  const usedTechs = taxonomy.techniques.filter((t) => countBy((s) => (s.techniques || []).includes(t.id)));
  const usedLangs = taxonomy.languages.filter((l) => countBy((s) => s.facts && s.facts.language === l.id));
  const usedLinks = taxonomy.link_states.filter((l) => countBy((s) => s.link_state === l.id));

  const stackMap = new Map();
  for (const site of sites) {
    for (const item of site.tech || []) {
      const id = slugify(item.name);
      if (!stackMap.has(id)) stackMap.set(id, { id, title: item.name, count: 0 });
      stackMap.get(id).count += 1;
    }
  }
  const usedStack = [...stackMap.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  const modeMap = new Map();
  const hueMap = new Map();
  for (const site of sites) {
    const palette = paletteFor(site);
    if (palette.mode) modeMap.set(palette.mode, (modeMap.get(palette.mode) || 0) + 1);
    if (palette.hue) hueMap.set(palette.hue, (hueMap.get(palette.hue) || 0) + 1);
  }

  return [
    { group: 'cat', title: 'Категория', open: true, values: usedCats.map((c) => ({ id: c.id, title: c.title, count: countBy((s) => (s.categories || []).includes(c.id)) })) },
    { group: 'sub', title: 'Подкатегория', values: usedSubs.map((sub) => ({ id: sub.id, title: sub.title, count: countBy((s) => (s.subcategories || []).includes(sub.id)) })) },
    { group: 'aud', title: 'Для кого', open: true, values: usedAud.map((a) => ({ id: a.id, title: a.title, count: countBy((s) => (s.audience || []).includes(a.id)) })) },
    { group: 'type', title: 'Тип сайта', open: true, values: usedTypes.map((t) => ({ id: t.id, title: t.title, count: countBy((s) => s.site_type === t.id) })) },
    { group: 'style', title: 'Визуальный стиль', values: usedStyles.map((st) => ({ id: st.id, title: st.title, count: countBy((s) => (s.styles || []).includes(st.id)) })) },
    { group: 'tech', title: 'Приёмы', values: usedTechs.map((t) => ({ id: t.id, title: t.title, count: countBy((s) => (s.techniques || []).includes(t.id)) })) },
    { group: 'stack', title: 'Технологии', values: usedStack },
    { group: 'mode', title: 'Тема палитры', values: taxonomy.palette_modes.filter((m) => modeMap.has(m.id)).map((m) => ({ id: m.id, title: m.title, count: modeMap.get(m.id) })) },
    { group: 'hue', title: 'Цвет фона', values: Object.entries(HUE_TITLES).filter(([id]) => hueMap.has(id)).map(([id, label]) => ({ id, title: label, count: hueMap.get(id), swatch: HUE_SWATCHES[id] })) },
    { group: 'lang', title: 'Язык сайта', values: usedLangs.map((l) => ({ id: l.id, title: l.title, count: countBy((s) => s.facts && s.facts.language === l.id) })) },
    { group: 'shot', title: 'Скриншот', values: [{ id: 'yes', title: 'Есть скриншот', count: countBy((s) => Boolean(s.screenshot)) }, { id: 'no', title: 'Скрин ждём', count: countBy((s) => !s.screenshot) }] },
    { group: 'link', title: 'Состояние ссылки', values: usedLinks.map((l) => ({ id: l.id, title: l.title, count: countBy((s) => s.link_state === l.id) })) }
  ].filter((group) => group.values.length);
}

/* ============================================================
   index.html
   ============================================================ */

function renderCatalog() {
  const facets = buildFacets()
    .map((group) => facetGroup(group))
    .filter(Boolean)
    .join('\n      ');

  const cards = sites
    .slice()
    .sort((a, b) => (champ.get(b.slot).total || 0) - (champ.get(a.slot).total || 0))
    .map(card)
    .join('\n    ');

  const body = `<section class="page-head container">
  <h1>Коллекция сайтов</h1>
  <p>Сайты, которые мне понравились, с разбором: что это, для кого, как сделано и как выглядит по критериям
  чемпионата. Ищите по категории, аудитории, приёму, технологии, палитре — или просто введите слово.
  Состояние фильтров попадает в адрес, такой ссылкой можно делиться.</p>
</section>

<section class="section section--tight container" aria-label="Поиск и фильтры">
  <div class="toolbar" role="search">
    <div class="search">
      <label class="search__label" for="q">Поиск по коллекции</label>
      <div class="search__row">
        <input class="search__input" id="q" type="search" autocomplete="off"
               placeholder="Название, домен, описание, приём, технология…">
        <button class="btn btn--ghost" type="button" id="copy-link">Скопировать подборку</button>
        <button class="btn btn--ghost" type="button" id="reset">Сбросить всё</button>
      </div>
    </div>
    <div class="toolbar__row">
      <div class="field">
        <label class="field__label" for="sort">Сортировка</label>
        <select id="sort">
          <option value="score">По баллу чемпионата</option>
          <option value="added">Сначала новые</option>
          <option value="name">По названию</option>
          <option value="slot">По номеру</option>
        </select>
      </div>
      <div class="field">
        <span class="field__label" id="view-label">Вид</span>
        <span class="viewswitch" role="group" aria-labelledby="view-label">
          <button class="btn btn--ghost btn--small" type="button" data-view="cards" aria-pressed="true">Карточки</button>
          <button class="btn btn--ghost btn--small" type="button" data-view="list" aria-pressed="false">Список</button>
        </span>
      </div>
      <p class="small muted" style="margin:0">Быстро: <kbd>/</kbd> — в поиск, <kbd>Esc</kbd> — очистить</p>
    </div>
  </div>

  <div class="layout" style="margin-top:var(--space-3)">
    <aside class="facets" aria-label="Фильтры">
      <div class="facets__head">
        <h2 style="margin:0;font-size:var(--fs-h3)">Фильтры</h2>
        <span class="small muted">${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])}</span>
      </div>
      ${facets}
    </aside>

    <div>
      <div class="chips" id="chips"></div>
      <div class="resultbar">
        <p class="resultbar__count" id="result-count" aria-live="polite" style="margin:0">${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])} из ${sites.length}</p>
      </div>

      <div class="grid" id="grid">
    ${cards}
      </div>

      <div class="empty" id="empty" hidden>
        <h3>Ничего не нашлось</h3>
        <p>По запросу <span id="empty-query"></span> в коллекции пусто. Попробуйте убрать часть фильтров
        или поискать по домену — например, <code>basement</code>.</p>
        <button class="btn btn--accent" type="button" id="empty-reset">Сбросить фильтры</button>
      </div>
    </div>
  </div>
</section>`;

  return pageShell({
    prefix: '.',
    current: 'index.html',
    title: 'Коллекция сайтов — каталог референсов с поиском',
    description: `Каталог понравившихся сайтов: поиск по категориям, аудиториям, приёмам и технологиям, чемпионат по ${TOTAL_CRITERIA} критериям и страница с разбором каждого сайта.`,
    body
  });
}

/* ============================================================
   champ.html
   ============================================================ */

function placeCell(place) {
  return place
    ? `<span class="rank rank--${place}"><span class="rank__dot" aria-hidden="true"></span>${place}</span>`
    : '—';
}

/* Сколько участников показывать в номинации до раскрытия остальных */
const RANKING_VISIBLE = 6;

/* Вертикальный список мест в номинации: без таблиц и горизонтальной прокрутки */
function rankingList(entries, places) {
  const rows = entries.map((entry) => {
    const place = places.get(entry.site.slot);
    return `<li class="ranking__row">
        <span class="ranking__place">${place && place <= 3 ? placeCell(place) : (place || '—')}</span>
        <span class="ranking__name"><a href="pages/${entry.site.slot}-${entry.site.slug}.html">${esc(entry.site.name)}</a></span>
        <span class="ranking__score">${fmt(entry.value.v)}</span>
      </li>`;
  });
  const visible = rows.slice(0, RANKING_VISIBLE);
  const rest = rows.slice(RANKING_VISIBLE);
  const list = (items) => `<ol class="ranking">${items.join('\n        ')}</ol>`;
  if (!rest.length) return list(visible);
  return `${list(visible)}
    <details class="ranking__more">
      <summary>Показать ещё ${rest.length} ${plural(rest.length, ['сайт', 'сайта', 'сайтов'])}</summary>
      ${list(rest)}
    </details>`;
}

function renderChamp() {
  const championData = champ.get(champion.slot);
  const sorted = sites.slice().sort((a, b) => (champ.get(b.slot).total || 0) - (champ.get(a.slot).total || 0));

  const leaderboardCards = sorted.map((site) => {
    const data = champ.get(site.slot);
    const place = overallRanks.get(site.slot);
    return `<article class="leaderboard__card">
        <div class="leaderboard__top">
          <span class="leaderboard__place">${place ? `${place} место` : 'без места'}</span>
          <h3 class="leaderboard__name"><a href="pages/${site.slot}-${site.slug}.html">${esc(site.name)}</a></h3>
          <span class="muted small">${esc(site.domain)}</span>
        </div>
        <p class="leaderboard__stats">
          <span>Итог: <strong>${fmt(data.total)}</strong> / 100</span>
          <span>Профиль: ${esc(data.profile.title)}</span>
          <span>Первых мест: <strong>${data.wins.length}</strong> из ${data.critTotal}${data.wins.length ? ` (единолично ${data.soloWins.length}, разделено ${data.sharedWins.length})` : ''}</span>
          <span>Призовых мест: <strong>${data.podiums.length}</strong></span>
          ${data.best ? `<span>Сильнее всего: ${esc(data.best.title)} — ${data.best.place} место</span>` : ''}
        </p>
        ${data.wins.length ? `<details class="ranking__more">
          <summary>Первые места: ${data.wins.length} из ${data.critTotal} — единолично ${data.soloWins.length}, разделено ${data.sharedWins.length}</summary>
          <ul class="criterion-list">
            ${data.wins.map((criterion) => `<li class="criterion">
              <span class="criterion__title"><a href="#crit-${esc(criterion.section)}-${esc(criterion.id)}">${esc(criterion.title)}</a></span>
              <span class="criterion__meta"><span>${points(criterion.v)}</span>${criterion.leadersCount > 1 ? `<span>делит место ещё с ${criterion.leadersCount - 1}</span>` : '<span>единолично</span>'}<span>${esc(criterion.sectionTitle)}</span></span>
            </li>`).join('\n            ')}
          </ul>
        </details>` : ''}
      </article>`;
  });

  /* В общем зачёте показываем верхушку, остальных прячем под раскрытие */
  const LEADERBOARD_VISIBLE = 10;
  const leaderboard = leaderboardCards.length <= LEADERBOARD_VISIBLE
    ? `<div class="leaderboard">${leaderboardCards.join('\n      ')}</div>`
    : `<div class="leaderboard">${leaderboardCards.slice(0, LEADERBOARD_VISIBLE).join('\n      ')}</div>
      <details class="ranking__more">
        <summary>Показать остальные ${leaderboardCards.length - LEADERBOARD_VISIBLE} ${plural(leaderboardCards.length - LEADERBOARD_VISIBLE, ['сайт', 'сайта', 'сайтов'])}</summary>
        <div class="leaderboard">${leaderboardCards.slice(LEADERBOARD_VISIBLE).join('\n      ')}</div>
      </details>`;

  /* Индекс критериев: всегда развёрнут, четыре колонки */
  const criteriaMap = taxonomy.champ_sections.list.map((section) => {
    const criteria = ALL_CRITERIA.filter((criterion) => criterion.section === section.id);
    return `<div class="subnav__group">
        <p class="subnav__group-title">${esc(section.title)} <span class="facet__count">${criteria.length}</span></p>
        <ul>${criteria.map((criterion) => `<li><a href="#crit-${esc(criterion.section)}-${esc(criterion.id)}">${esc(criterion.title)}</a></li>`).join('')}</ul>
      </div>`;
  }).join('\n      ');

  /* Номинации: 30 карточек по три в ряд, каждый критерий — своя карточка */
  const nominationCards = ALL_CRITERIA.map((criterion) => {
    const entries = sites
      .map((site) => ({
        site,
        value: champ.get(site.slot).criteria.find((item) => item.key === criterion.key)
      }))
      .filter((entry) => entry.value && entry.value.v != null)
      .sort((a, b) => b.value.v - a.value.v);

    const weightsUsed = entries.map((entry) => entry.value.weight);
    const minWeight = weightsUsed.length ? Math.min(...weightsUsed) : 0;
    const maxWeight = weightsUsed.length ? Math.max(...weightsUsed) : 0;
    const weightText = fmtWeight(minWeight) === fmtWeight(maxWeight)
      ? `вес ${fmtWeight(minWeight)} %`
      : `вес ${fmtWeight(minWeight)}–${fmtWeight(maxWeight)} %`;

    const places = criterionRanks.get(criterion.key);
    const leaders = entries.filter((entry) => places.get(entry.site.slot) === 1);
    const leaderText = leaders.length === 0 ? ''
      : leaders.length === 1
        ? `Победитель: <strong>${esc(leaders[0].site.name)}</strong> — ${points(leaders[0].value.v)}. `
        : `Первое место делят ${leaders.length} ${plural(leaders.length, ['сайт', 'сайта', 'сайтов'])}: ${leaders.map((entry) => esc(entry.site.name)).join(', ')} — по ${points(leaders[0].value.v)}. `;

    return `<article class="nomination" id="crit-${esc(criterion.section)}-${esc(criterion.id)}">
        <div class="nomination__head">
          <h3>${esc(criterion.title)}</h3>
          <span class="tag tag--muted">${esc(criterion.sectionTitle)}</span>
        </div>
        <p class="nomination__meta">${leaderText}${entries.length} ${plural(entries.length, ['участник', 'участника', 'участников'])} · ${weightText} · ${esc(measuredLabel(criterion.measured))}</p>
        ${rankingList(entries, places)}
      </article>`;
  }).join('\n      ');

  const sectionNotes = taxonomy.champ_sections.list.map((section) => {
    const notes = sites
      .map((site) => ({ site, note: champ.get(site.slot).sectionNotes[section.id] }))
      .filter((item) => item.note);
    if (!notes.length) return '';
    return `<details class="facet">
      <summary>${esc(section.title)} <span class="facet__count">${notes.length}</span></summary>
      <div class="facet__body">
        <dl class="specs">
          ${notes.map((item) => `<div><dt><a href="pages/${item.site.slot}-${item.site.slug}.html">${esc(item.site.name)}</a></dt><dd>${esc(item.note)}</dd></div>`).join('\n          ')}
        </dl>
      </div>
    </details>`;
  }).filter(Boolean).join('\n    ');

  const sectionWeightsList = taxonomy.champ_sections.list.map((section) => {
    const criteria = ALL_CRITERIA.filter((criterion) => criterion.section === section.id);
    const list = weights.criteria[section.id] || [];
    const items = criteria.map((criterion) => {
      const values = Object.entries(weights.profiles)
        .map(([, profile]) => `${esc(profile.title)} ${fmtWeight((profile.weights[criterion.section] || 0) / list.length)} %`)
        .join(' · ');
      return `<li><strong>${esc(criterion.title)}</strong> <span class="weights__values">— ${values}</span></li>`;
    }).join('\n        ');
    return `<details class="facet">
      <summary>${esc(section.title)} <span class="facet__count">${criteria.length}</span></summary>
      <div class="facet__body"><ul class="weights">${items}</ul></div>
    </details>`;
  }).join('\n    ');

  /* Пример весов берём из данных, чтобы текст не расходился с расчётом */
  const designCount = (weights.criteria.design || []).length || 1;
  const portfolioDesignWeight = fmtWeight((weights.profiles.portfolio.weights.design || 0) / designCount);
  const serviceDesignWeight = fmtWeight((weights.profiles.service.weights.design || 0) / designCount);

  const body = `<section class="page-head page-head--wide container">
  <h1>Чемпионат сайтов</h1>
  <p>Конкурс по ${TOTAL_CRITERIA} критериям, и каждый критерий — отдельная номинация со своим победителем
  и своим списком мест. Победы считаются по критериям отдельно от общего балла: сайт может взять много номинаций
  и всё равно проиграть в сумме, если его сильные критерии весят меньше. Оценка идёт по шкале 1–10: смотрю
  на разметку сайта, ответы сервера, проверку ссылок и скриншот — часть критериев измеряется автоматически,
  часть оценивается экспертно, и у каждой экспертной оценки есть обоснование в конце страницы.</p>
  <p>Вес критерия зависит от категории сайта: у магазина, медиа, портфолио, сервиса и промо-проекта разные
  приоритеты, поэтому один и тот же критерий даёт разный вклад в итог. Например, «Эстетика и оригинальность»
  весит ${portfolioDesignWeight} % у портфолио и ${serviceDesignWeight} % у сервиса. Итоговый балл нормируется
  в 0–100, места считаются по баллу напрямую: одинаковые баллы дают одинаковые места, и первое место может
  делиться между несколькими сайтами.</p>
  <p>Дальше по странице: индекс всех критериев, общий зачёт по итоговому баллу, ${TOTAL_CRITERIA} номинаций
  подряд с полными списками мест, обоснования оценок по разделам и методология с весами. Для быстрого перехода
  пользуйтесь индексом критериев ниже или залипающей панелью навигации — она остаётся на экране при прокрутке.
  Полный разбор каждого сайта со всеми его баллами лежит на отдельной странице: ссылка есть и в списках мест,
  и в карточках общего зачёта.</p>
</section>

<nav class="subnav" id="champ-nav" aria-label="Навигация по чемпионату">
  <div class="container subnav__row">
    <span class="subnav__count">${TOTAL_CRITERIA} критериев · ${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])}</span>
    <a class="subnav__link" href="#overall">Общий зачёт</a>
    <a class="subnav__link" href="#nominations">Номинации</a>
    <a class="subnav__link" href="#notes">Обоснования</a>
    <a class="subnav__link" href="#method">Методология</a>
  </div>
</nav>

<section class="section section--tight container" id="criteria">
  <h2>Все ${TOTAL_CRITERIA} критериев</h2>
  <p class="muted small">${taxonomy.champ_sections.list.length} разделов, ${TOTAL_CRITERIA} критериев-номинаций.
  Ссылка ведёт к номинации с полным списком мест.</p>
  <div class="subnav__map">
      ${criteriaMap}
  </div>
</section>

<section class="section section--tight container" id="overall">
  <div class="panel">
    <p class="eyebrow">Предварительный рейтинг · ${sites.length} ${plural(sites.length, ['участник', 'участника', 'участников'])} · ${TOTAL_CRITERIA} номинаций</p>
    <h2 style="margin-bottom:var(--space-1)">Абсолютный чемпион: <a href="pages/${champion.slot}-${champion.slug}.html">${esc(champion.name)}</a></h2>
    <p class="muted">${fmt(championData.total)} / 100 по профилю «${esc(championData.profile.title)}». ${esc(championData.profile.why)}</p>
    <p class="small muted">Побед в номинациях: <strong>${championData.wins.length} из ${championData.critTotal}</strong>
    (единолично ${championData.soloWins.length}, разделено ${championData.sharedWins.length}),
    призовых мест (1–3): <strong>${championData.podiums.length}</strong>.
    Рейтинг предварительный: участников пока ${sites.length}.</p>
  </div>

  <h2 style="margin-top:var(--space-4)">Общий зачёт</h2>
  <p class="muted small">Участники по порядку итогового балла. В карточке — профиль весов, первые места
  в критериях и сильные стороны; список первых мест раскрывается.</p>
  ${leaderboard}
</section>

<section class="section section--tight container" id="nominations">
  <h2>Номинации</h2>
  <p class="muted small">${TOTAL_CRITERIA} критериев, по три карточки в ряд: ${Math.ceil(TOTAL_CRITERIA / 3)} рядов.
  В каждой карточке — победитель, вес критерия и полный список мест с баллами.</p>
  <div class="nominations">
      ${nominationCards}
  </div>
  <p style="margin-top:var(--space-3)"><a class="backtotop" href="#criteria">↑ к списку критериев</a></p>
</section>

<section class="section section--tight container" id="notes">
  <h2>Обоснования оценок</h2>
  <p class="muted small">Почему баллы именно такие — по разделам, к которым относятся критерии.</p>
  ${sectionNotes}
  <p style="margin-top:var(--space-2)"><a class="backtotop" href="#criteria">↑ к списку критериев</a></p>
</section>

<section class="section section--tight container" id="method">
  <h2>Методология</h2>
  <div class="panel">
    <h3>Как считаются баллы</h3>
    <ol>
      <li>Каждый из ${TOTAL_CRITERIA} критериев получает 1–10 и оценивается отдельно — это и есть номинация.</li>
      <li>Вес критерия = вес его раздела, делённый на число критериев в этом разделе.
      Вес раздела зависит от профиля, который берётся у основной категории сайта: магазин, медиа, портфолио, сервис, промо-сайт.</li>
      <li>Итог = сумма (вес критерия × балл) / сумма весов оценённых критериев × 10. Это нормировка в 0–100.</li>
      <li>Места в каждой номинации считаются по баллу критерия напрямую: одинаковые баллы дают одинаковые места.
      Если высший балл получили несколько сайтов, первое место делится между ними, и победа засчитывается каждому —
      поэтому в карточках общего зачёта встречаются формулировки «первое место делят».</li>
    </ol>
    <h3>Что измеряется, а что оценивается</h3>
    <ul>
      <li><strong>Автоматически</strong> — HTTPS, SEO-минимум (title, description, Open Graph, sitemap, robots), стабильность по проверке ссылок.</li>
      <li><strong>Частично</strong> — адаптивность, доступность по разметке, формы, отзывы и юридическая информация на сайте.</li>
      <li><strong>Экспертно</strong> — дизайн, юзабилити, контент, интерактив, попадание в категорию. Обоснование — в разделе «Обоснования оценок».</li>
    </ul>
    <h3>Веса критериев по профилям</h3>
    <p class="small muted">Один и тот же критерий весит по-разному в зависимости от категории сайта.
    Число — сколько процентов итога даёт критерий.</p>
    ${sectionWeightsList}
    <p class="small muted" style="margin-top:var(--space-3)">Оценки выставляет агент — по разметке сайта, ответам
    сервера, проверке ссылок и скриншоту. Формула и веса — в <code>data/weights.json</code>,
    схема данных — в <code>data/SCHEMA.md</code>.</p>
  </div>
  <p style="margin-top:var(--space-2)"><a class="backtotop" href="#criteria">↑ к списку критериев</a></p>
</section>`;

  return pageShell({
    prefix: '.',
    current: 'champ.html',
    mainClass: 'page--champ',
    title: `Чемпионат сайтов — конкурс по ${TOTAL_CRITERIA} критериям`,
    description: `Рейтинг сайтов коллекции: ${TOTAL_CRITERIA} номинаций-критериев — от навигации и типографики до SEO и интерактивности, с местами и обоснованиями.`,
    body
  });
}

function measuredLabel(measured) {
  return {
    auto: 'измеряется автоматически',
    partial: 'частично измеряется',
    expert: 'экспертная оценка',
    none: 'снаружи не измеряется'
  }[measured] || measured;
}

/* ============================================================
   categories.html
   ============================================================ */

function renderCategories() {
  const categoryBlocks = taxonomy.categories
    .map((category) => {
      const inCategory = sites.filter((site) => (site.categories || []).includes(category.id));
      if (!inCategory.length) return '';
      const subs = category.subs
        .map((sub) => {
          const inSub = sites.filter((site) => (site.subcategories || []).includes(sub.id));
          if (!inSub.length) return '';
          return `<li>${esc(sub.title)}
            <span class="facet__count">${inSub.length}</span>
            <span class="small muted">— ${inSub.map((site) => `<a href="pages/${site.slot}-${site.slug}.html">${esc(site.name)}</a>`).join(', ')}</span>
          </li>`;
        })
        .filter(Boolean)
        .join('');

      return `<article class="panel">
      <h3>${esc(category.title)} <span class="small muted">${inCategory.length} ${plural(inCategory.length, ['сайт', 'сайта', 'сайтов'])}</span></h3>
      <p class="small muted">Профиль весов чемпионата: ${esc(weights.profiles[category.profile].title)} — ${esc(weights.profiles[category.profile].why)}</p>
      <ul class="small">
        ${inCategory.map((site) => `<li><a href="pages/${site.slot}-${site.slug}.html">${esc(site.name)}</a> <span class="muted">— ${esc(site.description_own.split('.')[0])}</span></li>`).join('')}
      </ul>
      ${subs ? `<details class="facet"><summary>Подкатегории</summary><div class="facet__body"><ul class="small" style="margin:0">${subs}</ul></div></details>` : ''}
      <p style="margin:var(--space-2) 0 0"><a class="btn btn--ghost btn--small" href="index.html#cat=${esc(category.id)}">Показать в каталоге</a></p>
    </article>`;
    })
    .filter(Boolean)
    .join('\n    ');

  const audienceBlocks = taxonomy.audiences
    .map((audience) => {
      const list = sites.filter((site) => (site.audience || []).includes(audience.id));
      if (!list.length) return '';
      return `<li><a href="index.html#aud=${esc(audience.id)}">${esc(audience.title)}</a>
        <span class="facet__count">${list.length}</span>
        <span class="small muted">— ${list.map((site) => esc(site.name)).join(', ')}</span></li>`;
    })
    .filter(Boolean)
    .join('\n      ');

  const typeBlocks = taxonomy.site_types
    .map((type) => {
      const list = sites.filter((site) => site.site_type === type.id);
      if (!list.length) return '';
      return `<li><a href="index.html#type=${esc(type.id)}">${esc(type.title)}</a>
        <span class="facet__count">${list.length}</span>
        <span class="small muted">— ${list.map((site) => esc(site.name)).join(', ')}</span></li>`;
    })
    .filter(Boolean)
    .join('\n      ');

  const body = `<section class="page-head container">
  <h1>Категории и аудитории</h1>
  <p>Разбивка коллекции по сферам, подкатегориям, аудиториям и типам сайтов.
  Каждая ссылка открывает каталог с уже включённым фильтром.</p>
</section>

<section class="section section--tight container">
  <h2>Категории</h2>
  <div class="grid">
    ${categoryBlocks}
  </div>
</section>

<section class="section section--tight container">
  <div class="layout">
    <div>
      <h2>Типы сайтов</h2>
      <ul class="small" style="list-style:none;padding:0">
      ${typeBlocks}
      </ul>
    </div>
    <div>
      <h2>Для кого</h2>
      <ul class="small" style="list-style:none;padding:0">
      ${audienceBlocks}
      </ul>
    </div>
  </div>
</section>`;

  return pageShell({
    prefix: '.',
    current: 'categories.html',
    title: 'Категории и аудитории коллекции',
    description: 'Разбивка коллекции сайтов по категориям, подкатегориям, аудиториям и типам сайтов со ссылками на отфильтрованный каталог.',
    body
  });
}

/* ============================================================
   pages/*.html
   ============================================================ */

function renderSite(site) {
  const data = champ.get(site.slot);
  const palette = paletteFor(site);
  const facts = site.facts || {};
  const seo = facts.seo || {};
  const links = facts.links || {};
  const notes = site.notes || '';
  const place = overallRanks.get(site.slot);
  const prefix = '..';

  const shot = site.screenshot
    ? `<figure class="shot">
      <img src="../Screens/${esc(site.screenshot)}" alt="Скриншот главной страницы ${esc(site.name)}"
           width="${palette.width || 1600}" height="${palette.height || 1000}" decoding="async" fetchpriority="high">
      <figcaption>Скриншот из <code>Screens/${esc(site.screenshot)}</code>${palette.share.length ? `, доминирующий цвет занимает ${Math.round(palette.share[0] * 100)}% кадра` : ''}.</figcaption>
    </figure>`
    : `<div class="shot--missing">Скриншот ещё не добавлен в <code>Screens/</code>.<br>Положите файл <code>${esc(site.slot)}.webp</code> и пересоберите страницы.</div>`;

  const neighbors = sites
    .slice()
    .sort((a, b) => a.slot.localeCompare(b.slot));
  const position = neighbors.findIndex((item) => item.slot === site.slot);
  const previous = neighbors[position - 1];
  const next = neighbors[position + 1];

  const similar = sites
    .filter((other) => other.slot !== site.slot)
    .map((other) => {
      const shared = [
        ...(other.categories || []).filter((id) => (site.categories || []).includes(id)),
        ...(other.styles || []).filter((id) => (site.styles || []).includes(id)),
        ...(other.techniques || []).filter((id) => (site.techniques || []).includes(id))
      ];
      return { site: other, shared };
    })
    .filter((item) => item.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length)
    .slice(0, 4);

  const paletteBlock = palette.colors.length
    ? `<div class="swatches swatches--big" aria-hidden="true">${palette.colors.map((hex) => `<span class="swatch" style="background:${esc(hex)}"></span>`).join('')}</div>
       <ul class="small mono" style="list-style:none;padding:0;margin:var(--space-2) 0 0">
       ${palette.colors.map((hex, i) => `<li>${esc(hex)}${palette.share[i] != null ? ` — ${Math.round(palette.share[i] * 100)}% кадра` : ''}</li>`).join('')}
       </ul>
       <p class="small muted" style="margin-top:var(--space-2)">${esc((site.palette && site.palette.source) || 'измерено из скриншота')}</p>`
    : `<p class="placeholder">палитра не измерена</p>`;

  /* Все 30 номинаций сайта — вертикальным списком, без таблиц */
  const criterionItems = data.criteria
    .slice()
    .sort((a, b) => ((a.place || 99) - (b.place || 99)) || (b.v - a.v))
    .map((criterion) => `<li class="criterion">
          <span class="criterion__title"><a href="../champ.html#crit-${esc(criterion.section)}-${esc(criterion.id)}">${esc(criterion.title)}</a></span>
          <span class="criterion__meta">
            <span>балл <strong>${criterion.v == null ? '—' : fmt(criterion.v)}</strong></span>
            <span>место <strong>${criterion.place || '—'}</strong> из ${sites.length}</span>
            <span>вес ${fmtWeight(criterion.weight)} %</span>
            <span>${esc(criterion.sectionTitle)}</span>
            <span>${esc(measuredLabel(criterion.measured))}</span>
          </span>
        </li>`).join('\n        ');

  const sectionNotes = taxonomy.champ_sections.list
    .map((section) => {
      const note = data.sectionNotes[section.id];
      if (!note) return '';
      return `<div><dt>${esc(section.title)}</dt><dd>${esc(note)}</dd></div>`;
    })
    .filter(Boolean)
    .join('\n        ');

  const body = `<nav class="breadcrumbs container" aria-label="Хлебные крошки">
  <ol>
    <li><a href="../index.html">Коллекция</a></li>
    <li><a href="../categories.html">${esc(title(CATS, (site.categories || [])[0]))}</a></li>
    <li>${esc(site.name)}</li>
  </ol>
</nav>

<article class="container">
  <header class="site-head">
    <p class="eyebrow">Сайт ${esc(site.slot)} · ${esc(title(TYPES, site.site_type))} · ${esc(title(CATS, (site.categories || [])[0]))}</p>
    <div class="site-head__row">
      <h1 style="margin:0">${esc(site.name)}</h1>
      ${place ? `<span class="rank rank--${place}"><span class="rank__dot" aria-hidden="true"></span>${place} место в чемпионате · ${fmt(data.total)} / 100</span>` : ''}
    </div>
    <p class="site-head__url"><a href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)}</a></p>
    <div class="site-head__actions">
      <a class="btn btn--accent" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">Открыть сайт</a>
      <a class="btn btn--ghost" href="../champ.html">Чемпионат целиком</a>
      <button class="btn btn--ghost" type="button" id="copy-link">Скопировать ссылку на страницу</button>
    </div>
    <div class="card__meta">
      ${(site.categories || []).map((id) => `<span class="tag">${esc(title(CATS, id))}</span>`).join('')}
      ${(site.subcategories || []).map((id) => `<span class="tag tag--muted">${esc(title(SUBS, id))}</span>`).join('')}
      ${(site.styles || []).map((id) => `<span class="tag tag--muted">${esc(title(STYLES, id))}</span>`).join('')}
      <span class="tag${site.link_state === 'alive' ? '' : ' tag--muted'}">${esc(title(LINKS, site.link_state))}</span>
    </div>
  </header>

  <div class="site-grid section section--tight">
    <div>
      ${shot}

      <section class="panel">
        <h2>Что это</h2>
        <p>${esc(site.description_own)}</p>
        ${site.description_user ? `<blockquote class="small muted" style="margin:0;padding-left:var(--space-2);border-left:3px solid var(--border-subtle)">Описание владельца коллекции: ${esc(site.description_user)}</blockquote>` : ''}
      </section>

      ${site.observations && site.observations.length ? `<section class="panel">
        <h2>Чем интересен</h2>
        <ul>${site.observations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </section>` : ''}

      <section class="panel">
        <h2>Все ${data.critTotal} номинаций сайта</h2>
        <p class="small muted">Итог: <strong>${fmt(data.total)} / 100</strong> по профилю «${esc(data.profile.title)}».
        Первых мест в критериях: <strong>${data.wins.length}</strong> (единолично ${data.soloWins.length}, разделено ${data.sharedWins.length}),
        призовых мест: <strong>${data.podiums.length}</strong>.
        Строки отсортированы по месту в номинации, ссылка ведёт к номинации в чемпионате.</p>
        <ol class="criterion-list">
        ${criterionItems}
        </ol>
      </section>

      ${sectionNotes ? `<section class="panel">
        <h2>Обоснования по разделам</h2>
        <dl class="specs">
        ${sectionNotes}
        </dl>
      </section>` : ''}

      ${site.unverified && site.unverified.length ? `<section class="panel">
        <h2>Что не проверено</h2>
        <ul class="small">${site.unverified.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </section>` : ''}
    </div>

    <div>
      <section class="panel">
        <h2>Паспорт</h2>
        <dl class="specs">
          <div><dt>Домен</dt><dd class="mono">${esc(site.domain)}</dd></div>
          <div><dt>Тип сайта</dt><dd>${esc(title(TYPES, site.site_type))}</dd></div>
          <div><dt>Категории</dt><dd>${joinOr(titles(CATS, site.categories))}</dd></div>
          <div><dt>Подкатегории</dt><dd>${joinOr(titles(SUBS, site.subcategories))}</dd></div>
          <div><dt>Для кого</dt><dd>${joinOr(titles(AUD, site.audience))}</dd></div>
          <div><dt>Стиль</dt><dd>${joinOr(titles(STYLES, site.styles))}</dd></div>
          <div><dt>Приёмы</dt><dd>${joinOr(titles(TECHS, site.techniques))}</dd></div>
          <div><dt>Технологии</dt><dd>${(site.tech || []).length ? site.tech.map((t) => esc(t.name)).join(', ') : '<span class="placeholder">не определено</span>'}</dd></div>
          <div><dt>Язык</dt><dd>${esc(title(LANGS, facts.language))}</dd></div>
          <div><dt>Страна</dt><dd>${orDash(facts.country)}</dd></div>
          <div><dt>Автор</dt><dd>${orDash(facts.author)}</dd></div>
          <div><dt>Год</dt><dd>${orDash(facts.year)}</dd></div>
          <div><dt>Добавлен</dt><dd>${orDash(site.added)}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Палитра</h2>
        ${paletteBlock}
        <dl class="specs" style="margin-top:var(--space-2)">
          <div><dt>Режим</dt><dd>${palette.mode ? esc(title(MODES, palette.mode)) : '<span class="placeholder">не измерено</span>'}</dd></div>
          <div><dt>Цвет фона</dt><dd>${palette.hue ? esc(HUE_TITLES[palette.hue] || palette.hue) : '<span class="placeholder">не измерено</span>'}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Чемпионат</h2>
        <p class="small muted">${place ? `${place} место из ${sites.length}` : 'место не определено'} · ${fmt(data.total)} / 100 ·
        первых мест ${data.wins.length} из ${data.critTotal}${data.best ? ` · сильнее всего: ${esc(data.best.title)} (${data.best.place} место)` : ''}</p>
        <ul class="small" style="margin:0;padding-left:var(--space-3)">
          ${data.wins.length
            ? data.wins.map((criterion) => `<li>${esc(criterion.title)} — 1 место, ${points(criterion.v)}</li>`).join('\n          ')
            : '<li class="muted">первых мест в критериях нет</li>'}
        </ul>
        <p style="margin:var(--space-2) 0 0"><a class="btn btn--ghost btn--small" href="../champ.html">Все ${TOTAL_CRITERIA} номинаций</a></p>
      </section>

      <section class="panel">
        <h2>Технические факты</h2>
        <dl class="specs">
          <div><dt>HTTPS</dt><dd>${yesNo(facts.https)}</dd></div>
          <div><dt>Meta viewport</dt><dd>${yesNo(facts.mobile && facts.mobile.viewport_meta)}</dd></div>
          <div><dt>Title</dt><dd>${seo.title ? `${esc(seo.title)} <span class="small muted">(${seo.title_len} симв.)</span>` : '<span class="placeholder">нет данных</span>'}</dd></div>
          <div><dt>Description</dt><dd>${seo.description ? `${esc(seo.description)} <span class="small muted">(${seo.description_len} симв.)</span>` : '<span class="placeholder">нет данных</span>'}</dd></div>
          <div><dt>Open Graph</dt><dd>${yesNo(seo.og)}</dd></div>
          <div><dt>Структурированные данные</dt><dd>${yesNo(seo.structured_data)}</dd></div>
          <div><dt>Sitemap</dt><dd>${orDash(seo.sitemap)}</dd></div>
          <div><dt>Robots</dt><dd>${orDash(seo.robots)}</dd></div>
          <div><dt>Аналитика</dt><dd>${(facts.analytics || []).length ? facts.analytics.map(esc).join(', ') : '<span class="placeholder">счётчиков не найдено</span>'}</dd></div>
          <div><dt>Проверено ссылок</dt><dd>${links.checked == null ? '<span class="placeholder">не проверялось</span>' : esc(links.checked)}</dd></div>
          <div><dt>Битые ссылки</dt><dd>${(links.broken || []).length ? links.broken.map(esc).join('<br>') : 'нет'}</dd></div>
          <div><dt>Контакты</dt><dd>${orDash(facts.contacts)}</dd></div>
          <div><dt>Юридическая информация</dt><dd>${orDash(facts.legal)}</dd></div>
        </dl>
      </section>

      ${(site.tech || []).length ? `<section class="panel">
        <h2>Технологии с доказательствами</h2>
        <ul class="small">
          ${site.tech.map((item) => `<li><strong>${esc(item.name)}</strong> — ${esc(item.evidence)}</li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="panel">
        <h2>Что смотреть в первую очередь</h2>
        <p class="small">${notes ? esc(notes) : '<span class="placeholder">заметок пока нет</span>'}</p>
      </section>

      ${similar.length ? `<section class="panel">
        <h2>Похожие в коллекции</h2>
        <ul class="small">
          ${similar.map((item) => `<li><a href="${item.site.slot}-${item.site.slug}.html">${esc(item.site.name)}</a>
            <span class="muted">— общее: ${esc([
              ...titles(CATS, item.shared.filter((id) => CATS.has(id))),
              ...titles(STYLES, item.shared.filter((id) => STYLES.has(id))),
              ...titles(TECHS, item.shared.filter((id) => TECHS.has(id)))
            ].join(', '))}</span></li>`).join('')}
        </ul>
      </section>` : ''}

      <nav class="panel" aria-label="Соседние сайты коллекции">
        <h2>Рядом в коллекции</h2>
        <p class="small">${previous ? `← <a href="${previous.slot}-${previous.slug}.html">${esc(previous.name)}</a>` : '<span class="muted">← это первый сайт</span>'}</p>
        <p class="small">${next ? `→ <a href="${next.slot}-${next.slug}.html">${esc(next.name)}</a>` : '<span class="muted">→ это последний сайт</span>'}</p>
      </nav>
    </div>
  </div>
</article>`;

  return pageShell({
    prefix,
    current: null,
    title: `${site.name} — разбор сайта в коллекции`,
    description: `${site.description_own.slice(0, 150)}`,
    body
  });
}

/* ============================================================
   Запись
   ============================================================ */

mkdirSync(join(ROOT, 'pages'), { recursive: true });

const written = [];
const write = (rel, content) => {
  writeFileSync(join(ROOT, rel), content, 'utf8');
  written.push(rel);
};

write('index.html', renderCatalog());
write('champ.html', renderChamp());
write('categories.html', renderCategories());

for (const site of sites) {
  write(`pages/${site.slot}-${site.slug}.html`, renderSite(site));
}

if (!QUIET) {
  console.log('Собрано страниц: ' + written.length);
  for (const rel of written) console.log('  ' + rel);
  console.log('');
  console.log('Номинаций (критериев): ' + TOTAL_CRITERIA + ', участников: ' + sites.length);
  console.log('Чемпион: ' + champion.name + ' — ' + fmt(champ.get(champion.slot).total) + ' / 100' +
    ' · побед ' + champ.get(champion.slot).wins.length + ' из ' + TOTAL_CRITERIA);
  for (const site of sites.slice().sort((a, b) => (champ.get(b.slot).total || 0) - (champ.get(a.slot).total || 0))) {
    const data = champ.get(site.slot);
    console.log('  ' + String(overallRanks.get(site.slot) || '—').padStart(2) + '. ' +
      site.name.padEnd(18) + ' ' + String(fmt(data.total)).padStart(5) + ' / 100 · побед ' +
      String(data.wins.length).padStart(2) + ' · призовых ' + String(data.podiums.length).padStart(2) +
      ' · профиль ' + data.profileId);
  }
}
