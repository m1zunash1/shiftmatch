'use strict';

const DICT_LABELS = { kobuta: '仔豚辞書', general: '一般語辞書', item: 'イラスト辞書' };
const state = { dictionaries: {}, parsedCache: new Map(), mergedCache: new Map(), lastResult: null };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function loadDictionaries() {
  if (typeof EMBEDDED_DICT_TEXT !== 'object' || !EMBEDDED_DICT_TEXT) throw new Error('辞書データを読み込めませんでした。');
  for (const [id, label] of Object.entries(DICT_LABELS)) {
    if (typeof EMBEDDED_DICT_TEXT[id] !== 'string') throw new Error(`${label}が見つかりません。`);
    state.dictionaries[id] = EMBEDDED_DICT_TEXT[id];
  }
}

function selectedDictionaryIds() {
  return Array.from(document.querySelectorAll('input[name="dict"]:checked')).map((input) => input.value);
}

function mergedWords(ids, parentSmallKana) {
  const key = `${[...ids].sort().join('|')}::${parentSmallKana}`;
  if (state.mergedCache.has(key)) return state.mergedCache.get(key);
  const words = new Set();
  for (const id of ids) {
    for (const word of parsedDictionary(id, parentSmallKana)) words.add(word);
  }
  state.mergedCache.set(key, words);
  return words;
}

function parsedDictionary(id, parentSmallKana) {
  const key = `${id}::${parentSmallKana}`;
  if (!state.parsedCache.has(key)) {
    state.parsedCache.set(key, ShiftMatchCore.parseDictionary(state.dictionaries[id], parentSmallKana));
  }
  return state.parsedCache.get(key);
}

function currentSources() {
  const values = [$('source1').value, $('source2').value];
  if (!$('source3Card').hidden) values.push($('source3').value);
  return values;
}

function updateInputMeta() {
  const parentSmallKana = $('parentSmallKana').checked;
  const sources = currentSources().map((value) => ShiftMatchCore.normalizeKana(value, parentSmallKana));
  const lengths = sources.map((value) => Array.from(value).length);
  const same = lengths.length > 0 && lengths.every((length) => length === lengths[0]);
  $('inputMeta').textContent = sources.some((value) => !value)
    ? `${sources.length}列・未入力あり`
    : `${sources.length}列・${same ? `各${lengths[0]}文字` : `長さ ${lengths.join(' / ')}`}`;
  $('inputMeta').classList.toggle('warning', !same || sources.some((value) => !value));
}

function zeroRange(nMax) {
  switch ($('zeroMode').value) {
    case 'none': return [0, 0];
    case 'one': return [1, 1];
    case 'custom': return [Number($('zeroMin').value), Number($('zeroMax').value)];
    default: return [0, nMax];
  }
}

function dictionaryTags(word, ids, parentSmallKana) {
  return ids.filter((id) => parsedDictionary(id, parentSmallKana).has(word));
}

function sortResults(results) {
  const order = $('sortOrder').value;
  return [...results].sort((a, b) => {
    if (order === 'shift') {
      const aScore = a.shifts.reduce((sum, value) => sum + Math.abs(value), 0);
      const bScore = b.shifts.reduce((sum, value) => sum + Math.abs(value), 0);
      return aScore - bScore || a.words.join('\0').localeCompare(b.words.join('\0'), 'ja');
    }
    if (order === 'words') return a.words.join('\0').localeCompare(b.words.join('\0'), 'ja');
    return a.n - b.n || a.positions.join(',').localeCompare(b.positions.join(',')) || a.shifts.join(',').localeCompare(b.shifts.join(','));
  });
}

