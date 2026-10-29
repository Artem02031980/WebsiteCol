#!/usr/bin/env node
/**
 * Сборка коллекции: data/*.json → index.html, pages/*.html
 *
 * Запуск: node tools/build.mjs [--quiet]
 * Зависимостей нет, только встроенные модули Node.
 *
 * Страницы генерируются целиком из данных: руками их не правим — перезапишутся.
 * Чемпионата в проекте больше нет: есть каталог и страница-разбор на каждый сайт.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.argv.includes('--quiet');

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const taxonomy = readJson('data/taxonomy.json');
const sitesDoc = readJson('data/sites.json');
const paletteDoc = existsSync(join(ROOT, 'data', 'palette.json'))
  ? readJson('data/palette.json')
  : { images: {} };

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
const orDash = (value) => (value == null || value === '' ? '<span class="placeholder">не указано</span>' : esc(value));
const yesNo = (value) => (value === true ? 'да' : value === false ? 'нет' : '<span class="placeholder">не измерено</span>');
const joinOr = (list, fallback = '<span class="placeholder">не указано</span>') =>
  (list && list.length ? list.map(esc).join(', ') : fallback);

/* Дата добавления: YYYY-MM-DD → ДД.ММ.ГГГГ */
const fmtDate = (value) => {
  if (!value) return '<span class="placeholder">не указано</span>';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? esc(`${m[3]}.${m[2]}.${m[1]}`) : esc(value);
};

/* Короткая фраза для карточек: в данных лежит description_short,
   старые записи без него показывают первое предложение длинного описания. */
const shortDescription = (site) => {
  const short = String(site.description_short || '').trim();
  return short || String(site.description_own || '').split('.')[0];
};

function plural(n, forms) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

function slugify(value) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  return value.toLowerCase().replace(/[а-яё]/g, (ch) => map[ch] || ch)
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* ============================================================
   Сортировка значений фильтров
   ============================================================ */

const startsLatin = (value) => /^[A-Za-z]/.test(String(value || '').trim());
const collator = new Intl.Collator('ru', { sensitivity: 'base' });

/* По алфавиту; названия, начинающиеся с латиницы, — в конце (или в начале, если latinLast=false) */
function sortFacetValues(values, latinLast) {
  return values.slice().sort((a, b) => {
    const la = startsLatin(a.title);
    const lb = startsLatin(b.title);
    if (la !== lb) return latinLast ? (la ? 1 : -1) : (la ? -1 : 1);
    return collator.compare(a.title, b.title);
  });
}

/* Технологии: значение не должно начинаться с символа —
   «@react-three/drei» → «React (@react-three/drei)»; имена без @ не трогаем */
