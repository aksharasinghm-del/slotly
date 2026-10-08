/* Public booking page: /:username/:slug */
(async function () {
  const { api, esc, icons } = S;
  const root = document.getElementById('root');
  const [, username, slug] = location.pathname.split('/').map(decodeURIComponent);
  const params = new URLSearchParams(location.search);
  const embed = params.has('embed');
  const rescheduleUid = params.get('reschedule');
  const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const DAY = 86400000;

  const state = {
    tz: S.browserTz,
    h12: true,
    year: 0, month: 0, // month is 0-based
    raw: [], // slot start times (ms) covering the visible month
    loading: true,
    selectedDate: null,
    selectedSlot: null,
    step: 'pick',
    guests: [],
    showGuests: false,
    autoAdvance: 2,
    error: '',
  };
  try {
    const saved = localStorage.getItem('slotly:h12');
    if (saved !== null) state.h12 = saved === '1';
  } catch { /* storage unavailable */ }

  if (embed) document.querySelector('.public-page').classList.add('embed');

  let host, et, appName = 'Slotly', oldBooking = null;
  try {
    const [data, cfg] = await Promise.all([api(`/api/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`), api('/api/config')]);
    host = data.user; et = data.eventType; appName = cfg.appName;
    if (rescheduleUid) {
      const r = await api(`/api/b/${encodeURIComponent(rescheduleUid)}`);
      if (r.booking.status !== 'confirmed') throw new Error('This event was canceled and can no longer be rescheduled.');
      oldBooking = r.booking;
      if (oldBooking.inviteeTz) state.tz = oldBooking.inviteeTz;
    }
  } catch (err) {
    root.innerHTML = `<div class="public-card confirm-card"><h1>${err.status === 404 ? 'This page is not available' : 'Something went wrong'}</h1>
      <p class="lead">${esc(err.status === 404 ? 'The link may be incorrect, or the event may have been turned off.' : err.message)}</p>
      <a class="btn btn-outline" href="/${esc(username)}">View all events</a></div>`;
    return;
  }
  document.title = `${et.name} | ${host.name}`;

  const todayKey = () => S.dateKey(Date.now(), state.tz);
  {
    const [y, m] = todayKey().split('-').map(Number);
    state.year = y; state.month = m - 1;
  }

  // Deep link to a specific time (from "share times" emails).
  const deepSlot = params.get('slot') ? Date.parse(params.get('slot')) : NaN;
  if (!Number.isNaN(deepSlot)) {
    const [y, m] = S.dateKey(deepSlot, state.tz).split('-').map(Number);
    state.year = y; state.month = m - 1; state.autoAdvance = 0;
  }

  function grouped() {
    const map = new Map();
    for (const ms of state.raw) {
      const key = S.dateKey(ms, state.tz);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ms);
    }
    return map;
  }

  const monthPrefix = () => `${state.year}-${String(state.month + 1).padStart(2, '0')}`;

  let loadSeq = 0;
  async function loadMonth() {
    const seq = ++loadSeq;
    state.loading = true;
    render();
    const from = Date.UTC(state.year, state.month, 1) - DAY;
    const to = Date.UTC(state.year, state.month + 1, 1) + DAY;
    try {
      const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      if (oldBooking) q.set('reschedule', oldBooking.uid);
      const data = await api(`/api/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/slots?${q}`);
      if (seq !== loadSeq) return;
      state.raw = data.slots.map((s) => Date.parse(s));
    } catch (err) {
      if (seq !== loadSeq) return;
      state.raw = [];
      state.error = err.message;
    }
    state.loading = false;
    const days = [...grouped().keys()].filter((k) => k.startsWith(monthPrefix()));

    if (!Number.isNaN(deepSlot) && state.raw.includes(deepSlot) && state.step === 'pick' && !state.selectedSlot) {
      state.selectedDate = S.dateKey(deepSlot, state.tz);
      state.selectedSlot = deepSlot;
      state.step = 'form';
    } else if (!days.length && state.autoAdvance > 0) {
      state.autoAdvance--;
      state.month++;
      if (state.month > 11) { state.month = 0; state.year++; }
      return loadMonth();
    }
    state.autoAdvance = 0;
    render();
  }

  // ---------- rendering ----------

  function infoPanel() {
    const slot = state.step === 'form' && state.selectedSlot;
    const end = slot && slot + et.duration * 60000;
    return `<aside class="bk-info">
      ${state.step === 'form' ? `<button class="icon-btn back" data-action="back" aria-label="Back">${icons.back}</button>` : ''}
      <div class="host" ${state.step === 'form' ? 'style="margin-top:44px"' : ''}>
        ${S.avatar(host, 56)}
        <div class="host-name">${esc(host.name)}</div>
        <h1>${esc(et.name)}</h1>
      </div>
      <div class="bk-meta">
        <div>${icons.clock}<span>${S.durationLabel(et.duration)}</span></div>
        ${S.locationLine(et.locationType, et.locationValue)}
        ${slot ? `<div class="highlight">${icons.calendar}<span>${S.fmtTime(slot, state.tz, state.h12)} - ${S.fmtTime(end, state.tz, state.h12)}, ${esc(S.fmtDate(slot, state.tz))}</span></div>
          <div class="highlight">${icons.globe}<span>${esc(S.tzName(state.tz, slot))}</span></div>` : ''}
        ${oldBooking ? `<div>${icons.calendar}<span><span class="small faint">Former time</span><br><s>${S.fmtTime(Date.parse(oldBooking.start), state.tz, state.h12)}, ${esc(S.fmtDate(Date.parse(oldBooking.start), state.tz))}</s></span></div>` : ''}
      </div>
      ${et.description ? `<div class="bk-desc">${esc(et.description)}</div>` : ''}
    </aside>`;
  }

  function calendarHtml(groups) {
    const first = new Date(Date.UTC(state.year, state.month, 1));
    const daysInMonth = new Date(Date.UTC(state.year, state.month + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const [ty, tm] = todayKey().split('-').map(Number);
    const atStart = state.year < ty || (state.year === ty && state.month <= tm - 1);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${monthPrefix()}-${String(d).padStart(2, '0')}`;
      const avail = !state.loading && groups.has(key);
      const cls = ['day', avail && 'avail', key === state.selectedDate && 'selected', key === todayKey() && 'today'].filter(Boolean).join(' ');
      const label = S.fmtDate(Date.UTC(state.year, state.month, d, 12), 'UTC', { weekday: 'long', month: 'long', day: 'numeric' });
      cells.push(avail
        ? `<button class="${cls}" data-date="${key}" aria-label="${label} - Times available" aria-pressed="${key === state.selectedDate}">${d}</button>`
        : `<span class="${cls}" aria-label="${label} - No times available">${d}</span>`);
    }
    const monthLabel = S.fmtDate(Date.UTC(state.year, state.month, 15), 'UTC', { month: 'long', year: 'numeric' });
    const hasAny = [...groups.keys()].some((k) => k.startsWith(monthPrefix()));
    return `<div class="cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="prev" aria-label="Previous month" ${atStart ? 'disabled' : ''}>${icons.left}</button>
        <div class="month">${monthLabel}</div>
        <button class="icon-btn" data-action="next" aria-label="Next month">${icons.right}</button>
      </div>
      <div class="cal-grid">${DOW.map((d) => `<span class="dow">${d}</span>`).join('')}${cells.join('')}</div>
      ${state.loading ? '<div class="spinner" style="margin:18px auto"></div>' : ''}
      ${!state.loading && !hasAny ? `<p class="empty-day" style="text-align:center;margin-top:18px">No times available in ${esc(monthLabel)}. <button class="btn-text btn" data-action="next">View next month</button></p>` : ''}
      ${state.error ? `<p class="error-text">${esc(state.error)}</p>` : ''}
      <div class="tz-row">
        <span class="label">Time zone</span>
        <label class="tz-select">${icons.globe}<select data-action="tz" aria-label="Time zone">${S.tzOptions(state.tz, state.h12)}</select></label>
      </div>
    </div>`;
  }

  function timesHtml(groups) {
    if (!state.selectedDate) return '';
    const list = groups.get(state.selectedDate) || [];
    const [y, m, d] = state.selectedDate.split('-').map(Number);
    const label = S.fmtDate(Date.UTC(y, m - 1, d, 12), 'UTC', { weekday: 'long', month: 'long', day: 'numeric' });
    return `<div class="times">
      <div class="row" style="margin-bottom:4px"><h3 style="margin:6px 0">${label}</h3>
        <div class="fmt-toggle" role="group" aria-label="Time format"><button class="${state.h12 ? 'on' : ''}" data-h12="1">am/pm</button><button class="${state.h12 ? '' : 'on'}" data-h12="0">24h</button></div>
      </div>
      <div class="times-list" style="margin-top:14px">
        ${list.length ? list.map((ms) => state.selectedSlot === ms
          ? `<div class="time-row selected"><button class="time-btn" data-slot="${ms}">${S.fmtTime(ms, state.tz, state.h12)}</button><button class="btn btn-primary next" data-action="to-form">Next</button></div>`
          : `<div class="time-row"><button class="time-btn" data-slot="${ms}">${S.fmtTime(ms, state.tz, state.h12)}</button></div>`).join('')
          : '<p class="empty-day">No times left on this day.</p>'}
      </div>
    </div>`;
  }

  function formHtml() {
    if (oldBooking) {
      return `<h2>Confirm new time</h2>
        <form class="details-form" id="details">
          <div id="form-error"></div>
          <div class="field"><label for="reason">Reason for reschedule (optional)</label><textarea class="input" id="reason" name="reason" rows="3"></textarea></div>
          <button class="btn btn-primary btn-lg" type="submit">Reschedule Event</button>
        </form>`;
    }
    return `<h2>Enter Details</h2>
      <form class="details-form" id="details" novalidate>
        <div id="form-error"></div>
        <div class="field"><label for="name">Name *</label><input class="input" id="name" name="name" autocomplete="name" required></div>
        <div class="field"><label for="email">Email *</label><input class="input" id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field">
          ${state.showGuests ? `<label for="guest-input">Guest Email(s)</label>
            <div class="guest-chips" id="guest-chips"></div>
            <input class="input" id="guest-input" placeholder="Type an email and press Enter">
            <span class="hint">Notify up to 10 additional guests of the scheduled event.</span>`
          : `<div><button type="button" class="btn btn-outline btn-sm" data-action="guests">Add Guests</button></div>`}
        </div>
        ${et.locationType === 'phone' ? `<div class="field"><label for="phone">Phone Number *</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel" required></div>` : ''}
        <div class="field"><label for="notes">Please share anything that will help prepare for our meeting.</label><textarea class="input" id="notes" name="notes"></textarea></div>
        <p class="terms">By proceeding, you confirm that you have read and agree to the scheduling terms of ${esc(host.name)}.</p>
        <button class="btn btn-primary btn-lg" type="submit">Schedule Event</button>
      </form>`;
  }

  function render() {
    const prevForm = document.getElementById('details');
    if (prevForm) state.formValues = Object.fromEntries(new FormData(prevForm));
    const groups = grouped();
    const showTimes = state.step === 'pick' && state.selectedDate;
    root.innerHTML = `<div class="public-card book-card ${showTimes || state.step === 'form' ? '' : 'narrow'}">
      ${embed ? '' : S.poweredBy(appName)}
      ${infoPanel()}
      <section class="bk-main">
        ${state.step === 'pick'
          ? `<h2>${oldBooking ? 'Select a New Date &amp; Time' : 'Select a Date &amp; Time'}</h2><div class="picker">${calendarHtml(groups)}${timesHtml(groups)}</div>`
          : formHtml()}
      </section>
    </div>`;
    if (state.step === 'form') bindForm();
  }

  function renderGuests() {
    const box = document.getElementById('guest-chips');
    if (!box) return;
    box.innerHTML = state.guests.map((g, i) => `<span class="chip">${esc(g)}<button type="button" data-remove-guest="${i}" aria-label="Remove ${esc(g)}">×</button></span>`).join('');
  }

  function addGuest(input) {
    const values = input.value.split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);
    for (const v of values) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { S.toast(`"${v}" is not a valid email`); continue; }
      if (state.guests.length >= 10) { S.toast('You can add up to 10 guests'); break; }
      if (!state.guests.includes(v)) state.guests.push(v);
    }
    input.value = '';
    renderGuests();
  }

  function showFormError(msg) {
    const box = document.getElementById('form-error');
    if (box) box.innerHTML = msg ? `<div class="form-error" role="alert">${esc(msg)}</div>` : '';
  }

  function bindForm() {
    const form = document.getElementById('details');
    for (const [k, v] of Object.entries(state.formValues || {})) if (form.elements[k]) form.elements[k].value = v;
    renderGuests();
    const guestInput = document.getElementById('guest-input');
    guestInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(guestInput); }
    });
    guestInput?.addEventListener('blur', () => guestInput.value && addGuest(guestInput));
    form.querySelector('input, textarea')?.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      showFormError('');
      const btn = form.querySelector('button[type=submit]');
      if (guestInput?.value) addGuest(guestInput);
      const fd = new FormData(form);
      const start = new Date(state.selectedSlot).toISOString();
      const suffix = embed ? '&embed=1' : '';
      try {
        if (oldBooking) {
          btn.disabled = true; btn.textContent = 'Rescheduling…';
          await api(`/api/b/${encodeURIComponent(oldBooking.uid)}/reschedule`, { method: 'POST', body: { start, reason: fd.get('reason') } });
          location.href = `/booking/${oldBooking.uid}?rescheduled=1${suffix}`;
          return;
        }
        const name = String(fd.get('name') || '').trim(), email = String(fd.get('email') || '').trim();
        if (!name) return showFormError('Please enter your name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showFormError('Please enter a valid email address.');
        if (et.locationType === 'phone' && !String(fd.get('phone') || '').trim()) return showFormError('Please enter your phone number.');
        btn.disabled = true; btn.textContent = 'Scheduling…';
        const res = await api(`/api/u/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/book`, {
          method: 'POST',
          body: { start, name, email, guests: state.guests, phone: fd.get('phone') || '', notes: fd.get('notes') || '', timezone: state.tz },
        });
        location.href = `/booking/${res.booking.uid}?new=1${suffix}`;
      } catch (err) {
        btn.disabled = false;
        btn.textContent = oldBooking ? 'Reschedule Event' : 'Schedule Event';
        showFormError(err.message);
        if (err.status === 409) {
          setTimeout(() => {
            state.step = 'pick'; state.selectedSlot = null;
            loadMonth();
          }, 2200);
        }
      }
    });
  }

  // ---------- events ----------

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.removeGuest !== undefined) {
      state.guests.splice(Number(t.dataset.removeGuest), 1);
      return renderGuests();
    }
    if (t.dataset.date) {
      state.selectedDate = t.dataset.date; state.selectedSlot = null;
      return render();
    }
    if (t.dataset.slot) {
      state.selectedSlot = Number(t.dataset.slot);
      render();
      root.querySelector('.time-row.selected .next')?.focus();
      return;
    }
    if (t.dataset.h12 !== undefined) {
      state.h12 = t.dataset.h12 === '1';
      try { localStorage.setItem('slotly:h12', state.h12 ? '1' : '0'); } catch { /* ignore */ }
      return render();
    }
    switch (t.dataset.action) {
      case 'prev':
      case 'next': {
        state.month += t.dataset.action === 'next' ? 1 : -1;
        if (state.month > 11) { state.month = 0; state.year++; }
        if (state.month < 0) { state.month = 11; state.year--; }
        state.selectedDate = null; state.selectedSlot = null; state.error = '';
        return loadMonth();
      }
      case 'to-form':
        state.step = 'form';
        render();
        return window.scrollTo({ top: 0 });
      case 'back':
        state.step = 'pick';
        return render();
      case 'guests':
        state.showGuests = true;
        render();
        return document.getElementById('guest-input')?.focus();
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'tz') {
      state.tz = e.target.value;
      state.selectedDate = null; state.selectedSlot = null;
      render();
    }
  });

  loadMonth();
})();
