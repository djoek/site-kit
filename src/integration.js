// The Astro integration: sets the fixed parts of astro.config, exposes site data to components
// through a virtual module, and writes the generated files (sitemap, robots, llms, .htaccess) after build.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadHours } from './hours.js';
import { writeOutputs } from './outputs.js';

const VIRTUAL_ID = 'virtual:site-kit';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const kitCopyDir = fileURLToPath(new URL('./i18n/', import.meta.url));

/** Deep merge for plain JSON objects; values from `override` win. */
function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base?.[key] ?? {}, value) : value;
  }
  return out;
}

/**
 * Read everything components need: site facts, copy per language (kit defaults merged with the
 * site's "kit" overrides) and parsed opening hours. Throws with a readable message on problems.
 */
export function loadSiteData(root, site) {
  const problems = [];
  const copy = {};
  for (const lang of site.languages) {
    const file = path.join(root, 'src/content/i18n', `${lang}.json`);
    if (!existsSync(file)) {
      problems.push(`missing copy file src/content/i18n/${lang}.json`);
      continue;
    }
    let siteCopy;
    try {
      siteCopy = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      problems.push(`src/content/i18n/${lang}.json is not valid JSON: ${error.message}`);
      continue;
    }
    const kitFile = path.join(kitCopyDir, `${lang}.json`);
    const kitDefaults = existsSync(kitFile) ? JSON.parse(readFileSync(kitFile, 'utf8')) : {};
    if (!existsSync(kitFile) && !siteCopy.kit) {
      problems.push(`site-kit has no built-in "${lang}" strings; add a complete "kit" section to src/content/i18n/${lang}.json`);
    }
    copy[lang] = { ...siteCopy, kit: merge(kitDefaults, siteCopy.kit ?? {}) };
  }

  let hours = null;
  if (site.hours) {
    const result = loadHours(path.join(root, site.hours), site.languages);
    if (result.errors.length) problems.push(...result.errors.map((error) => `${site.hours}: ${error}`));
    hours = result.hours;
  }

  if (problems.length) throw new Error(`site-kit could not load site data:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return { site, copy, hours };
}

/** @param {Readonly<import('./config.js').SiteConfig>} site result of defineSite() */
export function siteKit(site) {
  let root = process.cwd();

  const watched = () => [
    ...site.languages.map((lang) => path.join(root, 'src/content/i18n', `${lang}.json`)),
    ...(site.hours ? [path.join(root, site.hours)] : []),
  ];

  /** @type {import('vite').Plugin} */
  const virtualModule = {
    name: 'site-kit:data',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) return `export default ${JSON.stringify(loadSiteData(root, site))};`;
    },
    handleHotUpdate({ file, server }) {
      if (!watched().includes(path.resolve(file))) return;
      const module = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (module) server.moduleGraph.invalidateModule(module);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };

  return {
    name: '@djoek/site-kit',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, addWatchFile }) => {
        root = fileURLToPath(config.root);
        loadSiteData(root, site); // fail early, before Astro starts rendering
        for (const file of watched()) addWatchFile(file);
        updateConfig({
          site: site.url,
          output: 'static',
          trailingSlash: 'always',
          build: { format: 'directory', inlineStylesheets: 'never' },
          i18n: {
            defaultLocale: site.defaultLanguage,
            locales: [...site.languages],
            routing: { prefixDefaultLocale: false },
          },
          vite: { plugins: [virtualModule] },
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const data = loadSiteData(root, site);
        const written = await writeOutputs(fileURLToPath(dir), data);
        logger.info(`wrote ${written.join(', ')}`);
      },
    },
  };
}