function displayTechName(name) {
  const value = String(name);
  if (!value.startsWith('@')) return value;
  return value.replace(/@([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)/g, (match, scope, pkg) => {
    const label = scope.split('-')[0];
    return label.charAt(0).toUpperCase() + label.slice(1) + ` (@${scope}/${pkg})`;
  });
}

/* Фильтр «Технологии»: версии и описательные хвосты не должны плодить
   отдельные пункты. «Astro v6.1.6» и «Astro» — один пункт, «GSAP со
   ScrollTrigger» — тоже GSAP. На странице сайта при этом остаются полные
   названия с версиями и плагинами, это только ключ фильтра. */
function techFilterName(name) {
  let value = String(name || '').trim();
  value = value.replace(/\s+v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.]+)?\b/gi, '');
  value = value.replace(/\s+r\d+\b/gi, '');
  value = value.replace(/\s*\([^)]*\)\s*$/g, '');

  const families = [
    [/^GSAP\b/i, 'GSAP'],
    [/^Next\.js\b/i, 'Next.js'],
    [/^next\/(?:font|image)\b/i, 'Next.js'],
    [/^Nuxt\b/i, 'Nuxt'],
    [/^React Three Fiber\b/i, 'React Three Fiber'],
    [/^@react-three\/(?:fiber|drei)\b/i, 'React Three Fiber'],
    [/^React\b/i, 'React'],
    [/^Vue\b/i, 'Vue'],
    [/^Astro\b/i, 'Astro'],
    [/^SvelteKit\b/i, 'SvelteKit'],
    [/^(Framer Motion|Motion)\b/i, 'Framer Motion'],
    [/^three\.js\b/i, 'three.js'],
    [/^Lenis\b/i, 'Lenis'],
    [/^Barba\.js\b/i, 'Barba.js'],
    [/^jQuery\b/i, 'jQuery'],
    [/^Tailwind\b/i, 'Tailwind CSS'],
    [/^Sanity\b/i, 'Sanity'],
    [/^Mux\b/i, 'Mux'],
    [/^Cloudflare\b/i, 'Cloudflare'],
    [/^Vercel\b/i, 'Vercel'],
    [/^Webflow\b/i, 'Webflow'],
    [/^(Headless WordPress|WordPress)\b/i, 'WordPress'],
    [/^Framer\b/i, 'Framer'],
    [/^Web Audio( API)?\b/i, 'Web Audio API'],
    [/^Plausible\b/i, 'Plausible'],
    [/^PostHog\b/i, 'PostHog'],
    [/^Google Tag Manager\b/i, 'Google Tag Manager'],
    [/^Google Analytics 4\b/i, 'Google Analytics 4'],
    [/^PlayCanvas\b/i, 'PlayCanvas'],
    [/^Rive\b/i, 'Rive'],
    [/^Spline\b/i, 'Spline'],
    [/^Unity\b/i, 'Unity'],
    [/^Vite\b/i, 'Vite'],
    [/^Turbopack\b/i, 'Turbopack'],
    [/^nginx\b/i, 'nginx'],
    [/^OpenResty\b/i, 'OpenResty'],
    [/^AWS EC2\b/i, 'AWS EC2'],
    [/^Google Fonts\b/i, 'Google Fonts']
  ];
  for (const [re, label] of families) if (re.test(value)) return label;

  value = value.split(/\s+(?:—|–|\+)\s+|\s+со\s+|\s+с\s+|\s+и\s+|\s+в\s+|\s+на\s+|\s+для\s+|\s+как\s+|\s+вместо\s+|,\s+/i)[0].trim();
  return value;
}

/* ============================================================
   Палитра
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

function swatches(colors, size) {
  if (!colors.length) return '';
  return `<span class="swatches${size === 'big' ? ' swatches--big' : ''}" aria-hidden="true">${
    colors.map((hex) => `<span class="swatch" style="background:${esc(hex)}"></span>`).join('')
  }</span>`;
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
    titles(LANGS, (site.facts && site.facts.languages) || []).join(' '),
    site.facts ? [site.facts.country, site.facts.author].join(' ') : '',
    site.notes || ''
  ];
  return parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
}

/* ============================================================
   Общие части разметки
   ============================================================ */

function header(prefix) {
  return `<header class="header">
  <div class="container header__inner">
    <a class="header__logo" href="${prefix}/index.html" aria-label="Коллекция сайтов — на главную">
      <img src="${prefix}/assets/logo.svg" alt="Коллекция сайтов" width="430" height="86" fetchpriority="high">
    </a>
  </div>
</header>`;
}

function footer() {
  return `<footer class="footer">
  <div class="container">
    <p>${sites.length} ${plural(sites.length, ['сайт', 'сайта', 'сайтов'])} в подборке · Личная коллекция Хмелёва Артёма</p>
  </div>
</footer>`;
}