function renderResults() {
  if (!state.lastResult) return;
  const { searchResult, dictIds, parentSmallKana, elapsed } = state.lastResult;
  const results = sortResults(searchResult.results);
  const warnings = [];
  if (searchResult.truncatedByResults) warnings.push('最大表示件数に達しました');
  if (searchResult.truncatedByLimit) warnings.push('計算上限に達しました');
  $('summary').innerHTML = `<b>${results.length.toLocaleString()}件</b><span>${searchResult.operations.toLocaleString()}探索・${elapsed.toFixed(1)}ms</span>${warnings.map((warning) => `<em>${escapeHtml(warning)}</em>`).join('')}`;
  $('csvButton').disabled = results.length === 0;
  if (!results.length) {
    $('results').className = 'results-empty';
    $('results').textContent = '条件に一致する組は見つかりませんでした。';
    return;
  }
  $('results').className = 'result-list';
  $('results').innerHTML = results.map((result, resultIndex) => {
    const positionText = result.positions.map((position) => `${position}文字目`).join(' → ');
    const shiftText = result.shifts.map((shift) => (shift > 0 ? `+${shift}` : String(shift))).join(', ');
    const wordRows = result.words.map((word, index) => {
      const tags = dictionaryTags(word, dictIds, parentSmallKana).map((id) => `<span>${escapeHtml(DICT_LABELS[id])}</span>`).join('');
      return `<div class="word-row source-${index + 1}"><small>w_${index + 1}</small><code>${escapeHtml(result.sourceFragments[index])}</code><b>→</b><strong>${escapeHtml(word)}</strong><div class="tags">${tags}</div></div>`;
    }).join('');
    return `<article class="result-card"><div class="result-number">${resultIndex + 1}</div><div class="result-body"><div class="result-meta"><span>N=${result.n}</span><span>位置：${positionText}</span><span>シフト：[${shiftText}]</span></div>${wordRows}</div></article>`;
  }).join('');
}

function runSearch() {
  $('errorBox').textContent = '';
  const dictIds = selectedDictionaryIds();
  if (!dictIds.length) {
    $('errorBox').textContent = '辞書を1つ以上選択してください。';
    return;
  }
  const nMax = Number($('nMax').value);
  const [zeroMin, zeroMax] = zeroRange(nMax);
  const parentSmallKana = $('parentSmallKana').checked;
  const button = $('searchButton');
  button.disabled = true;
  button.querySelector('span').textContent = '検索中…';
  window.setTimeout(() => {
    try {
      const started = performance.now();
      const searchResult = ShiftMatchCore.search({
        sources: currentSources(),
        parentSmallKana,
        nMin: Number($('nMin').value),
        nMax,
        shiftMin: Number($('shiftMin').value),
        shiftMax: Number($('shiftMax').value),
        zeroMin,
        zeroMax,
        maxResults: Number($('maxResults').value),
        operationLimit: 5000000,
        words: mergedWords(dictIds, parentSmallKana),
      });
      state.lastResult = { searchResult, dictIds, parentSmallKana, elapsed: performance.now() - started };
      renderResults();
    } catch (error) {
      $('errorBox').textContent = error.message || String(error);
    } finally {
      button.disabled = false;
      button.querySelector('span').textContent = '検索する';
    }
  }, 20);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function saveCsv() {
  if (!state.lastResult) return;
  const results = sortResults(state.lastResult.searchResult.results);
  const sourceCount = state.lastResult.searchResult.normalizedSources.length;
  const header = ['N', '位置', 'シフト'];
  for (let index = 0; index < sourceCount; index += 1) header.push(`w_${index + 1}抽出`, `w_${index + 1}結果`);
  const rows = [header, ...results.map((result) => {
    const row = [result.n, result.positions.join('→'), result.shifts.join(',')];
    for (let index = 0; index < sourceCount; index += 1) row.push(result.sourceFragments[index], result.words[index]);
    return row;
  })];
  const blob = new Blob([`\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'shiftmatch-results.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

$('toggleSource3').addEventListener('click', () => {
  const card = $('source3Card');
  card.hidden = !card.hidden;
  $('toggleSource3').textContent = card.hidden ? '＋ w_3を追加' : '− w_3を外す';
  if (!card.hidden) $('source3').focus();
  updateInputMeta();
});
$('zeroMode').addEventListener('change', () => { $('zeroCustom').hidden = $('zeroMode').value !== 'custom'; });
$('searchButton').addEventListener('click', runSearch);
$('sortOrder').addEventListener('change', renderResults);
$('csvButton').addEventListener('click', saveCsv);
for (const input of document.querySelectorAll('input')) input.addEventListener('input', updateInputMeta);

try {
  loadDictionaries();
  updateInputMeta();
} catch (error) {
  $('errorBox').textContent = error.message || String(error);
  $('searchButton').disabled = true;
}
