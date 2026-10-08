import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, zonedParts } from '../lib/time.js';
import { computeSlots } from '../lib/slots.js';
import { buildIcs } from '../lib/ics.js';

test('zonedToUtc handles fixed and DST zones', () => {
  assert.equal(new Date(zonedToUtc(2026, 10, 8, 9, 0, 'Asia/Kolkata')).toISOString(), '2026-10-08T03:30:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 7, 1, 9, 0, 'America/New_York')).toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 12, 1, 9, 0, 'America/New_York')).toISOString(), '2026-12-01T14:00:00.000Z');
  const p = zonedParts(Date.parse('2026-10-08T03:30:00Z'), 'Asia/Kolkata');
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], [2026, 10, 8, 9, 0]);
});

const base = {
  rules: [{ weekday: 4, start_min: 9 * 60, end_min: 12 * 60 }], // Thursday 9–12
  tz: 'Asia/Kolkata', duration: 30,
  fromMs: Date.parse('2026-10-08T00:00:00+05:30'), toMs: Date.parse('2026-10-09T00:00:00+05:30'),
};

test('generates slots inside working hours', () => {
  const slots = computeSlots(base);
  assert.equal(slots.length, 6);
  assert.equal(new Date(slots[0]).toISOString(), '2026-10-08T03:30:00.000Z');
  assert.equal(new Date(slots.at(-1)).toISOString(), '2026-10-08T06:00:00.000Z');
});

test('busy intervals and buffers remove slots', () => {
  const busy = [{ start: Date.parse('2026-10-08T10:00:00+05:30'), end: Date.parse('2026-10-08T11:00:00+05:30') }];
  assert.equal(computeSlots({ ...base, busy }).length, 4);
  // A 15-minute buffer after also blocks the 9:30 slot (ends 10:00 + 15 min).
  assert.equal(computeSlots({ ...base, busy, bufferAfter: 15 }).length, 3);
});

test('interval controls start-time increments', () => {
  assert.equal(computeSlots({ ...base, interval: 15 }).length, 11);
});

test('respects range bounds', () => {
  assert.equal(computeSlots({ ...base, fromMs: Date.parse('2026-10-08T11:00:00+05:30') }).length, 2);
  assert.equal(computeSlots({ ...base, rules: [] }).length, 0);
});

test('ics output is well formed', () => {
  const ics = buildIcs({ uid: 'abc', start: 0, end: 1800000, summary: 'Hi, there; test', description: 'line1\nline2' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Hi\\, there\; test/);
  assert.match(ics, /DESCRIPTION:line1\\nline2/);
});

test('suggestTimes spreads picks across days and honours period', async () => {
  const { suggestTimes } = await import('../lib/suggest.js');
  const tz = 'Asia/Kolkata';
  const now = Date.parse('2026-10-12T00:00:00+05:30'); // Monday
  const rules = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
  const candidates = computeSlots({ rules, tz, duration: 30, interval: 30, fromMs: now, toMs: now + 5 * 86400000 });
  const picks = suggestTimes({ candidates, tz, count: 3, period: 'any', duration: 30, now });
  assert.equal(picks.length, 3);
  const days = new Set(picks.map((ms) => zonedParts(ms, tz).day));
  assert.equal(days.size, 3, 'one pick per day');
  assert.equal(zonedParts(picks[0], tz).day, 12, 'starts with the soonest day');
  const morning = suggestTimes({ candidates, tz, count: 4, period: 'morning', duration: 30, now });
  assert.ok(morning.every((ms) => zonedParts(ms, tz).hour < 12));
  // back-to-back with a busy block is avoided when alternatives exist
  const busy = [{ start: Date.parse('2026-10-12T10:30:00+05:30'), end: Date.parse('2026-10-12T16:30:00+05:30') }];
  const free = candidates.filter((s) => !busy.some((b) => s < b.end && s + 1800000 > b.start));
  const one = suggestTimes({ candidates: free, busy, tz, count: 1, duration: 30, now });
  assert.notEqual(new Date(one[0]).toISOString(), '2026-10-12T05:00:00.000Z'); // 10:00 ends exactly when busy starts
});
