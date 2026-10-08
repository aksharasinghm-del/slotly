/* Invite-only access request page: /request-access */
(function () {
  const { api, esc, icons } = S;
  const $ = (id) => document.getElementById(id);
  $('logo').innerHTML = icons.logo;
  $('ok-icon').innerHTML = icons.check;
  const params = new URLSearchParams(location.search);
  const form = $('request-form');
  if (params.get('email')) form.email.value = params.get('email');
  if (params.get('name')) form.name.value = params.get('name');
  if (params.has('denied')) {
    const banner = $('denied');
    banner.hidden = false;
    banner.innerHTML = `${icons.alert}<span><strong>${esc(params.get('email') || 'This account')}</strong> doesn't have access yet. Send a request below and you'll hear back by email.</span>`;
  }
  api('/api/config').then((cfg) => {
    document.querySelectorAll('.app-name').forEach((el) => { el.textContent = cfg.appName; });
    document.title = `Request access | ${cfg.appName}`;
  }).catch(() => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = (m) => { $('form-error').innerHTML = m ? `<div class="form-error" role="alert">${esc(m)}</div>` : ''; };
    err('');
    const data = Object.fromEntries(new FormData(form));
    if (!data.name.trim()) return err('Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) return err('Please enter a valid email address.');
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await api('/api/access-requests', { method: 'POST', body: data });
      $('form-view').hidden = true;
      $('done-view').hidden = false;
      if (res.status === 'approved') {
        $('done-text').innerHTML = 'You already have access. <a href="/auth/google">Log in with Google</a> using this email.';
      }
    } catch (ex) {
      btn.disabled = false; btn.textContent = 'Request access';
      err(ex.message);
    }
  });
})();
