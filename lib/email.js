const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmt(ms, tz, opts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(ms)).replace(/[\s ]?(AM|PM)/, (m, p) => p.toLowerCase());
}

function tzName(tz, ms) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value || tz;
}

/** Subject, HTML and plain-text bodies for an invite-with-times email. */
export function inviteEmail({ host, proposal, times, url, appName }) {
  const tz = host.timezone;
  const first = proposal.customer_name ? proposal.customer_name.split(/\s+/)[0] : '';
  const subject = `${host.name} has invited you to book: ${proposal.title}`;
  const greeting = first ? `Hi ${first},` : 'Hi,';
  const intro = `Please pick one of these times for <strong>${esc(proposal.title)}</strong> (${proposal.duration} min). Click a time to book it instantly.`;

  const byDay = new Map();
  for (const ms of times) {
    const day = fmt(ms, tz, { weekday: 'long', month: 'long', day: 'numeric' });
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(ms);
  }
  const slotLink = (ms) => `${url}?slot=${encodeURIComponent(new Date(ms).toISOString())}`;
  const timeLabel = (ms) => fmt(ms, tz, { hour: 'numeric', minute: '2-digit', hour12: true });

  const html = `<!doctype html><html><body style="margin:0;background:#f8f9fb;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e7edf6">
<tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 14px;font-size:16px">${esc(greeting)}</p>
${proposal.note ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;white-space:pre-line">${esc(proposal.note)}</p>` : ''}
<p style="margin:0 0 18px;font-size:15px;line-height:1.5">${intro}</p>
</td></tr>
${[...byDay.entries()].map(([day, list]) => `<tr><td style="padding:4px 28px 10px">
<div style="font-weight:bold;font-size:14px;margin-bottom:8px">${esc(day)}</div>
${list.map((ms) => `<a href="${esc(slotLink(ms))}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border:1px solid #006bff;border-radius:6px;color:#006bff;font-weight:bold;font-size:14px;text-decoration:none">${esc(timeLabel(ms))}</a>`).join('')}
</td></tr>`).join('')}
<tr><td style="padding:6px 28px 24px;font-size:13px;color:#476788">
Times shown in ${esc(tzName(tz, times[0]))}. The booking page shows them in your own time zone.<br><br>
<a href="${esc(url)}" style="color:#006bff">See all suggested times</a>
</td></tr></table>
<p style="font-size:12px;color:#6b7c93;margin:14px 0 0">Sent by ${esc(host.name)} via ${esc(appName)}</p>
</td></tr></table></body></html>`;

  const text = [
    greeting, '',
    proposal.note || '', proposal.note ? '' : null,
    `Please pick one of these times for "${proposal.title}" (${proposal.duration} min):`, '',
    ...[...byDay.entries()].flatMap(([day, list]) => [day, ...list.map((ms) => `  ${timeLabel(ms)}: ${slotLink(ms)}`), '']),
    `Times shown in ${tzName(tz, times[0])}.`,
    `All times: ${url}`, '',
    `${host.name}`,
  ].filter((l) => l !== null).join('\n');

  return { subject, html, text };
}
