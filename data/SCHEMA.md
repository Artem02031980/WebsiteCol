# Схема данных коллекции

Единственный источник правды — `data/sites.json` (сайты) и `data/champ.json` (оценки чемпионата).
Справочники значений — `data/taxonomy.json`, веса — `data/weights.json`.
Страницы (`index.html`, `champ.html`, `categories.html`, `pages/*.html`) **генерируются** из данных:
`node tools/build.mjs`. Руками их править бессмысленно — перезапишутся.

Главное правило: **не выдумывать**. Чего не измерили и не видели — `null`, в интерфейсе это
показывается как «не измерено», а `tools/validate.mjs` выводит такие поля отдельным списком.

## Запись сайта (`sites.json` → `sites[]`)

| Поле | Тип | Что это | Обязательное |
|---|---|---|---|
| `slot` | string | Номер вида `"001"` — совпадает с именем скрина в `Screens/` | да |
| `slug` | string | Латиница, kebab-case — попадает в имя страницы `pages/001-weeksync.html` | да |
| `name` | string | Название сайта | да |
| `url` | string | Точный адрес, который открываем | да |
| `domain` | string | Домен без www | да |
| `screenshot` | string \| null | Имя файла в `Screens/`, например `"001.webp"`. `null` — скрин ещё не прислан | да |
| `added` | string \| null | Дата добавления `YYYY-MM-DD`; `null` — не фиксировали | нет |
| `link_state` | string | id из `taxonomy.link_states` | да |
| `description_user` | string \| null | Описание от владельца коллекции, дословно | нет |
| `description_own` | string | Моё описание: что это и как сделано, 2–4 предложения | да |
| `categories` | string[] | id категорий, первая — основная (она задаёт профиль весов) | да |
| `subcategories` | string[] | id подкатегорий из выбранных категорий | нет |
| `audience` | string[] | id из `taxonomy.audiences` — «для кого» | да |
| `site_type` | string | id из `taxonomy.site_types` | да |
| `styles` | string[] | id из `taxonomy.styles` | да |
| `techniques` | string[] | id из `taxonomy.techniques` — то, ради чего сайт сохранён | да |
| `palette` | object | `{ "mode": "light\|dark\|contrast\|colorful", "colors": ["#RRGGBB"], "source": "измерено из Screens/001.webp" }` | да |
| `tech` | array | `[{ "name": "Next.js", "evidence": "файл /_next/static/…" }]` — без доказательства не пишем | нет |
| `observations` | string[] | 3–5 наблюдений, чем сайт интересен технически или визуально | да |
| `notes` | string | Моя заметка: что смотреть в этом сайте в первую очередь | да |
| `facts` | object | См. ниже | да |
| `unverified` | string[] | Что проверить не удалось — честный список | да |

Личных оценок владельца в схеме нет: он сайты не оценивает, ему нужна информация. Все субъективные
баллы — экспертные оценки агента и лежат в `data/champ.json`.

### `facts`

| Поле | Тип | Что это |
|---|---|---|
| `https` | boolean \| null | Сайт отдаётся по HTTPS |
| `country` | string \| null | Страна/город, если видно на сайте |
| `language` | string | id из `taxonomy.languages` |
| `author` | string \| null | Автор, студия или компания |
| `year` | number \| null | Год запуска/копирайта, если указан |
| `mobile.viewport_meta` | boolean \| null | Есть `<meta name="viewport">` |
| `mobile.overflow_375` | boolean \| null | Горизонтальное переполнение на 375 px (измеряется отдельно) |
| `seo.title` / `seo.title_len` | string / number | `<title>` и его длина |
| `seo.description` / `seo.description_len` | string / number | meta description и его длина |
| `seo.og` | boolean \| null | Есть Open Graph |
| `seo.sitemap` / `seo.robots` | string \| null | Что нашлось по адресу, `"не найдено"` если 404 |
| `seo.structured_data` | boolean \| null | Есть JSON-LD / микроразметка |
| `links.checked` | number | Сколько ссылок реально проверено |
| `links.broken` | string[] | Битые адреса |
| `contacts` | string \| null | Какие контакты есть на сайте |
| `legal` | string \| null | Юридическая информация, политика конфиденциальности |
| `analytics` | string[] | Счётчики, найденные в коде |

### `champ` (в `sites.json`, необязательно)

