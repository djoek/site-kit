// Scope check for the maintainer: a task type may only change certain files.
import { spawnSync } from 'node:child_process';

const ALWAYS = ['CHANGELOG.md'];
export const SCOPES = {
  copy: [/^src\/content\//],
  image: [/^public\/images\//, /^src\/assets\//],
  page: [/^src\/pages\//, /^src\/content\//, /^public\/images\//, /^src\/assets\//],
  hours: [/^src\/data\/hours\.toml$/],
  facts: [/^site\.config\.ts$/],
  deps: [/^package\.json$/, /^bun\.lock$/],
};

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

/** Files changed on this branch compared with base, plus uncommitted and untracked files. */
export function changedFiles(root, base = 'origin/main') {
  const committed = git(root, ['diff', '--name-only', `${base}...HEAD`]);
  const working = git(root, ['status', '--porcelain', '--untracked-files=all']).map((line) => line.slice(3).replace(/^.* -> /, ''));
  return [...new Set([...committed, ...working])].sort();
}

export function scopeCheck({ root, type, base }) {
  const allowed = SCOPES[type];
  if (!allowed) return [`scope: unknown task type "${type}" (use ${Object.keys(SCOPES).join(', ')})`];
  return changedFiles(root, base)
    .filter((file) => !ALWAYS.includes(file) && !allowed.some((pattern) => pattern.test(file)))
    .map((file) => `scope: ${file} is outside what a "${type}" task may change; this needs the site-builder`);
}
