import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const shell = readFileSync('src/shell.html', 'utf8');
const parts = ['01-boot','02-ai','03-engine','04-entities','05-player','06-ui','07-loop']
  .map(n => `// ===== ${n} =====\n` + readFileSync(`src/${n}.js`, 'utf8').trim() + '\n');

const code = parts.join('\n');
if (!shell.includes('// GAME_CODE')) throw new Error('Missing // GAME_CODE placeholder in shell.html');
const out = shell.replace('// GAME_CODE', () => code);

// Keep the repository-root single file for direct opening, and emit the
// deployable static build under dist/ for start.sh.
writeFileSync('index.html', out);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', out);

console.log(`Built index.html and dist/index.html: ${out.length} bytes, ${out.split('\n').length} lines`);
