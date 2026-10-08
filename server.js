import express from 'express';
import cookieSession from 'cookie-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all, run, batch, isRemote } from './lib/db.js';
import { renderPage } from './lib/pages.js';
import * as google from './lib/google.js';
import { computeSlots } from './lib/slots.js';
import { buildIcs } from './lib/ics.js';
import { isValidTimeZone, zonedParts, zonedToUtc } from './lib/time.js';
import { suggestTimes } from './lib/suggest.js';
import { inviteEmail, accessRequestEmail, accessApprovedEmail } from './lib/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  || `http://localhost:${PORT}`).replace(/\/$/, '');
// Optional comma-separated list of Google accounts allowed to sign in as hosts.
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
// With an allow-list set, the site is invite-only: those emails are admins, everyone else must request access.
const INVITE_ONLY = ALLOWED_EMAILS.length > 0;
const isAdmin = (u) => !INVITE_ONLY || ALLOWED_EMAILS.includes(String(u.email).toLowerCase());
const APP_NAME = process.env.APP_NAME || 'Slotly';
const DEMO = !google.enabled();
const REDIRECT_URI = `${BASE_URL}/auth/google/callback`;

const RESERVED = new Set(['app', 'api', 'auth', 'booking', 'p', 'css', 'js', 'img', 'assets', 'login', 'logout',
  'signup', 'admin', 'settings', 'help', 'privacy', 'terms', 'request-access', 'favicon.ico', 'robots.txt', 'about', 'pricing']);
const LOCATION_TYPES = ['meet', 'phone', 'in_person', 'custom'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cookie signing key. Falls back to one derived from the Google client secret so there's one less setting to configure.
const SESSION_SECRET = process.env.SESSION_SECRET
  || (process.env.GOOGLE_CLIENT_SECRET && crypto.createHash('sha256').update(`slotly-session:${process.env.GOOGLE_CLIENT_SECRET}`).digest('hex'))
  || 'dev-only-secret';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(cookieSession({
  name: 'slotly',
  keys: [SESSION_SECRET],
  maxAge: 30 * 24 * 3600 * 1000,
  sameSite: 'lax',
  secure: BASE_URL.startsWith('https://'),
  httpOnly: true,
}));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
  .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function uniqueUsername(base) {
  let name = slugify(base).replace(/[^a-z0-9-]/g, '') || 'user';
  if (name.length < 3) name = `${name}-cal`;
  let candidate = name, n = 1;
  while (RESERVED.has(candidate) || await get('SELECT 1 FROM users WHERE username = ?', candidate)) candidate = `${name}-${++n}`;
  return candidate;
}

async function uniqueSlug(userId, base, exceptId = 0) {
  const name = slugify(base) || 'meeting';
  let candidate = name, n = 1;
  while (await get('SELECT 1 FROM event_types WHERE user_id = ? AND slug = ? AND id != ?', userId, candidate, exceptId)) candidate = `${name}-${++n}`;
  return candidate;
}

async function currentUser(req) {
  return req.session?.uid ? await get('SELECT * FROM users WHERE id = ?', req.session.uid) : null;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

const publicUser = (u) => ({ name: u.name, username: u.username, picture: u.picture, timezone: u.timezone, welcome: u.welcome });

function serializeEventType(e) {
  return {
    id: e.id, name: e.name, slug: e.slug, duration: e.duration, description: e.description,
    locationType: e.location_type, locationValue: e.location_value, color: e.color, active: Boolean(e.active),
    bufferBefore: e.buffer_before, bufferAfter: e.buffer_after, minNotice: e.min_notice, maxDays: e.max_days,
    slotInterval: e.slot_interval,
  };
}

function serializeBooking(b, { host = false } = {}) {
  const out = {
    uid: b.uid, eventName: b.event_name, eventSlug: b.event_slug, duration: b.duration, color: b.color,
    locationType: b.location_type, locationValue: b.location_value,
    start: new Date(b.start_ms).toISOString(), end: new Date(b.end_ms).toISOString(),
    status: b.status, cancelReason: b.cancel_reason, cancelledBy: b.cancelled_by,
    inviteeName: b.invitee_name, inviteeEmail: b.invitee_email, inviteeTz: b.invitee_tz,
    meetLink: b.meet_link, synced: Boolean(b.google_event_id), fromInvite: Boolean(b.proposal_id),
  };
  if (host) Object.assign(out, {
    inviteePhone: b.invitee_phone, guests: JSON.parse(b.guests), notes: b.notes,
    googleLink: b.google_link, syncError: b.sync_error, createdAt: new Date(b.created_at).toISOString(),
  });
  return out;
}

function locationText(type, value, meetLink) {
  switch (type) {
    case 'meet': return meetLink || 'Google Meet';
    case 'phone': return value ? `Phone call: ${value}` : 'Phone call';
    case 'in_person': return value || 'In person';
    default: return value || '';
  }
}

function validateEventType(body, existing = {}) {
  const v = { ...existing };
  if (body.name !== undefined) {
    v.name = String(body.name).trim().slice(0, 100);
    if (!v.name) fail(400, 'Event name is required');
  }
  if (body.duration !== undefined) {
    v.duration = Number(body.duration);
    if (!Number.isInteger(v.duration) || v.duration < 5 || v.duration > 720) fail(400, 'Duration must be 5–720 minutes');
  }
  if (body.description !== undefined) v.description = String(body.description).slice(0, 5000);
  if (body.locationType !== undefined) {
    if (!LOCATION_TYPES.includes(body.locationType)) fail(400, 'Unknown location type');
    v.location_type = body.locationType;
  }
  if (body.locationValue !== undefined) v.location_value = String(body.locationValue).slice(0, 500);
  if (body.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(body.color)) fail(400, 'Invalid color');
    v.color = body.color;
  }
  if (body.active !== undefined) v.active = body.active ? 1 : 0;
  const ints = { bufferBefore: ['buffer_before', 0, 240], bufferAfter: ['buffer_after', 0, 240],
    minNotice: ['min_notice', 0, 60 * 24 * 60], maxDays: ['max_days', 1, 365] };
  for (const [key, [col, min, max]] of Object.entries(ints)) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < min || n > max) fail(400, `${key} must be between ${min} and ${max}`);
    v[col] = n;
  }
  if (body.slotInterval !== undefined) {
    const n = body.slotInterval === null || body.slotInterval === '' ? null : Number(body.slotInterval);
    if (n !== null && (!Number.isInteger(n) || n < 5 || n > 720)) fail(400, 'Slot interval must be 5–720 minutes');
    v.slot_interval = n;
  }
  return v;
}