function pageShell({ prefix, title: pageTitle, description, body }) {
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
${header(prefix)}
<main id="main">
${body}
</main>
${footer()}
<script src="${prefix}/assets/app.js"></script>
</body>
</html>
`;
}

/* ============================================================
   Каталог: карточки и фасеты
   ============================================================ */

function linkStateBadge(site) {
  if (site.link_state === 'dead') return '<span class="card__state card__state--dead">Сайт недоступен</span>';
  if (site.link_state === 'moved') return '<span class="card__state card__state--moved">Сайт переехал</span>';
  return '';
}

function card(site) {
  const palette = paletteFor(site);
  const href = `pages/${site.slot}-${site.slug}.html`;
  const shot = site.screenshot;

  const media = shot
    ? `<a class="card__media" href="${href}" tabindex="-1" aria-hidden="true">
        <img src="screens/${esc(shot)}" alt="" width="${palette.width || 1600}" height="${palette.height || 1000}" loading="lazy" decoding="async">
      </a>`
    : `<span class="card__media card__media--empty">Скриншот ещё не добавлен в screens/</span>`;

  const facetValues = {
    cat: (site.categories || []).join(' '),
    sub: (site.subcategories || []).join(' '),
    aud: (site.audience || []).join(' '),
    type: site.site_type || '',
    style: (site.styles || []).join(' '),
    tech: (site.techniques || []).join(' '),
    stack: [...new Set((site.tech || []).map((t) => slugify(techFilterName(t.name))).filter(Boolean))].join(' '),
    lang: (site.facts && site.facts.languages ? site.facts.languages : []).join(' '),
    mode: palette.mode || '',
    hue: palette.hue || '',
    link: site.link_state || 'unknown'
  };

  const attrs = Object.entries(facetValues)
    .map(([key, value]) => `data-${key}="${esc(value)}"`)
    .join('\n      ');

  return `<article class="card"
      ${attrs}
      data-slot="${esc(site.slot)}"
      data-name="${esc(site.name)}"
      data-search="${esc(searchIndex(site))}">
    ${media}
    <div class="card__body">
      <div class="card__top">
        <span class="card__slot">${esc(site.slot)}</span>
        <h3 class="card__title"><a href="${href}">${esc(site.name)}</a></h3>
        ${linkStateBadge(site)}
      </div>
      <p class="card__desc">${esc(shortDescription(site))}</p>
      <div class="card__foot">
        ${swatches(palette.colors)}
        <a class="card__open" href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">Открыть сайт ↗</a>
      </div>
    </div>
  </article>`;
}

function facetGroup({ group, title: groupTitle, values }) {
  const items = values
    .map((value) => `<label class="check${value.swatch ? ' check--swatch' : ''}">
          <input type="checkbox" data-group="${group}" data-group-title="${esc(groupTitle)}" data-label="${esc(value.title)}" value="${esc(value.id)}">
          <span${value.swatch ? ` style="--dot:${esc(value.swatch)}"` : ''}>${esc(value.title)}</span>
          <span class="facet__count">${value.count}</span>
        </label>`)
    .join('\n        ');

  if (!items) return '';
  return `<details class="facet">
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
  const usedLangs = taxonomy.languages.filter((l) => countBy((s) => (s.facts && s.facts.languages || []).includes(l.id)));
  const usedLinks = taxonomy.link_states.filter((l) => countBy((s) => s.link_state === l.id));

  const stackMap = new Map();
  for (const site of sites) {
    const seen = new Set();
    for (const item of site.tech || []) {
      const name = techFilterName(item.name);
      /* В фильтр идут только названия технологий: русские описательные
         заметки вроде «Чего нет» или «Собственный бандл» — не фильтр. */
      if (!name || !/[A-Za-z]/.test(name)) continue;
      const id = slugify(name);
      if (!stackMap.has(id)) stackMap.set(id, { id, title: displayTechName(name), count: 0 });
      if (!seen.has(id)) {
        stackMap.get(id).count += 1;
        seen.add(id);
      }
    }
  }
  const usedStack = [...stackMap.values()];

  const modeMap = new Map();
  const hueMap = new Map();
  for (const site of sites) {
    const palette = paletteFor(site);
    if (palette.mode) modeMap.set(palette.mode, (modeMap.get(palette.mode) || 0) + 1);
    if (palette.hue) hueMap.set(palette.hue, (hueMap.get(palette.hue) || 0) + 1);
  }

  const groups = [
    { group: 'cat', title: 'Категория', values: sortFacetValues(usedCats.map((c) => ({ id: c.id, title: c.title, count: countBy((s) => (s.categories || []).includes(c.id)) })), true) },
    { group: 'sub', title: 'Подкатегория', values: sortFacetValues(usedSubs.map((sub) => ({ id: sub.id, title: sub.title, count: countBy((s) => (s.subcategories || []).includes(sub.id)) })), true) },
    { group: 'aud', title: 'Для кого', values: sortFacetValues(usedAud.map((a) => ({ id: a.id, title: a.title, count: countBy((s) => (s.audience || []).includes(a.id)) })), true) },
    { group: 'type', title: 'Тип сайта', values: sortFacetValues(usedTypes.map((t) => ({ id: t.id, title: t.title, count: countBy((s) => s.site_type === t.id) })), true) },
    { group: 'style', title: 'Визуальный стиль', values: sortFacetValues(usedStyles.map((st) => ({ id: st.id, title: st.title, count: countBy((s) => (s.styles || []).includes(st.id)) })), true) },
    { group: 'tech', title: 'Приёмы', values: sortFacetValues(usedTechs.map((t) => ({ id: t.id, title: t.title, count: countBy((s) => (s.techniques || []).includes(t.id)) })), true) },
    { group: 'stack', title: 'Технологии', values: sortFacetValues(usedStack, false) },
    { group: 'mode', title: 'Тема палитры', values: sortFacetValues(taxonomy.palette_modes.filter((m) => modeMap.has(m.id)).map((m) => ({ id: m.id, title: m.title, count: modeMap.get(m.id) })), true) },
    { group: 'hue', title: 'Цвет фона', values: sortFacetValues(Object.entries(HUE_TITLES).filter(([id]) => hueMap.has(id)).map(([id, label]) => ({ id, title: label, count: hueMap.get(id), swatch: HUE_SWATCHES[id] })), true) },
    { group: 'lang', title: 'Язык сайта', values: sortFacetValues(usedLangs.map((l) => ({ id: l.id, title: l.title, count: countBy((s) => (s.facts && s.facts.languages || []).includes(l.id)) })), true) }
  ];

  /* Состояние ссылки появляется только когда в коллекции есть неживые ссылки:
     проверки идут по прямой команде, и пока всё живо — чекбокс не нужен. */
  const hasInactive = sites.some((s) => s.link_state !== 'alive');
  if (hasInactive) {
    groups.push({ group: 'link', title: 'Состояние ссылки', values: sortFacetValues(usedLinks.map((l) => ({ id: l.id, title: l.title, count: countBy((s) => s.link_state === l.id) })), true) });
  }

  return groups.filter((group) => group.values.length);
}

