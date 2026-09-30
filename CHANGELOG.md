# site-kit changelog

Newest first. Sites pin a version with `github:djoek/site-kit#vX.Y.Z`; read every entry between your pinned version and the new one before bumping.

## 0.1.2 (2026-09-30)

- `site-kit favicon` accepts a raster logo: `src/assets/logo.png` (automatic when there is no hand-made `public/favicon.svg`) or `--source <file>`. Transparent edges are trimmed, the logo is centred in a square, the apple-touch-icon gets a white background, and `public/favicon.svg` is generated as a wrapper around the PNG (marked, so it is never taken as the source).

## 0.1.1 (2026-09-30)

- `legalName` and `address.postalCode` are optional. Without a legal name the site shows `name` (address block, privacy policy); JSON-LD leaves the missing fields out.

## 0.1.0 (2026-09-30)

- First version: `<Document>` shell, head/SEO/JSON-LD, theme toggle, Popover navigation, language switcher, optional contact form, opening hours from `hours.toml`, address block, privacy policy (nl, en).
- Generated after build: `sitemap.xml`, `robots.txt`, `llms.txt`, `.htaccess` with a hash-based Content-Security-Policy, IndexNow key file.
- `site-kit check`: source checks, build, output checks, browser checks (Playwright + axe, both themes, mobile and desktop), optional `--scope <type>` for maintenance tasks.
- `redirects` in site.config: exact 301s in `.htaccess`, followed by the check server; targets must be built pages.
- `<ContactForm choice={...}>`: optional multiple-choice question.
- `<PriceList>`: packages with one or more (labelled) prices and what is included; amounts formatted per language.
- `<Gallery>`: responsive images (AVIF, WebP, JPEG at 3 widths) with alt text and optional captions.
- `site-kit favicon`: favicon.ico, apple-touch-icon, 192/512 icons and web manifest from `public/favicon.svg` (OKLCH colours converted for the rasteriser).
- `site-kit deploy [--dry-run] [--first-deploy]`: full check, git gate (clean `main` identical to `origin/main`), reviewed `deploy.remotePath`, target marker `.site-kit-target`, lftp mirror, IndexNow, live smoke test (pages, 404, redirects).
- Main navigation is visible on wide screens (a `[popover]` element is hidden by the browser until opened); the browser check now fails when it is not.
- Titles and descriptions must be unique within a language (the same brand-name title across languages is allowed).
- Not yet: French strings.
