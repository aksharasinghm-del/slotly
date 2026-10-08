/* Customer invite page: /p/:token — books one of the host's hand-picked times. */
(async function () {
  const { api, esc, icons } = S;
  const root = document.getElementById('root');
  const token = decodeURIComponent(location.pathname.split('/')[2]);
  const params = new URLSearchParams(location.search);
  const embed = params.has('embed');
  const rescheduleUid = params.get('reschedule');
  if (embed) document.querySelector('.public-page').classList.add('embed');

  const st = { tz: S.browserTz, h12: true, selected: null, step: 'pick', guests: [], showGuests: false };
  try { const v = localStorage.getItem('slotly:h12'); if (v !== null) st.h12 = v === '1'; } catch { /* ignore */ }

  let data, appName = 'Slotly', oldBooking = null;
  try {
    const q = rescheduleUid ? `?reschedule=${encodeURIComponent(rescheduleUid)}` : '';
    [data, { appName }] = await Promise.all([api(`/api/p/${encodeURIComponent(token)}${q}`), api('/api/config')]);
    if (rescheduleUid) {
      oldBooking = (await api(`/api/b/${encodeURIComponent(rescheduleUid)}`)).booking;
      if (oldBooking.inviteeTz) st.tz = oldBooking.inviteeTz;
    }
  } catch (err) {
    root.innerHTML = `<div class="public-card confirm-card"><h1>This link isn't valid</h1><p class="lead">${esc(err.status === 404 ? 'Please check the link you were sent.' : err.message)}</p></div>`;
    return;
  }
  const { host, proposal: p } = data;
  const times = data.times.map((t) => Date.parse(t));
  document.title = `${p.title} | ${host.name}`;
  const first = p.customerName ? p.customerName.split(/\s+/)[0] : '';

  const deep = params.get('slot') ? Date.parse(params.get('slot')) : NaN;
  if (times.includes(deep)) { st.selected = deep; st.step = 'form'; }

  if (data.status !== 'open') {
    const msg = {
      booked: ['This invite has already been used', 'A time has already been booked from this link. Check your email for the calendar invitation.'],
      cancelled: ['This invite is no longer active', `${host.name} has turned off this link.`],
      unavailable: ['These times are no longer available', 'All the suggested times have passed or been taken.'],
    }[data.status];
    root.innerHTML = `<div class="public-card confirm-card">${embed ? '' : S.poweredBy(appName)}${S.avatar(host, 56)}
      <h1>${esc(msg[0])}</h1><p class="lead">${esc(msg[1])}</p>
      <a class="btn btn-primary" href="/${esc(host.username)}">See other times with ${esc(host.name)}</a></div>`;
    return;
  }

  function info() {
    const end = st.selected && st.selected + p.duration * 60000;
    return `<aside class="bk-info">
      ${st.step === 'form' ? `<button class="icon-btn back" data-action="back" aria-label="Back">${icons.back}</button>` : ''}
      <div class="host" ${st.step === 'form' ? 'style="margin-top:44px"' : ''}>${S.avatar(host, 56)}<div class="host-name">${esc(host.name)}</div><h1>${esc(p.title)}</h1></div>
      <div class="bk-meta">
        <div>${icons.clock}<span>${S.durationLabel(p.duration)}</span></div>
        ${S.locationLine(p.locationType, p.locationValue)}
        ${st.step === 'form' ? `<div class="highlight">${icons.calendar}<span>${S.fmtTime(st.selected, st.tz, st.h12)} - ${S.fmtTime(end, st.tz, st.h12)}, ${esc(S.fmtDate(st.selected, st.tz))}</span></div>
          <div class="highlight">${icons.globe}<span>${esc(S.tzName(st.tz, st.selected))}</span></div>` : ''}
        ${oldBooking ? `<div>${icons.calendar}<span><span class="small faint">Former time</span><br><s>${S.fmtTime(Date.parse(oldBooking.start), st.tz, st.h12)}, ${esc(S.fmtDate(Date.parse(oldBooking.start), st.tz))}</s></span></div>` : ''}
      </div>
      ${p.note ? `<div class="note-box"><div class="small faint" style="font-weight:600;margin-bottom:4px">Message from ${esc(host.name.split(/\s+/)[0])}</div>${esc(p.note)}</div>` : ''}
    </aside>`;
  }

  function pickHtml() {
    const byDay = new Map();
    for (const ms of times) {
      const key = S.dateKey(ms, st.tz);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(ms);
    }
    return `<h2>${oldBooking ? 'Pick a new time' : first ? `Hi ${esc(first)}, pick a time that works for you` : 'Pick a time that works for you'}</h2>
      <div class="row" style="flex-wrap:wrap;margin:-8px 0 20px">
        <label class="tz-select">${icons.globe}<select data-action="tz" aria-label="Time zone">${S.tzOptions(st.tz, st.h12)}</select></label>
        <div class="fmt-toggle" role="group" aria-label="Time format"><button class="${st.h12 ? 'on' : ''}" data-h12="1">am/pm</button><button class="${st.h12 ? '' : 'on'}" data-h12="0">24h</button></div>
      </div>
      <div class="inv-days">${[...byDay.entries()].map(([key, list]) => {
        const [y, m, d] = key.split('-').map(Number);
        return `<div class="inv-day"><h3>${S.fmtDate(Date.UTC(y, m - 1, d, 12), 'UTC', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <div class="slot-grid">${list.map((ms) => st.selected === ms
            ? `<div class="time-row selected"><button class="time-btn" data-slot="${ms}">${S.fmtTime(ms, st.tz, st.h12)}</button><button class="btn btn-primary next" data-action="next">Next</button></div>`
            : `<div class="time-row"><button class="time-btn" data-slot="${ms}">${S.fmtTime(ms, st.tz, st.h12)}</button></div>`).join('')}</div></div>`;
      }).join('')}</div>
      <p class="hint" style="margin-top:22px">None of these work? <a href="/${esc(host.username)}">See ${esc(host.name)}'s other availability</a></p>`;
  }

  function formHtml() {
    if (oldBooking) {
      return `<h2>Confirm new time</h2><form class="details-form" id="details"><div id="form-error"></div>
        <button class="btn btn-primary btn-lg" type="submit">Reschedule Event</button></form>`;
    }
    return `<h2>Enter Details</h2>
      <form class="details-form" id="details" novalidate>
        <div id="form-error"></div>
        <div class="field"><label for="name">Name *</label><input class="input" id="name" name="name" autocomplete="name" value="${esc(p.customerName)}"></div>
        <div class="field"><label for="email">Email *</label><input class="input" id="email" name="email" type="email" autocomplete="email" value="${esc(p.customerEmail)}"></div>
        <div class="field">${st.showGuests ? `<label for="guest-input">Guest Email(s)</label><div class="guest-chips" id="guest-chips"></div>
            <input class="input" id="guest-input" placeholder="Type an email and press Enter"><span class="hint">Notify up to 10 additional guests.</span>`
          : '<div><button type="button" class="btn btn-outline btn-sm" data-action="guests">Add Guests</button></div>'}</div>
        ${p.locationType === 'phone' ? '<div class="field"><label for="phone">Phone Number *</label><input class="input" id="phone" name="phone" type="tel" autocomplete="tel"></div>' : ''}
        <div class="field"><label for="notes">Anything that will help prepare for the meeting?</label><textarea class="input" id="notes" name="notes"></textarea></div>
        <button class="btn btn-primary btn-lg" type="submit">Schedule Event</button>
      </form>`;
  }

  function render() {
    const prev = document.getElementById('details');
    if (prev) st.formValues = Object.fromEntries(new FormData(prev));
    root.innerHTML = `<div class="public-card book-card narrow">${embed ? '' : S.poweredBy(appName)}${info()}
      <section class="bk-main">${st.step === 'pick' ? pickHtml() : formHtml()}</section></div>`;
    if (st.step === 'form') bindForm();
  }

  function renderGuests() {
    const box = document.getElementById('guest-chips');
    if (box) box.innerHTML = st.guests.map((g, i) => `<span class="chip">${esc(g)}<button type="button" data-remove-guest="${i}" aria-label="Remove ${esc(g)}">×</button></span>`).join('');
  }

  function addGuest(input) {
    for (const v of input.value.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { S.toast(`"${v}" is not a valid email`); continue; }
      if (st.guests.length >= 10) break;
      if (!st.guests.includes(v)) st.guests.push(v);
    }
    input.value = '';
    renderGuests();
  }

  function bindForm() {
    const form = document.getElementById('details');
    for (const [k, v] of Object.entries(st.formValues || {})) if (form.elements[k]) form.elements[k].value = v;
    renderGuests();
    const gi = document.getElementById('guest-input');
    gi?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addGuest(gi); } });
    gi?.addEventListener('blur', () => gi.value && addGuest(gi));
    const err = (m) => { document.getElementById('form-error').innerHTML = m ? `<div class="form-error" role="alert">${esc(m)}</div>` : ''; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err('');
      if (gi?.value) addGuest(gi);
      const fd = new FormData(form);
      const btn = form.querySelector('[type=submit]');
      const start = new Date(st.selected).toISOString();
      const suffix = embed ? '&embed=1' : '';
      try {
        if (oldBooking) {
          btn.disabled = true; btn.textContent = 'Rescheduling…';
          await api(`/api/b/${encodeURIComponent(oldBooking.uid)}/reschedule`, { method: 'POST', body: { start } });
          location.href = `/booking/${oldBooking.uid}?rescheduled=1${suffix}`;
          return;
        }
        const name = String(fd.get('name') || '').trim(), email = String(fd.get('email') || '').trim();
        if (!name) return err('Please enter your name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Please enter a valid email address.');
        if (p.locationType === 'phone' && !String(fd.get('phone') || '').trim()) return err('Please enter your phone number.');
        btn.disabled = true; btn.textContent = 'Scheduling…';
        const res = await api(`/api/p/${encodeURIComponent(token)}/book`, {
          method: 'POST',
          body: { start, name, email, guests: st.guests, phone: fd.get('phone') || '', notes: fd.get('notes') || '', timezone: st.tz },
        });
        location.href = `/booking/${res.booking.uid}?new=1${suffix}`;
      } catch (ex) {
        btn.disabled = false; btn.textContent = oldBooking ? 'Reschedule Event' : 'Schedule Event';
        err(ex.message);
        if (ex.status === 409) setTimeout(() => location.reload(), 2200);
      }
    });
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.removeGuest !== undefined) { st.guests.splice(Number(t.dataset.removeGuest), 1); return renderGuests(); }
    if (t.dataset.slot) { st.selected = Number(t.dataset.slot); render(); return root.querySelector('.next')?.focus(); }
    if (t.dataset.h12 !== undefined) {
      st.h12 = t.dataset.h12 === '1';
      try { localStorage.setItem('slotly:h12', st.h12 ? '1' : '0'); } catch { /* ignore */ }
      return render();
    }
    if (t.dataset.action === 'next') { st.step = 'form'; render(); return window.scrollTo({ top: 0 }); }
    if (t.dataset.action === 'back') { st.step = 'pick'; return render(); }
    if (t.dataset.action === 'guests') { st.showGuests = true; render(); document.getElementById('guest-input')?.focus(); }
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.action === 'tz') { st.tz = e.target.value; render(); }
  });

  render();
})();