async function createUser({ googleId, email, name, picture, tokens }) {
  const now = Date.now();
  const { lastInsertRowid } = await run(
      `INSERT INTO users (google_id, email, name, picture, username, access_token, refresh_token, token_expiry, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      googleId, email, name || email, picture || null, await uniqueUsername(email.split('@')[0]),
      tokens?.access_token || null, tokens?.refresh_token || null,
      tokens?.expires_in ? now + tokens.expires_in * 1000 : null, now);
  const id = lastInsertRowid;
  const defaults = [
    ['15 Minute Meeting', '15min', 15, '#0ae8f0'],
    ['30 Minute Meeting', '30min', 30, '#8247f5'],
    ['60 Minute Meeting', '60min', 60, '#ff4f00'],
  ];
  await batch([
    ...[1, 2, 3, 4, 5].map((weekday) => ['INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', id, weekday, 9 * 60, 17 * 60]),
    ...defaults.map(([n, slug, duration, color]) => ['INSERT INTO event_types (user_id, name, slug, duration, color, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, n, slug, duration, color, now]),
  ]);
  return get('SELECT * FROM users WHERE id = ?', id);
}

async function loadPublic(req) {
  const user = await get('SELECT * FROM users WHERE username = ?', String(req.params.username).toLowerCase());
  if (!user) fail(404, 'Page not found');
  let et = null;
  if (req.params.slug) {
    et = await get('SELECT * FROM event_types WHERE user_id = ? AND slug = ?', user.id, req.params.slug);
    if (!et) fail(404, 'Event not found');
  }
  return { user, et };
}

/** Busy intervals from confirmed bookings and the host's Google calendars. */
async function getBusy(user, rangeStart, rangeEnd, exclude = null) {
  const busy = (await all(`SELECT uid, start_ms AS start, end_ms AS end FROM bookings
                    WHERE user_id = ? AND status = 'confirmed' AND end_ms > ? AND start_ms < ?`, user.id, rangeStart, rangeEnd))
    .filter((b) => b.uid !== exclude?.uid);

  if (user.refresh_token) {
    try {
      for (const b of await google.freeBusy(user, rangeStart, rangeEnd)) {
        // When rescheduling, the booking's own calendar event should not block other times.
        if (exclude && b.start === exclude.start_ms && b.end === exclude.end_ms) continue;
        busy.push(b);
      }
    } catch (err) {
      console.error('freeBusy failed:', err.message);
    }
  }
  return busy;
}

async function availableSlots(user, et, fromMs, toMs, exclude = null) {
  const now = Date.now();
  fromMs = Math.max(fromMs, now + et.min_notice * 60000);
  toMs = Math.min(toMs, now + et.max_days * 86400000);
  if (toMs <= fromMs) return [];
  const pad = (et.buffer_before + et.buffer_after + et.duration) * 60000;
  const busy = await getBusy(user, fromMs - pad, toMs + pad, exclude);
  const rules = await all('SELECT weekday, start_min, end_min FROM availability WHERE user_id = ?', user.id);
  return computeSlots({
    rules, tz: user.timezone, duration: et.duration, interval: et.slot_interval,
    bufferBefore: et.buffer_before, bufferAfter: et.buffer_after, fromMs, toMs, busy,
  });
}

function googleEventBody(host, b) {
  const guests = JSON.parse(b.guests);
  const manage = `${BASE_URL}/booking/${b.uid}`;
  const description = [
    `Event: ${b.event_name}`,
    `Invitee: ${b.invitee_name} (${b.invitee_email})`,
    b.invitee_phone ? `Phone: ${b.invitee_phone}` : '',
    guests.length ? `Guests: ${guests.join(', ')}` : '',
    b.notes ? `\nNotes from ${b.invitee_name}:\n${b.notes}` : '',
    `\nNeed to make changes? Reschedule or cancel: ${manage}`,
    `\nScheduled with ${APP_NAME}`,
  ].filter(Boolean).join('\n');
  const event = {
    summary: `${b.event_name}: ${host.name} and ${b.invitee_name}`,
    description,
    start: { dateTime: new Date(b.start_ms).toISOString(), timeZone: host.timezone },
    end: { dateTime: new Date(b.end_ms).toISOString(), timeZone: host.timezone },
    attendees: [
      { email: b.invitee_email, displayName: b.invitee_name },
      ...guests.map((email) => ({ email })),
    ],
    reminders: { useDefault: true },
    guestsCanModify: false,
    source: { title: APP_NAME, url: manage },
  };
  if (b.location_type === 'meet') {
    event.conferenceData = { createRequest: { requestId: b.uid, conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  } else {
    const location = locationText(b.location_type, b.location_value);
    if (location) event.location = location;
  }
  return event;
}

async function syncCreate(host, booking) {
  if (!host.refresh_token) return booking;
  try {
    const ev = await google.createEvent(host, googleEventBody(host, booking));
    await run('UPDATE bookings SET google_event_id = ?, google_link = ?, meet_link = ?, sync_error = NULL WHERE id = ?',
      ev.id, ev.htmlLink || null, ev.hangoutLink || null, booking.id);
  } catch (err) {
    console.error('Google event create failed:', err.message);
    await run('UPDATE bookings SET sync_error = ? WHERE id = ?', err.message, booking.id);
  }
  return await get('SELECT * FROM bookings WHERE id = ?', booking.id);
}

async function cancelBooking(booking, reason, by) {
  if (booking.status !== 'confirmed') fail(400, 'This event is already canceled');
  await run(`UPDATE bookings SET status = 'cancelled', cancel_reason = ?, cancelled_by = ? WHERE id = ?`,
    String(reason || '').slice(0, 1000), by, booking.id);
  const host = await get('SELECT * FROM users WHERE id = ?', booking.user_id);
  if (host.refresh_token && booking.google_event_id) {
    try {
      await google.deleteEvent(host, booking.google_event_id);
    } catch (err) {
      console.error('Google event delete failed:', err.message);
    }
  }
  return await get('SELECT * FROM bookings WHERE id = ?', booking.id);
}

// ---------- invite-only access ----------

async function canSignIn(email) {
  if (!INVITE_ONLY) return true;
  const e = String(email || '').toLowerCase();
  if (ALLOWED_EMAILS.includes(e)) return true;
  if (await get(`SELECT 1 FROM access_requests WHERE lower(email) = ? AND status = 'approved'`, e)) return true;
  return Boolean(await get('SELECT 1 FROM users WHERE lower(email) = ?', e));
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only the site owner can do this' });
    next();
  });
}

/** Admin accounts that can send email from their Gmail (used for notifications). */
async function mailerAdmins() {
  if (!INVITE_ONLY) return [];
  const rows = await all(`SELECT * FROM users WHERE lower(email) IN (${ALLOWED_EMAILS.map(() => '?').join(',')})`, ...ALLOWED_EMAILS);
  return rows.filter((u) => google.canSendEmail(u));
}

const serializeRequest = (r) => ({
  id: r.id, name: r.name, email: r.email, company: r.company, purpose: r.purpose, message: r.message,
  status: r.status, createdAt: new Date(r.created_at).toISOString(),
});

app.post('/api/access-requests', wrap(async (req, res) => {
  const b = req.body;
  if (b.website) return res.json({ ok: true }); // honeypot field: bots fill it, people never see it
  const name = String(b.name || '').trim().slice(0, 200);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  if (!name) fail(400, 'Please enter your name');
  if (!EMAIL_RE.test(email)) fail(400, 'Please enter a valid email address');
  const fields = [String(b.company || '').trim().slice(0, 200), String(b.purpose || '').trim().slice(0, 200), String(b.message || '').trim().slice(0, 2000)];
  const existing = await get('SELECT * FROM access_requests WHERE lower(email) = ? ORDER BY id DESC', email);
  if (existing?.status === 'approved') return res.json({ ok: true, status: 'approved' });
  let request;
  if (existing?.status === 'pending') {
    await run('UPDATE access_requests SET name = ?, company = ?, purpose = ?, message = ? WHERE id = ?', name, ...fields, existing.id);
    return res.json({ ok: true, status: 'pending' }); // already notified once
  }
  const { lastInsertRowid } = await run(
    'INSERT INTO access_requests (name, email, company, purpose, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    name, email, ...fields, Date.now());
  request = await get('SELECT * FROM access_requests WHERE id = ?', lastInsertRowid);
  for (const admin of await mailerAdmins()) {
    try {
      await google.sendEmail(admin, { to: admin.email, ...accessRequestEmail({ request, reviewUrl: `${BASE_URL}/app/requests`, appName: APP_NAME }) });
    } catch (err) {
      console.error('Access request email failed:', err.message);
    }
  }
  res.status(201).json({ ok: true, status: 'pending' });
}));

app.get('/api/access-requests', requireAdmin, wrap(async (req, res) => {
  const rows = await all('SELECT * FROM access_requests ORDER BY (status = \'pending\') DESC, created_at DESC LIMIT 500');
  res.json({ requests: rows.map(serializeRequest), canSendEmail: google.canSendEmail(req.user) });
}));

app.post('/api/access-requests/:id/:decision', requireAdmin, wrap(async (req, res) => {
  const decision = { approve: 'approved', decline: 'declined' }[req.params.decision];
  if (!decision) fail(404, 'Unknown action');
  const r = await get('SELECT * FROM access_requests WHERE id = ?', req.params.id);
  if (!r) fail(404, 'Request not found');
  await run('UPDATE access_requests SET status = ?, decided_at = ? WHERE id = ?', decision, Date.now(), r.id);
  let emailed = false;
  if (decision === 'approved' && google.canSendEmail(req.user)) {
    try {
      await google.sendEmail(req.user, { to: r.email, ...accessApprovedEmail({ name: r.name, signInUrl: `${BASE_URL}/?home=1`, hostName: req.user.name, appName: APP_NAME }) });
      emailed = true;
    } catch (err) {
      console.error('Approval email failed:', err.message);
    }
  }
  res.json({ request: serializeRequest(await get('SELECT * FROM access_requests WHERE id = ?', r.id)), emailed });
}));

// ---------- auth ----------

app.get('/auth/google', wrap(async (req, res) => {
  if (DEMO) return res.redirect('/auth/demo');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.state = state;
  res.redirect(google.authUrl(state, REDIRECT_URI));
}));

app.get('/auth/google/callback', wrap(async (req, res) => {
  if (req.query.error) return res.redirect(`/?error=${encodeURIComponent(req.query.error)}`);
  if (!req.query.state || req.query.state !== req.session.state) return res.status(400).send('Invalid sign-in state. Please try again.');
  delete req.session.state;
  const tokens = await google.exchangeCode(String(req.query.code), REDIRECT_URI);
  const profile = await google.userInfo(tokens.access_token);
  if (!(await canSignIn(profile.email))) {
    const q = new URLSearchParams({ denied: '1', email: profile.email || '', name: profile.name || '' });
    return res.redirect(`/request-access?${q}`);
  }
  let user = await get('SELECT * FROM users WHERE google_id = ?', profile.sub);
  if (user) {
    await run(`UPDATE users SET email = ?, picture = ?, access_token = ?, token_expiry = ?,
         refresh_token = COALESCE(?, refresh_token), scopes = ? WHERE id = ?`,
      profile.email, profile.picture || null, tokens.access_token, Date.now() + tokens.expires_in * 1000,
      tokens.refresh_token || null, tokens.scope || '', user.id);
  } else {
    user = await createUser({ googleId: profile.sub, email: profile.email, name: profile.name, picture: profile.picture, tokens });
    await run('UPDATE users SET scopes = ? WHERE id = ?', tokens.scope || '', user.id);
  }
  req.session.uid = user.id;
  res.redirect('/app');
}));

app.get('/auth/demo', wrap(async (req, res) => {
  if (!DEMO) return res.status(404).send('Not found');
  const user = await get(`SELECT * FROM users WHERE google_id = 'demo'`) ||
    await createUser({ googleId: 'demo', email: 'demo@example.com', name: 'Demo User' });
  req.session.uid = user.id;
  res.redirect('/app');
}));

app.post('/auth/logout', wrap(async (req, res) => {
  req.session = null;
  res.json({ ok: true });
}));

// ---------- owner API ----------

// Plain-language status check: open /api/health in a browser after deploying.
app.get('/api/health', wrap(async (req, res) => {
  const status = {
    website: 'working',
    database: isRemote ? 'Turso (permanent storage)' : 'TEMPORARY local file — set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN',
    google: DEMO ? 'not connected yet (demo mode)' : 'Google sign-in configured',
    address: BASE_URL,
  };
  try {
    await get('SELECT 1 AS ok');
    status.databaseConnection = 'OK';
  } catch (err) {
    status.databaseConnection = `FAILED: ${err.message}`;
  }
  res.set('Cache-Control', 'no-store').json(status);
}));

app.get('/api/config', (req, res) => res.json({ appName: APP_NAME, demo: DEMO, baseUrl: BASE_URL, inviteOnly: INVITE_ONLY }));

app.get('/api/me', requireAuth, wrap(async (req, res) => {
  const u = req.user;
  res.json({
    user: {
      ...publicUser(u), email: u.email, onboarded: Boolean(u.onboarded),
      googleConnected: Boolean(u.refresh_token), canSendEmail: google.canSendEmail(u),
      isAdmin: INVITE_ONLY && isAdmin(u), conflictCalendars: JSON.parse(u.conflict_calendars),
    },
    demo: DEMO, appName: APP_NAME, baseUrl: BASE_URL, inviteOnly: INVITE_ONLY,
  });
}));

app.put('/api/me', requireAuth, wrap(async (req, res) => {
  const u = req.user, b = req.body;
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 100) : u.name;
  if (!name) fail(400, 'Name is required');
  let username = u.username;
  if (b.username !== undefined && b.username !== u.username) {
    username = String(b.username).toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(username)) fail(400, 'URL must be 3–40 characters: letters, numbers and dashes');
    if (RESERVED.has(username) || await get('SELECT 1 FROM users WHERE username = ? AND id != ?', username, u.id)) fail(409, 'That URL is already taken');
  }
  const timezone = b.timezone !== undefined ? b.timezone : u.timezone;
  if (!isValidTimeZone(timezone)) fail(400, 'Invalid time zone');
  const welcome = b.welcome !== undefined ? String(b.welcome).slice(0, 1000) : u.welcome;
  let calendars = u.conflict_calendars;
  if (b.conflictCalendars !== undefined) {
    if (!Array.isArray(b.conflictCalendars) || b.conflictCalendars.length > 50) fail(400, 'Invalid calendars');
    calendars = JSON.stringify(b.conflictCalendars.map(String));
  }
  const onboarded = b.onboarded ? 1 : u.onboarded;
  await run('UPDATE users SET name = ?, username = ?, timezone = ?, welcome = ?, conflict_calendars = ?, onboarded = ? WHERE id = ?',
    name, username, timezone, welcome, calendars, onboarded, u.id);
  res.json({ ok: true, username });
}));

app.get('/api/calendars', requireAuth, wrap(async (req, res) => {
  if (!req.user.refresh_token) return res.json({ calendars: [] });
  res.json({ calendars: await google.listCalendars(req.user) });
}));

app.get('/api/event-types', requireAuth, wrap(async (req, res) => {
  res.json({ eventTypes: (await all('SELECT * FROM event_types WHERE user_id = ? ORDER BY created_at, id', req.user.id)).map(serializeEventType) });
}));

app.post('/api/event-types', requireAuth, wrap(async (req, res) => {
  const v = validateEventType(req.body, {
    name: '', duration: 30, description: '', location_type: 'meet', location_value: '', color: '#8247f5', active: 1,
    buffer_before: 0, buffer_after: 0, min_notice: 240, max_days: 60, slot_interval: null,
  });
  if (!v.name) fail(400, 'Event name is required');
  const slug = await uniqueSlug(req.user.id, req.body.slug || v.name);
  const { lastInsertRowid } = await run(
    `INSERT INTO event_types (user_id, name, slug, duration, description, location_type, location_value, color, active,
       buffer_before, buffer_after, min_notice, max_days, slot_interval, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.user.id, v.name, slug, v.duration, v.description, v.location_type, v.location_value, v.color, v.active,
    v.buffer_before, v.buffer_after, v.min_notice, v.max_days, v.slot_interval, Date.now());
  res.status(201).json({ eventType: serializeEventType(await get('SELECT * FROM event_types WHERE id = ?', lastInsertRowid)) });
}));

