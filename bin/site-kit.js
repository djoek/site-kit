#!/usr/bin/env bun
// site-kit command line. Run from a site's root directory.
//   site-kit check [--no-browser] [--scope <type>] [--base <ref>]
//   site-kit deploy [--dry-run] [--first-deploy]
//   site-kit favicon [--source <svg or png>]
//   site-kit maint start <issue> | maint finish | maint deploy
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
    'first-deploy': { type: 'boolean', default: false },
    source: { type: 'string' },
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

/** Run the checks; returns true when everything passed. */
async function runChecks({ scope = values.scope, base = values.base, browser = !values['no-browser'] } = {}) {
  const site = await loadSite();
  let ok = true;
  if (scope) {
    const { scopeCheck } = await import('../src/check/scope.js');
    ok = report(`scope (${scope})`, scopeCheck({ root, type: scope, base })) && ok;
  }
  const { sourceChecks, outputChecks } = await import('../src/check/static.js');
  let data;
  try {
    data = loadSiteData(root, site);
  } catch (error) {
    report('site data', [error.message]);
    return false;
  }
  const sourceOk = report('source checks', sourceChecks({ root, data }));
  ok = sourceOk && ok;
  const build = spawnSync(process.execPath, ['run', 'build'], { cwd: root, stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } });
  if (build.status !== 0) {
    report('build', [sourceOk ? 'astro build failed (see output above)' : 'astro build failed; fix the source problems above first']);
    return false;
  }
  ok = report('output checks', await outputChecks({ root, site })) && ok;
  if (browser) {
    const { browserChecks } = await import('../src/check/browser.js');
    ok = report('browser checks', await browserChecks({ root, site })) && ok;
  }
  if (ok) console.log('All checks passed.');
  return ok;
}

async function check(options) {
  if (!(await runChecks(options))) process.exit(1);
}

async function deployCommand() {
  await check({ browser: true }); // a deploy always runs the full check; exits on failure
  const { deploy } = await import('../src/deploy.js');
  try {
    await deploy({ root, site: await loadSite(), dryRun: values['dry-run'], firstDeploy: values['first-deploy'] });
  } catch (error) {
    console.error(`✗ deploy: ${error.message}`);
    process.exit(1);
  }
}

switch (command) {
  case 'check':
    await check();
    break;
  case 'deploy':
    await deployCommand();
    break;
  case 'maint': {
    const maint = await import('../src/maint.js');
    const [, sub, issue] = positionals;
    try {
      if (sub === 'start') await maint.maintStart({ root, issue });
      else if (sub === 'finish') await maint.maintFinish({ root, check: (options) => runChecks({ ...options, browser: true }) });
      else if (sub === 'deploy') {
        values['dry-run'] = false;
        values['first-deploy'] = false; // a first deploy is always done by a person
        await maint.maintDeploy({ root, site: await loadSite(), deploy: deployCommand });
      } else throw new Error('usage: site-kit maint start <issue> | maint finish | maint deploy');
    } catch (error) {
      console.error(`✗ maint ${sub ?? ''}: ${error.message}`);
      process.exit(1);
    }
    break;
  }
  case 'favicon': {
    const { favicon } = await import('../src/favicon.js');
    try {
      await favicon({ root, site: await loadSite(), source: values.source });
    } catch (error) {
      console.error(`✗ favicon: ${error.message}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.error('usage: site-kit check [--no-browser] [--scope <type>] [--base <ref>] | site-kit deploy [--dry-run] [--first-deploy] | site-kit favicon [--source <file>] | site-kit maint start <issue>|finish|deploy');
    process.exit(2);
}
