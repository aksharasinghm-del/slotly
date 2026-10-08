/* Shared helpers for every page. Exposes window.S. */
(function () {
  const svg = (d, extra = '') => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  const icons = {
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    video: svg('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
    link: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
    back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
    left: svg('<path d="m15 18-6-6 6-6"/>'),
    right: svg('<path d="m9 18 6-6-6-6"/>'),
    check: svg('<path d="M20 6 9 17l-5-5"/>', 'stroke-width="3"'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 3.1a4 4 0 0 1 0 7.8M22 21a7 7 0 0 0-4-6.3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
    trash: svg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'),
    edit: svg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    external: svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
    hours: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>'),
    logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
    menu: svg('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'),
    code: svg('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
    alert: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
    dots: svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>'),
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M17 8.5A6 6 0 1 0 17 15.5"/></svg>',
    google: '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-10 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.9-6.2z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/></svg>',
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const init = { credentials: 'same-origin', ...opts, headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers } };
    if (opts.body && typeof opts.body !== 'string') init.body = JSON.stringify(opts.body);
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

  function timezones() {
    try { return Intl.supportedValuesOf('timeZone'); } catch { return [browserTz, 'UTC']; }
  }

  const fmtCache = new Map();
  function fmt(tz, opts) {
    const key = tz + JSON.stringify(opts);
    if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }));
    return fmtCache.get(key);
  }

  const dateKey = (ms, tz) => {
    const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };

  const fmtTime = (ms, tz, h12 = true) =>
    fmt(tz, { hour: 'numeric', minute: '2-digit', hour12: h12 }).format(new Date(ms)).replace(/[\s ]?(AM|PM)/, (m, p) => p.toLowerCase());

  const fmtDate = (ms, tz, opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) => fmt(tz, opts).format(new Date(ms));

  function tzName(tz, ms = Date.now()) {
    try {
      const part = fmt(tz, { timeZoneName: 'long' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName');
      return part ? part.value : tz;
    } catch { return tz; }
  }

  function tzOptions(selected, h12 = true) {
    const now = Date.now();
    return timezones().map((tz) => `<option value="${esc(tz)}" ${tz === selected ? 'selected' : ''}>${esc(tz.replace(/_/g, ' '))} (${fmtTime(now, tz, h12)})</option>`).join('');
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  function avatar(user, size = 64) {
    const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
    if (user?.picture) return `<img class="avatar" src="${esc(user.picture)}" alt="" style="${style}" referrerpolicy="no-referrer">`;
    return `<span class="avatar" style="${style}">${esc(initials(user?.name))}</span>`;
  }

  const LOCATIONS = {
    meet: { label: 'Google Meet', icon: 'video' },
    phone: { label: 'Phone call', icon: 'phone' },
    in_person: { label: 'In-person meeting', icon: 'pin' },
    custom: { label: 'Custom location', icon: 'link' },
  };

  function locationLine(type, value, { confirmed = false, meetLink = null } = {}) {
    const loc = LOCATIONS[type] || LOCATIONS.custom;
    let text;
    if (type === 'meet') {
      text = meetLink ? `<a href="${esc(meetLink)}" target="_blank" rel="noopener">${esc(meetLink.replace(/^https?:\/\//, ''))}</a>`
        : confirmed ? 'Google Meet' : 'Web conferencing details provided upon confirmation.';
    } else if (type === 'phone') {
      text = confirmed && value ? `Phone call — ${esc(value)}` : 'Phone call — host will call you';
    } else if (type === 'custom' && /^https?:\/\//.test(value)) {
      text = `<a href="${esc(value)}" target="_blank" rel="noopener">${esc(value)}</a>`;
    } else {
      text = esc(value || loc.label);
    }
    return `<div>${icons[loc.icon]}<span>${text}</span></div>`;
  }

  function durationLabel(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} hr ${m} min` : `${h} hr${h > 1 ? 's' : ''}`;
  }

  let toastTimer;
  function toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function copy(text, message = 'Link copied') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(message);
  }

  /** Opens a modal; returns { el, close }. */
  function modal({ title, body, footer = '', width = 560, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="width:min(${width}px,100%)">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${icons.x}</button></div>
      <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('input, textarea, select')?.focus();
    return { el: wrap, close };
  }

  function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal({
        title,
        body: `<p class="muted" style="margin:0">${esc(message)}</p>`,
        footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>`,
        width: 440,
        onClose: () => { if (!answered) resolve(false); },
      });
      m.el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; m.close(); resolve(true); });
    });
  }

  function addToCalendarLinks(b, hostName, location) {
    const stamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const title = `${b.eventName} with ${hostName}`;
    const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${stamp(b.start)}/${stamp(b.end)}`, details: `Manage: ${location}`, location: b.meetLink || '' })}`;
    const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: title, startdt: b.start, enddt: b.end, body: `Manage: ${location}`, location: b.meetLink || '' })}`;
    return { google, outlook, ics: `/api/b/${b.uid}/ics` };
  }

  function poweredBy(appName = 'Slotly') {
    return `<div class="powered"><a href="/?home=1" target="_blank" rel="noopener"><small>POWERED BY</small>${esc(appName)}</a></div>`;
  }

  window.S = { api, esc, icons, browserTz, timezones, dateKey, fmtTime, fmtDate, tzName, tzOptions, avatar, initials,
    LOCATIONS, locationLine, durationLabel, toast, copy, modal, confirmDialog, addToCalendarLinks, poweredBy };
})();
