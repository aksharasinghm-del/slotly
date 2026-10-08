// Minimal Google OAuth + Calendar API client using fetch.
import { run } from './db.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const API = 'https://www.googleapis.com/calendar/v3';

export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const canSendEmail = (user) => Boolean(user.refresh_token) && String(user.scopes || '').includes(GMAIL_SCOPE);

export const enabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function authUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token error: ${data.error}: ${data.error_description || ''}`);
  return data;
}

export const exchangeCode = (code, redirectUri) =>
  tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });

export async function userInfo(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google userinfo error: ${res.status}`);
  return res.json();
}

async function accessToken(user) {
  if (user.access_token && user.token_expiry && user.token_expiry > Date.now() + 60000) return user.access_token;
  if (!user.refresh_token) throw new Error('Google Calendar is not connected');
  let data;
  try {
    data = await tokenRequest({ refresh_token: user.refresh_token, grant_type: 'refresh_token' });
  } catch (err) {
    // Google revoked or expired the grant: forget it so the dashboard asks the host to reconnect.
    if (/invalid_grant|expired or revoked/i.test(err.message)) {
      user.refresh_token = null;
      await run('UPDATE users SET refresh_token = NULL, access_token = NULL WHERE id = ?', user.id);
    }
    throw err;
  }
  user.access_token = data.access_token;
  user.token_expiry = Date.now() + data.expires_in * 1000;
  await run('UPDATE users SET access_token = ?, token_expiry = ? WHERE id = ?', user.access_token, user.token_expiry, user.id);
  return user.access_token;
}

async function call(user, method, path, body) {
  const token = await accessToken(user);
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // An event already removed on Google's side is fine to treat as deleted.
    if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return null;
    throw new Error(`Google Calendar ${method} ${path} failed: ${data?.error?.message || res.status}`);
  }
  return data;
}

export async function listCalendars(user) {
  const data = await call(user, 'GET', '/users/me/calendarList?minAccessRole=reader');
  return (data.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: Boolean(c.primary), color: c.backgroundColor }));
}

/** Busy intervals across the user's conflict calendars. */
export async function freeBusy(user, fromMs, toMs) {
  let ids;
  try { ids = JSON.parse(user.conflict_calendars); } catch { ids = ['primary']; }
  if (!ids.length) return [];
  const data = await call(user, 'POST', '/freeBusy', {
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    items: ids.map((id) => ({ id })),
  });
  const busy = [];
  for (const cal of Object.values(data.calendars || {})) {
    for (const b of cal.busy || []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return busy;
}

/** Creates the event on the host's primary calendar; Google emails the invites (sendUpdates=all). */
export function createEvent(user, event) {
  return call(user, 'POST', '/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1', event);
}

export function patchEvent(user, eventId, patch) {
  return call(user, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, patch);
}

export function deleteEvent(user, eventId) {
  return call(user, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`);
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const encodeHeader = (s) => `=?UTF-8?B?${Buffer.from(String(s), 'utf8').toString('base64')}?=`;

/** Sends an email from the host's own Gmail account. `to` must already be validated. */
export async function sendEmail(user, { to, subject, html, text }) {
  const boundary = `slotly-${Date.now().toString(36)}`;
  const mime = [
    `From: ${encodeHeader(user.name)} <${user.email}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html),
    `--${boundary}--`, '',
  ].join('\r\n');
  const token = await accessToken(user);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gmail send failed: ${data?.error?.message || res.status}`);
  return data;
}
