import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_PATH || path.resolve('data/slotly.db');
if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

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
`);

// Lightweight migrations for databases created by older versions.
function addColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'scopes', "TEXT NOT NULL DEFAULT ''");
addColumn('bookings', 'proposal_id', 'INTEGER REFERENCES proposals(id) ON DELETE SET NULL');

export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
