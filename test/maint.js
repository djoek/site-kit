// maint start / finish / deploy against a throwaway git repo with a bare "origin" and a fake `gh`.
// The checks and the deploy are stubbed: this tests the git and GitHub flow, not the site checks.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { maintDeploy, maintFinish, maintStart, slugify, taskType } from '../src/maint.js';

const work = mkdtempSync(path.join(tmpdir(), 'site-kit-maint-'));
const origin = path.join(work, 'origin.git');
const root = path.join(work, 'site');
const bin = path.join(work, 'bin');
const ghLog = path.join(work, 'gh.log');
const sh = (cmd, cwd = work) => {
  const r = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd}: ${r.stderr}`);
  return r.stdout.trim();
};

// Fake gh: answers from files in $FAKE_GH_DIR, logs every call.
mkdirSync(bin);
writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "$*" >> "${ghLog}"
case "$1 $2" in
  "issue view") cat "$FAKE_GH_DIR/issue.json" ;;
  "pr list") if echo "$*" | grep -q merged; then cat "$FAKE_GH_DIR/merged.json"; else echo "[]"; fi ;;
  "pr create") echo "https://github.com/djoek/example.be/pull/7" ;;
  "run list") cat "$FAKE_GH_DIR/runs.json" ;;
  "pr comment") echo ok ;;
  *) echo "fake gh: unexpected $*" >&2; exit 1 ;;
esac
`);
chmodSync(path.join(bin, 'gh'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.FAKE_GH_DIR = work;
const fake = (name, value) => writeFileSync(path.join(work, `${name}.json`), JSON.stringify(value));

sh(`git init -q --bare -b main "${origin}"`);
sh(`git init -q -b main "${root}"`);
sh('git config user.name test && git config user.email test@example.invalid', root);
mkdirSync(path.join(root, 'src/content/i18n'), { recursive: true });
writeFileSync(path.join(root, 'src/content/i18n/nl.json'), '{"home":{"intro":"Oud"}}\n');
writeFileSync(path.join(root, 'CHANGELOG.md'), '# Site changelog\n');
sh(`git add -A && git commit -qm init && git remote add origin "${origin}" && git push -q -u origin main`, root);

const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push(true);
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push(false);
    console.error(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
  }
};
const rejects = async (fn, text) => {
  try {
    await fn();
  } catch (error) {
    if (!error.message.includes(text)) throw new Error(`wrong error: ${error.message}`);
    return;
  }
  throw new Error(`expected an error containing "${text}"`);
};
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

await test('slug and task type helpers', () => {
  if (slugify('Nieuwe openingsuren vanaf 1 november!') !== 'nieuwe-openingsuren-vanaf-1-november') throw new Error('slug');
  if (slugify('Café & crème') !== 'cafe-creme') throw new Error('accent slug');
  if (taskType([{ name: 'agent-ok' }, { name: 'type:hours' }]) !== 'hours') throw new Error('type');
});

await test('start refuses an issue without a type label, and a needs-builder issue', async () => {
  fake('issue', { number: 3, title: 'Iets', state: 'OPEN', labels: [{ name: 'agent-ok' }] });
  await rejects(() => maintStart({ root, issue: 3 }), 'exactly one label type:');
  fake('issue', { number: 3, title: 'Iets', state: 'OPEN', labels: [{ name: 'needs-builder' }, { name: 'type:copy' }] });
  await rejects(() => maintStart({ root, issue: 3 }), 'needs-builder');
});

await test('start refuses a dirty working tree', async () => {
  writeFileSync(path.join(root, 'stray.txt'), 'x');
  fake('issue', { number: 4, title: 'Tekst', state: 'OPEN', labels: [{ name: 'type:copy' }] });
  await rejects(() => maintStart({ root, issue: 4 }), 'uncommitted changes');
  rmSync(path.join(root, 'stray.txt'));
});

await test('start creates maint/<n>-<slug> from an up-to-date main', async () => {
  fake('issue', { number: 4, title: 'Nieuwe intro tekst', state: 'OPEN', labels: [{ name: 'type:copy' }] });
  await quiet(() => maintStart({ root, issue: 4 }));
  if (sh('git branch --show-current', root) !== 'maint/4-nieuwe-intro-tekst') throw new Error('wrong branch');
});

await test('finish refuses without a CHANGELOG entry', async () => {
  writeFileSync(path.join(root, 'src/content/i18n/nl.json'), '{"home":{"intro":"Nieuw"}}\n');
  await rejects(() => maintFinish({ root, check: async () => true }), 'CHANGELOG.md');
});

await test('finish refuses when the check fails, and passes the task type as scope', async () => {
  writeFileSync(path.join(root, 'CHANGELOG.md'), '# Site changelog\n\n## 2026-10-01: nieuwe intro\n');
  let seen;
  await rejects(() => maintFinish({ root, check: async (o) => ((seen = o), false) }), 'the check failed');
  if (seen?.scope !== 'copy' || seen?.base !== 'origin/main') throw new Error(`scope not passed: ${JSON.stringify(seen)}`);
});

await test('finish commits, pushes and opens a pull request that closes the issue', async () => {
  await quiet(() => maintFinish({ root, check: async () => true }));
  const pushed = sh('git ls-remote --heads origin maint/4-nieuwe-intro-tekst', root);
  if (!pushed) throw new Error('branch not pushed');
  const log = readFileSync(ghLog, 'utf8');
  if (!/pr create .*--body Closes #4/s.test(log)) throw new Error('no pull request with "Closes #4"');
  if (sh('git log -1 --format=%s', root) !== 'copy: Nieuwe intro tekst (#4)') throw new Error('commit message');
  if (existsSync(path.join(root, '.git/site-kit-maint.json'))) throw new Error('state file left behind');
});

// Simulate the merge on GitHub: fast-forward origin/main to the branch.
sh('git push -q origin maint/4-nieuwe-intro-tekst:main', root);
const merged = sh('git rev-parse maint/4-nieuwe-intro-tekst', root);

await test('deploy refuses while CI is running or failed', async () => {
  fake('runs', [{ status: 'in_progress', conclusion: '', workflowName: 'check', url: 'u' }]);
  let deployed = false;
  await rejects(() => maintDeploy({ root, site: { url: 'https://example.be' }, deploy: async () => (deployed = true) }), 'still running');
  fake('runs', [{ status: 'completed', conclusion: 'failure', workflowName: 'check', url: 'u' }]);
  await rejects(() => maintDeploy({ root, site: { url: 'https://example.be' }, deploy: async () => (deployed = true) }), 'did not pass');
  if (deployed) throw new Error('deployed anyway');
});

await test('deploy runs on green CI and comments on the merged pull request', async () => {
  fake('runs', [{ status: 'completed', conclusion: 'success', workflowName: 'check', url: 'u' }]);
  fake('merged', [{ number: 7, mergeCommit: { oid: merged } }]);
  let deployed = false;
  await quiet(() => maintDeploy({ root, site: { url: 'https://example.be' }, deploy: async () => (deployed = true) }));
  if (!deployed) throw new Error('did not deploy');
  if (sh('git branch --show-current', root) !== 'main') throw new Error('not on main');
  if (!/pr comment 7 --body Deployed to https:\/\/example\.be\//.test(readFileSync(ghLog, 'utf8'))) throw new Error('no comment on #7');
});

rmSync(work, { recursive: true, force: true });
process.exit(results.every(Boolean) ? 0 : 1);
