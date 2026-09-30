// Static checks: source files and built HTML. Each failure is "scope: message".
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPages } from '../outputs.js';

const SOURCE_SKIP = new Set(['node_modules', 'dist', '.astro', '.git']);

function walk(dir, filter) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SOURCE_SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, filter) : filter(full) ? [full] : [];
  });
}

const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child) ? flatten(child, `${prefix}${key}.`) : [[`${prefix}${key}`, child]],
  );

const NAMED_COLOURS = 'white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|silver|navy|teal|maroon|olive|lime|aqua|fuchsia';
const COLOUR_PROPERTY = '(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow|caret-color|accent-color|text-decoration-color|column-rule-color)';
const NON_OKLCH = [
  [/#[0-9a-fA-F]{3,8}\b(?=[^{]*;)/, 'hex colour'],
  [/\b(?:rgba?|hsla?|hwb|lab|lch|color)\(/, 'non-OKLCH colour function'],
  [new RegExp(`${COLOUR_PROPERTY}\\s*:[^;{]*\\b(?:${NAMED_COLOURS})\\b`, 'i'), 'named colour'],
];
const SVG_NON_OKLCH = /(?:fill|stroke|stop-color|color)=["'](?:#|rgb|hsl|(?:white|black|red|green|blue|gray|grey)\b)/i;

/** Rough accessible name: text, aria-label, aria-labelledby, title or alt of a child image. */
function accessibleName(element, document) {
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) return labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  return (
    element.getAttribute('aria-label')?.trim() ||
    element.textContent?.trim() ||
    element.getAttribute('title')?.trim() ||
    element.querySelector('img[alt]')?.getAttribute('alt')?.trim() ||
    ''
  );
}

/** Checks on authored files. Run before the build so problems are reported by name, not as a crash. */
export function sourceChecks({ root, data }) {
  const failures = [];
  const fail = (scope, message) => failures.push(`${scope}: ${message}`);
  const rel = (file) => path.relative(root, file);

  // ---- Source -------------------------------------------------------------------------------

  // Copy files: same keys in every language, no empty strings.
  const copies = Object.entries(data.copy).map(([lang, copy]) => {
    const { kit, ...own } = copy;
    return [lang, flatten(own)];
  });
  if (copies.length > 1) {
    const [baseLang, baseEntries] = copies[0];
    const baseKeys = baseEntries.map(([key]) => key).sort().join('\n');
    for (const [lang, entries] of copies.slice(1)) {
      if (entries.map(([key]) => key).sort().join('\n') !== baseKeys) {
        const a = new Set(baseEntries.map(([k]) => k));
        const b = new Set(entries.map(([k]) => k));
        const missing = [...a].filter((k) => !b.has(k));
        const extra = [...b].filter((k) => !a.has(k));
        fail(`i18n/${lang}.json`, `keys differ from ${baseLang}.json (missing: ${missing.join(', ') || '-'}; extra: ${extra.join(', ') || '-'})`);
      }
    }
  }
  for (const [lang, entries] of copies) {
    for (const [key, value] of entries) if (typeof value === 'string' && !value.trim()) fail(`i18n/${lang}.json`, `${key} is empty`);
    if (!entries.some(([key]) => key === 'site.description')) fail(`i18n/${lang}.json`, 'missing site.description');
  }

  // Templates: no literal visitor-facing text; copy belongs in src/content/i18n.
  for (const file of walk(path.join(root, 'src'), (f) => f.endsWith('.astro'))) {
    const markup = readFileSync(file, 'utf8')
      .replace(/^---[\s\S]*?^---/m, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
    const text = markup.match(/>\s*([A-Za-zÀ-ÿ][^<{]*)</);
    if (text) fail(rel(file), `literal text "${text[1].trim().slice(0, 40)}" belongs in src/content/i18n`);
    const attribute = markup.match(/\b(?:alt|title|aria-label|placeholder)\s*=\s*["']([^"'{][^"']*)["']/i);
    if (attribute) fail(rel(file), `literal attribute text "${attribute[1].slice(0, 40)}" belongs in src/content/i18n`);
    if (/\sstyle\s*=/.test(markup)) fail(rel(file), 'inline style attribute (blocked by the CSP; use the stylesheet)');
  }

  // Colours: OKLCH only.
  for (const file of walk(path.join(root, 'src'), (f) => /\.(s?css|astro)$/.test(f))) {
    let css = readFileSync(file, 'utf8');
    if (file.endsWith('.astro')) css = (css.match(/<style\b[\s\S]*?<\/style>/gi) ?? []).join('\n');
    css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [pattern, label] of NON_OKLCH) if (pattern.test(css)) fail(rel(file), `${label}; use oklch() seeds and color-mix(in oklch, ...)`);
  }
  for (const file of [...walk(path.join(root, 'src'), (f) => f.endsWith('.svg')), ...walk(path.join(root, 'public'), (f) => f.endsWith('.svg'))]) {
    if (SVG_NON_OKLCH.test(readFileSync(file, 'utf8'))) fail(rel(file), 'SVG colour is not OKLCH');
  }
  const styles = walk(path.join(root, 'src'), (f) => /\.s?css$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  if (!/\bthemes\(/.test(styles)) fail('styles', 'call kit.themes($light, $dark) so both colour schemes are designed');

  // Placeholders anywhere in authored files.
  for (const file of [path.join(root, 'site.config.ts'), ...walk(path.join(root, 'src'), (f) => /\.(astro|json|toml|md|mdx|ts|js|scss)$/.test(f))]) {
    if (existsSync(file) && /REPLACE_ME|lorem ipsum|\bTODO\b/i.test(readFileSync(file, 'utf8'))) fail(rel(file), 'contains a placeholder (REPLACE_ME, TODO or lorem ipsum)');
  }

  // Repository hygiene.
  const changelog = path.join(root, 'CHANGELOG.md');
  if (!existsSync(changelog)) fail('CHANGELOG.md', 'missing');
  else if (!readFileSync(changelog, 'utf8').startsWith('# Site changelog')) fail('CHANGELOG.md', 'must start with "# Site changelog"');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.scripts?.build !== 'astro build') fail('package.json', 'scripts.build must be "astro build"');
  if (pkg.scripts?.check !== 'site-kit check') fail('package.json', 'scripts.check must be "site-kit check"');
  if (pkg.scripts?.deploy !== 'site-kit deploy') fail('package.json', 'scripts.deploy must be "site-kit deploy"');
  const git = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  if (git.status === 0) {
    for (const file of git.stdout.split('\n').filter(Boolean)) {
      if (/(^|\/)(\.env|\.deploy\.env)$/.test(file)) fail('git', `secret file is tracked: ${file}`);
      if (/^(dist|node_modules|\.astro)\//.test(file)) fail('git', `generated file is tracked: ${file}`);
    }
  }

  return failures;
}

/** Checks on the built site in dist/. */
export async function outputChecks({ root, site }) {
  const failures = [];
  const fail = (scope, message) => failures.push(`${scope}: ${message}`);
  const rel = (file) => path.relative(root, file);
  const dist = path.join(root, 'dist');

  if (!existsSync(dist)) {
    fail('dist', 'no build output');
    return failures;
  }
  const pages = await readPages(dist);
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const indexable = pages.filter((page) => !page.noindex);
  if (!byPath.has('/404.html')) fail('dist', '404.html is missing');
  for (const lang of site.languages) {
    const prefix = lang === site.defaultLanguage ? '/' : `/${lang}/`;
    if (!byPath.has(`${prefix}privacy/`)) fail('dist', `privacy page ${prefix}privacy/ is missing`);
    if (!pages.some((page) => page.lang === lang)) fail('dist', `no page in configured language ${lang}`);
  }

  const titles = new Map();
  const descriptions = new Map();
  for (const page of pages) {
    const { document, relative: scope } = page;
    const body = document.body;
    if (!/^<!doctype html>/i.test(page.html)) fail(scope, 'missing <!doctype html>');
    if (!site.languages.includes(page.lang)) fail(scope, `html lang "${page.lang}" is not a configured language`);

    // Structure and semantics.
    if (document.querySelectorAll('main').length !== 1 || !document.querySelector('main#main')) fail(scope, 'needs exactly one <main id="main">');
    if (!document.querySelector('body > header')) fail(scope, 'missing <header> landmark');
    if (!document.querySelector('body > footer')) fail(scope, 'missing <footer> landmark');
    const first = body.firstElementChild;
    if (!(first?.localName === 'a' && first.getAttribute('href') === '#main')) fail(scope, 'skip link to #main must be the first element in <body>');
    const h1s = document.querySelectorAll('h1');
    if (h1s.length !== 1) fail(scope, `expected one <h1>, found ${h1s.length}`);
    let previous = 0;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      const level = Number(heading.localName[1]);
      if (previous && level > previous + 1) fail(scope, `heading level skips from h${previous} to h${level}`);
      previous = level;
    }
    for (const section of document.querySelectorAll('section')) {
      if (!section.hasAttribute('aria-label') && !section.hasAttribute('aria-labelledby') && !section.querySelector('h1, h2, h3, h4, h5, h6')) {
        fail(scope, '<section> without a heading or label; use a heading, or a <div> if it is only layout');
      }
    }
    for (const element of document.querySelectorAll('div, span')) {
      if (/^(button|link)$/.test(element.getAttribute('role') ?? '') || element.hasAttribute('onclick')) fail(scope, `<${element.localName}> acting as a control; use <button> or <a>`);
    }
    let depth = 0;
    let deepest = 0;
    for (const token of page.html.match(/<\/?div\b[^>]*>/gi) ?? []) {
      depth += token.startsWith('</') ? -1 : 1;
      deepest = Math.max(deepest, depth);
    }
    if (deepest > 2) fail(scope, `<div> nested ${deepest} deep (maximum 2); use semantic elements`);
    if (document.querySelector('[style]')) fail(scope, 'inline style attribute (blocked by the CSP)');

    const ids = new Set();
    for (const element of document.querySelectorAll('[id]')) {
      if (ids.has(element.id)) fail(scope, `duplicate id #${element.id}`);
      ids.add(element.id);
    }
    for (const label of document.querySelectorAll('label[for]')) {
      if (!ids.has(label.getAttribute('for'))) fail(scope, `label points to missing #${label.getAttribute('for')}`);
    }
    for (const field of document.querySelectorAll('input:not([type=hidden]):not([type=submit]), textarea, select')) {
      const labelled = (field.id && document.querySelector(`label[for="${field.id}"]`)) || field.closest('label') || field.getAttribute('aria-label');
      if (!labelled) fail(scope, `form field "${field.getAttribute('name') ?? field.localName}" has no label`);
    }
    for (const image of document.querySelectorAll('img')) {
      if (!image.hasAttribute('alt')) fail(scope, `image ${image.getAttribute('src') ?? ''} has no alt attribute`);
    }
    for (const button of document.querySelectorAll('button')) if (!accessibleName(button, document)) fail(scope, 'button without accessible name');
    for (const link of document.querySelectorAll('a[href]')) if (!accessibleName(link, document)) fail(scope, `link ${link.getAttribute('href')} without accessible name`);

    // Forms.
    for (const form of document.querySelectorAll('form')) {
      if ((form.getAttribute('method') ?? '').toLowerCase() !== 'post') fail(scope, 'form method must be post');
      if (site.forms.contact && form.getAttribute('action') !== site.forms.contact.endpoint) fail(scope, 'form action differs from forms.contact.endpoint');
    }
    if (document.querySelector('form') && !site.forms.contact) fail(scope, 'page has a form but forms.contact is not configured (privacy policy would be wrong)');

    // Metadata.
    const title = page.title;
    const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';
    if (!title) fail(scope, 'missing <title>');
    if (title.length > 70) fail(scope, `title is ${title.length} characters (maximum 70)`);
    if (!description) fail(scope, 'missing meta description');
    if (description.length > 170) fail(scope, `description is ${description.length} characters (maximum 170)`);
    if (!page.noindex) {
      // Unique within a language; the same brand-name title in every language is fine.
      const titleKey = `${page.lang}\n${title}`;
      const descriptionKey = `${page.lang}\n${description}`;
      if (titles.has(titleKey)) fail(scope, `same title as ${titles.get(titleKey)}`);
      if (descriptions.has(descriptionKey)) fail(scope, `same description as ${descriptions.get(descriptionKey)}`);
      titles.set(titleKey, scope);
      descriptions.set(descriptionKey, scope);
      const canonicals = document.querySelectorAll('link[rel="canonical"]');
      if (canonicals.length !== 1) fail(scope, `expected one canonical link, found ${canonicals.length}`);
      else if (canonicals[0].getAttribute('href') !== site.url + page.path) fail(scope, `canonical must be ${site.url + page.path}`);
    }

    // Analytics.
    const umami = document.querySelectorAll('script[data-website-id]');
    if (site.analytics) {
      if (umami.length !== 1) fail(scope, `expected Umami once, found ${umami.length}`);
      else if (umami[0].getAttribute('data-website-id') !== site.analytics.umami.websiteId) fail(scope, 'Umami website id differs from site.config');
    } else if (umami.length) fail(scope, 'Umami script present but analytics is not configured');

    // Embedded third-party content must be declared, so the CSP allows it and the privacy policy names it.
    const embedOrigins = new Set((site.embeds ?? []).map((embed) => embed.origin));
    for (const frame of document.querySelectorAll('iframe')) {
      const src = frame.getAttribute('src') ?? '';
      if (!frame.getAttribute('title')) fail(scope, `iframe ${src} has no title`);
      let origin = null;
      try {
        origin = new URL(src).origin;
      } catch {}
      if (origin && !embedOrigins.has(origin)) fail(scope, `iframe from ${origin} is not listed in embeds in site.config`);
    }

    // JSON-LD.
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
    if (!blocks.length) fail(scope, 'missing JSON-LD');
    for (const block of blocks) {
      try {
        const graph = JSON.parse(block.textContent ?? '')['@graph'] ?? [];
        const organization = graph.find((node) => node['@id'] === `${site.url}/#organization`);
        if (!organization) fail(scope, 'JSON-LD has no organization with the site @id');
        const webPage = graph.find((node) => node['@type'] === 'WebPage');
        if (!page.noindex && webPage?.url !== site.url + page.path) fail(scope, 'JSON-LD WebPage url differs from canonical');
      } catch {
        fail(scope, 'invalid JSON-LD');
      }
    }

    // hreflang: complete and reciprocal.
    const alternates = [...document.querySelectorAll('link[rel="alternate"][hreflang]')];
    if (alternates.length) {
      const map = new Map(alternates.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href') ?? '']));
      for (const lang of site.languages) if (!map.has(lang)) fail(scope, `hreflang alternate missing for ${lang}`);
      if (!map.has('x-default')) fail(scope, 'hreflang x-default missing');
      for (const [lang, href] of map) {
        if (!href.startsWith(`${site.url}/`)) {
          fail(scope, `hreflang ${lang} points outside the site: ${href}`);
          continue;
        }
        const target = byPath.get(href.slice(site.url.length));
        if (!target) fail(scope, `hreflang ${lang} points to a missing page: ${href}`);
        else if (lang !== 'x-default') {
          if (target.lang !== lang) fail(scope, `hreflang ${lang} points to a page in "${target.lang}"`);
          const back = target.document.querySelector(`link[rel="alternate"][hreflang="${page.lang}"]`)?.getAttribute('href');
          if (!page.noindex && back !== site.url + page.path) fail(scope, `hreflang ${lang} target does not link back to this page`);
        }
      }
    }

    // Internal links and assets.
    for (const element of document.querySelectorAll('a[href], link[href], img[src], script[src], source[srcset], img[srcset]')) {
      const references = element.hasAttribute('srcset')
        ? element.getAttribute('srcset').split(',').map((part) => part.trim().split(/\s+/)[0])
        : [element.getAttribute('href') ?? element.getAttribute('src')];
      for (const reference of references) {
        if (!reference || /^(https?:|mailto:|tel:|data:)/.test(reference)) continue;
        const url = new URL(reference, `${site.url}${page.path}`);
        if (url.origin !== site.url) continue;
        let target = decodeURIComponent(url.pathname);
        if (target.endsWith('/')) target += 'index.html';
        if (!existsSync(path.join(dist, target))) {
          fail(scope, `broken internal link or asset ${reference}`);
          continue;
        }
        if (url.hash.length > 1 && target.endsWith('.html')) {
          const targetPage = pages.find((p) => p.relative === target.slice(1));
          if (targetPage && !targetPage.document.getElementById(decodeURIComponent(url.hash.slice(1)))) fail(scope, `missing fragment target ${reference}`);
        }
      }
    }
  }

  // Redirects: target must be a built page, source must not shadow one.
  for (const [from, to] of Object.entries(site.redirects)) {
    if (!byPath.has(to)) fail('redirects', `${from} points to ${to}, which is not a built page`);
    if (byPath.has(from) || existsSync(path.join(dist, from))) fail('redirects', `${from} is also a real file; the redirect would hide it`);
  }

  // Generated files.
  const sitemapPath = path.join(dist, 'sitemap.xml');
  if (!existsSync(sitemapPath)) fail('sitemap.xml', 'missing');
  else {
    const urls = [...readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const expected = indexable.map((page) => site.url + page.path).sort();
    if (urls.join('\n') !== expected.join('\n')) fail('sitemap.xml', 'does not match the indexable pages');
  }
  const robots = path.join(dist, 'robots.txt');
  if (!existsSync(robots) || !readFileSync(robots, 'utf8').includes(`Sitemap: ${site.url}/sitemap.xml`)) fail('robots.txt', 'missing or without sitemap line');
  const llms = path.join(dist, 'llms.txt');
  if (!existsSync(llms) || !readFileSync(llms, 'utf8').includes(`${site.url}/privacy/`)) fail('llms.txt', 'missing or without the privacy page');
  if (!existsSync(path.join(dist, '.htaccess'))) fail('.htaccess', 'missing');
  for (const file of walk(dist, (f) => path.basename(f) === '.DS_Store')) fail(rel(file), 'operating-system file in build output');

  return failures;
}
