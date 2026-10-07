# site-kit changelog

Newest first. Sites pin a version with `github:djoek/site-kit#vX.Y.Z`; read every entry between your pinned version and the new one before bumping.

## 0.1.7 (2026-10-01)

- Fix: the named-colour check flagged custom properties whose name contains a colour word, such as `color: var(--black)`. A colour keyword now only counts as a whole word. New negative test for `border-color: black` and a pass test for `var(--black)`.

## 0.1.6 (2026-10-01)

- `site-kit maint start <issue> | finish | deploy`: the maintainer's fixed path from a GitHub issue to a deploy. Sites add them as `maint:start`, `maint:finish`, `maint:deploy` scripts (see README, "Maintenance").
  - `start`: clean tree, `main` fast-forwarded to `origin/main`, the issue must be open with exactly one `type:<copy|image|page|hours|facts|deps>` label and no `needs-builder`; creates `maint/<n>-<slug>`.
  - `finish`: requires a `CHANGELOG.md` change, runs `check --scope <type>` plus the full check, commits, pushes, opens a pull request with `Closes #<n>`.
  - `deploy`: only on `main` identical to `origin/main`, with a completed, green CI run for that exact commit; then `site-kit deploy` (never `--first-deploy`) and a comment on the merged pull request.
- Scope `image` may also change `src/content/` (alt texts and captions live in the copy files).
- New test `test:maint` (git flow against a local bare repository and a fake `gh`).

## 0.1.5 (2026-09-30)

- `embeds` in site.config: third-party content shown in an `<iframe>`, e.g. `[{ name: 'Google Maps', origin: 'https://www.google.com' }]`. Each origin is added to the CSP `frame-src`, and `<PrivacyPolicy>` gets a section naming the services (new i18n keys `privacy.embedsHeading`, `privacy.embeds`). Without `embeds` nothing changes: the CSP still blocks every iframe.
- `check` fails on an `<iframe>` without `title`, or from an origin that is not listed in `embeds`. New negative test.
- `analytics.umami.hostUrl` (optional): where the script sends its data when that is not the script's origin. Umami Cloud needs `hostUrl: 'https://gateway.umami.is'`. The script gets `data-host-url`, and the CSP `connect-src` allows that origin instead of the script's. Self-hosted Umami needs no change.
- `<PrivacyPolicy>` has a default slot for site-specific sections. They appear before "your rights".

## 0.1.4 (2026-09-30)

- `<OpeningHours compact>` groups consecutive days with the same hours into one row ("woensdag t.e.m. zaterdag"); `hideClosed` leaves out closed days. New i18n key `hours.through` ("t.e.m." / "to"). Both props are off by default, so existing sites render the same.
- Fix: `site-kit favicon` failed with "Input image exceeds pixel limit" for SVGs with a large viewBox (for example 1024×1024). The render density is now relative to the SVG's own size.

## 0.1.3 (2026-09-30)

- Fix: images returned 404 in `astro dev` (`trailingSlash: 'always'` also applied to Astro's `/_image` endpoint). Dev now uses `'ignore'`; built URLs are unchanged. New test `test:dev` checks pages and images on the dev server.

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
