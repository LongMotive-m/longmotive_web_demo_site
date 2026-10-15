const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function field(formData, name) {
  return (formData.get(name) || '').toString().trim();
}

// COPY EVERY SUBMISSION INTO THE COMPANY'S GOOGLE WORKSPACE.
//
// The email to info@ / humanresource@ stays exactly as it was. On top of it,
// the same submission goes to the company's Apps Script web app ("WhatsApp
// 通知中心", owned by agent@longmotive.com), which appends a row to the
// enquiry sheet, files the CV in the HR-only Drive folder and sends the
// WhatsApp alert to whoever the routing sheet names.
//
// Both settings are optional. Without APPS_SCRIPT_URL and WEB_KEY (a Pages
// secret) nothing is sent, so a preview build or a fork never posts into the
// company's records. A failure here is logged and never blocks the email or
// the visitor's confirmation.
export function workspacePayload(data, key) {
  return {
    key,
    form: data.formType,
    salutation: data.salutation,
    name: data.name,
    phone: data.contact,
    email: data.email,
    subject: data.subject,
    message: data.message,
    position: data.jobTitle,
    page: data.page,
    ...(data.cv ? { cv_base64: data.cv.content, cv_name: data.cv.filename, cv_type: data.cv.type } : {}),
  };
}

async function sendToWorkspace(env, data) {
  if (!env.APPS_SCRIPT_URL || !env.WEB_KEY) return;
  try {
    const response = await fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workspacePayload(data, env.WEB_KEY)),
    });
    const text = await response.text().catch(() => '');
    if (!response.ok || !/"ok"\s*:\s*true/.test(text)) {
      console.error('Workspace copy failed:', response.status, text.slice(0, 300));
    }
  } catch (workspaceError) {
    console.error('Workspace copy error:', workspaceError);
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  const missingEnvironment = ['RESEND_API_KEY', 'CONTACT_FROM']
    .filter((name) => !env[name]);
  if (missingEnvironment.length > 0) {
    console.error('Missing contact-form environment variables:', missingEnvironment.join(', '));
    return json({ ok: false, error: 'Server not configured' }, 500);
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'Invalid form data' }, 400);
  }

  const formType = field(formData, 'formType');
  if (!['enquiry', 'careers'].includes(formType)) {
    return json({ ok: false, error: 'Invalid form type' }, 400);
  }

  // Honeypot: real users never fill this hidden field.
  if (field(formData, 'website')) return json({ ok: true });

  const salutation = field(formData, 'salutation');
  const name = field(formData, 'name');
  const contact = field(formData, 'contact');
  const email = field(formData, 'email');
  const subject = field(formData, 'subject');
  const message = field(formData, 'message');
  const jobTitle = field(formData, 'jobTitle');
  const isCareers = formType === 'careers';
  const cv = isCareers ? formData.get('cv') : null;
  const hasCv = cv instanceof File && cv.size > 0;

  const errors = [];
  if (!name) errors.push('Name is required');
  if (!/^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.com$/i.test(email)) errors.push('A valid .com email address is required');
  if (name.length > 120) errors.push('Name is too long');
  if (email.length > 254) errors.push('Email is too long');
  if (!contact) errors.push('Contact No. is required');
  if (contact.length > 60) errors.push('Contact No. is too long');

  if (isCareers) {
    if (!salutation) errors.push('Salutation is required');
    if (!jobTitle) errors.push('Position / Area of Interest is required');
    if (jobTitle.length > 120) errors.push('Position / Area of Interest is too long');
    if (salutation.length > 20) errors.push('Salutation is too long');
    // An application with no CV attached is not one the team can act on.
    if (!hasCv) errors.push('CV is required');
  } else {
    if (!subject) errors.push('Subject is required');
    if (!message) errors.push('Message is required');
    if (subject.length > 200) errors.push('Subject is too long');
    if (message.length > 5000) errors.push('Message is too long');
  }

  let attachment = null;
  let cvBuffer = null;
  if (isCareers && hasCv) {
    if (cv.size > MAX_FILE_SIZE) {
      errors.push('CV file must be under 5MB');
    } else if (!ALLOWED_TYPES[cv.type]) {
      errors.push('CV must be PDF, DOC, or DOCX');
    } else {
      const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5 _-]/g, '').slice(0, 50) || 'applicant';
      cvBuffer = await cv.arrayBuffer();
      attachment = {
        filename: `CV_${safeName}${ALLOWED_TYPES[cv.type]}`,
        content: bufferToBase64(cvBuffer),
      };
    }
  }

  if (errors.length > 0) {
    return json({ ok: false, error: errors.join('; ') }, 400);
  }

  // Archive CV to R2 (non-blocking: email still sends if storage fails)
  let storedKey = null;
  if (attachment && cvBuffer && env.CV_BUCKET) {
    try {
      const date = new Date().toISOString().slice(0, 10);
      storedKey = `cv/${date}/${Date.now()}_${attachment.filename}`;
      await env.CV_BUCKET.put(storedKey, cvBuffer, {
        httpMetadata: { contentType: cv.type },
        customMetadata: { name, email, jobTitle, contact },
      });
    } catch (storageError) {
      console.error('R2 storage error:', storageError);
      storedKey = null; // archiving failure must not block the email
    }
  }

  // Recorded before the email is attempted, so a Resend outage does not lose
  // the submission. waitUntil lets the visitor's reply go out without waiting.
  const workspaceCopy = sendToWorkspace(env, {
    formType, salutation, name, contact, email, subject, message, jobTitle,
    page: request.headers.get('Referer') || '',
    cv: attachment ? { content: attachment.content, filename: attachment.filename, type: cv.type } : null,
  });
  if (typeof waitUntil === 'function') waitUntil(workspaceCopy);
  else await workspaceCopy;

  const emailHtml = isCareers
    ? `
      <h2>New Job Application — ${escapeHtml(jobTitle)}</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><b>Salutation</b></td><td>${escapeHtml(salutation || '-')}</td></tr>
        <tr><td><b>Name</b></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><b>Contact No.</b></td><td>${escapeHtml(contact)}</td></tr>
        <tr><td><b>Email</b></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><b>Position / Area of Interest</b></td><td>${escapeHtml(jobTitle)}</td></tr>
        <tr><td><b>CV</b></td><td>${attachment ? escapeHtml(attachment.filename) : 'Not attached'}</td></tr>
        <tr><td><b>Archived</b></td><td>${storedKey ? escapeHtml(storedKey) : '-'}</td></tr>
      </table>`
    : `
      <h2>New Business Enquiry</h2>
      <table cellpadding="6" style="border-collapse:collapse">
        <tr><td><b>Name</b></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><b>Email</b></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><b>Contact No.</b></td><td>${escapeHtml(contact || '-')}</td></tr>
        <tr><td><b>Subject</b></td><td>${escapeHtml(subject)}</td></tr>
      </table>
      <h3>Message</h3>
      <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`;

  const payload = {
    from: env.CONTACT_FROM,
    // Route by the validated form type, never a shared deployment recipient.
    to: [isCareers ? 'humanresource@longmotive.com' : 'info@longmotive.com'],
    // Hidden management copy of every message (bcc: the visible recipients do not see it).
    bcc: ['sjwong@longmotive.com'],
    reply_to: email,
    subject: isCareers
      ? `[Job Application] ${jobTitle} — ${name}`
      : `[Enquiry] ${subject} — ${name}`,
    html: `${emailHtml}<p style="color:#888;font-size:12px">Submitted via longmotive-m.com</p>`,
  };
  if (attachment) payload.attachments = [attachment];

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resendResponse.ok) {
    const detail = await resendResponse.text().catch(() => '');
    console.error('Resend error:', resendResponse.status, detail);
    return json({ ok: false, error: 'Failed to send. Please try again later.' }, 502);
  }

  return json({
    ok: true,
    message: isCareers ? 'Application submitted successfully' : 'Enquiry received',
  });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ ok: false, error: 'Method not allowed' }, 405);
}
