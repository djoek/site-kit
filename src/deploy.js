// site-kit deploy: check-gated, git-gated lftp mirror of dist/ to the reviewed remote path,
// then IndexNow and a live smoke test.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const SAFE = /^[A-Za-z0-9._@-]+$/;
const SAFE_PATH = /^[A-Za-z0-9._/~-]+$/;

/** Parse KEY=value lines; ignores comments and blank lines; strips optional quotes. */
function parseEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

export function envFileFor(site) {
  return process.env.SITE_KIT_DEPLOY_ENV ?? path.join(homedir(), '.config/site-ops/deploy', `${new URL(site.url).host}.env`);
}

/** Load and validate the connection settings. Throws with a readable message. */
export function loadTarget(site) {
  if (!site.deploy) throw new Error('site.config has no deploy.remotePath');
  const file = envFileFor(site);
  if (!existsSync(file)) throw new Error(`deploy settings not found: ${file}\n  create it with SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PATH, SFTP_KEYFILE (chmod 600)`);
  if (statSync(file).mode & 0o077) throw new Error(`${file} is readable by other users; run: chmod 600 "${file}"`);
  const env = parseEnv(readFileSync(file, 'utf8'));
  for (const name of ['SFTP_HOST', 'SFTP_PORT', 'SFTP_USER', 'SFTP_PATH', 'SFTP_KEYFILE']) {
    if (!env[name]) throw new Error(`${file}: ${name} is not set`);
  }
  const keyfile = env.SFTP_KEYFILE.replace(/^~(?=\/)/, homedir());
  if (!SAFE.test(env.SFTP_HOST) || !SAFE.test(env.SFTP_USER)) throw new Error(`${file}: unsafe characters in SFTP_HOST or SFTP_USER`);
  if (!/^\d+$/.test(env.SFTP_PORT)) throw new Error(`${file}: SFTP_PORT must be a number`);
  if (!SAFE_PATH.test(keyfile) || !existsSync(keyfile)) throw new Error(`${file}: SFTP_KEYFILE is not a readable file with a safe path: ${keyfile}`);
  if (env.SFTP_PATH !== site.deploy.remotePath) {
    throw new Error(`${file}: SFTP_PATH (${env.SFTP_PATH}) differs from the reviewed deploy.remotePath in site.config (${site.deploy.remotePath})`);
  }
  return { host: env.SFTP_HOST, port: env.SFTP_PORT, user: env.SFTP_USER, path: env.SFTP_PATH, keyfile, file };
}

// One lftp command per call: its exit code is that command's result. Do not use "cmd:fail-exit":
// with it, lftp hangs after a failing command instead of exiting (seen with lftp 4.9).
// The timeout makes sure an unattended deploy can never wait forever.
function lftp(target, commands, timeoutSeconds = 60) {
  const ssh = `ssh -a -x -i ${target.keyfile} -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o BatchMode=yes`;
  const script = [
    'set net:max-retries 2',
    'set net:timeout 20',
    `set sftp:connect-program "${ssh}"`,
    `open -u "${target.user}","" -p ${target.port} "sftp://${target.host}"`,
    ...commands,
    'bye',
  ].join('\n');
  const result = spawnSync('lftp', [], { input: script, encoding: 'utf8', timeout: timeoutSeconds * 1000, killSignal: 'SIGKILL' });
  if (result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL') {
    throw new Error(`lftp did not finish within ${timeoutSeconds}s (${commands[0].split(' ')[0]}); check host, port and key`);
  }
  return result;
}

/** Refuse unless the working tree is clean and HEAD is exactly origin/main. */
export function gitGate(root) {
  const run = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (run('rev-parse', '--git-dir').status !== 0) return ['not a git repository'];
  const problems = [];
  if (run('status', '--porcelain').stdout.trim()) problems.push('working tree has uncommitted changes');
  const branch = run('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  if (branch !== 'main') problems.push(`on branch "${branch}", deploys happen from main`);
  const fetch = run('fetch', '--quiet', 'origin', 'main');
  if (fetch.status !== 0) problems.push(`git fetch origin main failed: ${fetch.stderr.trim()}`);
  else if (run('rev-parse', 'HEAD').stdout.trim() !== run('rev-parse', 'origin/main').stdout.trim()) problems.push('HEAD is not identical to origin/main (merge and pull first)');
  return problems;
}

async function indexNow(site, dist) {
  if (!site.indexNowKey) return 'IndexNow: no key configured, skipped';
  const sitemap = readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  try {
    const response = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(site.url).host, key: site.indexNowKey, keyLocation: `${site.url}/${site.indexNowKey}.txt`, urlList }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok || response.status === 202 ? `IndexNow: accepted ${urlList.length} URL(s)` : `IndexNow: HTTP ${response.status} (not fatal)`;
  } catch (error) {
    return `IndexNow: ${error.message} (not fatal)`;
  }
}

