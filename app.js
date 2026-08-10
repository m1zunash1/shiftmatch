const DICT_LABELS = {
  kobuta: '仔豚辞書',
  general: '一般語辞書',
  item: 'イラスト辞書',
  english: '英語辞書',
  roma: 'ローマ字辞書',
};

const state = {
  dictionaries: {},
  cache: { parsed: new Map(), merged: new Map() },
  lastSearch: null,
  visibleCount: 50,
};

const sourceEls = [
  document.getElementById('source1'),
  document.getElementById('source2'),
  document.getElementById('source3'),
];
const source3CardEl = document.getElementById('source3Card');
const toggleSource3El = document.getElementById('toggleSource3');
const inputMetaEl = document.getElementById('inputMeta');
const nMinEl = document.getElementById('nMin');
const nMaxEl = document.getElementById('nMax');
const shiftMinEl = document.getElementById('shiftMin');
const shiftMaxEl = document.getElementById('shiftMax');
const loopAllowedEl = document.getElementById('loopAllowed');
const maxResultsEl = document.getElementById('maxResults');
const searchBtnEl = document.getElementById('searchBtn');
const errorBoxEl = document.getElementById('errorBox');
const sortOrderEl = document.getElementById('sortOrder');
const resultFilterEl = document.getElementById('resultFilter');
const filterErrorEl = document.getElementById('filterError');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');
const loadMoreEl = document.getElementById('loadMore');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loadDictionaries() {
  if (typeof EMBEDDED_DICT_TEXT !== 'object' || EMBEDDED_DICT_TEXT === null) {
    throw new Error('dict-data.js を読み込めませんでした。');
  }
  for (const [id, label] of Object.entries(DICT_LABELS)) {
    const text = EMBEDDED_DICT_TEXT[id];
    if (typeof text !== 'string') throw new Error(`${label} の辞書データが見つかりません。`);
    state.dictionaries[id] = text;
  }
}

function parsedDictionary(id) {
  if (!state.cache.parsed.has(id)) {
    state.cache.parsed.set(id, ShiftMatchCore.parseDictionary(state.dictionaries[id]));
  }
  return state.cache.parsed.get(id);
}

function selectedDictIds() {
  return Array.from(document.querySelectorAll('input[name="targetDict"]:checked')).map((el) => el.value);
}

function mergedWords(ids) {
  const key = [...ids].sort().join('|');
  if (state.cache.merged.has(key)) return state.cache.merged.get(key);
  const words = new Set();
  for (const id of ids) for (const word of parsedDictionary(id)) words.add(word);
  state.cache.merged.set(key, words);
  return words;
}

function activeSourceEls() {
  return source3CardEl.hidden ? sourceEls.slice(0, 2) : sourceEls;
}

function parseSourceSections(rawValue) {
  const commaNormalized = String(rawValue || '').normalize('NFKC').replaceAll('，', ',');
  const rawSections = commaNormalized.split(',').map((section) => section.trim());
  if (rawSections.some((section) => !section)) throw new Error('文字列を入力してください。');
  const sections = rawSections.map((section) => ShiftMatchCore.normalizeKana(section, true));
  return { sections, hasComma: rawSections.length > 1 };
}

