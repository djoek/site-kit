// site-kit maint: the maintainer's fixed path from GitHub issue to deploy.
//   maint start <issue>   clean tree, up-to-date main, branch maint/<n>-<slug>, task type from the issue label
//   maint finish          scope check + full check, CHANGELOG changed, commit, push, pull request "Closes #n"
//   maint deploy          only on main == origin/main with a green CI run for that commit; deploy; comment on the PR
// Uses git and the GitHub CLI (gh). Every step refuses instead of guessing.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { SCOPES } from './check/scope.js';

const TYPES = Object.keys(SCOPES);

function run(cmd, args, root, { allowFail = false, input } = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', input, env: process.env });
  if (result.error) throw new Error(`${cmd} is not available: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed:\n${(result.stderr || result.stdout).trim()}`);
  return { ok: result.status === 0, out: result.stdout.trimEnd(), err: result.stderr.trim() };
}
const git = (root, ...args) => run('git', args, root).out;
const gh = (root, ...args) => run('gh', args, root).out;
const ghJson = (root, ...args) => JSON.parse(gh(root, ...args) || 'null');

const stateFile = (root) => path.join(root, '.git', 'site-kit-maint.json');

function readState(root) {
  const file = stateFile(root);
  if (!existsSync(file)) throw new Error('no maintenance task in progress; start one with: bun run maint:start <issue number>');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function requireClean(root) {
  const dirty = git(root, 'status', '--porcelain');
  if (dirty) throw new Error(`the working tree has uncommitted changes; commit or discard them first:\n${dirty}`);
}

/** "Nieuwe openingsuren vanaf 1 november!" -> "nieuwe-openingsuren-vanaf-1-november" (max 40 characters). */
export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'task';
}

/** The one type:* label on an issue, or an error that says what to do. */
export function taskType(labels) {
  const names = labels.map((label) => (typeof label === 'string' ? label : label.name));
  if (names.includes('needs-builder')) throw new Error('this issue is labelled needs-builder; it is not a maintenance task');
  const types = names.filter((name) => name.startsWith('type:')).map((name) => name.slice(5));
  if (types.length !== 1) throw new Error(`the issue needs exactly one label type:<${TYPES.join('|')}>, found ${types.length ? types.join(', ') : 'none'}`);
  if (!TYPES.includes(types[0])) throw new Error(`unknown task type "${types[0]}" (use ${TYPES.join(', ')})`);
  return types[0];
}

export async function maintStart({ root, issue }) {
  if (!/^\d+$/.test(String(issue ?? ''))) throw new Error('usage: maint start <issue number>');
  requireClean(root);
  const info = ghJson(root, 'issue', 'view', String(issue), '--json', 'number,title,state,labels');
  if (info.state !== 'OPEN') throw new Error(`issue #${issue} is ${info.state.toLowerCase()}, not open`);
  const type = taskType(info.labels);
  git(root, 'fetch', '--quiet', 'origin');
  git(root, 'switch', '--quiet', 'main');
  git(root, 'merge', '--quiet', '--ff-only', 'origin/main');
  const branch = `maint/${issue}-${slugify(info.title)}`;
  const exists = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root, { allowFail: true }).ok;
  git(root, 'switch', '--quiet', ...(exists ? [branch] : ['-c', branch]));
  writeFileSync(stateFile(root), `${JSON.stringify({ issue: Number(issue), title: info.title, type, branch }, null, 2)}\n`);
  console.log(`Issue #${issue}: ${info.title}
Task type: ${type}
Branch:    ${branch}${exists ? ' (existing branch, continuing)' : ''}

Read the issue:   gh issue view ${issue}
Then make the change, add a CHANGELOG.md entry, and run: bun run maint:finish`);
}

