import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = new URL('.', import.meta.url).pathname;
const dictionaryRoot = resolve(projectRoot, '../../nazo/dictionaries');
const files = {
  kobuta: 'kobuta.txt',
  general: 'general.txt',
  item: 'item.txt',
  english: 'english.txt',
  roma: 'roma.txt',
};
const payload = {};

for (const [key, filename] of Object.entries(files)) {
  payload[key] = readFileSync(resolve(dictionaryRoot, filename), 'utf8');
}

const output = `// Generated from ../../nazo/dictionaries by build-dict-data.mjs\nconst EMBEDDED_DICT_TEXT = ${JSON.stringify(payload)};\n`;
writeFileSync(resolve(projectRoot, 'dict-data.js'), output, 'utf8');