app.put('/api/event-types/:id', requireAuth, wrap(async (req, res) => {
  const existing = await get('SELECT * FROM event_types WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!existing) fail(404, 'Event type not found');
  const v = validateEventType(req.body, existing);
  if (req.body.slug !== undefined && req.body.slug !== existing.slug) {
    const slug = slugify(req.body.slug);
    if (!slug) fail(400, 'Invalid URL');
    if (await get('SELECT 1 FROM event_types WHERE user_id = ? AND slug = ? AND id != ?', req.user.id, slug, existing.id)) fail(409, 'You already have an event with that URL');
    v.slug = slug;
  }
  await run(`UPDATE event_types SET name = ?, slug = ?, duration = ?, description = ?, location_type = ?, location_value = ?, color = ?,
         active = ?, buffer_before = ?, buffer_after = ?, min_notice = ?, max_days = ?, slot_interval = ? WHERE id = ?`,
    v.name, v.slug, v.duration, v.description, v.location_type, v.location_value, v.color, v.active,
    v.buffer_before, v.buffer_after, v.min_notice, v.max_days, v.slot_interval, existing.id);
  res.json({ eventType: serializeEventType(await get('SELECT * FROM event_types WHERE id = ?', existing.id)) });
}));

app.delete('/api/event-types/:id', requireAuth, wrap(async (req, res) => {
  const { changes } = await run('DELETE FROM event_types WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!changes) fail(404, 'Event type not found');
  res.json({ ok: true });
}));

const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};

app.get('/api/availability', requireAuth, wrap(async (req, res) => {
  const rules = (await all('SELECT weekday, start_min, end_min FROM availability WHERE user_id = ? ORDER BY weekday, start_min', req.user.id))
    .map((r) => ({ weekday: r.weekday, start: toHHMM(r.start_min), end: toHHMM(r.end_min) }));
  res.json({ timezone: req.user.timezone, rules });
}));

app.put('/api/availability', requireAuth, wrap(async (req, res) => {
  const { rules, timezone } = req.body;
  if (!Array.isArray(rules) || rules.length > 100) fail(400, 'Invalid availability');
  if (timezone !== undefined && !isValidTimeZone(timezone)) fail(400, 'Invalid time zone');
  const parsed = rules.map((r) => {
    const weekday = Number(r.weekday), start = fromHHMM(r.start), end = r.end === '24:00' ? 1440 : fromHHMM(r.end);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !(start >= 0) || !(end <= 1440) || !(end > start)) {
      fail(400, 'Each interval needs an end time after its start time');
    }
    return { weekday, start, end };
  });
  for (let d = 0; d < 7; d++) {
    const day = parsed.filter((r) => r.weekday === d).sort((a, b) => a.start - b.start);
    for (let i = 1; i < day.length; i++) if (day[i].start < day[i - 1].end) fail(400, 'Times overlap with another set of times');
  }
  await batch([
    ['DELETE FROM availability WHERE user_id = ?', req.user.id],
    ...parsed.map((r) => ['INSERT INTO availability (user_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)', req.user.id, r.weekday, r.start, r.end]),
    ...(timezone ? [['UPDATE users SET timezone = ? WHERE id = ?', timezone, req.user.id]] : []),
  ]);
  res.json({ ok: true });
}));

