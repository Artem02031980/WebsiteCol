/* ============================================================
   Каталог коллекции: поиск, фасеты, сортировка, виды, состояние в адресе.
   Данные не запрашиваются — всё уже отрендерено в HTML, скрипт только
   фильтрует и переупорядочивает. Без JS страница читается: видны все
   карточки и ссылки.
   ============================================================ */
(function () {
  'use strict';

  var grid = document.getElementById('grid');
  // Каталог есть только на index.html; меню и копирование ссылки работают на всех страницах,
  // поэтому здесь не выходим, а проверяем наличие сетки в обработчиках.

  var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll('.card')) : [];
  var searchInput = document.getElementById('q');
  var sortSelect = document.getElementById('sort');
  var customSort = null;
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

  var state = { q: '', sort: 'slot-desc', view: 'cards', facets: {} };
  groups.forEach(function (group) { state.facets[group] = []; });

  function selected(group) {
    return facetBoxes
      .filter(function (box) { return box.dataset.group === group && box.checked; })
      .map(function (box) { return box.value; });
  }

  function readInputs() {
    state.q = searchInput ? searchInput.value : '';
    state.sort = sortSelect ? sortSelect.value : 'slot-desc';
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
    /* «По номеру с конца»: свежие сайты сверху */
    return (b.dataset.slot || '').localeCompare(a.dataset.slot || '');
  }

  /* ---------- Сортировка: свой список вместо системного <select> ----------
     Нативное меню нельзя оформить, поэтому select остаётся в разметке для
     работы без JS, а здесь скрывается и заменяется кнопкой с listbox.
     Стрелки, Home/End, Enter, Esc, Tab и набор по первым буквам — как у select. */

  function setupSort(select) {
    if (!select || !select.parentNode) return null;

    var field = select.closest ? select.closest('.field') : select.parentNode;
    var label = field ? field.querySelector('.field__label') : null;
    if (label && !label.id) label.id = 'sort-label';

    var options = Array.prototype.slice.call(select.options).map(function (option) {
      return { value: option.value, title: option.textContent.trim() };
    });

    var wrapper = document.createElement('div');
    wrapper.className = 'select';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'select__button';
    button.id = 'sort-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'sort-listbox');
    if (label) {
      button.setAttribute('aria-labelledby', label.id + ' sort-button-value');
      label.htmlFor = 'sort-button';
    }

    var valueBox = document.createElement('span');
    valueBox.className = 'select__value';
    valueBox.id = 'sort-button-value';

    var chevron = document.createElement('span');
    chevron.className = 'select__chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" focusable="false">' +
      '<path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"></path></svg>';

    button.appendChild(valueBox);
    button.appendChild(chevron);

    var list = document.createElement('ul');
    list.className = 'select__menu';
    list.id = 'sort-listbox';
    list.setAttribute('role', 'listbox');
    list.setAttribute('tabindex', '-1');
    list.hidden = true;
    if (label) list.setAttribute('aria-labelledby', label.id);

    var items = options.map(function (option, index) {
      var item = document.createElement('li');
      item.className = 'select__option';
      item.id = 'sort-option-' + index;
      item.setAttribute('role', 'option');
      item.setAttribute('data-value', option.value);
      item.setAttribute('aria-selected', 'false');

      var text = document.createElement('span');
      text.textContent = option.title;
      item.appendChild(text);

      var check = document.createElement('span');
      check.className = 'select__check';
      check.setAttribute('aria-hidden', 'true');
      check.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" focusable="false">' +
        '<path d="M1.5 6.5 4.5 9.5 10.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round"></path></svg>';
      item.appendChild(check);

      list.appendChild(item);
      return item;
    });

    field.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(button);
    wrapper.appendChild(list);
    select.hidden = true;
    select.tabIndex = -1;

    var isOpen = false;
    var active = -1;
    var typed = '';
    var typedTimer = null;

    function valueIndex() {
      for (var i = 0; i < options.length; i += 1) {
        if (options[i].value === select.value) return i;
      }
      return 0;
    }

    function setActive(index) {
      if (!items.length) return;
      active = Math.max(0, Math.min(index, items.length - 1));
      for (var i = 0; i < items.length; i += 1) {
        items[i].classList.toggle('is-active', i === active);
      }
      list.setAttribute('aria-activedescendant', items[active].id);
      if (items[active].scrollIntoView) items[active].scrollIntoView({ block: 'nearest' });
    }

    function openList(atEnd) {
      if (isOpen) return;
      isOpen = true;
      list.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      setActive(atEnd ? items.length - 1 : valueIndex());
      list.focus();
    }

    function closeList(refocus) {
      if (!isOpen) return;
      isOpen = false;
      list.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      list.removeAttribute('aria-activedescendant');
      // Если фокус остался в скрытом списке, вернуть его на кнопку, иначе он уйдёт в body
      if (refocus || document.activeElement === list) button.focus();
    }

    function choose(index) {
      var item = items[index];
      if (!item) return;
      select.value = item.getAttribute('data-value');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      closeList(true);
    }

    function sync() {
      var index = valueIndex();
      valueBox.textContent = options[index] ? options[index].title : '';
      for (var i = 0; i < items.length; i += 1) {
        items[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
      }
    }

    button.addEventListener('click', function () {
      if (isOpen) closeList(true);
      else openList(false);
    });

    button.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!isOpen) openList(event.key === 'ArrowUp');
      }
    });

    // Клик по пункту не должен уводить фокус из списка до выбора
    list.addEventListener('mousedown', function (event) { event.preventDefault(); });

    list.addEventListener('click', function (event) {
      var item = event.target.closest ? event.target.closest('.select__option') : null;
      if (item) choose(items.indexOf(item));
    });

    list.addEventListener('keydown', function (event) {
      var key = event.key;
      if (key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); return; }
      if (key === 'ArrowUp') { event.preventDefault(); setActive(active - 1); return; }
      if (key === 'Home') { event.preventDefault(); setActive(0); return; }
      if (key === 'End') { event.preventDefault(); setActive(items.length - 1); return; }
      if (key === 'Enter' || key === ' ') { event.preventDefault(); choose(active); return; }
      if (key === 'Escape') { event.stopPropagation(); closeList(true); return; }
      if (key === 'Tab') { closeList(true); return; }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        typed += key.toLowerCase();
        clearTimeout(typedTimer);
        typedTimer = setTimeout(function () { typed = ''; }, 600);
        for (var i = 0; i < options.length; i += 1) {
          if (options[i].title.toLowerCase().indexOf(typed) === 0) { setActive(i); break; }
        }
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (isOpen && !wrapper.contains(event.target)) closeList(false);
    }, true);

    sync();
    return { sync: sync };
  }

  /* ---------- Отрисовка ---------- */

  var currentMatches = [];

  function apply() {
    if (customSort) customSort.sync();
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
    if (state.sort !== 'slot-desc') parts.push('sort=' + state.sort);
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
    if (sortSelect) sortSelect.value = 'slot-desc';
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

  /* ---------- Две колонки на странице сайта ---------- */

  /* Карточки разной высоты в жёсткой сетке оставляли пустоту под короткой
     колонкой: высокая «Паспорт» тянула строку вниз, а под соседней карточкой
     оставалась дыра. Раскладываем карточки по двум колонкам, каждый раз в
     более короткую — пустот не остаётся. На узких экранах возвращаем
     исходный порядок и одну колонку. */
  var siteGrid = document.querySelector('.site-grid');
  if (siteGrid) {
    var siteCards = Array.prototype.slice.call(siteGrid.children);
    var siteLeft = null;
    var siteRight = null;
    var wideScreen = window.matchMedia('(min-width: 1101px)');

    var flattenSiteGrid = function () {
      siteCards.forEach(function (card) { siteGrid.appendChild(card); });
      // Старые колонки-обёртки удаляем: иначе после повторного split
      // (resize или догрузка картинки) пустые .site-col остаются во flex
      // и занимают половину ширины.
      Array.prototype.forEach.call(siteGrid.querySelectorAll(':scope > .site-col'), function (col) {
        col.remove();
      });
      siteGrid.classList.remove('is-split');
      siteLeft = null;
      siteRight = null;
    };

    var splitSiteGrid = function () {
      flattenSiteGrid();

      // Высоты меряем до переноса: колонки равной ширины, и в сетке, и в
      // флексе карточка занимает одну и ту же ширину, поэтому высоты те же.
      // К каждой высоте прибавляем gap колонки — иначе модель не учитывает
      // разное число промежутков в колонках.
      var gap = parseFloat(window.getComputedStyle(siteGrid).rowGap) || 0;
      var heights = siteCards.map(function (card) {
        return card.getBoundingClientRect().height + gap;
      });

      // Начало страницы — скриншот, «Что это» и «Чем интересен»: это связный
      // рассказ, он всегда идёт первым в левой колонке. Остальные карточки
      // (паспорт, палитра, техфакты, технологии, похожие) делим между
      // колонками так, чтобы разница высот была минимальной.
      var prefixEnd = 2;
      siteCards.forEach(function (card, index) {
        var title = card.querySelector('h2');
        if (title && title.textContent.trim().indexOf('Паспорт') === 0) {
          prefixEnd = index;
        }
      });
      if (prefixEnd > siteCards.length) prefixEnd = siteCards.length;

      var restHeights = heights.slice(prefixEnd);
      var prefixSum = heights.slice(0, prefixEnd).reduce(function (a, b) { return a + b; }, 0);
      var count = restHeights.length;
      var bestMask = null;
      var bestTallest = Infinity;
      var bestDiff = Infinity;

      if (count <= 14) {
        for (var mask = 0; mask < (1 << count); mask++) {
          var left = prefixSum;
          var right = 0;
          for (var bit = 0; bit < count; bit++) {
            // Бит 1 — карточка уходит в правую колонку.
            if ((mask >> bit) & 1) right += restHeights[bit];
            else left += restHeights[bit];
          }
          var tallest = Math.max(left, right);
          var diff = Math.abs(left - right);
          if (tallest < bestTallest || (tallest === bestTallest && diff < bestDiff)) {
            bestTallest = tallest;
            bestDiff = diff;
            bestMask = mask;
          }
        }
      }

      var sides = [];
      for (var i = 0; i < prefixEnd; i++) sides.push(0);
      if (bestMask === null) {
        // Запасной путь для очень длинных страниц: жадная раскладка.
        var running = [prefixSum, 0];
        for (var j = 0; j < count; j++) {
          var target = running[0] <= running[1] ? 0 : 1;
          sides.push(target);
          running[target] += restHeights[j];
        }
      } else {
        for (var k = 0; k < count; k++) sides.push((bestMask >> k) & 1);
      }

      siteLeft = document.createElement('div');
      siteLeft.className = 'site-col';
      siteRight = document.createElement('div');
      siteRight.className = 'site-col';
      siteGrid.appendChild(siteLeft);
      siteGrid.appendChild(siteRight);

      // Порядок карточек внутри колонки остаётся исходным.
      siteCards.forEach(function (card, index) {
        (sides[index] === 0 ? siteLeft : siteRight).appendChild(card);
      });
      siteGrid.classList.add('is-split');
    };

    var relayoutSiteGrid = function () {
      if (wideScreen.matches) splitSiteGrid();
      else flattenSiteGrid();
    };

    relayoutSiteGrid();

    var relayoutTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(relayoutTimer);
      relayoutTimer = setTimeout(relayoutSiteGrid, 150);
    });

    // Картинки догружаются после раскладки и меняют высоту карточек.
    siteCards.forEach(function (card) {
      Array.prototype.forEach.call(card.querySelectorAll('img'), function (img) {
        if (!img.complete) {
          img.addEventListener('load', function () {
            clearTimeout(relayoutTimer);
            relayoutTimer = setTimeout(relayoutSiteGrid, 150);
          });
        }
      });
    });
  }

  /* ---------- Горячие клавиши ---------- */

  document.addEventListener('keydown', function (event) {
    var tag = (event.target && event.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      Boolean(event.target && event.target.closest && event.target.closest('.select'));
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

  customSort = setupSort(sortSelect);
  readUrl();
  setView(state.view);
  apply();
})();