/** Fetch the live site and verify the essentials. Returns a list of failures. */
export async function smoke(site, origin = site.url) {
  const failures = [];
  const get = (pathname, redirect = 'follow') =>
    fetch(new URL(pathname, origin), { redirect, headers: { 'user-agent': 'site-kit smoke check' }, signal: AbortSignal.timeout(15_000) });
  for (const pathname of ['/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/privacy/']) {
    try {
      const response = await get(pathname);
      if (response.status !== 200) failures.push(`${pathname}: HTTP ${response.status}`);
      if (pathname === '/') {
        const html = await response.text();
        if (!html.includes(`<link rel="canonical" href="${site.url}/">`)) failures.push('/: canonical link missing or different');
      }
    } catch (error) {
      failures.push(`${pathname}: ${error.message}`);
    }
  }
  try {
    const missing = await get('/site-kit-smoke-missing/');
    if (missing.status !== 404) failures.push(`unknown URL returned HTTP ${missing.status}, expected 404`);
  } catch (error) {
    failures.push(`404 test: ${error.message}`);
  }
  for (const [from, to] of Object.entries(site.redirects)) {
    try {
      const response = await get(from, 'manual');
      const location = response.headers.get('location') ?? '';
      if (response.status !== 301 || !location.endsWith(to)) failures.push(`redirect ${from}: HTTP ${response.status} to "${location}", expected 301 to ${to}`);
    } catch (error) {
      failures.push(`redirect ${from}: ${error.message}`);
    }
  }
  return failures;
}

/**
 * Deploy. Options: dryRun (show what would change, no git gate), firstDeploy (allow a target without marker).
 * The caller has already run the full check.
 */
export async function deploy({ root, site, dryRun = false, firstDeploy = false, log = console.log }) {
  const dist = path.join(root, 'dist');
  if (spawnSync('lftp', ['--version']).error) throw new Error('lftp is not installed');
  const target = loadTarget(site);
  if (!dryRun) {
    const problems = gitGate(root);
    if (problems.length) throw new Error(`refusing to deploy:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }

  // Marker check: the remote directory must belong to this site.
  const domain = new URL(site.url).host;
  const marker = lftp(target, [`cat "${target.path}/.site-kit-target"`]);
  const remoteDomain = marker.status === 0 ? marker.stdout.trim() : null;
  if (remoteDomain !== null && remoteDomain !== domain) {
    throw new Error(`refusing to deploy: ${target.path} on ${target.host} belongs to "${remoteDomain}", not "${domain}"`);
  }
  if (remoteDomain === null && !firstDeploy) {
    throw new Error(`refusing to deploy: ${target.path} on ${target.host} has no .site-kit-target marker.\n  If this really is the directory for ${domain}, run once with --first-deploy (after --dry-run).`);
  }

  log(`${dryRun ? 'Preview of' : 'Deploying'} dist/ → sftp://${target.host}:${target.port}${target.path}`);
  log('Files on the server that are not in dist/ will be deleted.');
  const mirror = lftp(target, [
    `mirror --reverse --delete --delete-first --exclude-glob .DS_Store --exclude-glob "*/.DS_Store" --verbose ${dryRun ? '--dry-run' : ''} "${dist}/" "${target.path}"`,
  ], 900);
  log(mirror.stdout.trim());
  if (mirror.status !== 0) throw new Error(`lftp mirror failed:\n${mirror.stderr.trim()}`);
  if (dryRun) {
    log('Preview complete. Nothing was changed on the server.');
    return;
  }
  log(await indexNow(site, dist));
  const failures = await smoke(site, process.env.SITE_KIT_SMOKE_ORIGIN ?? site.url);
  if (failures.length) throw new Error(`deployed, but the live smoke test failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  log(`Deployed and verified: ${site.url}`);
}
