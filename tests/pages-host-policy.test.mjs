// The site answers on more than one address. This pins which address gets
// what -- see functions/_middleware.js for why the twin exists at all.
import fs from 'node:fs';
import assert from 'node:assert/strict';

const code = fs.readFileSync(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const { decide, onRequest, isRetired } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const PROJECT = 'longmotive-web-demo-site-avm.pages.dev';
const PREVIEW = 'news-events.' + PROJECT;
const doc = { dest: 'document' };

// The custom domain is the site and must not notice this file exists.
for (const host of ['www.longmotive-m.com', 'longmotive-m.com']) {
  assert.equal(decide({ host, ...doc }).action, 'pass', host + ' must pass through');
  assert.equal(decide({ host, pathname: '/robots.txt' }).action, 'pass', host + ' keeps its own robots.txt');
}

// Another Pages project deploying this repository is someone else's site.
assert.equal(decide({ host: 'longmotive-web-demo-site.pages.dev', ...doc }).action, 'pass');

// The project host mirrors production, so a reader is sent to the real one.
assert.deepEqual(
  decide({ host: PROJECT, pathname: '/news-events', search: '?v=1', ...doc }),
  { action: 'redirect', to: 'https://www.longmotive-m.com/news-events?v=1' },
);

// ...but only a reader. A form post has to reach the function it was aimed at.
assert.equal(decide({ host: PROJECT, method: 'POST', pathname: '/api/contact' }).action, 'noindex');
assert.equal(decide({ host: PROJECT, pathname: '/assets/og-cover.jpg', dest: 'image' }).action, 'noindex');

// Branch previews keep working -- they are how anything gets reviewed.
assert.equal(decide({ host: PREVIEW, pathname: '/news-events', ...doc }).action, 'noindex');
assert.equal(decide({ host: PREVIEW, pathname: '/robots.txt' }).action, 'robots');
assert.equal(decide({ host: PROJECT, pathname: '/robots.txt' }).action, 'robots');

// A client that sends no sec-fetch-dest is judged on what it will accept.
assert.equal(decide({ host: PROJECT, accept: 'text/html,*/*', ...{} }).action, 'redirect');
assert.equal(decide({ host: PROJECT, accept: 'image/avif,image/webp' }).action, 'noindex');

// And the wiring: the header lands on HTML and nothing else.
const run = (host, pathname, body, type) => onRequest({
  request: new Request('https://' + host + pathname, { headers: { 'sec-fetch-dest': 'document' } }),
  next: async () => new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } }),
});

const html = await run(PREVIEW, '/news-events', '<!doctype html><title>x</title>', 'text/html; charset=utf-8');
assert.equal(html.headers.get('x-robots-tag'), 'noindex, nofollow');

const asset = await run(PREVIEW, '/assets/og-cover.jpg', 'binary', 'image/jpeg');
assert.equal(asset.headers.get('x-robots-tag'), null, 'an asset keeps its own headers');
assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

const robots = await run(PROJECT, '/robots.txt', '', 'text/plain');
assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n');

const moved = await run(PROJECT, '/projects', '', 'text/html');
assert.equal(moved.status, 301);
assert.equal(moved.headers.get('location'), 'https://www.longmotive-m.com/projects');

const untouched = await run('www.longmotive-m.com', '/', '<!doctype html>', 'text/html');
assert.equal(untouched.headers.get('x-robots-tag'), null, 'the real site is never marked noindex');

// Working files that were published by accident. Deleting them left the
// extensionless routes alive for a week behind Cloudflare's s-maxage, so the
// middleware is what actually retires them -- on every host, the custom domain
// most of all, because that is where they were visible.
// 'ktp-growth-scrub' is in this list for a different reason: it is not dead,
// it is unpublished, and it is held down until it ships properly. When it
// does, it leaves the middleware set and this list together.
for (const slug of ['hero-arc-compare', 'hero-jb-compare', 'hero-real-prototype',
                    'projects-compare', 'projects-hybrid', 'projects-map-prototype',
                    'projects-video-hero', 'ktp-growth-scrub']) {
  for (const form of ['/' + slug, '/' + slug + '.html', '/' + slug + '/']) {
    assert.equal(isRetired(form), true, form + ' must be retired');
  }
}
// The globe embed is framed by the home screen and stays.
for (const keep of ['/projects-globe-embed', '/about', '/', '/news-events', '/msb-viewer.dc']) {
  assert.equal(isRetired(keep), false, keep + ' must keep serving');
}
const gone = await onRequest({
  request: new Request('https://www.longmotive-m.com/hero-jb-compare', { headers: { 'sec-fetch-dest': 'document' } }),
  next: async () => new Response('the old page', { headers: { 'content-type': 'text/html' } }),
});
assert.equal(gone.status, 410, 'a retired page answers 410 on the custom domain');
assert.equal(gone.headers.get('cache-control'), 'no-store', 'and nothing may pin that answer');
assert.doesNotMatch(await gone.text(), /the old page/, 'next() must never be reached for a retired path');

console.log('PASS: one address serves the site, the rest point at it or stay out of the index');
