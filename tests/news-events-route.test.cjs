const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const news = fs.readFileSync(path.join(root, 'news-events.html'), 'utf8');
const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const css = fs.readFileSync(path.join(root, 'news-events.css'), 'utf8');

assert.match(html, /'News & Events':'\/news-events\?v=20260917-1'/);
assert.match(html, /if\(n==='News & Events'\)\{ window\.location\.href=NAV_PATH\[n\]/);
assert.match(news, /<link rel="canonical" href="https:\/\/www\.longmotive-m\.com\/news-events">/);
for (const href of ['/', '/about', '/projects', '/news-events?v=20260917-1', '/contact']) {
  assert.ok(news.includes(`href="${href}"`), `News navigation must link to ${href}`);
}
assert.doesNotMatch(redirects, /^\/news-events\s+/m);
assert.doesNotMatch(redirects, /^\/news-events\s+\/\s+301$/m);
assert.match(sitemap, /<loc>https:\/\/www\.longmotive-m\.com\/news-events<\/loc>/);
assert.match(fs.readFileSync(path.join(root, '_headers'), 'utf8'), /\/news-events\s+Cache-Control: no-store, max-age=0/s);
assert.match(css, /\.ne-card-img\s*\{[^}]*object-fit:\s*cover/s);
assert.match(css, /\.ne-modal-header-img\s*\{[^}]*width:\s*100%[^}]*height:\s*auto[^}]*object-fit:\s*contain/s);
assert.doesNotMatch(css, /\.ne-modal-carousel::before/);
assert.doesNotMatch(news, /--ne-modal-image/);
assert.doesNotMatch(news, /class="ne-breadcrumb"/);
// a tall photograph must be sized from the height left over after the caption,
// not from its own width alone, or the modal scrolls
assert.match(news, /const byHeight = naturalHeight \? budget \* \(naturalWidth \/ naturalHeight\) : Infinity;/);
assert.match(news, /const modalWidth = Math\.min\(640, Math\.max\(floor, Math\.min\(naturalWidth, byHeight\)\)\);/);
assert.match(css, /max-width:\s*var\(--ne-modal-natural-width, 640px\)/);
assert.match(news, /const galleryAssetVersion = '20260921-1'/);
assert.match(news, /assets\/events\/gallery\/\$\{file\}\?v=\$\{galleryAssetVersion\}/);

// Both floating shortcuts. The SPA hides them behind whatsapp.js; this page
// never loads that script, so they are always on and the brochure one went
// missing entirely when the page was first brought over.
assert.match(news, /class="lm-whatsapp lm-brochure"[^>]*href="\/downloads\/longmotive-company-profile-2024\.pdf"/);
// The WhatsApp number changed to 60183410047 on 2026-10-14.
assert.match(news, /class="lm-whatsapp"[^>]*href="https:\/\/wa\.me\/60183410047/);
assert.ok(fs.existsSync(path.join(root, 'downloads', 'longmotive-company-profile-2024.pdf')), 'the brochure the button points at must ship');

// Shared chrome the standalone page has to carry itself. theme-color paints
// the phone browser bar; the og:image dimensions let a preview lay the card
// out before the picture arrives. Both went missing in the port.
assert.match(news, /<meta name="theme-color" content="#0f52a0">/);
for (const tag of ['og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt']) {
  assert.ok(news.includes(`property="${tag}"`), `News head must carry ${tag}`);
}
// One file, one cache entry: the SPA and this page must ask for the shared
// section-scroll script under the same revision.
const scrollRev = /mobile-section-scroll\.js\?v=([\w-]+)/;
assert.equal(news.match(scrollRev)?.[1], html.match(scrollRev)?.[1], 'both pages must request the same mobile-section-scroll.js revision');

console.log('PASS: News & Events follows the shared URL and standalone-head pattern');
