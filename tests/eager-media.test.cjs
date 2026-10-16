// WHAT A VISITOR PAYS BEFORE THEY SCROLL.
//
// Every video on the home screen is handed its src by _applySrcs. That used to
// happen on mount, so a desktop visit fetched the principles loop and the KTP
// band -- and, on About, three gallery films -- before a pixel had been
// scrolled, for pictures sitting thousands of px down the page. Measured on
// production at 1440 with scrollY 0: 35.9MB, 22 of it a background at 42%
// opacity. These assertions are what keeps that from coming back.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');

// Videos are armed on approach, never on mount.
assert.match(html, /if\(el\.tagName==='VIDEO'\)\{ this\._armVideo\(el,s\); return; \}/,
  '_applySrcs must hand videos to _armVideo rather than assigning src');
assert.match(html, /_armVideo=\(el,src\)=>\{/);
// Two ways in: the observer, and a scroll backstop. An observer needs the
// rendering steps, so a tab that is not compositing never fires one -- the
// backstop is both the safety net and the half a test can actually exercise.
assert.match(html, /obs=new IntersectionObserver\(entries=>\{ if\(entries\.some\(e=>e\.isIntersecting\)\) start\(\); \}/);
assert.match(html, /window\.addEventListener\('scroll',onMove,\{passive:true\}\)/);
assert.match(html, /const onMove=\(\)=>\{ if\(near\(\)\) start\(\); \};/);
assert.match(html, /const disarm=\(\)=>\{/, 'whichever arrives first must disarm the other');
assert.doesNotMatch(html, /el\.src=s;\s*\r?\n\s*if\(el\.tagName==='VIDEO'\)/,
  'the old assign-everything-on-mount path must stay gone');

// The hero is the only film worth a cold start; it is what the screen opens on.
const eager = html.match(/preload="auto"/g) || [];
assert.equal(eager.length, 1, 'only the hero video may preload eagerly');
assert.match(html, /class="lm-hero-media"[^>]*preload="auto"/,
  'and the one that does must be the hero');

// Every video the page names has to exist, at a weight someone would accept.
// A film is named one of two ways: a literal data-src (the KTP band on Home)
// or a vid: entry in the About gallery, bound into data-src at render time.
// The services backdrop (principles-bg) used to be the heaviest one here; it
// was removed with the October 2026 services rebuild and must not come back --
// its burned-in captions bled through the bottom of the section.
const BUDGET_MB = { 'ktp-band': 6 };
const srcs = [
  ...[...html.matchAll(/data-src="(uploads\/[\w./-]+\.mp4)"/g)].map(m => m[1]),
  ...[...html.matchAll(/vid:'(uploads\/[\w./-]+\.mp4)'/g)].map(m => m[1]),
];
assert.ok(srcs.length >= 4, 'expected the KTP band and the three About films to be declared');
assert.doesNotMatch(html, /principles-bg/, 'the old services backdrop film must not come back');
for (const src of srcs) {
  const file = path.join(root, src);
  assert.ok(fs.existsSync(file), `missing video: ${src}`);
  const mb = fs.statSync(file).size / 1048576;
  for (const [stem, cap] of Object.entries(BUDGET_MB)) {
    if (src.includes(stem)) {
      assert.ok(mb <= cap, `${src} is ${mb.toFixed(1)}MB, over its ${cap}MB budget`);
    }
  }
}

// The What We Do films: each one listed in SVC_CLIPS exists, is real footage
// rather than a preview stand-in, stays small enough for a section a visitor
// may scroll straight past, and is never fetched up front -- the page hands a
// film its src only when its row comes up.
const clipMap = html.match(/const SVC_CLIPS=\{([^}]*)\}/);
assert.ok(clipMap, 'SVC_CLIPS must be declared');
const clips = [...clipMap[1].matchAll(/'([^']+\.mp4)'/g)].map(m => m[1]);
assert.ok(clips.length >= 5, 'expected a film for at least five of the six rows');
for (const clip of clips) {
  assert.match(clip, /^uploads\/services\/[\w-]+-clip\.mp4$/, `${clip} is not a published services film`);
  const file = path.join(root, clip);
  assert.ok(fs.existsSync(file), `missing services film: ${clip}`);
  const mb = fs.statSync(file).size / 1048576;
  assert.ok(mb <= 5, `${clip} is ${mb.toFixed(1)}MB, over its 5MB budget`);
}
assert.match(html, /<video class="lm-svc-clip"[^>]*preload="none"/, 'services films must not preload');

// Working files do not ship to the customer's domain.
for (const orphan of ['hero-arc-compare', 'hero-jb-compare', 'hero-real-prototype',
                      'projects-compare', 'projects-hybrid', 'projects-map-prototype',
                      'projects-video-hero']) {
  assert.equal(fs.existsSync(path.join(root, orphan + '.html')), false,
    `${orphan}.html is a working file and must not be published`);
}
for (const orphan of ['uploads/3d/viewer-test.html', 'uploads/3d/viewer-test-5ea1ff35.html']) {
  assert.equal(fs.existsSync(path.join(root, orphan)), false, `${orphan} is a test page and must not be published`);
}
// The globe embed is not one of them -- the home screen frames it -- but it
// is not a page of its own either.
assert.ok(fs.existsSync(path.join(root, 'projects-globe-embed.html')));
assert.match(fs.readFileSync(path.join(root, 'projects-globe-embed.html'), 'utf8'), /<meta name="robots" content="noindex">/);
assert.match(html, /projects-globe-embed/);

// HSTS, and deliberately not for the subdomains we do not run.
assert.match(headers, /Strict-Transport-Security: max-age=31536000\s*$/m);
assert.doesNotMatch(headers, /Strict-Transport-Security:[^\n]*includeSubDomains/,
  'mail, webmail and cpanel under this domain are Webteq\'s, not ours');

console.log('PASS: only the hero loads eagerly, working files stay unpublished, HSTS is scoped');
