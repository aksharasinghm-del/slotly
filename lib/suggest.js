import { zonedParts } from './time.js';

const DAY = 86400000;
const MIN = 60000;

const dayNumber = (ms, tz) => {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day) / DAY;
};

/**
 * Picks the "best" few meeting times from candidate slots.
 * Prefers the requested part of the day, sooner days, round start times,
 * breathing room around existing meetings, and spreads picks across days.
 */
export function suggestTimes({ candidates, busy = [], tz, count = 3, period = 'any', duration, now = Date.now() }) {
  const today = dayNumber(now, tz);
  const dur = duration * MIN;
  const scored = candidates.map((start) => {
    const p = zonedParts(start, tz);
    const hour = p.hour + p.minute / 60;
    const day = dayNumber(start, tz);
    let score = 0;

    if (period === 'morning') score += hour < 12 ? 4 : -4;
    else if (period === 'afternoon') score += hour >= 12 && hour < 17 ? 4 : -4;
    else if (period === 'evening') score += hour >= 17 ? 4 : -4;
    else {
      if (hour >= 12 && hour < 13) score -= 1; // lunch
      if ((hour >= 10 && hour < 12) || (hour >= 14 && hour < 16)) score += 0.5; // focus-friendly hours
    }

    score -= 0.35 * (day - today); // sooner is better
    score += p.minute === 0 ? 0.6 : p.minute === 30 ? 0.3 : -0.3;

    const end = start + dur;
    let gapBefore = Infinity, gapAfter = Infinity;
    for (const b of busy) {
      if (b.end <= start) gapBefore = Math.min(gapBefore, start - b.end);
      if (b.start >= end) gapAfter = Math.min(gapAfter, b.start - end);
    }
    const gap = Math.min(gapBefore, gapAfter);
    if (gap === 0) score -= 1.5; // back-to-back
    else if (gap >= 30 * MIN) score += 0.5;

    return { start, day, score };
  }).sort((a, b) => b.score - a.score || a.start - b.start);

  const picked = [];
  const perDay = new Map();
  const passes = [{ maxPerDay: 1, spacing: 2 * 60 * MIN }, { maxPerDay: 2, spacing: 2 * 60 * MIN }, { maxPerDay: Infinity, spacing: dur }];
  for (const { maxPerDay, spacing } of passes) {
    for (const c of scored) {
      if (picked.length >= count) break;
      if (picked.includes(c)) continue;
      if ((perDay.get(c.day) || 0) >= maxPerDay) continue;
      if (picked.some((x) => Math.abs(x.start - c.start) < spacing)) continue;
      picked.push(c);
      perDay.set(c.day, (perDay.get(c.day) || 0) + 1);
    }
  }
  return picked.map((c) => c.start).sort((a, b) => a - b);
}
