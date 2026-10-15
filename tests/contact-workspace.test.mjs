import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../functions/api/contact.js', import.meta.url), 'utf8');
const { onRequestPost } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url, body: JSON.parse(options.body) });
  if (url === 'https://api.resend.com/emails') return new Response('{"id":"test-only"}', { status: 200 });
  return new Response('{"ok":true,"row":2}', { status: 200 });
};

async function submit(formType, env) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ formType, name: 'Workspace test', email: 'test@example.com', contact: '0123', subject: 'Quote', message: 'Test only', salutation: 'Ms', jobTitle: 'QS' })) form.set(name, value);
  if (formType === 'careers') form.set('cv', new File(['%PDF test'], 'cv.pdf', { type: 'application/pdf' }));
  const pending = [];
  const response = await onRequestPost({
    request: new Request('https://example.com/api/contact', { method: 'POST', body: form, headers: { Referer: 'https://www.longmotive-m.com/contact' } }),
    env: { RESEND_API_KEY: 'test', CONTACT_FROM: 'test@example.com', ...env },
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return response;
}

try {
  // Without the two settings, nothing leaves for Apps Script.
  calls.length = 0;
  assert.equal((await submit('enquiry', {})).status, 200);
  assert.deepEqual(calls.map((c) => c.url), ['https://api.resend.com/emails']);

  const env = { APPS_SCRIPT_URL: 'https://script.google.com/macros/s/TEST/exec', WEB_KEY: 'k' };
  for (const formType of ['enquiry', 'careers']) {
    calls.length = 0;
    assert.equal((await submit(formType, env)).status, 200);
    const copy = calls.find((c) => c.url === env.APPS_SCRIPT_URL);
    assert.ok(copy, 'workspace copy sent');
    assert.equal(copy.body.key, 'k');
    assert.equal(copy.body.form, formType);
    assert.equal(copy.body.phone, '0123');
    assert.equal(copy.body.page, 'https://www.longmotive-m.com/contact');
    assert.equal(Boolean(copy.body.cv_base64), formType === 'careers');
    assert.ok(calls.some((c) => c.url === 'https://api.resend.com/emails'), 'email still sent');
  }

  // A failing Apps Script never blocks the visitor.
  globalThis.fetch = async (url) => (url === 'https://api.resend.com/emails'
    ? new Response('{"id":"x"}', { status: 200 })
    : new Response('boom', { status: 500 }));
  const original = console.error; console.error = () => {};
  try { assert.equal((await submit('careers', env)).status, 200); } finally { console.error = original; }

  console.log('PASS: submissions copied to Workspace only when configured; CV included for careers; email and reply unaffected by failures');
} finally {
  globalThis.fetch = originalFetch;
}
