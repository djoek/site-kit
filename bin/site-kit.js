#!/usr/bin/env bun
// site-kit command line. Run from a site's root directory.
//   site-kit check [--no-browser] [--scope <type>] [--base <ref>]
//   site-kit deploy [--dry-run]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadSiteData } from '../src/integration.js';

const root = process.cwd();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'no-browser': { type: 'boolean', default: false },
    scope: { type: 'string' },
    base: { type: 'string', default: 'origin/main' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const [command] = positionals;

async function loadSite() {
  const file = path.join(root, 'site.config.ts');
  if (!existsSync(file)) throw new Error('site.config.ts not found; run site-kit from the site root');
  return (await import(file)).default;
}

function report(title, failures) {
  if (!failures.length) {
    console.log(`✓ ${title}`);
    return true;
  }
  console.error(`✗ ${title}: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  return false;
}

async function check() {
  const site = await loadSite();
  let ok = true;
  if (values.scope) {
    const { scopeCheck } = await import('../src/check/scope.js');
    ok = report(`scope (${values.scope})`, scopeCheck({ root, type: values.scope, base: values.base })) && ok;
  }
  const { sourceChecks, outputChecks } = await import('../src/check/static.js');
  let data;
  try {
    data = loadSiteData(root, site);
  } catch (error) {
    report('site data', [error.message]);
    process.exit(1);
  }
  const sourceOk = report('source checks', sourceChecks({ root, data }));
  ok = sourceOk && ok;
  const build = spawnSync(process.execPath, ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  if (build.status !== 0) {
    report('build', [sourceOk ? 'astro build failed (see output above)' : 'astro build failed; fix the source problems above first']);
    process.exit(1);
  }
  ok = report('output checks', await outputChecks({ root, site })) && ok;
  if (!values['no-browser']) {
    const { browserChecks } = await import('../src/check/browser.js');
    ok = report('browser checks', await browserChecks({ root })) && ok;
  }
  if (!ok) process.exit(1);
  console.log('All checks passed.');
}

switch (command) {
  case 'check':
    await check();
    break;
  case 'deploy':
    console.error('site-kit deploy is not implemented yet (Phase A3).');
    process.exit(1);
    break;
  default:
    console.error('usage: site-kit check [--no-browser] [--scope <type>] | site-kit deploy [--dry-run]');
    process.exit(2);
}