export async function maintFinish({ root, check }) {
  const state = readState(root);
  const current = git(root, 'branch', '--show-current');
  if (current !== state.branch) throw new Error(`you are on ${current}, but the task in progress is on ${state.branch}`);
  const changed = new Set([
    ...git(root, 'diff', '--name-only', 'origin/main...HEAD').split('\n'),
    ...git(root, 'status', '--porcelain', '--untracked-files=all').split('\n').map((line) => line.slice(3)),
  ].filter(Boolean));
  if (changed.size === 0) throw new Error('nothing changed on this branch');
  if (!changed.has('CHANGELOG.md')) throw new Error('add a CHANGELOG.md entry for this change (newest first, same format as the entries below it)');

  // Scope first, then the full check (both in one run of site-kit check).
  const ok = await check({ scope: state.type, base: 'origin/main' });
  if (!ok) throw new Error('the check failed; fix every problem above and run maint:finish again');

  git(root, 'add', '--all');
  const staged = git(root, 'diff', '--cached', '--name-only');
  if (staged) git(root, 'commit', '--quiet', '-m', `${state.type}: ${state.title} (#${state.issue})`);
  git(root, 'push', '--quiet', '--set-upstream', 'origin', state.branch);

  const existing = ghJson(root, 'pr', 'list', '--head', state.branch, '--state', 'open', '--json', 'number,url');
  let url;
  if (existing?.length) {
    url = existing[0].url;
    console.log(`Pushed to the existing pull request: ${url}`);
  } else {
    const files = [...changed].sort().map((file) => `- \`${file}\``).join('\n');
    const body = `Closes #${state.issue}\n\nTask type: \`${state.type}\`. \`site-kit check --scope ${state.type}\` and the full check passed.\n\nChanged files:\n${files}\n`;
    url = gh(root, 'pr', 'create', '--base', 'main', '--head', state.branch, '--title', `${state.type}: ${state.title}`, '--body', body);
    console.log(`Pull request: ${url}`);
  }
  rmSync(stateFile(root), { force: true });
  console.log('Done. Kris reviews and merges; after the merge, run: bun run maint:deploy');
}

export async function maintDeploy({ root, site, deploy }) {
  requireClean(root);
  git(root, 'fetch', '--quiet', 'origin');
  git(root, 'switch', '--quiet', 'main');
  git(root, 'merge', '--quiet', '--ff-only', 'origin/main');
  const head = git(root, 'rev-parse', 'HEAD');
  if (head !== git(root, 'rev-parse', 'origin/main')) throw new Error('main differs from origin/main');

  // CI must have passed for exactly this commit.
  const runs = ghJson(root, 'run', 'list', '--branch', 'main', '--commit', head, '--json', 'status,conclusion,workflowName,url') ?? [];
  if (!runs.length) throw new Error(`no CI run found for ${head.slice(0, 7)} on main; wait for GitHub Actions and try again`);
  const unfinished = runs.filter((r) => r.status !== 'completed');
  if (unfinished.length) throw new Error(`CI is still running for ${head.slice(0, 7)} (${unfinished[0].url}); try again when it has finished`);
  const failed = runs.filter((r) => r.conclusion !== 'success');
  if (failed.length) throw new Error(`CI did not pass for ${head.slice(0, 7)}: ${failed.map((r) => `${r.workflowName} ${r.conclusion} ${r.url}`).join(', ')}`);

  await deploy(); // runs the full check and the deploy's own git gate; exits on failure

  // Tell the pull request (and so the issue it closed) that the change is live.
  const merged = ghJson(root, 'pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '20', '--json', 'number,mergeCommit') ?? [];
  const pr = merged.find((p) => p.mergeCommit?.oid === head);
  const url = `${site.url}/`;
  if (pr) {
    gh(root, 'pr', 'comment', String(pr.number), '--body', `Deployed to ${url} (commit ${head.slice(0, 7)}).`);
    console.log(`Commented on pull request #${pr.number}.`);
  } else {
    console.log(`Deployed ${head.slice(0, 7)}; no merged pull request found for this commit, so no comment was added.`);
  }
}
