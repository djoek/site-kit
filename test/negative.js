// Negative tests: copy the fixture, break it on purpose, and require that check reports each defect.
// Each case runs on a fresh copy so one defect cannot hide another.
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const fixture = path.resolve(import.meta.dir, '../fixtures/basic');
const bin = path.resolve(import.meta.dir, '../bin/site-kit.js');
const skip = new Set(['node_modules', 'dist', '.astro']);

function copyFixture() {
  const work = mkdtempSync(path.join(tmpdir(), 'site-kit-negative-'));
  cpSync(fixture, work, { recursive: true, filter: (src) => !path.relative(fixture, src).split(path.sep).some((part) => skip.has(part)) });
  symlinkSync(path.join(fixture, 'node_modules'), path.join(work, 'node_modules'));
  return work;
}

function edit(work, file, from, to) {
  const full = path.join(work, file);
  const text = readFileSync(full, 'utf8');
  if (!text.includes(from)) throw new Error(`mutation anchor not found in ${file}: ${from}`);
  writeFileSync(full, text.replace(from, to));
}

/** Break a copy with `mutate`, run check with `args`, require every string in `expected`. */
function runCase(name, args, mutate, expected) {
  const work = copyFixture();
  mutate(work);
  const result = spawnSync('bun', [bin, 'check', ...args], { cwd: work, encoding: 'utf8', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  const output = `${result.stdout}\n${result.stderr}`;
  const missing = expected.filter((text) => !output.includes(text));
  const ok = result.status !== 0 && missing.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    if (result.status === 0) console.error('    check exited 0');
    for (const text of missing) console.error(`    not reported: ${text}`);
    console.error(output.split('\n').filter((line) => /^\s*[-✗✓]/.test(line)).map((line) => `    | ${line}`).join('\n'));
  }
  rmSync(work, { recursive: true, force: true });
  return ok;
}

const results = [
  runCase('source: literal text, hex colour, missing translation key', ['--no-browser'], (work) => {
    edit(work, 'src/pages/_Home.astro', '<p>{copy.intro}</p>', '<p>{copy.intro}</p><p>Hard-coded tekst</p>');
    appendFileSync(path.join(work, 'src/styles/site.scss'), '\nmain { border-color: #ff0000; }\n');
    const file = path.join(work, 'src/content/i18n/en.json');
    const copy = JSON.parse(readFileSync(file, 'utf8'));
    delete copy.footer;
    writeFileSync(file, JSON.stringify(copy));
  }, ['belongs in src/content/i18n', 'hex colour', 'keys differ from nl.json (missing: footer.privacy', 'fix the source problems above first']),

  runCase('output: second h1, broken link', ['--no-browser'], (work) => {
    edit(work, 'src/pages/_Privacy.astro', '<PrivacyPolicy />', '<PrivacyPolicy /><h1>{copy.kit.privacy.title}</h1>');
    edit(work, 'src/pages/_Home.astro', '<p>{copy.intro}</p>', '<p><a href="/bestaat-niet/">{copy.intro}</a></p>');
  }, ['expected one <h1>, found 2', 'broken internal link or asset /bestaat-niet/']),

  runCase('browser: low contrast in one theme', [], (work) => {
    appendFileSync(path.join(work, 'src/styles/site.scss'), '\nmain p { color: color-mix(in oklch, var(--color-bg) 80%, var(--color-text)); }\n');
  }, ['axe color-contrast']),

  runCase('output: redirect to a page that does not exist', ['--no-browser'], (work) => {
    edit(work, 'site.config.ts', "redirects: { '/Privacy.html': '/privacy/' }", "redirects: { '/Privacy.html': '/privacybeleid/' }");
  }, ['/Privacy.html points to /privacybeleid/, which is not a built page']),

  runCase('site data: invalid opening hours', ['--no-browser'], (work) => {
    edit(work, 'src/data/hours.toml', 'fri = [["07:00", "18:00"]]', 'fri = [["18:00", "07:00"]]');
  }, ['[week].fri: 18:00 is not before 07:00']),

  runCase('site data: exception note missing a language', ['--no-browser'], (work) => {
    edit(work, 'src/data/hours.toml', 'note = { nl = "Kerstmis", en = "Christmas" }', 'note = { nl = "Kerstmis" }');
  }, ['note is missing "en"']),
];

process.exit(results.every(Boolean) ? 0 : 1);
