// Database: SQLite locally (a file), or a free hosted Turso database in production.
// Turso speaks SQLite, so the same SQL runs in both places.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
let url = remoteUrl;
if (!url) {
  const file = path.resolve(process.env.DATABASE_PATH || 'data/slotly.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  url = `file:${file}`;
}

export const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN });
export const isRemote = Boolean(remoteUrl);

const SCHEMA = `

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    picture TEXT,
    username TEXT UNIQUE NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    welcome TEXT NOT NULL DEFAULT 'Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.',
    onboarded INTEGER NOT NULL DEFAULT 0,
    conflict_calendars TEXT NOT NULL DEFAULT '["primary"]',
    access_token TEXT,
    refresh_token TEXT,
    token_expiry INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS event_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    duration INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location_type TEXT NOT NULL DEFAULT 'meet',
    location_value TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#8247f5',
    active INTEGER NOT NULL DEFAULT 1,
    buffer_before INTEGER NOT NULL DEFAULT 0,
    buffer_after INTEGER NOT NULL DEFAULT 0,
    min_notice INTEGER NOT NULL DEFAULT 240,
    max_days INTEGER NOT NULL DEFAULT 60,
    slot_interval INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE (user_id, slug)
  );

  CREATE TABLE IF NOT EXISTS availability (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type_id INTEGER REFERENCES event_types(id) ON DELETE SET NULL,
    event_name TEXT NOT NULL,
    event_slug TEXT NOT NULL,
    duration INTEGER NOT NULL,
    color TEXT NOT NULL,
    location_type TEXT NOT NULL,
    location_value TEXT NOT NULL DEFAULT '',
    invitee_name TEXT NOT NULL,
    invitee_email TEXT NOT NULL,
    invitee_phone TEXT NOT NULL DEFAULT '',
    invitee_tz TEXT NOT NULL,
    guests TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    cancel_reason TEXT NOT NULL DEFAULT '',
    cancelled_by TEXT NOT NULL DEFAULT '',
    google_event_id TEXT,
    google_link TEXT,
    meet_link TEXT,
    sync_error TEXT,
    proposal_id INTEGER,
    created_at INTEGER NOT NULL
  );

  -- One-off invite links: a set of hand-picked times sent to a specific customer.
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration INTEGER NOT NULL,
    location_type TEXT NOT NULL DEFAULT 'meet',
    location_value TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    times TEXT NOT NULL,
    single_use INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open',
    sent_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_proposals_user ON proposals (user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_bookings_user_time ON bookings (user_id, start_ms);
  CREATE INDEX IF NOT EXISTS idx_availability_user ON availability (user_id);
`;

let ready;
/** Creates tables on first use (each cold start), and upgrades older databases. */
export function init() {
  ready ||= (async () => {
    await db.executeMultiple(SCHEMA);
    await addColumn('users', 'scopes', "TEXT NOT NULL DEFAULT ''");
    await addColumn('bookings', 'proposal_id', 'INTEGER');
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

async function addColumn(table, column, definition) {
  const rs = await db.execute(`PRAGMA table_info(${table})`);
  const cols = rs.rows.map((r) => r.name);
  if (!cols.includes(column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));
const plain = (rs, row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]]));

async function exec(sql, args) {
  await init();
  return db.execute({ sql, args: clean(args) });
}

export async function get(sql, ...args) {
  const rs = await exec(sql, args);
  return rs.rows.length ? plain(rs, rs.rows[0]) : undefined;
}

export async function all(sql, ...args) {
  const rs = await exec(sql, args);
  return rs.rows.map((row) => plain(rs, row));
}

export async function run(sql, ...args) {
  const rs = await exec(sql, args);
  return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? undefined : Number(rs.lastInsertRowid) };
}

/** Runs several statements atomically: batch([[sql, ...args], ...]). */
export async function batch(statements) {
  await init();
  await db.batch(statements.map(([sql, ...args]) => ({ sql, args: clean(args) })), 'write');
}