function parseAllSources(requireValues = true) {
  const parsed = activeSourceEls().map((el) => {
    if (!el.value.trim()) {
      if (requireValues) throw new Error('文字列を入力してください。');
      return null;
    }
    return parseSourceSections(el.value);
  });
  if (parsed.some((entry) => entry === null)) return null;

  const pickupEnabled = parsed.some((entry) => entry.hasComma);
  let positionGroups = null;
  if (pickupEnabled) {
    const sectionCounts = parsed.map((entry) => entry.sections.length);
    const sameCount = sectionCounts.every((count) => count === sectionCounts[0]);
    const sectionLengths = parsed.map((entry) => entry.sections.map((section) => Array.from(section).length));
    const correspondingLengthsMatch = sameCount && sectionLengths[0].every(
      (length, sectionIndex) => sectionLengths.every((lengths) => lengths[sectionIndex] === length),
    );
    if (!correspondingLengthsMatch) {
      throw new Error('カンマで区切られた文字列はいずれも同じ長さにしてください');
    }
    positionGroups = [];
    for (let group = 0; group < sectionCounts[0]; group += 1) {
      for (let index = 0; index < sectionLengths[0][group]; index += 1) positionGroups.push(group);
    }
  }

  const sources = parsed.map((entry) => entry.sections.join(''));
  const sourceLengths = sources.map((source) => Array.from(source).length);
  if (!sourceLengths.every((length) => length === sourceLengths[0])) {
    if (pickupEnabled) throw new Error('カンマで区切られた文字列はいずれも同じ長さにしてください');
    throw new Error('文字列はいずれも同じ長さにしてください。');
  }
  return { sources, positionGroups, pickupEnabled, sectionCount: parsed[0].sections.length };
}

function updateInputMeta() {
  if (activeSourceEls().every((el) => !el.value.trim())) {
    inputMetaEl.textContent = '未入力';
    inputMetaEl.className = 'pill muted';
    return;
  }
  try {
    const parsed = parseAllSources(false);
    if (!parsed) {
      inputMetaEl.textContent = '未入力あり';
      inputMetaEl.className = 'pill muted';
      return;
    }
    const length = Array.from(parsed.sources[0]).length;
    inputMetaEl.textContent = `${parsed.sources.length}文字列 / 各${length}文字${parsed.pickupEnabled ? ` / ${parsed.sectionCount}区画` : ''}`;
    inputMetaEl.className = 'pill';
  } catch (_error) {
    inputMetaEl.textContent = '入力を確認してください';
    inputMetaEl.className = 'pill muted';
  }
}

function validateForm() {
  const parsedSources = parseAllSources(true);
  const dictIds = selectedDictIds();
  const nMin = Number(nMinEl.value);
  const nMax = Number(nMaxEl.value);
  const shiftMin = Number(shiftMinEl.value);
  const shiftMax = Number(shiftMaxEl.value);
  const maxResults = Number(maxResultsEl.value);
  if (dictIds.length === 0) throw new Error('辞書を1つ以上選んでください。');
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('最大表示件数は1以上の整数で指定してください。');
  return {
    ...parsedSources,
    dictIds,
    nMin,
    nMax,
    shiftMin,
    shiftMax,
    zeroMin: 0,
    zeroMax: nMax,
    loopAllowed: loopAllowedEl.checked,
    maxResults,
  };
}

function dictIdsFor(word, selectedIds) {
  return selectedIds.filter((id) => parsedDictionary(id).has(word));
}

function sortRows(rows, order) {
  return [...rows].sort((a, b) => {
    const lengthDiff = order === 'long' ? b.n - a.n : a.n - b.n;
    return lengthDiff || a.words.join('|').localeCompare(b.words.join('|'), 'ja');
  });
}

function shiftLabel(shift) {
  if (shift > 0) return `+${shift}`;
  if (shift === 0) return '±0';
  return String(shift);
}

function renderWordLine(row, sourceIndex, selectedIds) {
  const fromChars = Array.from(row.sourceFragments[sourceIndex]);
  const toChars = Array.from(row.words[sourceIndex]);
  const cells = fromChars.map((char, index) => `
    <span class="move-cell">
      <span class="from-char">${escapeHtml(char)}</span>
      <span class="shift-char">${escapeHtml(shiftLabel(row.shifts[index]))}</span>
      <span class="to-char">${escapeHtml(toChars[index])}</span>
    </span>
  `).join('');
  const tags = dictIdsFor(row.words[sourceIndex], selectedIds)
    .map((id) => `<span class="dict-tag">${escapeHtml(DICT_LABELS[id])}</span>`)
    .join('');
  return `
    <div class="word-line source-${sourceIndex + 1}">
      <span class="word-label">${sourceIndex + 1}</span>
      <div>
        <div class="move-line">${cells}</div>
        <div class="result-meta">${tags}</div>
      </div>
    </div>
  `;
}

