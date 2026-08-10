const DICT_LABELS = {
  kobuta: '仔豚辞書',
  general: '一般語辞書',
  item: 'イラスト辞書',
};

const state = {
  dictionaries: {},
  cache: { parsed: new Map(), merged: new Map() },
  lastSearch: null,
};

const sourceEls = [
  document.getElementById('source1'),
  document.getElementById('source2'),
  document.getElementById('source3'),
];
const inputMetaEl = document.getElementById('inputMeta');
const nMinEl = document.getElementById('nMin');
const nMaxEl = document.getElementById('nMax');
const shiftMinEl = document.getElementById('shiftMin');
const shiftMaxEl = document.getElementById('shiftMax');
const zeroModeEl = document.getElementById('zeroMode');
const zeroCustomEl = document.getElementById('zeroCustom');
const zeroMinEl = document.getElementById('zeroMin');
const zeroMaxEl = document.getElementById('zeroMax');
const maxResultsEl = document.getElementById('maxResults');
const searchBtnEl = document.getElementById('searchBtn');
const errorBoxEl = document.getElementById('errorBox');
const sortOrderEl = document.getElementById('sortOrder');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');

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

function currentSources() {
  return sourceEls.map((el) => el.value).filter((value, index) => index < 2 || value.trim());
}

function zeroRange(nMax) {
  if (zeroModeEl.value === 'none') return [0, 0];
  if (zeroModeEl.value === 'one') return [1, 1];
  if (zeroModeEl.value === 'custom') return [Number(zeroMinEl.value), Number(zeroMaxEl.value)];
  return [0, nMax];
}

function updateInputMeta() {
  const sources = currentSources().map((value) => ShiftMatchCore.normalizeKana(value, true));
  if (!sources[0] && !sources[1]) {
    inputMetaEl.textContent = '未入力';
    inputMetaEl.className = 'pill muted';
    return;
  }
  const lengths = sources.map((value) => Array.from(value).length);
  const valid = sources.length >= 2 && sources.every(Boolean) && lengths.every((length) => length === lengths[0]);
  inputMetaEl.textContent = valid ? `${sources.length}文字列 / 各${lengths[0]}文字` : `文字数: ${lengths.join(' / ')}`;
  inputMetaEl.className = valid ? 'pill' : 'pill muted';
}

function validateForm() {
  const sources = currentSources();
  const dictIds = selectedDictIds();
  const nMin = Number(nMinEl.value);
  const nMax = Number(nMaxEl.value);
  const shiftMin = Number(shiftMinEl.value);
  const shiftMax = Number(shiftMaxEl.value);
  const maxResults = Number(maxResultsEl.value);
  const [zeroMin, zeroMax] = zeroRange(nMax);
  if (dictIds.length === 0) throw new Error('辞書を1つ以上選んでください。');
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('最大表示件数は1以上の整数で指定してください。');
  return { sources, dictIds, nMin, nMax, shiftMin, shiftMax, zeroMin, zeroMax, maxResults };
}

function dictIdsFor(word, selectedIds) {
  return selectedIds.filter((id) => parsedDictionary(id).has(word));
}

function sortRows(rows, order) {
  const compareNumberArrays = (left, right) => {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return left.length - right.length;
  };
  return [...rows].sort((a, b) => {
    if (order === 'word') return a.words.join('|').localeCompare(b.words.join('|'), 'ja');
    if (order === 'shift') {
      const aTotal = a.shifts.reduce((sum, shift) => sum + Math.abs(shift), 0);
      const bTotal = b.shifts.reduce((sum, shift) => sum + Math.abs(shift), 0);
      return aTotal - bTotal || a.words.join('|').localeCompare(b.words.join('|'), 'ja');
    }
    return a.n - b.n || compareNumberArrays(a.positions, b.positions) || compareNumberArrays(a.shifts, b.shifts);
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
      <span class="word-label">w_${sourceIndex + 1}</span>
      <div>
        <div class="move-line">${cells}</div>
        <div class="result-meta">${tags}</div>
      </div>
    </div>
  `;
}

function renderResults() {
  if (!state.lastSearch) return;
  const { result, settings, elapsed } = state.lastSearch;
  const rows = sortRows(result.results, sortOrderEl.value);
  summaryEl.textContent = `ヒット数: ${rows.length} / ${elapsed}ms`;
  if (rows.length === 0) {
    resultsEl.innerHTML = '<div class="empty">ヒットなし</div>';
    return;
  }
  resultsEl.innerHTML = rows.map((row, index) => {
    const title = row.words.map(escapeHtml).join(' / ');
    const positions = row.positions.join('→');
    return `
      <article class="result-item" style="--result-index:${index}">
        <div class="result-head">
          <div class="result-title">${index + 1}. ${title}</div>
          <div class="pattern-badge">N=${row.n} / ${escapeHtml(positions)}文字目</div>
        </div>
        ${row.words.map((_word, sourceIndex) => renderWordLine(row, sourceIndex, settings.dictIds)).join('')}
      </article>
    `;
  }).join('');
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
          operationLimit: 5000000,
          words: mergedWords(settings.dictIds),
        });
        state.lastSearch = { result, settings, elapsed: Math.round(performance.now() - startedAt) };
        renderResults();
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

function init() {
  loadDictionaries();
  updateInputMeta();
  sourceEls.forEach((el) => {
    el.addEventListener('input', updateInputMeta);
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
  });
  zeroModeEl.addEventListener('change', () => { zeroCustomEl.hidden = zeroModeEl.value !== 'custom'; });
  searchBtnEl.addEventListener('click', runSearch);
  sortOrderEl.addEventListener('change', renderResults);
}

try {
  init();
} catch (error) {
  summaryEl.textContent = '初期化エラー';
  errorBoxEl.textContent = error.message || String(error);
}
