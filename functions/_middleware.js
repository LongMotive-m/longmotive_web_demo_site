// THE SITE HAS MORE THAN ONE ADDRESS, AND ONLY ONE OF THEM IS THE SITE.
//
// Cloudflare Pages gives every project a permanent <project>.pages.dev and
// every branch a <branch>.<project>.pages.dev, all public, with no switch to
// turn them off. So www.longmotive-m.com has a twin serving byte-identical
// content at longmotive-web-demo-site-avm.pages.dev -- an address that names
// the project, the account and the fact that it started life as a demo.
//
// Cloudflare already sends x-robots-tag: noindex on BRANCH previews. It does
// not send it on the project host, which is the one that mirrors production,
// so that is the address search engines can index and people can find. The
// canonical tag points at www from every host, which is what has kept the
// duplicates out of the index so far, but a canonical is a hint and the
// address still answers.
//
// Branch previews are how work gets reviewed before it ships, so they keep
// serving. They only get a robots.txt that says no.
//
// SCOPE IS DELIBERATE: this touches our own project's addresses and nothing
// else. The custom domain falls through on the first comparison, and so does
// any other Pages project that happens to deploy this repository -- that is
// someone else's site to configure.

const CANONICAL_ORIGIN = 'https://www.longmotive-m.com';
const PROJECT_HOST = 'longmotive-web-demo-site-avm.pages.dev';

const DISALLOW_ALL = 'User-agent: *\nDisallow: /\n';

// WORKING FILES THAT WERE PUBLISHED BY ACCIDENT.
//
// Seven hero and projects comparison pages shipped with the site and answered
// 200 on the customer's domain, under titles that were never meant to leave a
// working folder. Deleting them from the repo was not enough: Cloudflare held
// the extensionless routes under `Cache-Control: public, s-maxage=604800`, so
// the edge kept serving the old bytes -- /hero-jb-compare still returned the
// page while /hero-jb-compare?cb=1 and /hero-jb-compare.html both answered 404.
// That is a week of a deleted page staying up. A Function runs ahead of that
// copy (its response comes back carrying no Age at all), so this is what
// actually retires them.
//
// 410 rather than a redirect: they are gone and have no successor, a 410 is the
// fastest thing to fall out of an index, and unlike a 301 no browser keeps it
// forever -- the mistake that left /news-events needing a cache-busting query.
const RETIRED = new Set([
  'hero-arc-compare', 'hero-jb-compare', 'hero-real-prototype',
  'projects-compare', 'projects-hybrid', 'projects-map-prototype',
  'projects-video-hero',
  // NOT RETIRED, NOT PUBLISHED. The KTP growth scrub reached main and answered
  // on www before it was meant to, and removing the file from the repo left
  // the same week-long ghost the seven above did: /ktp-growth-scrub kept
  // answering 200 from the edge while /ktp-growth-scrub?cb=1 and the .html
  // form both gave 404. This is what actually takes it down.
  //
  // TAKE THIS LINE OUT WHEN THE PAGE SHIPS. Leave it in and the page will
  // deploy and still answer 410, with nothing in the build to explain why.
  'ktp-growth-scrub',
]);

export function isRetired(pathname) {
  const slug = pathname
    .replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.html$/, '');
  return RETIRED.has(slug);
}

const GONE_BODY = '<!doctype html><meta charset="utf-8"><title>Gone | Longmotive</title>'
  + '<p style="font:16px system-ui;padding:3rem">This page is no longer published. '
  + '<a href="https://www.longmotive-m.com/">Longmotive</a></p>';

// A reader gets moved; a form post and an asset fetch do not. Redirecting a
// POST would break /api/contact, and redirecting assets would mean a branch
// preview quietly rendering with production's files.
function isDocumentRequest(method, dest, accept) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (dest) return dest === 'document';
  return (accept || '').includes('text/html');
}

export function decide({ host, method = 'GET', pathname = '/', search = '', dest = '', accept = '' }) {
  const ours = host === PROJECT_HOST || host.endsWith('.' + PROJECT_HOST);
  if (!ours) return { action: 'pass' };

  if (pathname === '/robots.txt') return { action: 'robots' };

  // The project host mirrors production and has no job of its own.
  if (host === PROJECT_HOST && isDocumentRequest(method, dest, accept)) {
    return { action: 'redirect', to: CANONICAL_ORIGIN + pathname + search };
  }

  // Branch previews stay readable, and stay out of the index.
  return { action: 'noindex' };
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // Retired on every host, the custom domain included -- that is the one they
  // were actually visible on.
  if (isRetired(url.pathname)) {
    return new Response(GONE_BODY, {
      status: 410,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
    });
  }

  const plan = decide({
    host: url.hostname,
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    dest: request.headers.get('sec-fetch-dest') || '',
    accept: request.headers.get('accept') || '',
  });

  if (plan.action === 'pass') return next();

  if (plan.action === 'robots') {
    return new Response(DISALLOW_ALL, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  if (plan.action === 'redirect') return Response.redirect(plan.to, 301);

  const res = await next();
  // Only a document carries an index entry worth suppressing, and rebuilding
  // an asset response would throw away its immutable caching headers.
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', 'noindex, nofollow');
  return out;
}