app.get('/api/bookings', requireAuth, wrap(async (req, res) => {
  const now = Date.now();
  const scope = req.query.scope || 'upcoming';
  const queries = {
    upcoming: [`status = 'confirmed' AND end_ms >= ? ORDER BY start_ms ASC`, now],
    past: [`status = 'confirmed' AND end_ms < ? ORDER BY start_ms DESC`, now],
    cancelled: [`status = 'cancelled' AND ? > 0 ORDER BY start_ms DESC`, 1],
  };
  const q = queries[scope];
  if (!q) fail(400, 'Unknown scope');
  const rows = await all(`SELECT * FROM bookings WHERE user_id = ? AND ${q[0]} LIMIT 500`, req.user.id, q[1]);
  res.json({ bookings: rows.map((b) => serializeBooking(b, { host: true })) });
}));

app.post('/api/bookings/:uid/cancel', requireAuth, wrap(async (req, res) => {
  const booking = await get('SELECT * FROM bookings WHERE uid = ? AND user_id = ?', req.params.uid, req.user.id);
  if (!booking) fail(404, 'Booking not found');
  const updated = await cancelBooking(booking, req.body.reason, 'host');
  res.json({ booking: serializeBooking(updated, { host: true }) });
}));

// ---------- public API ----------

app.get('/api/u/:username', wrap(async (req, res) => {
  const { user } = await loadPublic(req);
  const eventTypes = (await all('SELECT * FROM event_types WHERE user_id = ? AND active = 1 ORDER BY created_at, id', user.id)).map(serializeEventType);
  res.json({ user: publicUser(user), eventTypes });
}));

