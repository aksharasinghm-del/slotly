import { zonedParts, zonedToUtc } from './time.js';

const DAY = 86400000;

/**
 * Bookable slot start times (UTC ms) in [fromMs, toMs).
 * rules: [{ weekday 0-6, start_min, end_min }] in the host's timezone.
 * busy:  [{ start, end }] UTC ms intervals that block time.
 */
export function computeSlots({ rules, tz, duration, interval, bufferBefore = 0, bufferAfter = 0, fromMs, toMs, busy = [] }) {
  if (toMs <= fromMs || !rules.length) return [];
  const dur = duration * 60000;
  const before = bufferBefore * 60000;
  const after = bufferAfter * 60000;
  const step = interval || duration;
  const out = new Set();

  const first = zonedParts(fromMs - DAY, tz);
  const last = zonedParts(toMs + DAY, tz);
  const endDay = Date.UTC(last.year, last.month - 1, last.day);

  for (let cursor = Date.UTC(first.year, first.month - 1, first.day); cursor <= endDay; cursor += DAY) {
    const d = new Date(cursor);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate(), weekday = d.getUTCDay();
    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      for (let t = rule.start_min; t + duration <= rule.end_min; t += step) {
        const start = zonedToUtc(y, m, day, Math.floor(t / 60), t % 60, tz);
        if (start < fromMs || start >= toMs) continue;
        const end = start + dur;
        if (busy.some((b) => start - before < b.end && end + after > b.start)) continue;
        out.add(start);
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}