function renderResults(resetCount = false) {
  if (!state.lastSearch) return;
  if (resetCount) state.visibleCount = 50;
  const { result, settings, elapsed } = state.lastSearch;
  let rows = result.results;
  const pattern = resultFilterEl.value;
  filterErrorEl.textContent = '';
  if (pattern) {
    try {
      const expression = new RegExp(pattern, 'i');
      rows = rows.filter((row) => row.words.some((word) => expression.test(word)));
    } catch (_error) {
      filterErrorEl.textContent = '正規表現が正しくありません。';
    }
  }
  rows = sortRows(rows, sortOrderEl.value);
  const matchedCount = rows.length;
  const displayLimit = Math.min(settings.maxResults, matchedCount);
  const visibleRows = rows.slice(0, Math.min(state.visibleCount, displayLimit));
  summaryEl.textContent = `表示: ${visibleRows.length}件 / 該当${matchedCount}件 / ${elapsed}ms`;
  loadMoreEl.hidden = visibleRows.length >= displayLimit;
  if (rows.length === 0) {
    resultsEl.innerHTML = '<div class="empty">ヒットなし</div>';
    return;
  }
  resultsEl.innerHTML = visibleRows.map((row, index) => `
    <article class="result-item" style="--result-index:${index}">
      <div class="result-head">
        <div class="result-title">${index + 1}. ${row.words.map(escapeHtml).join(' / ')}</div>
        <div class="pattern-badge">${row.n}文字 / ${escapeHtml(row.positions.join('→'))}文字目</div>
      </div>
      ${row.words.map((_word, sourceIndex) => renderWordLine(row, sourceIndex, settings.dictIds)).join('')}
    </article>
  `).join('');
  if (result.truncatedByResults || result.truncatedByLimit) {
    resultsEl.insertAdjacentHTML('beforeend', '<div class="more-note">上限に達したため、検索結果を途中で打ち切っています。</div>');
  }
}

function runSearch() {
  errorBoxEl.textContent = '';
  resultsEl.innerHTML = '';
  try {
    const settings = validateForm();
    summaryEl.textContent = '検索中…';
    window.setTimeout(() => {
      try {
        const startedAt = performance.now();
        const result = ShiftMatchCore.search({
          ...settings,
          parentSmallKana: true,
          lengthOrder: sortOrderEl.value,
          operationLimit: 5000000,
          words: mergedWords(settings.dictIds),
        });
        state.lastSearch = { result, settings, elapsed: Math.round(performance.now() - startedAt) };
        renderResults(true);
      } catch (error) {
        summaryEl.textContent = '検索エラー';
        errorBoxEl.textContent = error.message || String(error);
      }
    }, 20);
  } catch (error) {
    summaryEl.textContent = '入力エラー';
    errorBoxEl.textContent = error.message || String(error);
  }
}

function toggleSource3() {
  source3CardEl.hidden = !source3CardEl.hidden;
  toggleSource3El.textContent = source3CardEl.hidden ? '＋ 文字列3を追加' : '− 文字列3を削除';
  if (source3CardEl.hidden) sourceEls[2].value = '';
  else sourceEls[2].focus();
  updateInputMeta();
}

function init() {
  loadDictionaries();
  updateInputMeta();
  sourceEls.forEach((el) => {
    el.addEventListener('input', updateInputMeta);
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
  });
  toggleSource3El.addEventListener('click', toggleSource3);
  searchBtnEl.addEventListener('click', runSearch);
  sortOrderEl.addEventListener('change', () => renderResults(true));
  resultFilterEl.addEventListener('input', () => renderResults(true));
  loadMoreEl.addEventListener('click', () => {
    state.visibleCount += 50;
    renderResults();
  });
}

try {
  init();
} catch (error) {
  summaryEl.textContent = '初期化エラー';
  errorBoxEl.textContent = error.message || String(error);
}
