// End-to-end deploy test against a local sshd (SFTP). Skips when sshd or lftp is missing.
// Covers: first deploy, marker, repeat deploy, dirty-tree refusal, wrong-marker refusal, live smoke test.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sshd = ['/usr/sbin/sshd', '/usr/bin/sshd'].find(existsSync);
if (!sshd || spawnSync('lftp', ['--version']).error) {
  console.log('- deploy test skipped (needs sshd and lftp)');
  process.exit(0);
}

const fixture = path.resolve(import.meta.dir, '../fixtures/basic');
const bin = path.resolve(import.meta.dir, '../bin/site-kit.js');
const work = mkdtempSync(path.join(tmpdir(), 'site-kit-deploy-'));
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

// SSH server on a spare port, key-only, for the current user.
const ssh = path.join(work, 'ssh');
mkdirSync(ssh, { mode: 0o700 });
run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(ssh, 'host_key')]);
run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path.join(ssh, 'client_key')]);
writeFileSync(path.join(ssh, 'authorized_keys'), readFileSync(path.join(ssh, 'client_key.pub')));
chmodSync(path.join(ssh, 'authorized_keys'), 0o600);
const port = 22000 + Math.floor(Math.random() * 1000);
writeFileSync(path.join(ssh, 'sshd_config'), [
  `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${path.join(ssh, 'host_key')}`, `AuthorizedKeysFile ${path.join(ssh, 'authorized_keys')}`,
  'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'PermitRootLogin prohibit-password', 'StrictModes no', 'Subsystem sftp internal-sftp', `PidFile ${path.join(ssh, 'sshd.pid')}`,
].join('\n'));
mkdirSync('/run/sshd', { recursive: true });
const server = spawn(sshd, ['-D', '-f', path.join(ssh, 'sshd_config')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const home = process.env.HOME;
mkdirSync(path.join(home, '.ssh'), { recursive: true, mode: 0o700 });
const scan = run('ssh-keyscan', ['-p', String(port), '127.0.0.1']);
writeFileSync(path.join(home, '.ssh/known_hosts'), scan.stdout, { flag: 'a' });

// The "remote" directory, and the site copy as a git repo with an origin.
const remote = '/srv/www/fixture.example.be';
rmSync(remote, { recursive: true, force: true });
mkdirSync(remote, { recursive: true });
writeFileSync(path.join(remote, 'old-page.html'), 'left over from the previous site');
const site = path.join(work, 'site');
cpSync(fixture, site, { recursive: true, filter: (src) => !path.relative(fixture, src).split(path.sep).some((p) => ['node_modules', 'dist', '.astro'].includes(p)) });
symlinkSync(path.join(fixture, 'node_modules'), path.join(site, 'node_modules'));
writeFileSync(path.join(site, '.gitignore'), 'node_modules\ndist\n.astro\n');
const origin = path.join(work, 'origin.git');
run('git', ['init', '-q', '--bare', '-b', 'main', origin]);
const git = (...args) => run('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: site });
git('init', '-q', '-b', 'main');
git('add', '.');
git('commit', '-q', '-m', 'fixture');
git('remote', 'add', 'origin', origin);
git('push', '-q', 'origin', 'main');

const envFile = path.join(work, 'deploy.env');
writeFileSync(envFile, `SFTP_HOST=127.0.0.1\nSFTP_PORT=${port}\nSFTP_USER=${run('id', ['-un']).stdout.trim()}\nSFTP_PATH=${remote}\nSFTP_KEYFILE=${path.join(ssh, 'client_key')}\n`);
chmodSync(envFile, 0o600);

// "Live" site = the remote directory served with the same .htaccess rules.
const { serve } = await import('../src/check/browser.js');
const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: '1', SITE_KIT_DEPLOY_ENV: envFile };

// Start the live server once; it reads files per request, so it always shows the current remote state.
const live = await serve(remote);
const livePort = live.address().port;
const cases = [];
const expect = (name, output, needles, exitZero) => {
  const exitOk = exitZero ? output.endsWith('[exit 0]') : !output.endsWith('[exit 0]');
  const missing = needles.filter((n) => !output.includes(n));
  const ok = exitOk && !missing.length;
  cases.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) console.error(output.split('\n').filter((l) => !/├─|^\d\d:\d\d/.test(l)).slice(-25).map((l) => `    | ${l}`).join('\n'));
};

// Async on purpose: the live server runs in this process and must keep answering during the deploy.
const reuse = async (...args) => {
  const child = Bun.spawn(['bun', bin, 'deploy', ...args], { cwd: site, env: { ...env, SITE_KIT_SMOKE_ORIGIN: `http://127.0.0.1:${livePort}` }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return `${stdout}\n${stderr}`.trim() + `\n[exit ${status}]`;
};

expect('no marker and no --first-deploy: refused', await reuse(), ['has no .site-kit-target marker'], false);
expect('first deploy: mirrors, deletes the old file, smoke test passes', await reuse('--first-deploy'), ['Deployed and verified'], true);
expect('  old file removed, marker present', `${existsSync(path.join(remote, 'old-page.html'))} ${readFileSync(path.join(remote, '.site-kit-target'), 'utf8').trim()}\n[exit 0]`, ['false fixture.example.be'], true);
expect('second deploy without flags: allowed by the marker', await reuse(), ['Deployed and verified'], true);
writeFileSync(path.join(site, 'CHANGELOG.md'), '# Site changelog\n\nuncommitted\n');
expect('dirty working tree: refused', await reuse(), ['working tree has uncommitted changes'], false);
git('checkout', '-q', '--', 'CHANGELOG.md');
writeFileSync(path.join(remote, '.site-kit-target'), 'other-site.be\n');
expect('marker of another site: refused before mirroring', await reuse(), ['belongs to "other-site.be"'], false);

live.close();
server.kill();
rmSync(work, { recursive: true, force: true });
rmSync(remote, { recursive: true, force: true });
process.exit(cases.every(Boolean) ? 0 : 1);
