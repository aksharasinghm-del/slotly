/* Public profile page: /:username — lists active event types. */
(async function () {
  const { api, esc, icons } = S;
  const root = document.getElementById('root');
  const username = decodeURIComponent(location.pathname.split('/')[1]);
  const embed = new URLSearchParams(location.search).has('embed');
  if (embed) document.querySelector('.public-page').classList.add('embed');
  try {
    const [{ user, eventTypes }, cfg] = await Promise.all([api(`/api/u/${encodeURIComponent(username)}`), api('/api/config')]);
    document.title = `${user.name} | ${cfg.appName}`;
    const suffix = embed ? '?embed=1' : '';
    root.innerHTML = `<div class="public-card profile-card">
      ${embed ? '' : S.poweredBy(cfg.appName)}
      <div class="profile-head">${S.avatar(user, 72)}<h1>${esc(user.name)}</h1><p>${esc(user.welcome)}</p></div>
      ${eventTypes.length ? `<div class="et-list">${eventTypes.map((et) => `
        <a class="et-link" href="/${esc(user.username)}/${esc(et.slug)}${suffix}">
          <span class="dot" style="background:${esc(et.color)}"></span>
          <h3>${esc(et.name)}</h3>${icons.right}
        </a>`).join('')}</div>`
        : '<p class="muted" style="text-align:center;margin-top:32px">There are no events available right now.</p>'}
    </div>`;
  } catch (err) {
    root.innerHTML = `<div class="public-card confirm-card"><h1>This page is not available</h1><p class="lead">${esc(err.status === 404 ? 'Check the link and try again.' : err.message)}</p></div>`;
  }
})();