app.get('/api/u/:username/:slug', wrap(async (req, res) => {
  const { user, et } = await loadPublic(req);
  if (!et.active && (await currentUser(req))?.id !== user.id) fail(404, 'This event is not available');
  res.json({ user: publicUser(user), eventType: serializeEventType(et) });
}));

app.get('/api/u/:username/:slug/slots', wrap(async (req, res) => {
  const { user, et } = await loadPublic(req);
  if (!et.active) fail(404, 'This event is not available');
  const from = Date.parse(req.query.from), to = Date.parse(req.query.to);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from || to - from > 62 * 86400000) fail(400, 'Invalid range');
  let exclude = null;
  if (req.query.reschedule) exclude = await get(`SELECT * FROM bookings WHERE uid = ? AND user_id = ? AND status = 'confirmed'`, req.query.reschedule, user.id);
  const slots = await availableSlots(user, et, from, to, exclude);
  res.json({ timezone: user.timezone, slots: slots.map((ms) => new Date(ms).toISOString()) });
}));

app.post('/api/u/:username/:slug/book', wrap(async (req, res) => {
  const { user, et } = await loadPublic(req);
  if (!et.active) fail(404, 'This event is not available');
  const b = req.body;
  const { name, email, guests, phone, startMs, notes } = parseInvitee(b, et.location_type);
  const tz = isValidTimeZone(b.timezone) ? b.timezone : user.timezone;

  const slots = await availableSlots(user, et, startMs, startMs + 1);
  if (!slots.includes(startMs)) fail(409, 'Sorry, that time is no longer available. Please pick another time.');

  const uid = crypto.randomBytes(16).toString('hex');
  const { lastInsertRowid } = await run(
    `INSERT INTO bookings (uid, user_id, event_type_id, event_name, event_slug, duration, color, location_type, location_value,
       invitee_name, invitee_email, invitee_phone, invitee_tz, guests, notes, start_ms, end_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid, user.id, et.id, et.name, et.slug, et.duration, et.color, et.location_type,
    et.location_type === 'phone' ? phone : et.location_value,
    name, email, phone, tz, JSON.stringify(guests), notes,
    startMs, startMs + et.duration * 60000, Date.now());
  const booking = await syncCreate(user, await get('SELECT * FROM bookings WHERE id = ?', lastInsertRowid));
  res.status(201).json({ booking: serializeBooking(booking), invitesSent: Boolean(booking.google_event_id) });
}));

function parseInvitee(b, locationType) {
  const name = String(b.name || '').trim().slice(0, 200);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  if (!name) fail(400, 'Name is required');
  if (!EMAIL_RE.test(email)) fail(400, 'A valid email is required');
  const guests = [...new Set((Array.isArray(b.guests) ? b.guests : []).map((g) => String(g).trim().toLowerCase()).filter(Boolean))];
  if (guests.length > 10) fail(400, 'You can add up to 10 guests');
  for (const g of guests) if (!EMAIL_RE.test(g)) fail(400, `Invalid guest email: ${g}`);
  const phone = String(b.phone || '').trim().slice(0, 40);
  if (locationType === 'phone' && !phone) fail(400, 'Phone number is required');
  const startMs = Date.parse(b.start);
  if (Number.isNaN(startMs)) fail(400, 'Invalid time');
  return { name, email, guests, phone, startMs, notes: String(b.notes || '').slice(0, 5000) };
}

async function loadBooking(uid) {
  const booking = await get('SELECT * FROM bookings WHERE uid = ?', String(uid));
  if (!booking) fail(404, 'Booking not found');
  return { booking, host: await get('SELECT * FROM users WHERE id = ?', booking.user_id) };
}

app.get('/api/b/:uid', wrap(async (req, res) => {
  const { booking, host } = await loadBooking(req.params.uid);
  const upcoming = booking.status === 'confirmed' && booking.start_ms > Date.now();
  let canReschedule = false, rescheduleUrl = null;
  if (booking.proposal_id) {
    const p = await get('SELECT * FROM proposals WHERE id = ?', booking.proposal_id);
    canReschedule = upcoming && p?.status === 'open';
    if (canReschedule) rescheduleUrl = `/p/${p.token}?reschedule=${booking.uid}`;
  } else {
    const et = booking.event_type_id ? await get('SELECT * FROM event_types WHERE id = ?', booking.event_type_id) : null;
    canReschedule = upcoming && Boolean(et?.active);
    if (canReschedule) rescheduleUrl = `/${host.username}/${et.slug}?reschedule=${booking.uid}`;
  }
  res.json({ booking: serializeBooking(booking), host: publicUser(host), canReschedule, rescheduleUrl });
}));

app.post('/api/b/:uid/cancel', wrap(async (req, res) => {
  const { booking } = await loadBooking(req.params.uid);
  if (booking.start_ms < Date.now()) fail(400, 'This event has already happened');
  const updated = await cancelBooking(booking, req.body.reason, 'invitee');
  res.json({ booking: serializeBooking(updated) });
}));

app.post('/api/b/:uid/reschedule', wrap(async (req, res) => {
  const { booking, host } = await loadBooking(req.params.uid);
  if (booking.status !== 'confirmed') fail(400, 'This event was canceled');
  const startMs = Date.parse(req.body.start);
  if (Number.isNaN(startMs)) fail(400, 'Invalid time');
  let ok;
  if (booking.proposal_id) {
    const p = await get('SELECT * FROM proposals WHERE id = ?', booking.proposal_id);
    if (!p || p.status !== 'open') fail(400, 'This event can no longer be rescheduled');
    ok = (await openProposalTimes(host, p, booking)).includes(startMs);
  } else {
    const et = booking.event_type_id ? await get('SELECT * FROM event_types WHERE id = ?', booking.event_type_id) : null;
    if (!et?.active) fail(400, 'This event can no longer be rescheduled');
    ok = (await availableSlots(host, et, startMs, startMs + 1, booking)).includes(startMs);
  }
  if (!ok) fail(409, 'Sorry, that time is no longer available. Please pick another time.');
  const endMs = startMs + booking.duration * 60000;
  await run('UPDATE bookings SET start_ms = ?, end_ms = ? WHERE id = ?', startMs, endMs, booking.id);
  let updated = await get('SELECT * FROM bookings WHERE id = ?', booking.id);
  if (host.refresh_token && booking.google_event_id) {
    try {
      await google.patchEvent(host, booking.google_event_id, {
        start: { dateTime: new Date(startMs).toISOString(), timeZone: host.timezone },
        end: { dateTime: new Date(endMs).toISOString(), timeZone: host.timezone },
      });
    } catch (err) {
      console.error('Google event update failed:', err.message);
      await run('UPDATE bookings SET sync_error = ? WHERE id = ?', err.message, booking.id);
    }
  } else {
    updated = await syncCreate(host, updated);
  }
  res.json({ booking: serializeBooking(updated) });
}));

app.get('/api/b/:uid/ics', wrap(async (req, res) => {
  const { booking: b, host } = await loadBooking(req.params.uid);
  const ics = buildIcs({
    uid: b.uid, start: b.start_ms, end: b.end_ms,
    summary: `${b.event_name} with ${host.name}`,
    description: `${b.notes ? `${b.notes}\n\n` : ''}Manage: ${BASE_URL}/booking/${b.uid}`,
    location: locationText(b.location_type, b.location_value, b.meet_link),
    organizerName: host.name, organizerEmail: host.email, url: `${BASE_URL}/booking/${b.uid}`,
    cancelled: b.status === 'cancelled',
  });
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${b.event_slug}.ics"`);
  res.send(ics);
}));

