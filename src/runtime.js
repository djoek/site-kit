// Runtime helpers for .astro files. Data comes from the virtual module the integration provides.
import data from 'virtual:site-kit';

export const site = data.site;
export const hours = data.hours;

/** The copy for one language: the site's own JSON with a merged `kit` section. */
export function copyFor(lang) {
  const copy = data.copy[lang];
  if (!copy) throw new Error(`site-kit: no copy loaded for language "${lang}"`);
  return copy;
}

/** Language of the page being rendered. Pass Astro.currentLocale. */
export function langOf(currentLocale) {
  return currentLocale && site.languages.includes(currentLocale) ? currentLocale : site.defaultLanguage;
}

/** Replace {name} placeholders. Unknown placeholders are left visible so checks can catch them. */
export function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}
