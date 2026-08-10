import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const core = require('./search-core.js');
const dictionaryRoot = resolve(new URL('.', import.meta.url).pathname, '../../nazo/dictionaries');
const words = new Set([
  ...core.parseDictionary(readFileSync(resolve(dictionaryRoot, 'general.txt'), 'utf8')),
  ...core.parseDictionary(readFileSync(resolve(dictionaryRoot, 'kobuta.txt'), 'utf8')),
]);

assert.equal(core.normalizeKana('ショウユ'), 'しようゆ');
assert.equal(core.normalizeKana('しょうゆ'), 'しようゆ');
assert.equal(core.normalizeDictionaryWord('しょうゆ'), 'しょうゆ');
assert.equal(core.normalizeDictionaryWord('CAT'), 'cat');
assert.deepEqual(core.DAKUON, Array.from('がぎぐげござじずぜぞだぢづでど'));
assert.deepEqual(core.B_DAKUON, Array.from('ばびぶべぼ'));
assert.deepEqual(core.HANDAKUON, Array.from('ぱぴぷぺぽ'));
assert(words.has('しょうゆ'));
assert(!words.has('しようゆ'));

const result = core.search({
  sources: ['ひとさしなか', 'しょうゆしお'],
  parentSmallKana: true,
  nMin: 2,
  nMax: 2,
  shiftMin: -5,
  shiftMax: 5,
  zeroMin: 1,
  zeroMax: 1,
  loopAllowed: false,
  maxResults: 5000,
  operationLimit: 5000000,
  words,
});

const keyed = new Set(result.results.map((entry) => `${entry.words.join('/')}|${entry.positions.join(',')}|${entry.shifts.join(',')}`));
for (const expected of [
  'ふな/すし|1,5|1,0',
  'さけ/うめ|3,4|0,-3',
  'なす/しお|5,3|0,2',
  'さき/うみ|3,4|0,-5',
]) assert(keyed.has(expected), `missing fixture: ${expected}`);

assert.throws(() => core.search({
  sources: ['あい', 'あいう'], parentSmallKana: true, nMin: 1, nMax: 1,
  shiftMin: 0, shiftMax: 0, zeroMin: 1, zeroMax: 1, loopAllowed: false, words,
}), /長さをそろえて/);

const alphabetLoop = core.search({
  sources: ['z', 'a'], parentSmallKana: true, nMin: 1, nMax: 1,
  shiftMin: 1, shiftMax: 1, zeroMin: 0, zeroMax: 1, loopAllowed: true,
  maxResults: 10, words: new Set(['a', 'b']),
});
assert(alphabetLoop.results.some((entry) => entry.words.join('/') === 'a/b'));

const alphabetNoLoop = core.search({
  sources: ['z', 'a'], parentSmallKana: true, nMin: 1, nMax: 1,
  shiftMin: 1, shiftMax: 1, zeroMin: 0, zeroMax: 1, loopAllowed: false,
  maxResults: 10, words: new Set(['a', 'b']),
});
assert.equal(alphabetNoLoop.results.length, 0);

const mixedScripts = core.search({
  sources: ['か', 'f'], parentSmallKana: true, nMin: 1, nMax: 1,
  shiftMin: 1, shiftMax: 1, zeroMin: 0, zeroMax: 1, loopAllowed: false,
  maxResults: 10, words: new Set(['き', 'g']),
});
assert(mixedScripts.results.some((entry) => entry.words.join('/') === 'き/g'));

const pickup = core.search({
  sources: ['abcd', 'abcd'], parentSmallKana: true, nMin: 2, nMax: 2,
  shiftMin: 0, shiftMax: 0, zeroMin: 0, zeroMax: 2, loopAllowed: false,
  positionGroups: [0, 0, 1, 1], maxResults: 100,
  words: new Set(['ac', 'ad', 'bc', 'bd', 'ca', 'cb', 'da', 'db']),
});
assert(pickup.results.length > 0);
assert(pickup.results.every((entry) => new Set(entry.positions.map((position) => (position <= 2 ? 0 : 1))).size === 2));

const voiced = core.search({
  sources: ['がばぱ', 'がばぱ'], parentSmallKana: true, nMin: 3, nMax: 3,
  shiftMin: 1, shiftMax: 1, zeroMin: 0, zeroMax: 3, loopAllowed: false,
  maxResults: 10, words: new Set(['ぎびぴ']),
});
assert(voiced.results.some((entry) => entry.words.join('/') === 'ぎびぴ/ぎびぴ'));

const ignoredUnsupported = core.search({
  sources: ['あーい', 'あ・い'], parentSmallKana: true, nMin: 2, nMax: 2,
  shiftMin: 0, shiftMax: 0, zeroMin: 0, zeroMax: 2, loopAllowed: false,
  maxResults: 10, words: new Set(['あい']),
});
assert(ignoredUnsupported.results.some((entry) => entry.positions.join(',') === '1,3'));

console.log(`ok: ${result.results.length} results, ${result.operations} operations`);