/* ============================================================
   index.html
   ============================================================ */

function renderCatalog() {
  const facets = buildFacets()
    .map((group) => facetGroup(group))
    .filter(Boolean)
    .join('\n      ');

  /* По умолчанию каталог открывается с конца коллекции: свежие сайты сверху */
  const cards = sites
    .slice()
    .sort((a, b) => b.slot.localeCompare(a.slot))
    .map(card)
    .join('\n    ');

  const body = `<section class="hero container">
  <h1 class="visually-hidden">Коллекция сайтов — каталог понравившихся сайтов</h1>
  <p class="hero__text">Личная коллекция сайтов, которые запомнились: каждый — со своей страницей-разбором,
  где видно, что это, чем интересен, кто и на чём сделал. Ищите по категории, стилю, приёму, технологии
  или палитре, сочетайте фильтры и делитесь ссылкой на подборку.</p>
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
          <option value="slot-desc" selected>По номеру с конца</option>
          <option value="slot">По номеру</option>
          <option value="name">По названию</option>
        </select>
      </div>
      <div class="field">
        <span class="field__label" id="view-label">Вид</span>
        <span class="viewswitch" role="group" aria-labelledby="view-label">
          <button class="btn btn--ghost btn--small" type="button" data-view="cards" aria-pressed="true">Карточки</button>
          <button class="btn btn--ghost btn--small" type="button" data-view="list" aria-pressed="false">Список</button>
        </span>
      </div>
      <p class="small muted toolbar__hint">Быстро: <kbd>/</kbd> — в поиск, <kbd>Esc</kbd> — очистить</p>
    </div>
  </div>

  <div class="layout">
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
    title: 'Коллекция сайтов — каталог референсов',
    description: `Личная коллекция сайтов с разбором каждого: ${sites.length} сайтов, поиск по категориям, стилям, приёмам, технологиям и палитрам, отдельная страница на каждый сайт.`,
    body
  });
}

/* ============================================================
   pages/*.html
   ============================================================ */

function renderSite(site) {
  const palette = paletteFor(site);
  const facts = site.facts || {};
  const seo = facts.seo || {};
  const links = facts.links || {};
  const notes = site.notes || '';
  const prefix = '..';

  const shot = site.screenshot
    ? `<figure class="shot">
      <img src="../screens/${esc(site.screenshot)}" alt="Скриншот главной страницы ${esc(site.name)}"
           width="${palette.width || 1600}" height="${palette.height || 1000}" decoding="async" fetchpriority="high">
    </figure>`
    : `<div class="shot--missing">Скриншот ещё не добавлен в <code>screens/</code>.<br>Положите файл <code>${esc(site.slot)}.webp</code> и пересоберите страницы.</div>`;

  /* «Что это» — единый текст: своё описание и описание владельца коллекции */
  const intro = [site.description_own, site.description_user]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');

  const langs = titles(LANGS, facts.languages || []);

  const paletteRows = palette.colors.map((hex, i) => {
    const share = palette.share[i];
    return `<li class="palette-row">
          <span class="swatch" style="background:${esc(hex)}" aria-hidden="true"></span>
          <code>${esc(hex)}</code>${share != null ? ` — ${Math.round(share * 100)}% кадра` : ''}
        </li>`;
  }).join('\n        ');

  const paletteBlock = palette.colors.length
    ? `<div class="swatches swatches--big" aria-hidden="true">${palette.colors.map((hex) => `<span class="swatch" style="background:${esc(hex)}"></span>`).join('')}</div>
       <ul class="palette-list">
        ${paletteRows}
       </ul>
       <dl class="specs" style="margin-top:var(--space-2)">
         <div><dt>Режим</dt><dd>${palette.mode ? esc(title(MODES, palette.mode)) : '<span class="placeholder">не измерено</span>'}</dd></div>
         <div><dt>Цвет фона</dt><dd>${palette.hue ? esc(HUE_TITLES[palette.hue] || palette.hue) : '<span class="placeholder">не измерено</span>'}</dd></div>
       </dl>`
    : '<p class="placeholder">палитра не измерена</p>';

  const body = `<nav class="breadcrumbs container" aria-label="Хлебные крошки">
  <ol>
    <li><a href="../index.html">Главная</a></li>
    <li>${esc(site.name)}</li>
  </ol>
</nav>

<article class="container">
  <header class="site-head">
    <h1>${esc(site.name)}</h1>
    <ul class="taglist">
      ${(site.categories || []).map((id) => `<li><span class="tag">${esc(title(CATS, id))}</span></li>`).join('\n      ')}
      ${(site.subcategories || []).map((id) => `<li><span class="tag tag--muted">${esc(title(SUBS, id))}</span></li>`).join('\n      ')}
      ${(site.styles || []).map((id) => `<li><span class="tag tag--muted">${esc(title(STYLES, id))}</span></li>`).join('\n      ')}
      <li><span class="tag tag--muted">${esc(title(LINKS, site.link_state))}</span></li>
    </ul>
    <p class="site-head__url"><a href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)}</a></p>
  </header>

  <div class="site-grid section section--tight">
      ${shot}

      <section class="panel">
        <h2>Что это</h2>
        <p>${esc(intro)}</p>
      </section>

      ${site.observations && site.observations.length ? `<section class="panel">
        <h2>Чем интересен</h2>
        <ul>${site.observations.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </section>` : ''}

      <section class="panel">
        <h2>Паспорт</h2>
        <dl class="specs">
          <div><dt>Домен</dt><dd class="mono">${esc(site.domain)}</dd></div>
          <div><dt>Тип сайта</dt><dd>${esc(title(TYPES, site.site_type))}</dd></div>
          <div><dt>Категории</dt><dd>${joinOr(titles(CATS, site.categories))}</dd></div>
          <div><dt>Подкатегории</dt><dd>${joinOr(titles(SUBS, site.subcategories))}</dd></div>
          <div><dt>Для кого</dt><dd>${joinOr(titles(AUD, site.audience))}</dd></div>
          <div><dt>Стиль</dt><dd>${joinOr(titles(STYLES, site.styles))}</dd></div>
          <div><dt>Язык</dt><dd>${joinOr(langs)}</dd></div>
          <div><dt>Страна</dt><dd>${orDash(facts.country)}</dd></div>
          <div><dt>Автор</dt><dd>${orDash(facts.author)}</dd></div>
          <div><dt>Год</dt><dd>${orDash(facts.year)}</dd></div>
          <div><dt>Добавлен в коллекцию</dt><dd>${fmtDate(site.added)}</dd></div>
        </dl>
      </section>

      <section class="panel">
        <h2>Палитра</h2>
        ${paletteBlock}
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
          ${site.tech.map((item) => `<li><strong>${esc(displayTechName(item.name))}</strong> — ${esc(item.evidence)}</li>`).join('')}
        </ul>
      </section>` : ''}

      <section class="panel">
        <h2>Что смотреть в первую очередь</h2>
        <p class="small">${notes ? esc(notes) : '<span class="placeholder">заметок пока нет</span>'}</p>
      </section>
  </div>
</article>`;

  return pageShell({
    prefix,
    title: `${site.name} — сайт в коллекции`,
    description: shortDescription(site).slice(0, 150),
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

for (const site of sites) {
  write(`pages/${site.slot}-${site.slug}.html`, renderSite(site));
}

if (!QUIET) {
  console.log('Собрано страниц: ' + written.length + ' (' + sites.length + ' сайтов + каталог)');
}
