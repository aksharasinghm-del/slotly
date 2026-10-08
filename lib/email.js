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

const shell = (inner, footer) => `<!doctype html><html><body style="margin:0;background:#f8f9fb;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:10px;border:1px solid #e7edf6">
<tr><td style="padding:28px;font-size:15px;line-height:1.55">${inner}</td></tr></table>
<p style="font-size:12px;color:#6b7c93;margin:14px 0 0">${footer}</p></td></tr></table></body></html>`;

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin-top:8px;padding:12px 22px;background:#006bff;color:#fff;border-radius:6px;font-weight:bold;text-decoration:none">${esc(label)}</a>`;

/** Notifies the site owner about a new access request. */
export function accessRequestEmail({ request: r, reviewUrl, appName }) {
  const rows = [['Name', r.name], ['Email', r.email], ['Business', r.company], ['Wants to use it for', r.purpose], ['Message', r.message]]
    .filter(([, v]) => v);
  const subject = `New ${appName} access request from ${r.name}`;
  const html = shell(`<p style="margin:0 0 14px"><strong>${esc(r.name)}</strong> has asked to use ${esc(appName)} for their own bookings.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;margin-bottom:16px">
${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#476788;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;white-space:pre-line">${esc(v)}</td></tr>`).join('')}
</table>${button(reviewUrl, 'Review request')}`, `Sent by your ${esc(appName)} site`);
  const text = [`${r.name} has asked to use ${appName} for their own bookings.`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Approve or decline: ${reviewUrl}`].join('\n');
  return { subject, html, text };
}

/** Tells a requester they can now sign in. */
export function accessApprovedEmail({ name, signInUrl, hostName, appName }) {
  const first = String(name || '').split(/\s+/)[0] || 'there';
  const subject = `You're in! Your ${appName} access is approved`;
  const html = shell(`<p style="margin:0 0 12px">Hi ${esc(first)},</p>
<p style="margin:0 0 12px">Good news: your request to use ${esc(appName)} has been approved. Sign in with your Google account to set up your booking page, connect your calendar, and start sharing your link.</p>
${button(signInUrl, `Sign in to ${appName}`)}
<p style="margin:18px 0 0;color:#476788;font-size:13px">Use the same email address you requested access with.</p>`, `Approved by ${esc(hostName)}`);
  const text = `Hi ${first},\n\nYour request to use ${appName} has been approved. Sign in with your Google account (same email you requested with):\n${signInUrl}\n\n${hostName}`;
  return { subject, html, text };
}