`{ "profile": "portfolio", "notes": { "ux": "почему такая оценка" } }` — переопределение профиля весов
и заметки по разделам. Сами баллы лежат в `data/champ.json`.

## Оценки (`champ.json`)

```
{
  "sites": {
    "001": {
      "criteria": { "ux.nav": 8, "ux.interface": { "v": 9, "note": "почему именно столько" } },
      "section_notes": { "ux": "одна строка обоснования на раздел" }
    }
  },
  "meta": { "scale": "1–10, шаг 0.5", "updated": "YYYY-MM-DD" }
}
```

- Значение критерия — либо число, либо объект `{ v, note }` (объект нужен, когда хочется пояснить балл).
- **Каждый критерий — отдельная номинация.** Место сайта в номинации считается по баллу критерия напрямую;
  одинаковые баллы дают одинаковые места, первое место — победа.
- Ключ критерия — `раздел.id` из `data/weights.json` (`ux.nav`, `design.aesthetics`, …).
- Итог = сумма (вес критерия × балл) / сумма весов оценённых критериев × 10, то есть 0–100.
  Вес критерия = вес его раздела, делённый на число критериев в разделе.
- Критерий отсутствует в объекте → он не участвует в расчёте. Сейчас заполнены все 30.

## Что означают источники оценки

- `auto` — измерено по разметке и ответам сервера (HTTPS, SEO-минимум, битые ссылки).
- `partial` — частично измерено, частично экспертно (адаптив, формы, отзывы на сайте).
- `expert` — экспертная оценка агента по скрину и разметке, с обоснованием в `section_notes`.

## Как добавить сайт

1. Положить скрин в `Screens/` с номером = текущий максимум + 1 (`032.webp`).
2. `node tools/add-site.mjs <url> --slot 032 --name "Название"` — создаст черновик записи.
3. Разбор сайта субагентом по шаблону `RESEARCH_PROMPT.md` (один агент на сайт).
4. Заполнить поля в `data/sites.json`, выставить баллы в `data/champ.json`.
5. `node tools/build.mjs` — пересобрать страницы.
6. `node tools/validate.mjs` — до нуля ошибок и предупреждений.
7. `node tools/palette.mjs` — обновить палитры (нужно ≥ 4 ГБ свободной памяти).
8. `node tools/check-widths.mjs 1280,1440,1920` — убедиться, что переполнения нет.

Полный ритуал с пояснениями — в `AGENTS.md`, правила оценок — там же.

## Расширение справочников (`taxonomy.json`)

Id из справочников нельзя выдумывать в записи сайта: сначала значение появляется в таксономии,
потом используется. Порядок:

1. Добавить объект `{ "id": "kebab-case", "title": "Как это видит человек" }` в нужный список:
   `categories` (с подсписком `subs`), `audiences`, `site_types`, `styles`, `techniques`,
   `languages`, `palette_modes`, `link_states`.
2. `node tools/validate.mjs` — он ругается на неизвестные id, поэтому после правки справочника
   проверка должна проходить.
3. `node tools/build.mjs` — фильтры каталога и страница категорий подхватят новое значение сами.

Что уже добавлялось по ходу проекта:

- приёмы: `data-viz`, `click-reveal`, `shader-text`, `vector-animation` (Lottie и Rive);
- аудитории: `consumers` (обычные пользователи), `investors`, `automotive`;
- языки: `it`; для двуязычных сайтов с полноценной второй локалью ставится `multi`.

## Соглашения, накопившиеся по ходу

- `palette.colors` — цвета **со скриншота** (измеряет `tools/palette.mjs`), а токены сайта
  перечисляются в `palette.source`. Если снимок сделан на другой теме, чем открывается сайт,
  это тоже пишется в `palette.source`.
- `facts.links.broken` — только реально проверенные адреса; «не удалось проверить» идёт
  в `unverified`, а не в битые ссылки.
- `unverified` — обязательный список; формулировать конкретно: что не проверено и почему
  (браузер не запускался, сайт закрыт Cloudflare, листинг закрыт).
- Расхождение скриншота с живым сайтом — отдельный пункт и в `observations`, и в `unverified`.
- Дата в `added` — день, когда сайт попал в коллекцию; `null`, если не фиксировали.
- Проверить всё разом после правок: `node tools/doctor.mjs` (целостность и окружение) →
  `node tools/validate.mjs` (данные и разметка).

