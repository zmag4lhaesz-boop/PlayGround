import { readFileSync, writeFileSync } from 'node:fs';

const shell = readFileSync('src/shell.html', 'utf8');
const parts = ['01-boot','02-ai','03-engine','04-entities','05-player','06-ui','07-loop']
  .map(n => `// ===== ${n} =====\n` + readFileSync(`src/${n}.js`, 'utf8').trim() + '\n');

const code = parts.join('\n');
if (!shell.includes('// GAME_CODE')) throw new Error('Missing // GAME_CODE placeholder in shell.html');
const out = shell.replace('// GAME_CODE', () => code);
writeFileSync('index.html', out);
console.log(`Built index.html: ${out.length} bytes, ${out.split('\n').length} lines`);
