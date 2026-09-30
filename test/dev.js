// Dev server: pages and images must work in `astro dev` too (the checks only look at the build).
// Regression: trailingSlash 'always' made Astro's /_image endpoint return 404 in dev.
import { spawn } from 'node:child_process';
import path from 'node:path';

const fixture = path.resolve(import.meta.dir, '../fixtures/basic');
const port = 4300 + Math.floor(Math.random() * 90);
const server = spawn('bunx', ['astro', 'dev', '--port', String(port), '--ignore-lock'], { cwd: fixture, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
const base = `http://localhost:${port}`;
const results = [];
const expect = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${detail}`}`);
};
try {
  let html = '';
  for (let i = 0; i < 60 && !html; i++) {
    await new Promise((r) => setTimeout(r, 500));
    html = await fetch(`${base}/`).then((r) => (r.ok ? r.text() : ''), () => '');
  }
  expect('dev server serves the home page', Boolean(html));
  const images = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/&#38;|&amp;/g, '&'));
  expect('home page has gallery images', images.length >= 2, `(found ${images.length})`);
  for (const [i, src] of images.slice(0, 2).entries()) {
    const response = await fetch(base + src);
    expect(`image ${i + 1} loads in dev (${response.status}, ${response.headers.get('content-type')})`, response.ok && /^image\//.test(response.headers.get('content-type') ?? ''));
  }
  const page = await fetch(`${base}/privacy/`);
  expect('a subpage loads in dev', page.ok);
} finally {
  server.kill();
}
process.exit(results.every(Boolean) ? 0 : 1);
