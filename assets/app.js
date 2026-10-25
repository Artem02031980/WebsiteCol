/* ============================================================
   Каталог коллекции: поиск, фасеты, сортировка, виды, состояние в адресе.
   Данные не запрашиваются — всё уже отрендерено в HTML (@@BUILD@@
   собирает разметку), скрипт только фильтрует и переупорядочивает.
   Без JS страница читается: видны все карточки и ссылки.
   ============================================================ */
(function () {
  'use strict';

  var grid = document.getElementById('grid');
  // Каталог есть только на index.html; меню и копирование ссылки работают на всех страницах,
  // поэтому здесь не выходим, а проверяем наличие сетки в обработчиках.

  var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll('.card')) : [];
  var searchInput = document.getElementById('q');
  var sortSelect = document.getElementById('sort');
  var viewButtons = Array.prototype.slice.call(document.querySelectorAll('[data-view]'));
  var resetButton = document.getElementById('reset');
  var copyButton = document.getElementById('copy-link');
  var chipsBox = document.getElementById('chips');
  var countBox = document.getElementById('result-count');
  var emptyBox = document.getElementById('empty');
  var emptyQuery = document.getElementById('empty-query');
  var emptyReset = document.getElementById('empty-reset');
  var facetBoxes = Array.prototype.slice.call(document.querySelectorAll('input[type="checkbox"][data-group]'));
  var groups = [];
  facetBoxes.forEach(function (box) {
    if (groups.indexOf(box.dataset.group) === -1) groups.push(box.dataset.group);
  });

  var TITLES = {};
  facetBoxes.forEach(function (box) {
    TITLES[box.dataset.group] = box.dataset.groupTitle || box.dataset.group;
  });

  /* ---------- Нормализация текста ---------- */

  var TRANSLIT = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  };

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\wа-я\s.-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function translit(value) {
    return value.replace(/[а-яё]/g, function (ch) { return TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch; });
  }

  // Готовим поисковый индекс карточки: обычный текст и транслит (чтобы «басмент» находил basement)
  cards.forEach(function (card) {
    var raw = normalize(card.dataset.search || '');
    card.dataset.index = raw;
    card.dataset.indexLatin = translit(raw);
  });

  /* ---------- Состояние ---------- */

  var state = { q: '', sort: 'score', view: 'cards', facets: {} };
  groups.forEach(function (group) { state.facets[group] = []; });

  function selected(group) {
    return facetBoxes
      .filter(function (box) { return box.dataset.group === group && box.checked; })
      .map(function (box) { return box.value; });
  }

  function readInputs() {
    state.q = searchInput ? searchInput.value : '';
    state.sort = sortSelect ? sortSelect.value : 'score';
    groups.forEach(function (group) { state.facets[group] = selected(group); });
  }

  /* ---------- Фильтрация ---------- */

  function words(query) {
    var list = normalize(query).split(' ').filter(Boolean);
    return list.map(function (word) { return { raw: word, latin: translit(word) }; });
  }

  function matchesText(card, queryWords) {
    for (var i = 0; i < queryWords.length; i += 1) {
      var word = queryWords[i];
      var inRaw = word.raw.length > 1 && card.dataset.index.indexOf(word.raw) !== -1;
      var inLatin = word.latin.length > 1 && card.dataset.indexLatin.indexOf(word.latin) !== -1;
      if (!inRaw && !inLatin) return false;
    }
    return true;
  }

  function matchesFacet(card, group, values) {
    if (!values.length) return true;
    var cardValues = (card.dataset[group] || '').split(' ').filter(Boolean);
    for (var i = 0; i < values.length; i += 1) {
      if (cardValues.indexOf(values[i]) !== -1) return true;
    }
    return false;
  }

  // excludeGroup — для перекрёстных счётчиков: считаем так, будто в этой группе ничего не выбрано
  function match(card, queryWords, excludeGroup) {
    if (!matchesText(card, queryWords)) return false;
    for (var i = 0; i < groups.length; i += 1) {
      var group = groups[i];
      if (group === excludeGroup) continue;
      if (!matchesFacet(card, group, state.facets[group])) return false;
    }
    return true;
  }

  /* ---------- Сортировка ---------- */

  var COLLATOR = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('ru', { sensitivity: 'base' })
    : null;

  function compare(a, b) {
    var mode = state.sort;
    if (mode === 'name') return COLLATOR ? COLLATOR.compare(a.dataset.name, b.dataset.name)
      : a.dataset.name.localeCompare(b.dataset.name);
    if (mode === 'slot') return (a.dataset.slot || '').localeCompare(b.dataset.slot || '');
    if (mode === 'added') return String(b.dataset.added || '').localeCompare(String(a.dataset.added || ''));
    return num(b.dataset.score) - num(a.dataset.score);
  }

  function num(value) {
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : -1;
  }

  /* ---------- Отрисовка ---------- */

  var currentMatches = [];

  function apply() {
    if (!grid) return;
    var queryWords = words(state.q);
    currentMatches = cards.filter(function (card) { return match(card, queryWords, null); });

    var visible = {};
    currentMatches.forEach(function (card) { visible[card.dataset.slot] = true; });

    cards.forEach(function (card) {
      var show = Boolean(visible[card.dataset.slot]);
      card.hidden = !show;
    });

    currentMatches.sort(compare).forEach(function (card) { grid.appendChild(card); });

    if (countBox) {
      countBox.textContent = currentMatches.length + ' ' + plural(currentMatches.length, ['сайт', 'сайта', 'сайтов']) +
        ' из ' + cards.length;
    }
    if (emptyBox) emptyBox.hidden = currentMatches.length !== 0;
    if (emptyQuery) emptyQuery.textContent = state.q ? '«' + state.q + '»' : 'с такими фильтрами';

    renderChips();
    renderCounts(queryWords);
    writeUrl();
  }

  function plural(n, forms) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  }

  function renderChips() {
    if (!chipsBox) return;
    chipsBox.textContent = '';
    var items = [];

    if (state.q) items.push({ group: 'q', value: state.q, label: 'поиск: ' + state.q });
    groups.forEach(function (group) {
      state.facets[group].forEach(function (value) {
        var box = facetBoxes.find(function (b) { return b.dataset.group === group && b.value === value; });
        items.push({ group: group, value: value, label: (TITLES[group] || group) + ': ' + (box ? box.dataset.label : value) });
      });
    });

    if (!items.length) {
      var hint = document.createElement('span');
      hint.className = 'small muted';
      hint.textContent = 'Фильтры не выбраны — показана вся коллекция.';
      chipsBox.appendChild(hint);
      return;
    }

    items.forEach(function (item) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      var text = document.createElement('span');
      text.textContent = item.label;
      var button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = '&times;';
      button.setAttribute('aria-label', 'Убрать фильтр ' + item.label);
      button.addEventListener('click', function () {
        if (item.group === 'q') {
          if (searchInput) searchInput.value = '';
        } else {
          var box = facetBoxes.find(function (b) { return b.dataset.group === item.group && b.value === item.value; });
          if (box) box.checked = false;
        }
        readInputs();
        apply();
      });
      chip.appendChild(text);
      chip.appendChild(button);
      chipsBox.appendChild(chip);
    });

    var clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn--ghost btn--small';
    clear.textContent = 'Сбросить всё';
    clear.addEventListener('click', resetAll);
    chipsBox.appendChild(clear);
    if (resetButton) resetButton.hidden = true;
  }

  function renderCounts(queryWords) {
    facetBoxes.forEach(function (box) {
      var group = box.dataset.group;
      var value = box.value;
      var count = cards.filter(function (card) {
        return match(card, queryWords, group) && matchesFacet(card, group, [value]);
      }).length;
      var holder = box.parentElement ? box.parentElement.querySelector('.facet__count') : null;
      if (holder) holder.textContent = count;
      var row = box.closest ? box.closest('.check') : null;
      if (row) row.classList.toggle('is-empty', count === 0 && !box.checked);
    });
  }

  /* ---------- Адрес ---------- */

  function writeUrl() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    groups.forEach(function (group) {
      if (state.facets[group].length) parts.push(group + '=' + state.facets[group].join(','));
    });
    if (state.sort !== 'score') parts.push('sort=' + state.sort);
    if (state.view !== 'cards') parts.push('view=' + state.view);
    var hash = parts.length ? '#' + parts.join('&') : '#';
    try {
      history.replaceState(null, '', hash);
    } catch (e) {
      if (location.hash !== hash) location.hash = hash; // file:// в некоторых браузерах запрещает replaceState
    }
  }

  function readUrl() {
    var raw = (location.hash || '').replace(/^#/, '') || (location.search || '').replace(/^\?/, '');
    if (!raw) return;
    raw.split('&').forEach(function (pair) {
      if (!pair) return;
      var index = pair.indexOf('=');
      var key = index === -1 ? pair : pair.slice(0, index);
      var value = index === -1 ? '' : decodeURIComponent(pair.slice(index + 1));
      if (key === 'q') {
        state.q = value;
        if (searchInput) searchInput.value = value;
      } else if (key === 'sort') {
        state.sort = value;
        if (sortSelect) sortSelect.value = value;
      } else if (key === 'view') {
        state.view = value;
      } else if (groups.indexOf(key) !== -1 && value) {
        value.split(',').forEach(function (item) {
          var box = facetBoxes.find(function (b) { return b.dataset.group === key && b.value === item; });
          if (box) box.checked = true;
        });
      }
    });
    readInputs();
  }

  function resetAll() {
    if (searchInput) searchInput.value = '';
    facetBoxes.forEach(function (box) { box.checked = false; });
    if (sortSelect) sortSelect.value = 'score';
    setView('cards');
    readInputs();
    apply();
  }

  /* ---------- Вид ---------- */

  function setView(view) {
    state.view = view === 'list' ? 'list' : 'cards';
    if (grid) grid.classList.toggle('grid--list', state.view === 'list');
    viewButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.view === state.view ? 'true' : 'false');
    });
  }

  /* ---------- Обработчики ---------- */

  var debounce = null;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      readInputs();
      apply();
    });
    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        searchInput.value = '';
        readInputs();
        apply();
      }
    });
  }

  facetBoxes.forEach(function (box) {
    box.addEventListener('change', function () { readInputs(); apply(); });
  });

  if (sortSelect) sortSelect.addEventListener('change', function () { readInputs(); apply(); });
  if (resetButton) resetButton.addEventListener('click', resetAll);
  if (emptyReset) emptyReset.addEventListener('click', resetAll);

  viewButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setView(button.dataset.view);
      writeUrl();
    });
  });

  if (copyButton) {
    copyButton.addEventListener('click', function () {
      var url = location.href;
      var done = function () {
        var old = copyButton.textContent;
        copyButton.textContent = 'Ссылка скопирована';
        setTimeout(function () { copyButton.textContent = old; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt('Скопируйте ссылку:', url); });
      } else {
        window.prompt('Скопируйте ссылку:', url);
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    var tag = (event.target && event.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (event.key === '/' && !typing) {
      event.preventDefault();
      if (searchInput) searchInput.focus();
    }
  });

  window.addEventListener('hashchange', function () {
    facetBoxes.forEach(function (box) { box.checked = false; });
    state.q = '';
    readUrl();
    setView(state.view);
    apply();
  });

  /* ---------- Старт ---------- */

  readUrl();
  setView(state.view);
  apply();
})();
