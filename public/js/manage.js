/* Booking confirmation + manage page: /booking/:uid */
(async function () {
  const { api, esc, icons } = S;
  const root = document.getElementById('root');
  const uid = decodeURIComponent(location.pathname.split('/')[2]);
  const params = new URLSearchParams(location.search);
  const embed = params.has('embed');
  if (embed) document.querySelector('.public-page').classList.add('embed');

  let data, appName = 'Slotly', mode = params.has('new') ? 'new' : params.has('rescheduled') ? 'rescheduled' : 'view';
  try {
    [data, { appName }] = await Promise.all([api(`/api/b/${encodeURIComponent(uid)}`), api('/api/config')]);
  } catch (err) {
    root.innerHTML = `<div class="public-card confirm-card"><h1>Event not found</h1><p class="lead">${esc(err.message)}</p></div>`;
    return;
  }
  if (mode !== 'view') history.replaceState(null, '', `/booking/${uid}${embed ? '?embed=1' : ''}`);

  function render(showCancel = false) {
    const { booking: b, host, canReschedule } = data;
    const tz = b.inviteeTz || S.browserTz;
    const start = Date.parse(b.start), end = Date.parse(b.end);
    const cancelled = b.status === 'cancelled';
    const past = end < Date.now();
    const manageUrl = location.origin + `/booking/${b.uid}`;
    const links = S.addToCalendarLinks(b, host.name, manageUrl);
    document.title = `${cancelled ? 'Canceled: ' : ''}${b.eventName} with ${host.name}`;

    const heading = cancelled ? 'This event has been canceled'
      : mode === 'new' ? 'You are scheduled'
      : mode === 'rescheduled' ? 'Your event has been rescheduled'
      : past ? 'This event has ended' : 'Your scheduled event';
    const lead = cancelled
      ? (b.cancelledBy === 'host' ? `${host.name} canceled this event.` : b.synced ? 'The event was canceled and a cancellation notice was sent to all guests.' : 'The event was canceled.')
      : mode !== 'view'
        ? (b.synced ? 'A calendar invitation has been sent to your email address.' : `You're all set. Add the event to your calendar below.`)
        : '';

    root.innerHTML = `<div class="public-card confirm-card">
      ${embed ? '' : S.poweredBy(appName)}
      ${S.avatar(host, 56)}
      <h1>${!cancelled && mode !== 'view' ? `<span class="ok">${icons.check}</span>` : ''}${esc(heading)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : '<div style="height:20px"></div>'}
      <div class="summary-box ${cancelled ? 'cancelled' : ''}">
        <h2>${esc(b.eventName)}</h2>
        <div>${icons.user}<span>${esc(host.name)}</span></div>
        <div class="when">${icons.calendar}<span>${S.fmtTime(start, tz)} - ${S.fmtTime(end, tz)}, ${esc(S.fmtDate(start, tz))}</span></div>
        <div>${icons.globe}<span>${esc(S.tzName(tz, start))}</span></div>
        ${S.locationLine(b.locationType, b.locationValue, { confirmed: true, meetLink: b.meetLink })}
        ${cancelled && b.cancelReason ? `<div>${icons.alert}<span>Reason: ${esc(b.cancelReason)}</span></div>` : ''}
      </div>
      ${!cancelled && !past ? `<div class="add-cal">
        <a class="btn btn-ghost btn-sm" href="${esc(links.google)}" target="_blank" rel="noopener">${icons.calendar} Google</a>
        <a class="btn btn-ghost btn-sm" href="${esc(links.outlook)}" target="_blank" rel="noopener">${icons.calendar} Outlook</a>
        <a class="btn btn-ghost btn-sm" href="${esc(links.ics)}">${icons.calendar} iCal / .ics</a>
      </div>` : ''}
      ${showCancel ? `<form class="cancel-form" id="cancel-form">
          <div id="cancel-error"></div>
          <div class="field"><label for="reason">Reason for canceling</label><textarea class="input" id="reason" name="reason" placeholder="Optional"></textarea></div>
          <div class="row"><button type="button" class="btn btn-ghost" data-action="keep">Keep event</button><button class="btn btn-danger" type="submit">Cancel Event</button></div>
        </form>`
        : !cancelled && !past ? `<div class="manage-links">
          <span class="faint small" style="width:100%">Need to make a change?</span>
          ${canReschedule ? `<a href="${esc(data.rescheduleUrl)}${embed ? '&embed=1' : ''}">Reschedule</a>` : ''}
          <button class="btn btn-text" data-action="cancel" style="padding:0">Cancel</button>
        </div>` : ''}
      ${cancelled || past ? `<div class="manage-links"><a href="/${esc(host.username)}${embed ? '?embed=1' : ''}">Schedule another event with ${esc(host.name)}</a></div>` : ''}
    </div>`;

    const form = document.getElementById('cancel-form');
    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true; btn.textContent = 'Canceling…';
      try {
        const res = await api(`/api/b/${encodeURIComponent(uid)}/cancel`, { method: 'POST', body: { reason: form.reason.value } });
        data.booking = res.booking; mode = 'view';
        render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Cancel Event';
        document.getElementById('cancel-error').innerHTML = `<div class="form-error">${esc(err.message)}</div>`;
      }
    });
    form?.reason.focus();
  }

  root.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'cancel') render(true);
    if (action === 'keep') render(false);
  });

  render();
})();
