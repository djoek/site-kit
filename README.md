# site-kit

Shared Astro baseline for small static sites: the parts every site has, so each site only contains its own design and content.

## What a site gets

| Part | How |
|---|---|
| Document shell: `<html lang>`, head, skip link, one `<main id="main">` | `<Document>` with `header` and `footer` slots |
| Canonical, Open Graph, hreflang, JSON-LD (organisation, address, opening hours) | automatic in `<Document>` |
| Light/dark theme with stored choice | `<ThemeToggle>` + `kit.themes()` in SCSS |
| Main navigation, Popover on small screens | `<Nav items={...}>` |
| Language switcher | `<LanguageSwitcher translations={...}>` |
| Opening hours | `<OpeningHours>`, data in `hours.toml` |
| Address and contact details | `<Address>` |
| Contact form (optional) | `<ContactForm>`, enable with `forms.contact` |
| Privacy policy, sections follow the config | `<PrivacyPolicy>` |
| `sitemap.xml`, `robots.txt`, `llms.txt`, `.htaccess` with CSP | generated after every build |
| Price packages | `<PriceList packages={...}>` |
| Photo gallery, responsive images | `<Gallery images={...}>` |
| 301 redirects from old URLs | `redirects` in site.config |
| Favicons and web manifest | `site-kit favicon` |
| Checks | `site-kit check` |
| Deploy | `site-kit deploy` |

## Use in a site

```sh
bun add github:djoek/site-kit#v0.1.0 astro sass
```

`astro.config.ts`:

```ts
import { defineConfig } from 'astro/config';
import { siteKit } from '@djoek/site-kit';
import site from './site.config';

export default defineConfig({ integrations: [siteKit(site)] });
```

`site.config.ts` holds facts only (see `fixtures/basic/site.config.ts`). All visitor-facing copy goes in `src/content/i18n/<lang>.json`, which needs at least `site.description`. Override built-in strings with a `kit` section in the same file.

`package.json` scripts:

```json
{ "dev": "astro dev", "build": "astro build", "check": "site-kit check", "deploy": "site-kit deploy" }
```

Styles:

```scss
@use '@djoek/site-kit/styles' as kit;
@include kit.themes(
  $light: (canvas: oklch(97% 0.012 80), ink: oklch(25% 0.02 60), brand: oklch(47% 0.12 45)),
  $dark: (canvas: oklch(20% 0.015 60), ink: oklch(94% 0.012 80), brand: oklch(78% 0.11 60))
);
```

## Opening hours

`src/data/hours.toml`, set `hours: 'src/data/hours.toml'` in `site.config.ts`:

```toml
[week]            # [] = closed
mon = []
tue = [["08:00", "12:30"], ["13:30", "18:00"]]
# ... all seven days

[[exception]]     # shown until removed from the file
date = "2026-12-25"
to = "2026-12-26" # optional
closed = true     # or: hours = [["08:00", "12:00"]]
note = { nl = "Kerstmis", en = "Christmas" }   # optional; every site language when present
```

## Checks

`site-kit check` runs, in order:

1. **source**: same translation keys in every language, no literal text in templates, OKLCH colours only, both themes designed, no placeholders, no tracked secrets;
2. **build**: `astro build`, then the generated files;
3. **output**: one `<h1>`, heading order, landmarks, labels, alt text, links and fragments, canonical, hreflang (complete and reciprocal), JSON-LD, sitemap matches the pages;
4. **browser**: every page in light and dark, mobile and desktop, axe WCAG 2.2 AA, no horizontal overflow, no console or CSP errors; skip link, theme toggle and mobile navigation behaviour.

Options: `--no-browser`, `--scope <copy|image|page|hours|facts|deps>` (fails when the branch changes files outside that task type), `--base <git ref>`.

The browser checks need Chromium: `bunx playwright install chromium`, or point `SITE_KIT_CHROMIUM` at an existing binary.

## Deploy

`site-kit deploy` runs the full check, then mirrors `dist/` to the server with lftp over SFTP. Files on the server that are not in `dist/` are deleted.

Safety, in this order:

1. **Full check** must pass (always including the browser checks).
2. **Git gate**: clean working tree, on `main`, identical to `origin/main`. A merged PR is the only way to get something deployed.
3. **Reviewed path**: `SFTP_PATH` in the env file must equal `deploy.remotePath` in `site.config.ts`.
4. **Target marker**: every build contains `.site-kit-target` with the domain. The server copy must hold the same domain; a directory with another site's marker is refused. The first deploy to a directory without marker needs `--first-deploy` (look at `--dry-run` first).
5. After the mirror: IndexNow (if `indexNowKey` is set) and a **live smoke test** of home, robots, sitemap, llms, privacy, 404 and every redirect.

Connection settings live outside the repository, one file per site, `chmod 600`:

```sh
# ~/.config/site-ops/deploy/<domain>.env
SFTP_HOST=ssh.example-host.net
SFTP_PORT=22
SFTP_USER=account
SFTP_PATH=/www/example.be          # must equal deploy.remotePath
SFTP_KEYFILE=~/.ssh/example-deploy
```

The server's host key must already be in `~/.ssh/known_hosts` (connections run with `BatchMode=yes` and never ask).

`--dry-run` shows what would change and skips the git gate. Needs `lftp` installed.

## Develop site-kit

```sh
bun install
bun run test        # fixture must pass, broken copies of it must fail, deploy end-to-end (needs sshd + lftp, skipped otherwise)
```