// ---------- invite links (hand-picked times for one customer) ----------

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const parseLocal = (s, tz) => {
  const m = LOCAL_RE.exec(String(s));
  if (!m) fail(400, `Invalid time: ${s}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) fail(400, `Invalid time: ${s}`);
  return zonedToUtc(y, mo, d, h, mi, tz);
};
const toLocal = (ms, tz) => {
  const p = zonedParts(ms, tz);
  const z = (n) => String(n).padStart(2, '0');
  return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
};
const parseDuration = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 5 || n > 720) fail(400, 'Duration must be 5–720 minutes');
  return n;
};

async function workingRules(userId) {
  const rules = await all('SELECT weekday, start_min, end_min FROM availability WHERE user_id = ?', userId);
  return rules.length ? rules : [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
}

function inWorkingHours(rules, ms, duration, tz) {
  const p = zonedParts(ms, tz);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const start = p.hour * 60 + p.minute;
  return rules.some((r) => r.weekday === weekday && start >= r.start_min && start + duration <= r.end_min);
}

/** Annotates times with busy / outside-hours / past flags so the host can see conflicts before sending. */
async function describeTimes(user, starts, duration) {
  if (!starts.length) return [];
  const dur = duration * 60000;
  const busy = await getBusy(user, Math.min(...starts), Math.max(...starts) + dur);
  const rules = await workingRules(user.id);
  const now = Date.now();
  return starts.map((start) => ({
    local: toLocal(start, user.timezone),
    start: new Date(start).toISOString(),
    busy: busy.some((b) => start < b.end && start + dur > b.start),
    inHours: inWorkingHours(rules, start, duration, user.timezone),
    past: start <= now,
  }));
}

app.get('/api/day-times', requireAuth, wrap(async (req, res) => {
  const duration = parseDuration(req.query.duration || 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date))) fail(400, 'Invalid date');
  const starts = [];
  for (let m = 6 * 60; m + duration <= 22 * 60; m += 30) {
    starts.push(parseLocal(`${req.query.date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, req.user.timezone));
  }
  res.json({ timezone: req.user.timezone, times: await describeTimes(req.user, starts, duration) });
}));

