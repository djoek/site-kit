# site-kit changelog

Newest first. Sites pin a version with `github:djoek/site-kit#vX.Y.Z`; read every entry between your pinned version and the new one before bumping.

## 0.1.0 (unreleased)

- First version: `<Document>` shell, head/SEO/JSON-LD, theme toggle, Popover navigation, language switcher, optional contact form, opening hours from `hours.toml`, address block, privacy policy (nl, en).
- Generated after build: `sitemap.xml`, `robots.txt`, `llms.txt`, `.htaccess` with a hash-based Content-Security-Policy, IndexNow key file.
- `site-kit check`: source checks, build, output checks, browser checks (Playwright + axe, both themes, mobile and desktop), optional `--scope <type>` for maintenance tasks.
- Not yet: `site-kit deploy`, favicon generation, French strings.
