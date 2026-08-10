(function initShiftMatchCore(globalScope) {
  'use strict';

  const GOJUON = Array.from('あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん');
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
      .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
    if (!parentSmallKana) return normalized;
    return splitChars(normalized).map((char) => SMALL_KANA[char] || char).join('');
  }

  function parseDictionary(text, parentSmallKana = true) {
    const words = new Set();
    for (const raw of String(text || '').split(/\r?\n/)) {
      const word = normalizeKana(raw.trim(), parentSmallKana);
      if (word) words.add(word);
    }
    return words;
  }

  function makeTrieNode() {
    return { children: new Map(), terminal: false };
  }

  function buildTrie(words, allowedLengths) {
    const root = makeTrieNode();
    for (const word of words) {
      const chars = splitChars(word);
      if (allowedLengths && !allowedLengths.has(chars.length)) continue;
      if (chars.some((char) => !GOJUON.includes(char))) continue;
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
    const unsupported = [...new Set(sources.flatMap((value) => splitChars(value)).filter((char) => !GOJUON.includes(char)))];
    if (unsupported.length) throw new Error(`五十音順にない文字が含まれています：${unsupported.join('、')}`);
    const maxLength = lengths[0];
    const numericKeys = ['nMin', 'nMax', 'shiftMin', 'shiftMax', 'zeroMin', 'zeroMax'];
    for (const key of numericKeys) {
      if (!Number.isInteger(config[key])) throw new Error('検索設定には整数を指定してください。');
    }
    if (config.nMin < 1 || config.nMax < config.nMin || config.nMax > maxLength) {
      throw new Error(`Nは1〜${maxLength}の範囲で指定してください。`);
    }
    if (config.shiftMin > config.shiftMax) throw new Error('シフト最小値は最大値以下にしてください。');
    if (config.zeroMin < 0 || config.zeroMax < config.zeroMin || config.zeroMax > config.nMax) {
      throw new Error('0シフト個数の範囲が不正です。');
    }
    return { sources, sourceChars: sources.map(splitChars), maxLength };
  }

  function search(config) {
    const { sources, sourceChars, maxLength } = validateConfig(config);
    const allowedLengths = new Set();
    for (let n = config.nMin; n <= config.nMax; n += 1) allowedLengths.add(n);
    const trie = buildTrie(config.words, allowedLengths);
    const shifts = [];
    for (let shift = config.shiftMin; shift <= config.shiftMax; shift += 1) shifts.push(shift);

    const results = [];
    const maxResults = Math.max(1, config.maxResults || 1000);
    const operationLimit = Math.max(1000, config.operationLimit || 5000000);
    let operations = 0;
    let truncatedByLimit = false;
    let truncatedByResults = false;

    outer:
    for (let n = config.nMin; n <= config.nMax; n += 1) {
      const positions = [];
      const used = new Array(maxLength).fill(false);

      function choosePosition(depth) {
        if (results.length >= maxResults || operations >= operationLimit) return;
        if (depth === n) {
          const nodes = sources.map(() => trie);
          const outputChars = sources.map(() => []);
          const shiftVector = [];

          function chooseShift(outputIndex, zeroCount) {
            if (results.length >= maxResults || operations >= operationLimit) return;
            if (zeroCount > config.zeroMax || zeroCount + (n - outputIndex) < config.zeroMin) return;
            if (outputIndex === n) {
              if (zeroCount < config.zeroMin || zeroCount > config.zeroMax) return;
              if (!nodes.every((node) => node.terminal)) return;
              const words = outputChars.map((chars) => chars.join(''));
              results.push({
                n,
                positions: positions.map((position) => position + 1),
                shifts: [...shiftVector],
                sourceFragments: sourceChars.map((chars) => positions.map((position) => chars[position]).join('')),
                words,
              });
              return;
            }

            const position = positions[outputIndex];
            for (const shift of shifts) {
              operations += 1;
              if (operations >= operationLimit) return;
              const nextNodes = [];
              const nextChars = [];
              let valid = true;
              for (let sourceIndex = 0; sourceIndex < sourceChars.length; sourceIndex += 1) {
                const sourceChar = sourceChars[sourceIndex][position];
                const shiftedIndex = GOJUON.indexOf(sourceChar) + shift;
                if (shiftedIndex < 0 || shiftedIndex >= GOJUON.length) {
                  valid = false;
                  break;
                }
                const shiftedChar = GOJUON[shiftedIndex];
                const nextNode = nodes[sourceIndex].children.get(shiftedChar);
                if (!nextNode) {
                  valid = false;
                  break;
                }
                nextNodes.push(nextNode);
                nextChars.push(shiftedChar);
              }
              if (!valid) continue;

              const previousNodes = [...nodes];
              for (let index = 0; index < nodes.length; index += 1) {
                nodes[index] = nextNodes[index];
                outputChars[index].push(nextChars[index]);
              }
              shiftVector.push(shift);
              chooseShift(outputIndex + 1, zeroCount + (shift === 0 ? 1 : 0));
              shiftVector.pop();
              for (let index = 0; index < nodes.length; index += 1) {
                outputChars[index].pop();
                nodes[index] = previousNodes[index];
              }
            }
          }

          chooseShift(0, 0);
          return;
        }

        for (let position = 0; position < maxLength; position += 1) {
          if (used[position]) continue;
          used[position] = true;
          positions.push(position);
          choosePosition(depth + 1);
          positions.pop();
          used[position] = false;
          if (results.length >= maxResults || operations >= operationLimit) return;
        }
      }

      choosePosition(0);
      if (results.length >= maxResults) {
        truncatedByResults = true;
        break outer;
      }
      if (operations >= operationLimit) {
        truncatedByLimit = true;
        break outer;
      }
    }

    return { results, operations, truncatedByLimit, truncatedByResults, normalizedSources: sources };
  }

  const api = { GOJUON, SMALL_KANA, normalizeKana, parseDictionary, buildTrie, search };
  globalScope.ShiftMatchCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
