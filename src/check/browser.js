// Browser checks with Playwright + axe: every page, both themes, mobile and desktop.
// The local server sends the same headers as the generated .htaccess (including the CSP),
// so anything the CSP would block in production also fails here.
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { htmlFiles, parseHtaccessHeaders, parseHtaccessRedirects, urlPath } from '../outputs.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
};
const VIEWPORTS = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export function serve(dist) {
  const htaccess = path.join(dist, '.htaccess');
  // Read per request, like Apache: the served directory can change while the server runs.
  const rules = () => {
    const text = existsSync(htaccess) ? readFileSync(htaccess, 'utf8') : '';
    return { headers: parseHtaccessHeaders(text), redirects: parseHtaccessRedirects(text) };
  };
  const server = createServer(async (request, response) => {
    const { headers, redirects } = rules();
    let pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (redirects[pathname]) {
      response.writeHead(301, { ...headers, Location: redirects[pathname] });
      response.end();
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(dist, path.normalize(pathname));
    let status = 200;
    let target = file;
    if (!file.startsWith(dist) || !(await stat(file).catch(() => null))?.isFile()) {
      status = 404;
      target = path.join(dist, '404.html');
    }
    response.writeHead(status, { ...headers, 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
    response.end(await readFile(target));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

export async function browserChecks({ root, site }) {
  const failures = [];
  const fail = (scope, message) => failures.push(`${scope}: ${message}`);
  const dist = path.join(root, 'dist');
  const server = await serve(dist);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.SITE_KIT_CHROMIUM ? { executablePath: process.env.SITE_KIT_CHROMIUM } : {});

  try {
    const paths = (await htmlFiles(dist)).map(urlPath);

    // Every page × theme × viewport: overflow, theme applied, images, console/CSP errors, axe.
    for (const pagePath of paths) {
      for (const theme of ['light', 'dark']) {
        for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
          const scope = `${pagePath} [${theme}, ${viewportName}]`;
          const context = await browser.newContext({ viewport, reducedMotion: 'reduce', colorScheme: theme });
          await context.addInitScript((value) => {
            try {
              localStorage.setItem('theme', value);
            } catch {}
          }, theme);
          const page = await context.newPage();
          const errors = [];
          page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
          page.on('pageerror', (error) => errors.push(error.message));
          const response = await page.goto(base + pagePath, { waitUntil: 'load' });
          if (response?.status() !== 200) fail(scope, `HTTP ${response?.status()}`);
          const state = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            theme: document.documentElement.dataset.theme,
            scheme: getComputedStyle(document.documentElement).colorScheme,
            broken: [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.currentSrc || img.src),
          }));
          if (state.overflow > 1) fail(scope, `page is ${state.overflow}px wider than the screen`);
          if (state.theme !== theme || !state.scheme.includes(theme)) fail(scope, `${theme} theme was not applied`);
          for (const src of state.broken) fail(scope, `broken image ${src}`);
          for (const error of errors) fail(scope, `console: ${error}`);
          const axe = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
          for (const violation of axe.violations) {
            const target = violation.nodes[0]?.target?.join(' ') ?? '';
            fail(scope, `axe ${violation.id}: ${violation.help} (${violation.nodes.length}×, first: ${target})`);
          }
          await context.close();
        }
      }
    }

    // Redirects from old URLs land on a working page.
    for (const [from, to] of Object.entries(site?.redirects ?? {})) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const response = await page.goto(base + from);
      const landed = new URL(page.url()).pathname;
      if (landed !== to || response?.status() !== 200) fail(`redirect ${from}`, `expected to land on ${to} with HTTP 200, got ${landed} (HTTP ${response?.status()})`);
      await context.close();
    }

    // Behaviour, tested once on the home page.
    const home = '/';
    {
      const context = await browser.newContext({ viewport: VIEWPORTS.mobile, colorScheme: 'light' });
      const page = await context.newPage();
      const missing = await page.goto(`${base}/site-kit-missing-page/`);
      if (missing?.status() !== 404) fail('/404.html', 'unknown URLs do not get the 404 page');
      await page.goto(base + home);
      // Skip link is the first keyboard stop.
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('href'));
      if (focused !== '#main') fail(`${home} [keyboard]`, `first Tab stop is ${focused ?? 'nothing'}, expected the skip link`);
      // Theme: system theme first, nothing stored; toggle stores the choice and updates aria-pressed.
      const initial = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, stored: localStorage.getItem('theme') }));
      if (initial.theme !== 'light' || initial.stored !== null) fail(`${home} [theme]`, 'system theme not applied, or stored before any choice');
      const toggle = page.locator('[data-theme-toggle]').first();
      if (await toggle.count()) {
        await toggle.click();
        const after = await page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          stored: localStorage.getItem('theme'),
          pressed: document.querySelector('[data-theme-toggle]')?.getAttribute('aria-pressed'),
        }));
        if (after.theme !== 'dark' || after.stored !== 'dark' || after.pressed !== 'true') fail(`${home} [theme]`, 'toggle did not switch to dark, store it, and set aria-pressed="true"');
      }
      // Desktop navigation: visible without opening anything.
      {
        const desktop = await browser.newContext({ viewport: VIEWPORTS.desktop });
        const wide = await desktop.newPage();
        await wide.goto(base + home);
        const menu = wide.locator('nav[popover]').first();
        if ((await menu.count()) && !(await menu.isVisible())) fail(`${home} [desktop nav]`, 'main navigation is not visible at desktop width');
        await desktop.close();
      }
      // Mobile navigation: closed, opens with the button, closes with Escape.
      const opener = page.locator('button[popovertarget]').first();
      if (await opener.count()) {
        const nav = page.locator(`#${await opener.getAttribute('popovertarget')}`);
        if (await nav.isVisible()) fail(`${home} [mobile nav]`, 'navigation is visible before opening');
        await opener.click();
        if (!(await nav.isVisible())) fail(`${home} [mobile nav]`, 'navigation did not open');
        await page.keyboard.press('Escape');
        if (await nav.isVisible()) fail(`${home} [mobile nav]`, 'navigation did not close with Escape');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  return failures;
}
