(function initShiftMatchCore(globalScope) {
  'use strict';

  const GOJUON = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
  const DAKUON = Array.from('がぎぐげござじずぜぞだぢづでど');
  const B_DAKUON = Array.from('ばびぶべぼ');
  const HANDAKUON = Array.from('ぱぴぷぺぽ');
  const ALPHABET = Array.from('abcdefghijklmnopqrstuvwxyz');
  const SMALL_KANA = {
    ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お',
    ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ',
  };

  function splitChars(value) {
    return Array.from(value);
  }

  function normalizeKana(value, parentSmallKana = true) {
    const normalized = String(value || '')
      .normalize('NFKC')
      .replace(/[\s　]+/g, '')
      .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
      .toLowerCase();
    if (!parentSmallKana) return normalized;
    return splitChars(normalized).map((char) => SMALL_KANA[char] || char).join('');
  }

  function normalizeDictionaryWord(value) {
    return String(value || '')
      .normalize('NFKC')
      .trim()
      .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
      .toLowerCase();
  }

  function parseDictionary(text) {
    const words = new Set();
    for (const raw of String(text || '').split(/\r?\n/)) {
      const word = normalizeDictionaryWord(raw);
      if (word) words.add(word);
    }
    return words;
  }

  function makeTrieNode() {
    return { children: new Map(), terminal: false };
  }

  function sequenceForChar(char) {
    if (GOJUON.includes(char)) return GOJUON;
    if (DAKUON.includes(char)) return DAKUON;
    if (B_DAKUON.includes(char)) return B_DAKUON;
    if (HANDAKUON.includes(char)) return HANDAKUON;
    if (ALPHABET.includes(char)) return ALPHABET;
    return null;
  }

  function buildTrie(words, allowedLengths) {
    const root = makeTrieNode();
    for (const word of words) {
      const chars = splitChars(word);
      if (allowedLengths && !allowedLengths.has(chars.length)) continue;
      if (chars.some((char) => !sequenceForChar(char))) continue;
      let node = root;
      for (const char of chars) {
        if (!node.children.has(char)) node.children.set(char, makeTrieNode());
        node = node.children.get(char);
      }
      node.terminal = true;
    }
    return root;
  }

  function validateConfig(config) {
    const sources = config.sources.map((value) => normalizeKana(value, config.parentSmallKana));
    if (sources.length < 2 || sources.length > 3) throw new Error('文字列は2個または3個指定してください。');
    if (sources.some((value) => !value)) throw new Error('使用する文字列をすべて入力してください。');
    const lengths = sources.map((value) => splitChars(value).length);
    if (!lengths.every((length) => length === lengths[0])) throw new Error('文字列の長さをそろえてください。');
    const maxLength = lengths[0];
    const sourceChars = sources.map(splitChars);
    const selectablePositions = Array.from({ length: maxLength }, (_, position) => position)
      .filter((position) => sourceChars.every((chars) => sequenceForChar(chars[position])));
    const numericKeys = ['nMin', 'nMax', 'shiftMin', 'shiftMax', 'zeroMin', 'zeroMax'];
    for (const key of numericKeys) {
      if (!Number.isInteger(config[key])) throw new Error('検索設定には整数を指定してください。');
    }
    if (config.nMin < 1 || config.nMax < config.nMin || config.nMax > selectablePositions.length) {
      throw new Error(`拾う文字数は1〜${selectablePositions.length}の範囲で指定してください。`);
    }
    if (config.shiftMin > config.shiftMax) throw new Error('シフト最小値は最大値以下にしてください。');
    if (config.zeroMin < 0 || config.zeroMax < config.zeroMin || config.zeroMax > config.nMax) {
      throw new Error('0シフト個数の範囲が不正です。');
    }
    if (config.positionGroups) {
      if (config.positionGroups.length !== maxLength) throw new Error('pick up区画の位置情報が不正です。');
      const groupCount = new Set(config.positionGroups).size;
      if (config.nMax < groupCount) throw new Error('拾う文字数はカンマ区画の数以上にしてください。');
    }
    return { sources, sourceChars, maxLength, selectablePositions };
  }

  function search(config) {
    const { sources, sourceChars, maxLength, selectablePositions } = validateConfig(config);
    const allowedLengths = new Set();
    for (let n = config.nMin; n <= config.nMax; n += 1) allowedLengths.add(n);
    const trie = buildTrie(config.words, allowedLengths);
    const wordsByLength = new Map();
    for (const rawWord of config.words) {
      const word = normalizeDictionaryWord(rawWord);
      const chars = splitChars(word);
      if (!allowedLengths.has(chars.length) || chars.some((char) => !sequenceForChar(char))) continue;
      if (!wordsByLength.has(chars.length)) wordsByLength.set(chars.length, []);
      wordsByLength.get(chars.length).push({ word, chars });
    }

    const results = [];
    const resultLimit = Math.max(1000, config.resultLimit || 100000);
    const operationLimit = Math.max(1000, config.operationLimit || 5000000);
    let operations = 0;
    let truncatedByLimit = false;
    let truncatedByResults = false;
    const groupCount = config.positionGroups ? new Set(config.positionGroups).size : 0;
    const transitionCache = new Map();
    function transitionsFor(targetChar) {
      if (transitionCache.has(targetChar)) return transitionCache.get(targetChar);
      const targetSequence = sequenceForChar(targetChar);
      const transitions = [];
      for (const position of selectablePositions) {
        const firstChar = sourceChars[0][position];
        const firstSequence = sequenceForChar(firstChar);
        if (firstSequence !== targetSequence) continue;
        const possibleShifts = [];
        if (config.loopAllowed) {
          for (let shift = config.shiftMin; shift <= config.shiftMax; shift += 1) {
            const index = ((firstSequence.indexOf(firstChar) + shift) % firstSequence.length + firstSequence.length) % firstSequence.length;
            if (firstSequence[index] === targetChar) possibleShifts.push(shift);
          }
        } else {
          const shift = firstSequence.indexOf(targetChar) - firstSequence.indexOf(firstChar);
          if (shift >= config.shiftMin && shift <= config.shiftMax) possibleShifts.push(shift);
        }
        for (const shift of possibleShifts) {
          const shiftedChars = [];
          let valid = true;
          for (let sourceIndex = 1; sourceIndex < sourceChars.length; sourceIndex += 1) {
            const sourceChar = sourceChars[sourceIndex][position];
            const sequence = sequenceForChar(sourceChar);
            const rawIndex = sequence.indexOf(sourceChar) + shift;
            if (!config.loopAllowed && (rawIndex < 0 || rawIndex >= sequence.length)) {
              valid = false;
              break;
            }
            const shiftedIndex = ((rawIndex % sequence.length) + sequence.length) % sequence.length;
            shiftedChars[sourceIndex] = sequence[shiftedIndex];
          }
          if (valid) transitions.push({ position, shift, shiftedChars });
        }
      }
      transitionCache.set(targetChar, transitions);
      return transitions;
    }
    const lengths = [];
    if (config.lengthOrder === 'long') {
      for (let n = config.nMax; n >= config.nMin; n -= 1) lengths.push(n);
    } else {
      for (let n = config.nMin; n <= config.nMax; n += 1) lengths.push(n);
    }

    outer:
    for (const n of lengths) {
      for (const target of wordsByLength.get(n) || []) {
        const positions = [];
        const used = new Array(maxLength).fill(false);
        const shiftVector = [];
        const outputChars = sources.map(() => []);
        const nodes = sources.map((_source, sourceIndex) => (sourceIndex === 0 ? null : trie));

        function matchTarget(depth, zeroCount) {
          if (results.length >= resultLimit || operations >= operationLimit) return;
          if (zeroCount > config.zeroMax || zeroCount + (n - depth) < config.zeroMin) return;
          if (config.positionGroups) {
            const covered = new Set(positions.map((position) => config.positionGroups[position])).size;
            if (groupCount - covered > n - depth) return;
          }
          if (depth === n) {
            if (zeroCount < config.zeroMin || zeroCount > config.zeroMax) return;
            if (config.positionGroups) {
              const covered = new Set(positions.map((position) => config.positionGroups[position])).size;
              if (covered !== groupCount) return;
            }
            if (!nodes.slice(1).every((node) => node.terminal)) return;
            results.push({
              n,
              positions: positions.map((position) => position + 1),
              shifts: [...shiftVector],
              sourceFragments: sourceChars.map((chars) => positions.map((position) => chars[position]).join('')),
              words: [target.word, ...outputChars.slice(1).map((chars) => chars.join(''))],
            });
            return;
          }

          const targetChar = target.chars[depth];
          for (const transition of transitionsFor(targetChar)) {
            const { position, shift, shiftedChars } = transition;
            if (used[position]) continue;
            operations += 1;
            if (operations >= operationLimit) return;
            const nextNodes = [];
            let valid = true;
            for (let sourceIndex = 1; sourceIndex < sourceChars.length; sourceIndex += 1) {
              const nextNode = nodes[sourceIndex].children.get(shiftedChars[sourceIndex]);
              if (!nextNode) {
                valid = false;
                break;
              }
              nextNodes[sourceIndex] = nextNode;
            }
            if (!valid) continue;

            used[position] = true;
            positions.push(position);
            shiftVector.push(shift);
            const previousNodes = [...nodes];
            for (let sourceIndex = 1; sourceIndex < sourceChars.length; sourceIndex += 1) {
              nodes[sourceIndex] = nextNodes[sourceIndex];
              outputChars[sourceIndex].push(shiftedChars[sourceIndex]);
            }
            matchTarget(depth + 1, zeroCount + (shift === 0 ? 1 : 0));
            for (let sourceIndex = 1; sourceIndex < sourceChars.length; sourceIndex += 1) outputChars[sourceIndex].pop();
            for (let sourceIndex = 1; sourceIndex < sourceChars.length; sourceIndex += 1) nodes[sourceIndex] = previousNodes[sourceIndex];
            shiftVector.pop();
            positions.pop();
            used[position] = false;
            if (results.length >= resultLimit || operations >= operationLimit) return;
          }
        }

        matchTarget(0, 0);
        if (results.length >= resultLimit) {
          truncatedByResults = true;
          break outer;
        }
        if (operations >= operationLimit) {
          truncatedByLimit = true;
          break outer;
        }
      }
    }

    return { results, operations, truncatedByLimit, truncatedByResults, normalizedSources: sources };
  }

  const api = { GOJUON, DAKUON, B_DAKUON, HANDAKUON, ALPHABET, SMALL_KANA, normalizeKana, normalizeDictionaryWord, parseDictionary, buildTrie, sequenceForChar, search };
  globalScope.ShiftMatchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
