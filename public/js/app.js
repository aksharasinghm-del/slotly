/* Host dashboard: /app, /app/meetings, /app/availability, /app/settings */
(async function () {
  const { api, esc, icons } = S;
  const view = document.getElementById('view');
  const COLORS = ['#ff4f00', '#f8e436', '#e55cff', '#8247f5', '#0099ff', '#0ae8f0', '#17e885', '#ccf000', '#ffa600'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ROUTES = { '/app': 'events', '/app/invites': 'invites', '/app/invites/new': 'newInvite', '/app/meetings': 'meetings', '/app/requests': 'requests', '/app/availability': 'availability', '/app/settings': 'settings' };

  let me, cfg, eventTypes = [];

  document.getElementById('logo').innerHTML = icons.logo;
  document.getElementById('plus').innerHTML = icons.plus;
  document.getElementById('menu-btn').innerHTML = icons.menu;
  document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icons[el.dataset.icon]; });

  async function loadMe() {
    const data = await api('/api/me');
    me = data.user;
    cfg = { demo: data.demo, appName: data.appName, baseUrl: data.baseUrl };
  }

  try {
    await loadMe();
  } catch (err) {
    if (err.status === 401) { location.href = '/?home=1'; return; }
    view.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
    return;
  }

  // First visit: adopt the browser's timezone.
  if (!me.onboarded) {
    await api('/api/me', { method: 'PUT', body: { timezone: S.browserTz, onboarded: true } }).catch(() => {});
    me.timezone = S.browserTz;
  }

  const bookingUrl = (et) => `${cfg.baseUrl}/${me.username}${et ? `/${et.slug}` : ''}`;
  const shortUrl = (url) => url.replace(/^https?:\/\//, '');

  function renderChrome() {
    document.getElementById('brand-name').textContent = cfg.appName;
    document.title = cfg.appName;
    document.getElementById('top-user').innerHTML = `<button class="user-pill" data-route="/app/settings" aria-label="Account settings">${S.avatar(me, 34)}</button>`;
    document.getElementById('side-foot').innerHTML = `
      <a class="btn btn-text" href="/${esc(me.username)}" target="_blank" rel="noopener" style="justify-content:flex-start">${icons.external} View landing page</a>
      <button class="btn btn-text" data-action="logout" style="justify-content:flex-start;color:var(--muted)">${icons.logout} Log out</button>`;
    document.getElementById('nav-requests').hidden = !me.isAdmin;
    if (me.isAdmin) refreshRequestCount();
    const banner = document.getElementById('banner');
    if (cfg.demo) {
      banner.innerHTML = `<div class="banner">${icons.alert}<span><strong>Demo mode.</strong> Google sign-in isn't configured on this server, so bookings won't sync to Google Calendar or send invites. See the README to add your Google OAuth credentials.</span></div>`;
    } else if (!me.googleConnected) {
      banner.innerHTML = `<div class="banner">${icons.alert}<span>Your Google Calendar isn't connected, so invites can't be sent. </span><a class="btn btn-primary btn-sm" href="/auth/google">Reconnect Google</a></div>`;
    } else banner.innerHTML = '';
  }

  // ---------- router ----------

  function navigate(path, push = true) {
    if (push && path !== location.pathname) history.pushState(null, '', path);
    const name = ROUTES[location.pathname] || 'events';
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name || (name === 'newInvite' && a.dataset.view === 'invites')));
    document.getElementById('sidebar').classList.remove('open');
    view.innerHTML = '<div class="spinner"></div>';
    ({ events: renderEvents, invites: renderInvites, newInvite: renderNewInvite, meetings: renderMeetings, requests: renderRequests, availability: renderAvailability, settings: renderSettings })[name]();
    window.scrollTo({ top: 0 });
  }

  window.addEventListener('popstate', () => navigate(location.pathname, false));
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('a[href^="/app"], [data-route]');
    if (link && !e.metaKey && !e.ctrlKey && !link.target) {
      e.preventDefault();
      return navigate(link.dataset.route || link.getAttribute('href'));
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') {
      await api('/auth/logout', { method: 'POST' });
      location.href = '/?home=1';
    }
    if (action === 'new-event') openEditor();
    if (!e.target.closest('.menu')) document.querySelectorAll('.menu-list').forEach((m) => m.remove());
  });
  document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  // ---------- event types ----------

  function locationSummary(et) {
    return { meet: 'Google Meet', phone: 'Phone call', in_person: 'In person', custom: 'Custom location' }[et.locationType];
  }

  async function renderEvents() {
    const data = await api('/api/event-types');
    eventTypes = data.eventTypes;
    view.innerHTML = `
      <h1 class="page-title">Scheduling</h1>
      <div class="tabs"><button class="on">Event types</button></div>
      <div class="owner-strip">
        ${S.avatar(me, 40)}
        <div class="who"><strong>${esc(me.name)}</strong><a href="/${esc(me.username)}" target="_blank" rel="noopener">${esc(shortUrl(bookingUrl()))}</a></div>
        <span class="spacer"></span>
        <label class="search">${icons.list}<input class="input" id="et-search" placeholder="Search event types" aria-label="Search event types"></label>
        <button class="btn btn-outline" data-route="/app/invites/new">${icons.mail} Send specific times</button>
        <button class="btn btn-primary" data-action="new-event">${icons.plus} New Event Type</button>
      </div>
      <div id="et-grid"></div>`;
    const grid = document.getElementById('et-grid');
    const draw = (q = '') => {
      const list = eventTypes.filter((et) => et.name.toLowerCase().includes(q.toLowerCase()));
      if (!eventTypes.length) {
        grid.innerHTML = `<div class="empty">${icons.calendar}<h3>Create scheduling links with event types</h3><p>Event types are templates for meetings people can book with you.</p><button class="btn btn-primary" data-action="new-event">${icons.plus} New Event Type</button></div>`;
        return;
      }
      grid.className = 'et-grid';
      grid.innerHTML = list.map((et) => `
        <article class="et-card ${et.active ? '' : 'off'}" style="--c:${esc(et.color)}" data-id="${et.id}">
          <div class="et-top">
            <label class="switch" title="${et.active ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-toggle="${et.id}" ${et.active ? 'checked' : ''} aria-label="${et.active ? 'Turn off' : 'Turn on'} ${esc(et.name)}"><span></span></label>
            <div class="menu"><button class="icon-btn" data-menu="${et.id}" aria-label="More options">${icons.gear}</button></div>
          </div>
          <div class="et-body" data-edit="${et.id}">
            <h3>${esc(et.name)}</h3>
            <div class="muted">${S.durationLabel(et.duration)}, One-on-One · ${locationSummary(et)}</div>
            <a href="/${esc(me.username)}/${esc(et.slug)}" target="_blank" rel="noopener">View booking page</a>
          </div>
          <div class="et-foot">
            <button class="btn btn-text" data-copy="${et.id}" ${et.active ? '' : 'disabled'}>${icons.copy} Copy link</button>
            <button class="btn btn-outline btn-sm" data-share="${et.id}" ${et.active ? '' : 'disabled'}>Share</button>
          </div>
        </article>`).join('') || '<p class="muted">No event types match your search.</p>';
    };
    draw();
    document.getElementById('et-search').addEventListener('input', (e) => draw(e.target.value));

    grid.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-copy],[data-share],[data-menu],[data-edit],[data-menu-action]');
      if (!t || e.target.closest('a')) return;
      const find = (id) => eventTypes.find((x) => x.id === Number(id));
      if (t.dataset.copy) return S.copy(bookingUrl(find(t.dataset.copy)));
      if (t.dataset.share) return openShare(find(t.dataset.share));
      if (t.dataset.edit) return openEditor(find(t.dataset.edit));
      if (t.dataset.menu) {
        e.stopPropagation();
        document.querySelectorAll('.menu-list').forEach((m) => m.remove());
        t.parentElement.insertAdjacentHTML('beforeend', `<div class="menu-list">
          <button data-menu-action="edit" data-id="${t.dataset.menu}">${icons.edit} Edit</button>
          <button data-menu-action="duplicate" data-id="${t.dataset.menu}">${icons.copy} Duplicate</button>
          <button data-menu-action="delete" data-id="${t.dataset.menu}" class="danger">${icons.trash} Delete</button></div>`);
        return;
      }
      const et = find(t.dataset.id);
      document.querySelectorAll('.menu-list').forEach((m) => m.remove());
      if (t.dataset.menuAction === 'edit') openEditor(et);
      if (t.dataset.menuAction === 'duplicate') {
        const { id, slug, ...rest } = et;
        await api('/api/event-types', { method: 'POST', body: { ...rest, name: `${et.name} (copy)` } });
        S.toast('Event type duplicated');
        renderEvents();
      }
      if (t.dataset.menuAction === 'delete') {
        const ok = await S.confirmDialog({ title: 'Delete event type?', message: `Users will be unable to schedule further meetings with "${et.name}". Meetings already scheduled will not be affected.`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await api(`/api/event-types/${et.id}`, { method: 'DELETE' });
        S.toast('Event type deleted');
        renderEvents();
      }
    });

    grid.addEventListener('change', async (e) => {
      const id = e.target.dataset.toggle;
      if (!id) return;
      try {
        await api(`/api/event-types/${id}`, { method: 'PUT', body: { active: e.target.checked } });
        const et = eventTypes.find((x) => x.id === Number(id));
        et.active = e.target.checked;
        draw(document.getElementById('et-search').value);
        S.toast(et.active ? 'Event type turned on' : 'Event type turned off');
      } catch (err) { S.toast(err.message); }
    });
  }

  function openEditor(et) {
    const isNew = !et;
    et = et || { name: '', duration: 30, description: '', locationType: 'meet', locationValue: '', color: '#8247f5', bufferBefore: 0, bufferAfter: 0, minNotice: 240, maxDays: 60, slotInterval: null, slug: '' };
    const durations = [15, 30, 45, 60, 90, 120];
    const isCustomDuration = !durations.includes(et.duration);
    const locPlaceholder = { in_person: 'Address', custom: 'Meeting link or instructions', phone: '', meet: '' };
    const m = S.modal({
      title: isNew ? 'New Event Type' : 'Edit Event Type',
      width: 620,
      body: `<form id="et-form" novalidate>
        <div id="et-error"></div>
        <div class="field"><label for="f-name">Event name *</label><input class="input" id="f-name" name="name" value="${esc(et.name)}" placeholder="e.g. Intro call" required maxlength="100"></div>
        <div class="grid-2">
          <div class="field"><label for="f-duration">Duration</label>
            <select class="input" id="f-duration" name="durationPreset">
              ${durations.map((d) => `<option value="${d}" ${d === et.duration ? 'selected' : ''}>${S.durationLabel(d)}</option>`).join('')}
              <option value="custom" ${isCustomDuration ? 'selected' : ''}>Custom…</option>
            </select>
            <input class="input" type="number" min="5" max="720" name="durationCustom" value="${et.duration}" ${isCustomDuration ? '' : 'hidden'} aria-label="Custom duration in minutes" placeholder="Minutes">
          </div>
          <div class="field"><label for="f-slug">URL</label>
            <div class="input-group"><span class="prefix">/${esc(me.username)}/</span><input class="input" id="f-slug" name="slug" value="${esc(et.slug)}" placeholder="auto"></div>
          </div>
        </div>
        <div class="field"><span class="label">Location</span>
          <div class="loc-options">${Object.entries(S.LOCATIONS).map(([k, v]) => `<label><input type="radio" name="locationType" value="${k}" ${et.locationType === k ? 'checked' : ''}>${icons[v.icon]}${v.label.replace(' meeting', '').replace('Custom location', 'Custom')}</label>`).join('')}</div>
          <input class="input" name="locationValue" value="${esc(et.locationValue)}" placeholder="${esc(locPlaceholder[et.locationType])}" ${['in_person', 'custom'].includes(et.locationType) ? '' : 'hidden'} aria-label="Location details">
          <span class="hint" data-loc-hint></span>
        </div>
        <div class="field"><label for="f-desc">Description / Instructions</label><textarea class="input" id="f-desc" name="description" placeholder="Write a summary and any details your invitee should know about the event.">${esc(et.description)}</textarea></div>
        <div class="field"><span class="label">Event color</span>
          <div class="color-row">${COLORS.map((c) => `<label title="${c}"><input type="radio" name="color" value="${c}" ${et.color === c ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div>
        </div>
        <details class="adv" ${isNew ? '' : 'open'}><summary>Scheduling limits &amp; buffers</summary>
          <div class="grid-2">
            <div class="field"><label for="f-notice">Minimum notice</label>
              <select class="input" id="f-notice" name="minNotice">${[[0, 'None'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours'], [720, '12 hours'], [1440, '1 day'], [2880, '2 days'], [10080, '1 week']].map(([v, l]) => `<option value="${v}" ${v === et.minNotice ? 'selected' : ''}>${l}</option>`).join('')}${[0, 30, 60, 120, 240, 720, 1440, 2880, 10080].includes(et.minNotice) ? '' : `<option value="${et.minNotice}" selected>${et.minNotice} minutes</option>`}</select></div>
            <div class="field"><label for="f-days">Invitees can schedule</label>
              <div class="input-group"><input class="input" type="number" id="f-days" name="maxDays" min="1" max="365" value="${et.maxDays}"><span class="prefix" style="padding-right:14px">days into the future</span></div></div>
            <div class="field"><label for="f-bb">Buffer before event</label>
              <select class="input" id="f-bb" name="bufferBefore">${[0, 5, 10, 15, 30, 45, 60].map((v) => `<option value="${v}" ${v === et.bufferBefore ? 'selected' : ''}>${v ? `${v} min` : 'None'}</option>`).join('')}</select></div>
            <div class="field"><label for="f-ba">Buffer after event</label>
              <select class="input" id="f-ba" name="bufferAfter">${[0, 5, 10, 15, 30, 45, 60].map((v) => `<option value="${v}" ${v === et.bufferAfter ? 'selected' : ''}>${v ? `${v} min` : 'None'}</option>`).join('')}</select></div>
            <div class="field"><label for="f-int">Start time increments</label>
              <select class="input" id="f-int" name="slotInterval"><option value="">Same as duration</option>${[5, 10, 15, 20, 30, 60].map((v) => `<option value="${v}" ${v === et.slotInterval ? 'selected' : ''}>${v} min</option>`).join('')}</select></div>
          </div>
        </details>
      </form>`,
      footer: `<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" data-save>${isNew ? 'Create' : 'Save Changes'}</button>`,
    });
    const form = m.el.querySelector('#et-form');
    const hint = form.querySelector('[data-loc-hint]');
    const syncLoc = () => {
      const type = form.locationType.value;
      form.locationValue.hidden = !['in_person', 'custom'].includes(type);
      form.locationValue.placeholder = locPlaceholder[type];
      hint.textContent = type === 'meet' ? (me.googleConnected ? 'A unique Google Meet link is created for every booking.' : 'Connect Google Calendar to generate Meet links.')
        : type === 'phone' ? 'Invitees will be asked for their phone number and you will call them.' : '';
    };
    syncLoc();
    form.addEventListener('change', (e) => {
      if (e.target.name === 'locationType') syncLoc();
      if (e.target.name === 'durationPreset') form.durationCustom.hidden = e.target.value !== 'custom';
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    m.el.querySelector('[data-save]').addEventListener('click', save);

    async function save() {
      const f = form.elements;
      const duration = f.durationPreset.value === 'custom' ? Number(f.durationCustom.value) : Number(f.durationPreset.value);
      const body = {
        name: f.name.value.trim(), duration, description: f.description.value,
        locationType: form.locationType.value, locationValue: f.locationValue.value,
        color: form.color.value || et.color, minNotice: Number(f.minNotice.value), maxDays: Number(f.maxDays.value),
        bufferBefore: Number(f.bufferBefore.value), bufferAfter: Number(f.bufferAfter.value),
        slotInterval: f.slotInterval.value ? Number(f.slotInterval.value) : null,
      };
      if (f.slug.value.trim()) body.slug = f.slug.value.trim();
      const err = m.el.querySelector('#et-error');
      if (!body.name) { err.innerHTML = '<div class="form-error">Event name is required.</div>'; return f.name.focus(); }
      const btn = m.el.querySelector('[data-save]');
      btn.disabled = true;
      try {
        await api(isNew ? '/api/event-types' : `/api/event-types/${et.id}`, { method: isNew ? 'POST' : 'PUT', body });
        m.close();
        S.toast(isNew ? 'Event type created' : 'Changes saved');
        if (location.pathname !== '/app') navigate('/app'); else renderEvents();
      } catch (ex) {
        btn.disabled = false;
        err.innerHTML = `<div class="form-error">${esc(ex.message)}</div>`;
      }
    }
  }

  async function openShare(et) {
    const url = bookingUrl(et);
    const embed = `<iframe src="${url}?embed=1" width="100%" height="720" frameborder="0" title="Schedule a meeting with ${esc(me.name)}"></iframe>`;
    const m = S.modal({
      title: `Share ${et.name}`,
      width: 600,
      body: `<div class="tabs" role="tablist"><button class="on" data-tab="link">Copy link</button><button data-tab="times">Add times to email</button><button data-tab="embed">Add to website</button></div>
        <div data-pane="link">
          <div class="share-link"><input class="input" value="${esc(url)}" readonly aria-label="Booking link"><button class="btn btn-primary" data-copy-link>Copy</button></div>
          <p class="hint">Share this link with anyone. They'll see your available times and can book directly onto your calendar.</p>
          <div class="row" style="margin-top:16px;flex-wrap:wrap">
            <a class="btn btn-ghost btn-sm" href="mailto:?subject=${encodeURIComponent(`Let's meet: ${et.name}`)}&body=${encodeURIComponent(`Hi,\n\nPlease pick a time that works for you here:\n${url}\n\nThanks,\n${me.name}`)}">${icons.mail} Email link</a>
            <a class="btn btn-ghost btn-sm" href="https://wa.me/?text=${encodeURIComponent(`Book a time with me: ${url}`)}" target="_blank" rel="noopener">Share on WhatsApp</a>
            <a class="btn btn-ghost btn-sm" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" target="_blank" rel="noopener">LinkedIn</a>
          </div>
        </div>
        <div data-pane="times" hidden><p class="hint" style="margin-top:0">Pick a few times to suggest. Each one links straight to the booking form.</p><div id="share-slots"><div class="spinner"></div></div></div>
        <div data-pane="embed" hidden>
          <p class="hint" style="margin-top:0">Paste this code into your website's HTML to show your booking page inline.</p>
          <textarea class="input code" rows="4" readonly aria-label="Embed code">${esc(embed)}</textarea>
          <button class="btn btn-primary" style="margin-top:12px" data-copy-embed>Copy code</button>
        </div>`,
    });
    const el = m.el;
    el.querySelector('[data-copy-link]').addEventListener('click', () => S.copy(url));
    el.querySelector('[data-copy-embed]').addEventListener('click', () => S.copy(embed, 'Embed code copied'));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    }));

    // Suggested times for the email tab.
    const box = el.querySelector('#share-slots');
    try {
      const from = new Date(), to = new Date(Date.now() + 14 * 86400000);
      const { slots } = await api(`/api/u/${encodeURIComponent(me.username)}/${encodeURIComponent(et.slug)}/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
      if (!slots.length) { box.innerHTML = '<p class="muted">No available times in the next two weeks. Check your availability settings.</p>'; return; }
      const byDay = new Map();
      for (const s of slots) {
        const key = S.dateKey(Date.parse(s), me.timezone);
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(s);
      }
      const days = [...byDay.entries()].slice(0, 5);
      const selected = new Set(days.slice(0, 3).map(([, list]) => list[0]));
      box.innerHTML = days.map(([, list]) => `<div class="label">${esc(S.fmtDate(Date.parse(list[0]), me.timezone, { weekday: 'long', month: 'short', day: 'numeric' }))}</div>
        <div class="slot-chips">${list.slice(0, 12).map((s) => `<button type="button" data-slot="${s}" class="${selected.has(s) ? 'on' : ''}">${S.fmtTime(Date.parse(s), me.timezone)}</button>`).join('')}</div>`).join('')
        + `<p class="hint">Times shown in ${esc(S.tzName(me.timezone))}.</p><button class="btn btn-primary" data-copy-times>Copy times to clipboard</button>`;
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-slot]');
        if (b) { b.classList.toggle('on'); b.classList.contains('on') ? selected.add(b.dataset.slot) : selected.delete(b.dataset.slot); }
        if (e.target.closest('[data-copy-times]')) {
          if (!selected.size) return S.toast('Select at least one time');
          const lines = [...selected].sort().map((s) => {
            const ms = Date.parse(s);
            return `• ${S.fmtDate(ms, me.timezone, { weekday: 'short', month: 'short', day: 'numeric' })}, ${S.fmtTime(ms, me.timezone)} — ${url}?slot=${encodeURIComponent(s)}`;
          });
          S.copy(`${et.name} (${S.durationLabel(et.duration)})\nTimes in ${S.tzName(me.timezone)}:\n${lines.join('\n')}\n\nNone of these work? See all times: ${url}`, 'Times copied — paste them into your email');
        }
      });
    } catch (err) {
      box.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
    }
  }

  // ---------- meetings ----------

  async function renderMeetings(scope = 'upcoming') {
    view.innerHTML = `<h1 class="page-title">Meetings</h1>
      <div class="tabs">${[['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Canceled']].map(([k, l]) => `<button data-scope="${k}" class="${k === scope ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div id="meet-list"><div class="spinner"></div></div>`;
    view.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => renderMeetings(b.dataset.scope)));
    const box = document.getElementById('meet-list');
    let bookings;
    try {
      ({ bookings } = await api(`/api/bookings?scope=${scope}`));
    } catch (err) {
      box.innerHTML = `<p class="error-text">${esc(err.message)}</p>`;
      return;
    }
    if (!bookings.length) {
      box.innerHTML = `<div class="empty">${icons.calendar}<h3>No ${scope === 'cancelled' ? 'canceled' : scope} events</h3><p>${scope === 'upcoming' ? 'Share your booking link to start getting meetings on your calendar.' : 'Nothing to show here yet.'}</p>${scope === 'upcoming' ? '<a class="btn btn-primary" href="/app">Go to event types</a>' : ''}</div>`;
      return;
    }
    const tz = me.timezone;
    const groups = new Map();
    for (const b of bookings) {
      const key = S.fmtDate(Date.parse(b.start), tz);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    box.innerHTML = `<div class="panel">${[...groups.entries()].map(([day, list]) => `<div class="meet-group"><h4>${esc(day)}</h4>
      ${list.map((b) => `<div class="meet-row" data-uid="${b.uid}">
        <div class="when"><span class="dot" style="background:${esc(b.color)}"></span>${S.fmtTime(Date.parse(b.start), tz)} – ${S.fmtTime(Date.parse(b.end), tz)}</div>
        <div class="who"><strong>${esc(b.inviteeName)}</strong><span>${b.fromInvite ? 'Invite link' : 'Event type'} <b>${esc(b.eventName)}</b>${b.guests.length ? ` · ${b.guests.length + 1} invitees` : ''}</span>
          ${b.syncError ? `<div><span class="badge badge-warn" title="${esc(b.syncError)}">Not synced to Google</span></div>` : ''}</div>
        <button class="btn btn-text" data-details>${icons.right} Details</button>
        <div class="meet-detail" hidden>
          <div><div class="k">Email</div><div class="v"><a href="mailto:${esc(b.inviteeEmail)}">${esc(b.inviteeEmail)}</a></div></div>
          <div><div class="k">Location</div><div class="v">${b.meetLink ? `<a href="${esc(b.meetLink)}" target="_blank" rel="noopener">${esc(b.meetLink)}</a>` : esc(b.locationType === 'phone' ? `Phone: ${b.inviteePhone}` : b.locationValue || S.LOCATIONS[b.locationType]?.label)}</div></div>
          <div><div class="k">Invitee time zone</div><div class="v">${esc(S.tzName(b.inviteeTz))}</div></div>
          ${b.guests.length ? `<div><div class="k">Guests</div><div class="v">${b.guests.map(esc).join('\n')}</div></div>` : ''}
          ${b.notes ? `<div style="grid-column:1/-1"><div class="k">Notes</div><div class="v">${esc(b.notes)}</div></div>` : ''}
          ${b.status === 'cancelled' ? `<div style="grid-column:1/-1"><div class="k">Canceled by ${esc(b.cancelledBy === 'host' ? 'you' : b.inviteeName)}</div><div class="v">${esc(b.cancelReason || 'No reason given')}</div></div>` : ''}
          <div class="actions">
            ${b.googleLink ? `<a class="btn btn-ghost btn-sm" href="${esc(b.googleLink)}" target="_blank" rel="noopener">${icons.external} Open in Google Calendar</a>` : ''}
            <a class="btn btn-ghost btn-sm" href="/booking/${esc(b.uid)}" target="_blank" rel="noopener">Invitee page</a>
            ${b.status === 'confirmed' && scope === 'upcoming' ? `<button class="btn btn-ghost btn-sm" data-cancel style="color:var(--danger)">${icons.x} Cancel</button>` : ''}
          </div>
        </div>
      </div>`).join('')}</div>`).join('')}</div>`;

    box.addEventListener('click', async (e) => {
      const row = e.target.closest('.meet-row');
      if (!row) return;
      if (e.target.closest('[data-details]')) {
        const d = row.querySelector('.meet-detail');
        d.hidden = !d.hidden;
      }
      if (e.target.closest('[data-cancel]')) {
        const b = bookings.find((x) => x.uid === row.dataset.uid);
        const m = S.modal({
          title: 'Cancel Event',
          width: 480,
          body: `<p class="muted" style="margin-top:0">${esc(b.eventName)} with ${esc(b.inviteeName)}<br>${esc(S.fmtDate(Date.parse(b.start), tz))}, ${S.fmtTime(Date.parse(b.start), tz)}</p>
            <div class="field"><label for="c-reason">Message to ${esc(b.inviteeName)} (optional)</label><textarea class="input" id="c-reason"></textarea></div>
            <p class="hint">${b.synced ? 'Google Calendar will email a cancellation to all invitees.' : 'This event was not synced to Google Calendar, so no cancellation email will be sent.'}</p>`,
          footer: '<button class="btn btn-ghost" data-close>Keep event</button><button class="btn btn-danger" data-ok>Cancel Event</button>',
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async (ev) => {
          ev.target.disabled = true;
          try {
            await api(`/api/bookings/${b.uid}/cancel`, { method: 'POST', body: { reason: m.el.querySelector('#c-reason').value } });
            m.close();
            S.toast('Event canceled');
            renderMeetings(scope);
          } catch (err) { ev.target.disabled = false; S.toast(err.message); }
        });
      }
    });
  }

  // ---------- availability ----------

  function timeOptions(selected, includeMidnight = false) {
    const out = [];
    for (let m = 0; m <= (includeMidnight ? 1440 : 1425); m += 15) {
      const hhmm = m === 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const label = m === 1440 ? '12:00am (midnight)' : S.fmtTime(Date.UTC(2024, 0, 1, Math.floor(m / 60), m % 60), 'UTC');
      out.push(`<option value="${hhmm}" ${hhmm === selected ? 'selected' : ''}>${label}</option>`);
    }
    return out.join('');
  }

  async function renderAvailability() {
    const data = await api('/api/availability');
    const days = DAYS.map((_, i) => data.rules.filter((r) => r.weekday === i).map((r) => ({ start: r.start, end: r.end === '00:00' ? '24:00' : r.end })));
    let tz = data.timezone;
    view.innerHTML = `<h1 class="page-title">Availability</h1>
      <div class="tabs"><button class="on">Schedules</button></div>
      <div class="panel">
        <div class="panel-head"><h3>Working hours <span class="badge">Default</span></h3></div>
        <div class="panel-body">
          <div class="field" style="max-width:420px"><label for="a-tz">Time zone</label><select class="input" id="a-tz">${S.tzOptions(tz)}</select></div>
          <div class="label" style="margin-bottom:4px">Weekly hours</div>
          <p class="hint" style="margin-top:0">Set when you are typically available for meetings. Busy times on your Google Calendar are blocked automatically.</p>
          <div id="days"></div>
          <div id="a-error"></div>
          <div class="row" style="margin-top:20px"><button class="btn btn-primary" id="a-save">Save</button></div>
        </div>
      </div>`;
    const box = document.getElementById('days');
    const draw = () => {
      box.innerHTML = days.map((list, d) => `<div class="avail-row">
        <div class="avail-day ${list.length ? '' : 'off'}"><span class="wd">${DAYS[d][0]}</span>${DAYS[d].slice(0, 3).toUpperCase()}</div>
        <div class="intervals">${list.length ? list.map((r, i) => `<div class="interval">
            <select class="input" data-d="${d}" data-i="${i}" data-k="start" aria-label="${DAYS[d]} start time">${timeOptions(r.start)}</select><span>–</span>
            <select class="input" data-d="${d}" data-i="${i}" data-k="end" aria-label="${DAYS[d]} end time">${timeOptions(r.end, true)}</select>
            <button class="icon-btn" data-remove="${d}:${i}" aria-label="Remove interval">${icons.x}</button>
            ${i === 0 ? `<button class="icon-btn" data-add="${d}" aria-label="Add interval">${icons.plus}</button><button class="icon-btn" data-copyday="${d}" title="Copy times to all days" aria-label="Copy times to all days">${icons.copy}</button>` : ''}
          </div>`).join('')
          : `<div class="unavailable">Unavailable <button class="icon-btn" data-add="${d}" aria-label="Add interval for ${DAYS[d]}">${icons.plus}</button></div>`}
        </div></div>`).join('');
    };
    draw();
    box.addEventListener('change', (e) => {
      const s = e.target;
      if (s.dataset.k) days[s.dataset.d][s.dataset.i][s.dataset.k] = s.value;
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.add !== undefined) {
        const list = days[b.dataset.add];
        const last = list[list.length - 1];
        if (!last) list.push({ start: '09:00', end: '17:00' });
        else {
          const [h, mm] = last.end.split(':').map(Number);
          const s = Math.min(h * 60 + mm + 60, 1380), e2 = Math.min(s + 60, 1440);
          const f = (m) => (m === 1440 ? '24:00' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
          list.push({ start: f(s), end: f(e2) });
        }
      }
      if (b.dataset.remove) {
        const [d, i] = b.dataset.remove.split(':').map(Number);
        days[d].splice(i, 1);
      }
      if (b.dataset.copyday !== undefined) {
        const src = days[b.dataset.copyday];
        for (let d = 0; d < 7; d++) if (days[d].length || d >= 1 && d <= 5) days[d] = src.map((r) => ({ ...r }));
        S.toast('Copied to all working days');
      }
      draw();
    });
    document.getElementById('a-tz').addEventListener('change', (e) => { tz = e.target.value; });
    document.getElementById('a-save').addEventListener('click', async (e) => {
      const rules = days.flatMap((list, weekday) => list.map((r) => ({ weekday, start: r.start, end: r.end })));
      const err = document.getElementById('a-error');
      err.innerHTML = '';
      e.target.disabled = true;
      try {
        await api('/api/availability', { method: 'PUT', body: { rules, timezone: tz } });
        me.timezone = tz;
        S.toast('Availability saved');
      } catch (ex) {
        err.innerHTML = `<div class="form-error" style="margin-top:16px">${esc(ex.message)}</div>`;
      }
      e.target.disabled = false;
    });
  }

  // ---------- settings ----------

  async function renderSettings() {
    view.innerHTML = `<h1 class="page-title">Settings</h1>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h3>Profile</h3></div><div class="panel-body">
          <form id="profile-form" style="max-width:560px">
            <div id="p-error"></div>
            <div class="row" style="margin-bottom:20px;gap:16px">${S.avatar(me, 64)}<div><strong>${esc(me.email)}</strong><div class="hint">Your picture comes from your Google account.</div></div></div>
            <div class="field"><label for="p-name">Name</label><input class="input" id="p-name" name="name" value="${esc(me.name)}" maxlength="100"></div>
            <div class="field"><label for="p-user">Your link</label>
              <div class="input-group"><span class="prefix">${esc(shortUrl(cfg.baseUrl))}/</span><input class="input" id="p-user" name="username" value="${esc(me.username)}" maxlength="40"></div>
              <span class="hint">Changing this breaks links you've already shared.</span></div>
            <div class="field"><label for="p-welcome">Welcome message</label><textarea class="input" id="p-welcome" name="welcome" maxlength="1000">${esc(me.welcome)}</textarea></div>
            <div class="field"><label for="p-tz">Time zone</label><select class="input" id="p-tz" name="timezone">${S.tzOptions(me.timezone)}</select></div>
            <button class="btn btn-primary" type="submit">Save Changes</button>
          </form>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>Calendar connection</h3></div><div class="panel-body" id="cal-panel"><div class="spinner"></div></div></div>
      </div>`;
    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const err = document.getElementById('p-error');
      err.innerHTML = '';
      try {
        const res = await api('/api/me', { method: 'PUT', body: { name: f.name.value, username: f.username.value, welcome: f.welcome.value, timezone: f.timezone.value } });
        Object.assign(me, { name: f.name.value.trim(), username: res.username, welcome: f.welcome.value, timezone: f.timezone.value });
        renderChrome();
        S.toast('Profile saved');
      } catch (ex) {
        err.innerHTML = `<div class="form-error">${esc(ex.message)}</div>`;
      }
    });

    const panel = document.getElementById('cal-panel');
    if (cfg.demo || !me.googleConnected) {
      panel.innerHTML = `<div class="connect-card"><span class="gicon">${icons.google}</span><div style="flex:1;min-width:200px"><strong>Google Calendar</strong>
        <div class="hint">${cfg.demo ? 'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server to enable sync. See the README.' : 'Connect to check for conflicts and send calendar invites.'}</div></div>
        ${cfg.demo ? '' : '<a class="btn btn-primary" href="/auth/google">Connect</a>'}</div>`;
      return;
    }
    try {
      const { calendars } = await api('/api/calendars');
      const selected = new Set(me.conflictCalendars.map((id) => (id === 'primary' ? calendars.find((c) => c.primary)?.id || id : id)));
      panel.innerHTML = `<div class="connect-card" style="margin-bottom:20px"><span class="gicon">${icons.google}</span><div style="flex:1"><strong>Google Calendar</strong><div class="hint">Connected as ${esc(me.email)}. New bookings are added to your primary calendar and invites are emailed to guests.</div></div><span class="badge" style="background:#e3f6ef;color:var(--success)">Connected</span></div>
        <div class="label">Check for conflicts</div><p class="hint" style="margin-top:2px">Busy times on these calendars are hidden from your booking pages.</p>
        <div class="cal-list">${calendars.map((c) => `<label class="checkbox"><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id) ? 'checked' : ''}><span class="swatch" style="background:${esc(c.color || '#ccc')}"></span>${esc(c.name)}${c.primary ? ' <span class="badge">Primary</span>' : ''}</label>`).join('')}</div>
        <div class="row" style="margin-top:18px"><button class="btn btn-primary" id="cal-save">Save</button><a class="btn btn-text" href="/auth/google">Reconnect</a></div>`;
      document.getElementById('cal-save').addEventListener('click', async () => {
        const ids = [...panel.querySelectorAll('.cal-list input:checked')].map((i) => i.value);
        await api('/api/me', { method: 'PUT', body: { conflictCalendars: ids } });
        me.conflictCalendars = ids;
        S.toast('Calendars saved');
      });
    } catch (err) {
      panel.innerHTML = `<p class="error-text">Couldn't load your calendars: ${esc(err.message)}</p><a class="btn btn-primary" href="/auth/google">Reconnect Google</a>`;
    }
  }

  // ---------- invite links (send hand-picked times) ----------

  const pad2 = (n) => String(n).padStart(2, '0');
  const localDateLabel = (key, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => {
    const [y, m, d] = key.split('-').map(Number);
    return S.fmtDate(Date.UTC(y, m - 1, d, 12), 'UTC', opts);
  };
  const localTimeLabel = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return S.fmtTime(Date.UTC(2024, 0, 1, h, m), 'UTC');
  };
  const STATUS = {
    open: ['Open', 'badge-ok'], booked: ['Booked', 'badge-blue'], expired: ['Expired', ''], cancelled: ['Turned off', 'badge-danger'],
  };

  function inviteEmailText(p, isoTimes) {
    const tz = me.timezone;
    const first = p.customerName ? p.customerName.split(/\s+/)[0] : '';
    const byDay = new Map();
    for (const iso of isoTimes) {
      const ms = Date.parse(iso);
      const day = S.fmtDate(ms, tz, { weekday: 'short', month: 'short', day: 'numeric' });
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(`   ${S.fmtTime(ms, tz)}  →  ${p.url}?slot=${encodeURIComponent(iso)}`);
    }
    return [
      first ? `Hi ${first},` : 'Hi,', '',
      ...(p.note ? [p.note, ''] : []),
      `Please pick a time for "${p.title}" (${S.durationLabel(p.duration)}). Click a link to book it instantly:`, '',
      ...[...byDay.entries()].flatMap(([day, lines]) => [day, ...lines, '']),
      `(Times in ${S.tzName(tz)}. The booking page shows them in your own time zone.)`, '',
      `All times: ${p.url}`, '', me.name,
    ].join('\n');
  }

  function shareInvite(p, { canSend }) {
    const open = p.status === 'open';
    const subject = `${me.name} has invited you to book: ${p.title}`;
    const mailto = `mailto:${encodeURIComponent(p.customerEmail || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(inviteEmailText(p, p.times.filter((t) => Date.parse(t) > Date.now())))}`;
    const m = S.modal({
      title: 'Send to your customer',
      width: 560,
      body: `<div class="share-link"><input class="input" value="${esc(p.url)}" readonly aria-label="Invite link"><button class="btn btn-primary" data-copy>Copy link</button></div>
        <p class="hint">Only the times you picked are shown on this link${p.singleUse ? ', and it closes once your customer books one' : ''}.</p>
        ${open ? `<div class="send-box">
          <div class="field" style="margin-bottom:12px"><label for="s-to">Customer email</label><input class="input" id="s-to" type="email" value="${esc(p.customerEmail)}" placeholder="customer@example.com"></div>
          <div class="row" style="flex-wrap:wrap">
            ${canSend ? `<button class="btn btn-primary" data-send>${icons.mail} Send from my Gmail</button>` : ''}
            <a class="btn ${canSend ? 'btn-ghost' : 'btn-primary'}" data-mailto href="${esc(mailto)}">${icons.mail} Open in my email app</a>
            <a class="btn btn-ghost" href="https://wa.me/?text=${encodeURIComponent(inviteEmailText(p, p.times.filter((t) => Date.parse(t) > Date.now())))}" target="_blank" rel="noopener">WhatsApp</a>
            <button class="btn btn-text" data-copy-text>${icons.copy} Copy message</button>
          </div>
          ${canSend ? '' : `<p class="hint" style="margin-bottom:0">${cfg.demo ? 'Sending straight from Gmail works once Google is connected.' : 'Want to send straight from Gmail? <a href="/auth/google">Reconnect Google</a> and allow sending email.'}</p>`}
        </div>` : ''}`,
    });
    const el = m.el;
    el.querySelector('[data-copy]').addEventListener('click', () => S.copy(p.url));
    el.querySelector('[data-copy-text]')?.addEventListener('click', () => S.copy(inviteEmailText(p, p.times.filter((t) => Date.parse(t) > Date.now())), 'Message copied — paste it anywhere'));
    const to = el.querySelector('#s-to');
    to?.addEventListener('input', () => {
      el.querySelector('[data-mailto]').href = mailto.replace(/^mailto:[^?]*/, `mailto:${encodeURIComponent(to.value.trim())}`);
    });
    el.querySelector('[data-send]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.value.trim())) { to.focus(); return S.toast('Enter your customer\'s email'); }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await api(`/api/proposals/${p.id}/send`, { method: 'POST', body: { to: to.value.trim() } });
        p.customerEmail = to.value.trim();
        m.close();
        S.toast(`Sent to ${to.value.trim()}`);
        if (location.pathname === '/app/invites') renderInvites();
      } catch (err) {
        btn.disabled = false; btn.innerHTML = `${icons.mail} Send from my Gmail`;
        S.toast(err.message);
      }
    });
  }

  async function renderInvites() {
    const { proposals, canSendEmail } = await api('/api/proposals');
    view.innerHTML = `<h1 class="page-title">Invite links</h1>
      <div class="owner-strip"><p class="muted" style="margin:0;flex:1;min-width:240px">Pick exact dates and times (even outside your usual hours) and send them to one customer. They choose one and it lands on your calendar.</p>
        <button class="btn btn-primary" data-route="/app/invites/new">${icons.plus} Send specific times</button></div>
      <div id="inv-list"></div>`;
    const box = document.getElementById('inv-list');
    if (!proposals.length) {
      box.innerHTML = `<div class="empty">${icons.mail}<h3>No invite links yet</h3><p>Choose a few times that work for you and send them to a customer in one click.</p><button class="btn btn-primary" data-route="/app/invites/new">Send specific times</button></div>`;
      return;
    }
    const tz = me.timezone;
    box.innerHTML = `<div class="panel">${proposals.map((p) => {
      const [label, cls] = STATUS[p.status] || [p.status, ''];
      const future = p.times.filter((t) => Date.parse(t) > Date.now());
      return `<div class="inv-row" data-id="${p.id}">
        <div class="inv-main">
          <div class="row" style="flex-wrap:wrap"><strong>${esc(p.customerName || p.customerEmail || 'Anyone with the link')}</strong><span class="badge ${cls}">${label}</span>${p.sentAt ? '<span class="badge">Emailed</span>' : ''}</div>
          <div class="muted small">${esc(p.title)} · ${S.durationLabel(p.duration)} · ${p.times.length} time${p.times.length > 1 ? 's' : ''} offered</div>
          <div class="inv-times">${p.times.slice(0, 6).map((t) => {
            const ms = Date.parse(t);
            const taken = p.bookings.some((b) => b.start === t);
            return `<span class="tchip ${taken ? 'taken' : ms < Date.now() ? 'past' : ''}">${esc(S.fmtDate(ms, tz, { weekday: 'short', month: 'short', day: 'numeric' }))}, ${S.fmtTime(ms, tz)}</span>`;
          }).join('')}${p.times.length > 6 ? `<span class="tchip">+${p.times.length - 6} more</span>` : ''}</div>
          ${p.bookings.map((b) => `<div class="small" style="margin-top:6px;color:var(--success);font-weight:600">${icons.check.replace('class="icon"', 'class="icon" style="width:14px;height:14px;vertical-align:-2px"')} ${esc(b.inviteeName)} booked ${esc(S.fmtDate(Date.parse(b.start), tz, { weekday: 'short', month: 'short', day: 'numeric' }))}, ${S.fmtTime(Date.parse(b.start), tz)}</div>`).join('')}
        </div>
        <div class="inv-actions">
          ${p.status === 'open' && future.length ? `<button class="btn btn-outline btn-sm" data-send>${icons.mail} Send</button>` : ''}
          <button class="btn btn-text" data-copy-url>${icons.copy} Copy link</button>
          ${p.status === 'open' ? `<button class="icon-btn" data-off title="Turn off link" aria-label="Turn off link">${icons.trash}</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
    box.addEventListener('click', async (e) => {
      const row = e.target.closest('.inv-row');
      if (!row) return;
      const p = proposals.find((x) => x.id === Number(row.dataset.id));
      if (e.target.closest('[data-copy-url]')) S.copy(p.url);
      if (e.target.closest('[data-send]')) shareInvite(p, { canSend: canSendEmail });
      if (e.target.closest('[data-off]')) {
        const ok = await S.confirmDialog({ title: 'Turn off this link?', message: 'Your customer will no longer be able to book from it. Meetings already booked are not affected.', confirmLabel: 'Turn off', danger: true });
        if (!ok) return;
        await api(`/api/proposals/${p.id}`, { method: 'DELETE' });
        S.toast('Link turned off');
        renderInvites();
      }
    });
  }

  async function renderNewInvite() {
    const tz = me.timezone;
    const todayKey = S.dateKey(Date.now(), tz);
    const [ty, tm] = todayKey.split('-').map(Number);
    const st = {
      year: ty, month: tm - 1, date: todayKey, allHours: false, duration: 30,
      selected: new Map(), // local "YYYY-MM-DDTHH:MM" -> { busy, inHours, past }
      dayTimes: [],
    };

    view.innerHTML = `<div class="row" style="margin-bottom:8px"><a class="btn btn-text" href="/app/invites">${icons.back} Invite links</a></div>
      <h1 class="page-title">Send specific times</h1>
      <div class="invite-layout">
        <section class="panel">
          <div class="panel-head"><h3><span class="step-num">1</span> Who is it for?</h3></div>
          <div class="panel-body">
            <div class="grid-2">
              <div class="field"><label for="n-name">Customer name</label><input class="input" id="n-name" placeholder="e.g. Riya Sharma" autocomplete="off"></div>
              <div class="field"><label for="n-email">Customer email</label><input class="input" id="n-email" type="email" placeholder="riya@company.com" autocomplete="off"></div>
            </div>
            <div class="field"><label for="n-title">Meeting title</label><input class="input" id="n-title" placeholder="Meeting with ${esc(me.name)}" maxlength="100"></div>
            <div class="field"><label for="n-duration">Duration</label>
              <select class="input" id="n-duration">${[15, 20, 30, 45, 60, 90, 120].map((d) => `<option value="${d}" ${d === 30 ? 'selected' : ''}>${S.durationLabel(d)}</option>`).join('')}</select></div>
            <div class="field"><span class="label">Location</span>
              <div class="loc-options">${Object.entries(S.LOCATIONS).map(([k, v]) => `<label><input type="radio" name="n-loc" value="${k}" ${k === 'meet' ? 'checked' : ''}>${icons[v.icon]}${v.label.replace(' meeting', '').replace('Custom location', 'Custom')}</label>`).join('')}</div>
              <input class="input" id="n-locval" hidden placeholder="Address or meeting link" aria-label="Location details">
            </div>
            <div class="field"><label for="n-note">Personal message (optional)</label><textarea class="input" id="n-note" rows="3" placeholder="Great speaking with you! Here are a few times that work for me."></textarea></div>
            <label class="checkbox"><input type="checkbox" id="n-single" checked><span>Close the link after one booking</span></label>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h3><span class="step-num">2</span> Pick the times</h3><span class="badge" id="sel-count">0 selected</span></div>
          <div class="panel-body">
            <div class="suggest-bar">
              <div class="suggest-title">${icons.hours}<div><strong>Let ${esc(cfg.appName)} pick for me</strong><div class="hint">Finds free times on your calendar, spread over different days, avoiding back-to-back meetings.</div></div></div>
              <div class="row" style="flex-wrap:wrap">
                <select class="input" id="sg-count" aria-label="How many times">${[3, 4, 5, 6].map((n) => `<option value="${n}">${n} times</option>`).join('')}</select>
                <select class="input" id="sg-period" aria-label="Time of day"><option value="any">Any time of day</option><option value="morning">Mornings</option><option value="afternoon">Afternoons</option><option value="evening">Evenings</option></select>
                <select class="input" id="sg-days" aria-label="Within"><option value="3">Next 3 days</option><option value="7" selected>Next 7 days</option><option value="14">Next 2 weeks</option><option value="30">Next 30 days</option></select>
                <button class="btn btn-primary" id="sg-go">Suggest times</button>
              </div>
            </div>
            <div class="or-line"><span>or choose your own</span></div>
            <div class="picker-2">
              <div id="mini-cal"></div>
              <div class="day-pane">
                <div class="row"><strong id="day-label"></strong><span class="spacer"></span><label class="checkbox small"><input type="checkbox" id="all-hours"> All hours</label></div>
                <div class="day-chips" id="day-chips"><div class="spinner"></div></div>
                <div class="custom-time">
                  <label for="ct-input" class="small" style="font-weight:600">Any custom time</label>
                  <div class="row"><input class="input" type="time" id="ct-input" step="300" value="10:00"><button class="btn btn-ghost btn-sm" id="ct-add">${icons.plus} Add</button></div>
                </div>
              </div>
            </div>
            <div class="sel-list" id="sel-list"></div>
            <p class="hint">Times are in your time zone (${esc(S.tzName(tz))}). Your customer sees them in theirs.</p>
          </div>
          <div class="modal-foot" style="justify-content:space-between;flex-wrap:wrap"><span id="n-error" class="error-text"></span><button class="btn btn-primary btn-lg" id="n-create">Create invite link</button></div>
        </section>
      </div>`;

    const $ = (id) => document.getElementById(id);

    function drawCalendar() {
      const first = new Date(Date.UTC(st.year, st.month, 1));
      const daysInMonth = new Date(Date.UTC(st.year, st.month + 1, 0)).getUTCDate();
      const lead = (first.getUTCDay() + 6) % 7;
      const prefix = `${st.year}-${pad2(st.month + 1)}`;
      const selDays = new Set([...st.selected.keys()].map((k) => k.slice(0, 10)));
      const atStart = st.year === ty && st.month === tm - 1;
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${prefix}-${pad2(d)}`;
        const past = key < todayKey;
        const cls = ['day', !past && 'avail', key === st.date && 'selected', key === todayKey && 'today', selDays.has(key) && 'has-sel'].filter(Boolean).join(' ');
        cells += past ? `<span class="${cls}">${d}</span>` : `<button class="${cls}" data-date="${key}" aria-label="${localDateLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}">${d}</button>`;
      }
      $('mini-cal').innerHTML = `<div class="cal-head"><button class="icon-btn" data-mon="-1" aria-label="Previous month" ${atStart ? 'disabled' : ''}>${icons.left}</button>
        <div class="month">${S.fmtDate(Date.UTC(st.year, st.month, 15), 'UTC', { month: 'long', year: 'numeric' })}</div>
        <button class="icon-btn" data-mon="1" aria-label="Next month">${icons.right}</button></div>
        <div class="cal-grid mini">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="dow">${d}</span>`).join('')}${cells}</div>`;
    }

    let daySeq = 0;
    async function loadDay() {
      const seq = ++daySeq;
      $('day-label').textContent = localDateLabel(st.date, { weekday: 'long', month: 'long', day: 'numeric' });
      $('day-chips').innerHTML = '<div class="spinner" style="margin:16px auto"></div>';
      try {
        const { times } = await api(`/api/day-times?date=${st.date}&duration=${st.duration}`);
        if (seq !== daySeq) return;
        st.dayTimes = times;
        drawDay();
      } catch (err) { $('day-chips').innerHTML = `<p class="error-text">${esc(err.message)}</p>`; }
    }

    function drawDay() {
      const list = st.dayTimes.filter((t) => !t.past && (st.allHours || t.inHours || st.selected.has(t.local)));
      $('day-chips').innerHTML = list.length ? list.map((t) => `<button class="tbtn ${st.selected.has(t.local) ? 'on' : ''} ${t.busy ? 'busy' : ''}" data-local="${t.local}" title="${t.busy ? 'You have something else at this time' : t.inHours ? 'Free' : 'Outside your working hours'}">${localTimeLabel(t.local.slice(11))}${t.busy ? '<small>busy</small>' : ''}</button>`).join('')
        : `<p class="hint" style="margin:8px 0">${st.dayTimes.some((t) => !t.past) ? 'Outside your working hours. Tick “All hours” or add a custom time below.' : 'This day is over. Pick another date.'}</p>`;
    }

    function drawSelected() {
      $('sel-count').textContent = `${st.selected.size} selected`;
      const keys = [...st.selected.keys()].sort();
      if (!keys.length) {
        $('sel-list').innerHTML = '<div class="sel-empty">No times yet. Use <strong>Suggest times</strong> or tap times above.</div>';
        return;
      }
      const byDay = new Map();
      for (const k of keys) {
        if (!byDay.has(k.slice(0, 10))) byDay.set(k.slice(0, 10), []);
        byDay.get(k.slice(0, 10)).push(k);
      }
      $('sel-list').innerHTML = [...byDay.entries()].map(([day, list]) => `<div class="sel-day"><div class="sel-day-label">${localDateLabel(day)}</div><div class="sel-chips">
        ${list.map((k) => {
          const info = st.selected.get(k) || {};
          const warn = info.busy ? 'Conflicts with your calendar' : info.inHours === false ? 'Outside working hours' : '';
          return `<span class="schip ${info.busy ? 'warn' : ''}" title="${warn}">${localTimeLabel(k.slice(11))}${info.busy ? ` ${icons.alert}` : ''}<button data-remove="${k}" aria-label="Remove ${localTimeLabel(k.slice(11))}">×</button></span>`;
        }).join('')}</div></div>`).join('')
        + ([...st.selected.values()].some((i) => i.busy) ? `<p class="small" style="color:#9a5b00;margin:4px 0 0">${icons.alert.replace('class="icon"', 'class="icon" style="width:14px;height:14px;vertical-align:-2px"')} Some times clash with your calendar. You can still send them.</p>` : '');
    }

    let checkTimer;
    function refreshFlags() {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(async () => {
        const times = [...st.selected.keys()];
        if (!times.length) return;
        try {
          const res = await api('/api/check-times', { method: 'POST', body: { times, duration: st.duration } });
          for (const t of res.times) if (st.selected.has(t.local)) st.selected.set(t.local, t);
          drawSelected();
        } catch { /* flags are best-effort */ }
      }, 250);
    }

    function toggle(local, info) {
      if (st.selected.has(local)) st.selected.delete(local);
      else {
        if (st.selected.size >= 30) return S.toast('You can offer up to 30 times');
        st.selected.set(local, info || {});
      }
      drawSelected(); drawDay(); drawCalendar();
      if (!info) refreshFlags();
    }

    drawCalendar(); drawSelected(); loadDay();

    $('mini-cal').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.date) { st.date = b.dataset.date; drawCalendar(); loadDay(); }
      if (b.dataset.mon) {
        st.month += Number(b.dataset.mon);
        if (st.month > 11) { st.month = 0; st.year++; }
        if (st.month < 0) { st.month = 11; st.year--; }
        drawCalendar();
      }
    });
    $('day-chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-local]');
      if (b) toggle(b.dataset.local, st.dayTimes.find((t) => t.local === b.dataset.local));
    });
    $('sel-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (b) toggle(b.dataset.remove);
    });
    $('all-hours').addEventListener('change', (e) => { st.allHours = e.target.checked; drawDay(); });
    $('ct-add').addEventListener('click', () => {
      const v = $('ct-input').value;
      if (!/^\d{2}:\d{2}$/.test(v)) return S.toast('Enter a time');
      const local = `${st.date}T${v}`;
      if (st.selected.has(local)) return S.toast('Already added');
      const ms = Date.parse(`${st.date}T${v}:00Z`);
      if (st.date === todayKey && v <= S.fmtTime(Date.now(), tz, false).padStart(5, '0')) return S.toast('That time has already passed');
      if (Number.isNaN(ms)) return S.toast('Enter a valid time');
      toggle(local);
    });
    $('n-duration').addEventListener('change', (e) => { st.duration = Number(e.target.value); loadDay(); refreshFlags(); });
    document.querySelectorAll('[name=n-loc]').forEach((r) => r.addEventListener('change', () => {
      const v = document.querySelector('[name=n-loc]:checked').value;
      $('n-locval').hidden = !['in_person', 'custom'].includes(v);
      $('n-locval').placeholder = v === 'in_person' ? 'Address' : 'Meeting link or instructions';
    }));
    $('n-name').addEventListener('input', (e) => {
      $('n-title').placeholder = e.target.value.trim() ? `${me.name} and ${e.target.value.trim().split(/\s+/)[0]}` : `Meeting with ${me.name}`;
    });

    $('sg-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Finding times…';
      try {
        const { times } = await api('/api/suggest', { method: 'POST', body: { duration: st.duration, count: Number($('sg-count').value), period: $('sg-period').value, days: Number($('sg-days').value), exclude: [...st.selected.keys()] } });
        if (!times.length) S.toast('No free times found. Try a longer range or a different time of day.');
        let added = 0;
        for (const t of times) if (!st.selected.has(t.local) && st.selected.size < 30) { st.selected.set(t.local, t); added++; }
        if (times[0]) {
          st.date = times[0].local.slice(0, 10);
          [st.year, st.month] = [Number(st.date.slice(0, 4)), Number(st.date.slice(5, 7)) - 1];
        }
        drawSelected(); drawCalendar(); loadDay();
        if (added) S.toast(`Added ${added} suggested time${added > 1 ? 's' : ''}`);
      } catch (err) { S.toast(err.message); }
      btn.disabled = false; btn.textContent = 'Suggest times';
    });

    $('n-create').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      $('n-error').textContent = '';
      if (!st.selected.size) { $('n-error').textContent = 'Pick at least one time.'; return; }
      const email = $('n-email').value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('n-error').textContent = 'Customer email looks invalid.'; return $('n-email').focus(); }
      const locationType = document.querySelector('[name=n-loc]:checked').value;
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const { proposal } = await api('/api/proposals', {
          method: 'POST',
          body: {
            title: $('n-title').value.trim() || $('n-title').placeholder, duration: st.duration, locationType, locationValue: $('n-locval').value,
            note: $('n-note').value, customerName: $('n-name').value, customerEmail: email, singleUse: $('n-single').checked,
            times: [...st.selected.keys()],
          },
        });
        history.pushState(null, '', '/app/invites');
        await renderInvites();
        document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === 'invites'));
        shareInvite(proposal, { canSend: me.canSendEmail });
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Create invite link';
        $('n-error').textContent = err.message;
      }
    });
  }

  // ---------- access requests (invite-only mode, site owner only) ----------

  async function refreshRequestCount() {
    try {
      const { requests } = await api('/api/access-requests');
      const n = requests.filter((r) => r.status === 'pending').length;
      const badge = document.getElementById('req-count');
      badge.textContent = n;
      badge.hidden = !n;
    } catch { /* not an admin */ }
  }

  async function renderRequests() {
    const { requests, canSendEmail } = await api('/api/access-requests');
    const signupUrl = `${cfg.baseUrl}/request-access`;
    view.innerHTML = `<h1 class="page-title">Access requests</h1>
      <div class="owner-strip"><p class="muted" style="margin:0;flex:1;min-width:240px">People who asked to use ${esc(cfg.appName)} for their own bookings. Approve someone and they can sign in with Google${canSendEmail ? ', and they get an email telling them so' : ''}. Your clients never need this; they book from your link without an account.</p>
        <button class="btn btn-ghost" data-copy-signup>${icons.copy} Copy request link</button></div>
      <div id="req-list"></div>`;
    view.querySelector('[data-copy-signup]').addEventListener('click', () => S.copy(signupUrl));
    const box = document.getElementById('req-list');
    if (!requests.length) {
      box.innerHTML = `<div class="empty">${icons.users}<h3>No requests yet</h3><p>When someone asks for access on ${esc(signupUrl.replace(/^https?:\/\//, ''))}, they'll show up here and you'll get an email.</p></div>`;
      return;
    }
    const label = { pending: ['Waiting', 'badge-warn'], approved: ['Approved', 'badge-ok'], declined: ['Declined', 'badge-danger'] };
    box.innerHTML = `<div class="panel">${requests.map((r) => `<div class="req-row" data-id="${r.id}">
        <div class="req-main">
          <div class="row" style="flex-wrap:wrap"><strong>${esc(r.name)}</strong><span class="badge ${label[r.status][1]}">${label[r.status][0]}</span></div>
          <div class="small"><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.company ? ` · ${esc(r.company)}` : ''}</div>
          <div class="muted small">${esc(r.purpose || '')}${r.purpose ? ' · ' : ''}${esc(S.fmtDate(Date.parse(r.createdAt), me.timezone, { month: 'short', day: 'numeric', year: 'numeric' }))}</div>
          ${r.message ? `<div class="msg">${esc(r.message)}</div>` : ''}
        </div>
        <div class="inv-actions">
          ${r.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-decide="approve">${icons.check} Approve</button>` : ''}
          ${r.status === 'pending' ? '<button class="btn btn-ghost btn-sm" data-decide="decline">Decline</button>' : ''}
        </div>
      </div>`).join('')}</div>`;
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-decide]');
      if (!b) return;
      const r = requests.find((x) => x.id === Number(b.closest('.req-row').dataset.id));
      b.disabled = true;
      try {
        const res = await api(`/api/access-requests/${r.id}/${b.dataset.decide}`, { method: 'POST' });
        S.toast(b.dataset.decide === 'approve'
          ? (res.emailed ? `Approved. ${r.name} has been emailed.` : `Approved. Let ${r.name} know they can sign in.`)
          : 'Request declined');
        renderRequests();
        refreshRequestCount();
      } catch (err) { b.disabled = false; S.toast(err.message); }
    });
  }

  renderChrome();
  navigate(location.pathname, false);
})();