app.post('/api/check-times', requireAuth, wrap(async (req, res) => {
  const duration = parseDuration(req.body.duration);
  const list = Array.isArray(req.body.times) ? req.body.times.slice(0, 60) : fail(400, 'times must be a list');
  res.json({ times: await describeTimes(req.user, list.map((t) => parseLocal(t, req.user.timezone)), duration) });
}));

app.post('/api/suggest', requireAuth, wrap(async (req, res) => {
  const duration = parseDuration(req.body.duration || 30);
  const count = Math.min(Math.max(Number(req.body.count) || 3, 1), 10);
  const days = Math.min(Math.max(Number(req.body.days) || 7, 1), 60);
  const period = ['any', 'morning', 'afternoon', 'evening'].includes(req.body.period) ? req.body.period : 'any';
  const exclude = new Set((Array.isArray(req.body.exclude) ? req.body.exclude : []).map(String));
  const now = Date.now();
  const fromMs = now + 60 * 60000, toMs = now + days * 86400000;
  const busy = await getBusy(req.user, fromMs - 86400000, toMs + 86400000);
  let rules = await workingRules(req.user.id);
  // Evening requests may fall outside working hours; widen the window so there's something to suggest.
  if (period === 'evening') rules = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start_min: 17 * 60, end_min: 21 * 60 }));
  const candidates = computeSlots({ rules, tz: req.user.timezone, duration, interval: 30, fromMs, toMs, busy })
    .filter((ms) => !exclude.has(toLocal(ms, req.user.timezone)));
  const picks = suggestTimes({ candidates, busy, tz: req.user.timezone, count, period, duration, now });
  res.json({ times: await describeTimes(req.user, picks, duration) });
}));

async function serializeProposal(p, { host = false } = {}) {
  const times = JSON.parse(p.times);
  const out = {
    token: p.token, url: `${BASE_URL}/p/${p.token}`, title: p.title, duration: p.duration,
    locationType: p.location_type, locationValue: p.location_value, note: p.note,
    customerName: p.customer_name, customerEmail: p.customer_email, singleUse: Boolean(p.single_use),
  };
  if (host) {
    const bookings = await all(`SELECT * FROM bookings WHERE proposal_id = ? AND status = 'confirmed' ORDER BY start_ms`, p.id);
    const now = Date.now();
    let status = p.status;
    if (status === 'open' && p.single_use && bookings.length) status = 'booked';
    else if (status === 'open' && times.every((t) => t <= now)) status = 'expired';
    Object.assign(out, {
      id: p.id, status, times: times.map((t) => new Date(t).toISOString()),
      sentAt: p.sent_at ? new Date(p.sent_at).toISOString() : null, createdAt: new Date(p.created_at).toISOString(),
      bookings: bookings.map((b) => ({ uid: b.uid, start: new Date(b.start_ms).toISOString(), inviteeName: b.invitee_name, inviteeEmail: b.invitee_email })),
    });
  }
  return out;
}

/** Proposal times that can still be booked right now. */
async function openProposalTimes(user, p, exclude = null) {
  if (p.status !== 'open') return [];
  if (p.single_use && !exclude && await get(`SELECT 1 FROM bookings WHERE proposal_id = ? AND status = 'confirmed'`, p.id)) return [];
  const now = Date.now();
  const times = JSON.parse(p.times).filter((t) => t > now);
  if (!times.length) return [];
  const dur = p.duration * 60000;
  const busy = await getBusy(user, times[0], times[times.length - 1] + dur, exclude);
  return times.filter((t) => !busy.some((b) => t < b.end && t + dur > b.start));
}

app.post('/api/proposals', requireAuth, wrap(async (req, res) => {
  const b = req.body, u = req.user;
  const duration = parseDuration(b.duration);
  const title = String(b.title || '').trim().slice(0, 100) || 'Meeting';
  if (b.locationType !== undefined && !LOCATION_TYPES.includes(b.locationType)) fail(400, 'Unknown location type');
  const customerEmail = String(b.customerEmail || '').trim().toLowerCase();
  if (customerEmail && !EMAIL_RE.test(customerEmail)) fail(400, 'Customer email looks invalid');
  if (!Array.isArray(b.times) || !b.times.length) fail(400, 'Pick at least one time');
  if (b.times.length > 30) fail(400, 'You can offer up to 30 times');
  const now = Date.now();
  const times = [...new Set(b.times.map((t) => parseLocal(t, u.timezone)))].sort((x, y) => x - y);
  if (times.some((t) => t <= now)) fail(400, 'One of the times is in the past');
  const token = crypto.randomBytes(12).toString('base64url');
  const { lastInsertRowid } = await run(
    `INSERT INTO proposals (token, user_id, title, duration, location_type, location_value, note, customer_name, customer_email, times, single_use, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    token, u.id, title, duration, b.locationType || 'meet', String(b.locationValue || '').slice(0, 500), String(b.note || '').slice(0, 2000),
    String(b.customerName || '').trim().slice(0, 200), customerEmail, JSON.stringify(times), b.singleUse === false ? 0 : 1, now);
  res.status(201).json({ proposal: await serializeProposal(await get('SELECT * FROM proposals WHERE id = ?', lastInsertRowid), { host: true }) });
}));

app.get('/api/proposals', requireAuth, wrap(async (req, res) => {
  const rows = await all('SELECT * FROM proposals WHERE user_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id);
  res.json({ proposals: await Promise.all(rows.map((p) => serializeProposal(p, { host: true }))), canSendEmail: google.canSendEmail(req.user) });
}));

app.delete('/api/proposals/:id', requireAuth, wrap(async (req, res) => {
  const { changes } = await run(`UPDATE proposals SET status = 'cancelled' WHERE id = ? AND user_id = ?`, req.params.id, req.user.id);
  if (!changes) fail(404, 'Invite link not found');
  res.json({ ok: true });
}));

app.post('/api/proposals/:id/send', requireAuth, wrap(async (req, res) => {
  const p = await get('SELECT * FROM proposals WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!p) fail(404, 'Invite link not found');
  if (!google.canSendEmail(req.user)) fail(400, 'Reconnect Google to send emails from your Gmail.');
  const to = String(req.body.to || p.customer_email).trim().toLowerCase();
  if (!EMAIL_RE.test(to)) fail(400, 'Enter a valid customer email');
  const times = await openProposalTimes(req.user, p);
  if (!times.length) fail(400, 'None of the times in this link are still available');
  const email = inviteEmail({ host: req.user, proposal: p, times, url: `${BASE_URL}/p/${p.token}`, appName: APP_NAME });
  await google.sendEmail(req.user, { to, ...email });
  await run('UPDATE proposals SET sent_at = ?, customer_email = ? WHERE id = ?', Date.now(), to, p.id);
  res.json({ ok: true });
}));

async function loadProposal(token) {
  const p = await get('SELECT * FROM proposals WHERE token = ?', String(token));
  if (!p) fail(404, 'This link is not valid');
  return { p, host: await get('SELECT * FROM users WHERE id = ?', p.user_id) };
}

app.get('/api/p/:token', wrap(async (req, res) => {
  const { p, host } = await loadProposal(req.params.token);
  let exclude = null;
  if (req.query.reschedule) exclude = await get(`SELECT * FROM bookings WHERE uid = ? AND proposal_id = ? AND status = 'confirmed'`, String(req.query.reschedule), p.id);
  const times = await openProposalTimes(host, p, exclude);
  let status = p.status === 'cancelled' ? 'cancelled' : 'open';
  if (status === 'open' && !times.length) {
    status = p.single_use && !exclude && await get(`SELECT 1 FROM bookings WHERE proposal_id = ? AND status = 'confirmed'`, p.id) ? 'booked' : 'unavailable';
  }
  res.json({ host: publicUser(host), proposal: await serializeProposal(p), status, times: times.map((t) => new Date(t).toISOString()) });
}));

app.post('/api/p/:token/book', wrap(async (req, res) => {
  const { p, host } = await loadProposal(req.params.token);
  const v = parseInvitee(req.body, p.location_type);
  const tz = isValidTimeZone(req.body.timezone) ? req.body.timezone : host.timezone;
  if (!(await openProposalTimes(host, p)).includes(v.startMs)) fail(409, 'Sorry, that time is no longer available. Please pick another time.');
  const uid = crypto.randomBytes(16).toString('hex');
  const { lastInsertRowid } = await run(
    `INSERT INTO bookings (uid, user_id, proposal_id, event_name, event_slug, duration, color, location_type, location_value,
       invitee_name, invitee_email, invitee_phone, invitee_tz, guests, notes, start_ms, end_ms, created_at)
     VALUES (?, ?, ?, ?, '', ?, '#006bff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid, host.id, p.id, p.title, p.duration, p.location_type, p.location_type === 'phone' ? v.phone : p.location_value,
    v.name, v.email, v.phone, tz, JSON.stringify(v.guests), v.notes, v.startMs, v.startMs + p.duration * 60000, Date.now());
  const booking = await syncCreate(host, await get('SELECT * FROM bookings WHERE id = ?', lastInsertRowid));
  res.status(201).json({ booking: serializeBooking(booking), invitesSent: Boolean(booking.google_event_id) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- pages ----------

const page = (name, status = 200) => (req, res) => res.status(status).type('html').set('Cache-Control', 'no-cache').send(renderPage(name));
app.get('/', wrap(async (req, res, next) => ((await currentUser(req)) && !req.query.home ? res.redirect('/app') : next())), page('index'));
app.get('/privacy', page('privacy'));
app.get('/request-access', page('request'));
app.get(['/app', '/app/*'], page('app'));
app.get('/booking/:uid', page('manage'));
app.get('/p/:token', page('invite'));
app.get('/:username', (req, res, next) => (RESERVED.has(req.params.username) ? next() : page('profile')(req, res)));
app.get('/:username/:slug', (req, res, next) => (RESERVED.has(req.params.username) ? next() : page('book')(req, res)));
app.use(page('404', 404));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) return next(err);
  const message = status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  if (req.path.startsWith('/api/')) res.status(status).json({ error: message });
  else res.status(status).send(message);
});

// On Vercel the platform imports the app; everywhere else we start a server.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`${APP_NAME} running at ${BASE_URL}`);
    if (DEMO) console.log('Demo mode: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in and Calendar sync.');
  });
}

export default app;
