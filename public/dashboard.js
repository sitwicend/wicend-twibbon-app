const number = new Intl.NumberFormat('id-ID');
const date = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' });
const count = value => Math.max(0, Number(value) || 0);
const displayDate = value => value && Number.isFinite(new Date(value).getTime()) ? date.format(new Date(value)) : '—';
const pngData = /^data:image\/png;base64,[a-z0-9+/]+={0,2}$/i;

async function readPng(file) {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (signature.join(',') !== '137,80,78,71,13,10,26,10') {
    throw new Error(`${file.name} bukan berkas PNG.`);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`data:image/png;base64,${reader.result.split(',')[1]}`);
    reader.onerror = () => reject(new Error(`Gagal membaca ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

export async function dashboard(app, { api, esc, toast, copy }) {
  const e = value => esc(String(value ?? ''));
  const campaignPath = slug => `/c/${encodeURIComponent(slug)}`;
  const managePath = slug => `/api/manage/${encodeURIComponent(slug)}`;
  let user;
  let campaigns = [];
  let view = 'overview';
  let busy = false;
  const isAdmin = () => user?.role === 'admin' || user?.isAdmin === true;
  const post = (path, body) => api(path, { method: 'POST', body });
  const errorMessage = error => error?.message || 'Terjadi kesalahan. Coba lagi.';

  async function perform(button, task, onError = error => toast(errorMessage(error))) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try { await task(); }
    catch (error) { onError(error); }
    finally {
      busy = false;
      button.disabled = false;
    }
  }

  function auth(mode = 'login', message = '') {
    const register = mode === 'register';
    app.innerHTML = `<section class="wrap rb-auth"><div class="rb-auth-intro"><span class="rb-kicker">RUANG KREATOR</span><h1>Buat bingkai untuk momen yang berarti.</h1><p>Terbitkan kampanye, kelola bingkai, dan pantau jangkauannya dari satu ruang.</p></div><div class="rb-panel rb-auth-panel">
      <div class="rb-auth-tabs" aria-label="Pilihan akun"><button type="button" class="btn ${register ? 'outline' : 'primary'}" aria-pressed="${!register}" data-auth="login">Masuk</button><button type="button" class="btn ${register ? 'primary' : 'outline'}" aria-pressed="${register}" data-auth="register">Daftar</button></div>
      <form class="rb-form"><h2>${register ? 'Buat akun' : 'Masuk ke akunmu'}</h2>
      ${register ? '<label>Nama<input name="name" autocomplete="name" required></label>' : ''}
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>Kata sandi<input name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" required></label>
      <p class="rb-status" role="status">${e(message)}</p><button class="btn primary" type="submit">${register ? 'Daftar' : 'Masuk'}</button></form></div></section>`;
    app.querySelectorAll('[data-auth]').forEach(button => { button.onclick = () => { if (!busy) auth(button.dataset.auth); }; });
    const form = app.querySelector('form');
    form.onsubmit = event => {
      event.preventDefault();
      const status = form.querySelector('.rb-status');
      status.textContent = '';
      perform(form.querySelector('[type=submit]'), async () => {
        const result = await post(`/api/${mode}`, Object.fromEntries(new FormData(form)));
        if (register && !result.user) {
          auth('login', result.confirmationRequired ? 'Periksa email (termasuk folder spam), konfirmasi pendaftaran, lalu masuk.' : 'Akun berhasil dibuat. Silakan masuk.');
          return;
        }
        user = (await api('/api/me')).user;
        if (user) await show('overview');
        else auth('login', register ? 'Akun berhasil dibuat. Silakan masuk.' : 'Sesi tidak tersedia. Silakan masuk lagi.');
      }, error => { status.textContent = errorMessage(error); });
    };
  }

  const tabs = { overview: 'Ringkasan', campaigns: 'Kampanye', create: 'Buat kampanye', accounts: 'Akun pengguna' };
  function shell(current, title, subtitle) {
    app.innerHTML = `<section class="wrap rb-dash"><aside class="rb-sidebar rb-panel"><span class="rb-kicker">RUANG KREATOR</span><strong>${e(user.name || user.email)}</strong><small>${isAdmin() ? 'Administrator' : 'Kreator'}</small>
      <nav aria-label="Navigasi dasbor">${Object.entries(tabs).filter(([key]) => key !== 'accounts' || isAdmin()).map(([key, label]) => `<button type="button" data-view="${key}" ${current === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>
      <button type="button" class="btn outline rb-logout">Keluar</button></aside>
      <div class="rb-main"><header class="rb-heading"><span class="rb-kicker">DASBOR</span><h1>${e(title)}</h1><p>${e(subtitle)}</p></header><div class="rb-body"></div></div></section>`;
    app.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => { if (!busy) show(button.dataset.view); }; });
    const logout = app.querySelector('.rb-logout');
    logout.onclick = () => perform(logout, async () => {
      await post('/api/logout');
      user = null;
      campaigns = [];
      auth();
    });
    return app.querySelector('.rb-body');
  }

  function overview(body) {
    const totals = campaigns.reduce((result, item) => [result[0] + count(item.views), result[1] + count(item.downloads)], [0, 0]);
    const popular = [...campaigns].sort((a, b) => count(b.views) - count(a.views)).slice(0, 6);
    const max = Math.max(1, ...popular.map(item => Math.max(count(item.views), count(item.downloads))));
    body.innerHTML = `<div class="rb-metrics">${[['Kampanye', campaigns.length], ['Tayangan', totals[0]], ['Unduhan', totals[1]]].map(([label, value]) => `<article class="rb-metric"><span>${label}</span><strong>${number.format(value)}</strong></article>`).join('')}</div>
      <section class="rb-panel rb-chart"><div class="rb-section-head"><h2>Kampanye teratas</h2><button class="btn outline" data-list type="button">Lihat kampanye</button></div>
      ${popular.length ? `<p class="rb-legend"><span>Tayangan</span><span>Unduhan</span></p>${popular.map(item => `<div class="rb-chart-row"><strong>${e(item.title)}</strong>${['views', 'downloads'].map((key, i) => `<div class="rb-bar-line"><meter min="0" max="${max}" value="${count(item[key])}" aria-label="${i ? 'Unduhan' : 'Tayangan'}: ${e(item.title)}"></meter><span>${number.format(count(item[key]))}</span></div>`).join('')}</div>`).join('')}` : '<p>Belum ada kampanye untuk ditampilkan.</p>'}</section>`;
    body.querySelector('[data-list]').onclick = () => { if (!busy) show('campaigns'); };
  }

  function campaignList(body) {
    body.innerHTML = `<div class="rb-section-head"><h2>Daftar kampanye</h2><button class="btn primary" type="button" data-new>+ Buat kampanye</button></div>
      ${campaigns.length ? `<div class="rb-campaigns">${campaigns.map((item, i) => `<article class="rb-panel rb-campaign"><div><span class="rb-kicker">${e(item.category || 'Kampanye')}</span><h3>${e(item.title)}</h3><p>${e(item.slug)} · ${e(displayDate(item.createdAt))}${item.ownerName ? ` · ${e(item.ownerName)}` : ''}</p><p>${number.format(count(item.views))} tayangan · ${number.format(count(item.downloads))} unduhan</p></div><div class="rb-actions"><button type="button" class="btn outline" data-copy="${i}">Salin tautan</button><button type="button" class="btn outline" data-edit="${i}">Edit</button><button type="button" class="btn outline rb-danger" data-delete="${i}">Hapus</button></div></article>`).join('')}</div>` : '<p class="rb-panel rb-empty">Belum ada kampanye. Buat kampanye pertamamu untuk mulai membagikan bingkai.</p>'}`;
    body.querySelector('[data-new]').onclick = () => { if (!busy) show('create'); };
    body.querySelectorAll('[data-copy]').forEach(button => { button.onclick = () => perform(button, () => copy(new URL(campaignPath(campaigns[button.dataset.copy].slug), location.origin).href)); });
    body.querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => { if (!busy) editor(campaigns[button.dataset.edit]); }; });
    body.querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = () => {
        if (busy) return;
        const item = campaigns[button.dataset.delete];
        if (!confirm(`Hapus kampanye “${item.title}”? Tindakan ini tidak bisa dibatalkan.`)) return;
        perform(button, async () => {
          await api(managePath(item.slug), { method: 'DELETE' });
          toast('Kampanye dihapus.');
          await show('campaigns');
        });
      };
    });
  }

  function editor(item) {
    view = item ? 'edit' : 'create';
    const body = shell(item ? 'campaigns' : 'create', item ? 'Edit kampanye' : 'Buat kampanye', 'Atur informasi dan bingkai yang akan digunakan pengunjung.');
    const frames = [...(item?.frames || [])];
    body.innerHTML = `<form class="rb-panel rb-form rb-editor">
      <label>Judul<input name="title" value="${e(item?.title)}" required></label>
      <label>Slug<input name="slug" value="${e(item?.slug)}" ${item ? 'readonly' : 'required pattern="[a-z0-9]+(-[a-z0-9]+)*"'}><small>${item ? 'Slug tidak dapat diubah setelah kampanye dibuat.' : 'Gunakan huruf kecil, angka, dan tanda hubung.'}</small></label>
      <label>Kategori<input name="category" value="${e(item?.category)}" maxlength="100" required></label>
      <label>Tema<input name="theme" value="${e(item?.theme || 'green')}" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="32" required><small>Contoh: green.</small></label>
      <label class="rb-full">Deskripsi<textarea name="description" rows="3">${e(item?.description)}</textarea></label>
      <label class="rb-full">Caption<textarea name="caption" rows="3">${e(item?.caption)}</textarea></label>
      <div class="rb-full"><label>Bingkai PNG<input type="file" accept="image/png,.png" multiple><small>Tambahkan beberapa PNG transparan. Bingkai pertama tampil paling awal.</small></label><ol class="rb-frames"></ol></div>
      <p class="rb-status rb-full" role="status"></p><div class="rb-actions rb-full"><button type="submit" class="btn primary">${item ? 'Simpan perubahan' : 'Terbitkan kampanye'}</button><button type="button" class="btn outline" data-cancel>Batal</button></div></form>`;
    const form = body.querySelector('form');
    const frameList = form.querySelector('.rb-frames');
    const picker = form.querySelector('[type=file]');
    const status = form.querySelector('.rb-status');
    const submit = form.querySelector('[type=submit]');
    const renderFrames = () => {
      frameList.innerHTML = frames.map((frame, i) => `<li>${typeof frame === 'string' && (pngData.test(frame) || /^\/frames\/[a-z0-9_-]+\.(?:png|svg)$/i.test(frame)) ? `<img src="${e(frame)}" alt="" width="88" height="88">` : '<div class="rb-frame-placeholder"></div>'}<span>Bingkai ${i + 1}</span><div class="rb-frame-actions">
        <button type="button" data-index="${i}" data-step="-1" aria-label="Majukan bingkai ${i + 1}" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" data-index="${i}" data-step="1" aria-label="Mundurkan bingkai ${i + 1}" ${i === frames.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-index="${i}" data-remove aria-label="Hapus bingkai ${i + 1}">×</button></div></li>`).join('');
    };
    renderFrames();
    frameList.onclick = event => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      const index = Number(button.dataset.index);
      if (button.hasAttribute('data-remove')) frames.splice(index, 1);
      else {
        const next = index + Number(button.dataset.step);
        [frames[index], frames[next]] = [frames[next], frames[index]];
      }
      renderFrames();
    };
    picker.onchange = async () => {
      if (busy) { picker.value = ''; return; }
      status.textContent = '';
      submit.disabled = true;
      await perform(picker, async () => {
        const results = await Promise.allSettled(Array.from(picker.files, readPng));
        for (const result of results) if (result.status === 'fulfilled') frames.push(result.value);
        status.textContent = results.filter(result => result.status === 'rejected').map(result => errorMessage(result.reason)).join(' ');
        renderFrames();
      }, error => { status.textContent = errorMessage(error); });
      picker.value = '';
      submit.disabled = false;
    };
    form.querySelector('[data-cancel]').onclick = () => { if (!busy) show('campaigns'); };
    form.onsubmit = event => {
      event.preventDefault();
      if (busy) return;
      status.textContent = '';
      if (!frames.length) { status.textContent = 'Tambahkan setidaknya satu bingkai PNG.'; picker.focus(); return; }
      const data = Object.fromEntries(new FormData(form));
      for (const key of Object.keys(data)) data[key] = data[key].trim();
      if (item) data.slug = item.slug;
      data.frames = [...frames];
      perform(submit, async () => {
        await api(item ? managePath(item.slug) : '/api/manage', { method: item ? 'PUT' : 'POST', body: data });
        toast(item ? 'Perubahan disimpan.' : 'Kampanye diterbitkan.');
        await show('campaigns');
      }, error => { status.textContent = errorMessage(error); });
    };
  }

  function accounts(body, users) {
    body.innerHTML = users.length ? `<div class="rb-panel rb-table"><table><thead><tr><th scope="col">Nama</th><th scope="col">Email</th><th scope="col">Peran</th><th scope="col">Terdaftar</th></tr></thead><tbody>${users.map(account => `<tr><td>${e(account.name)}</td><td>${e(account.email)}</td><td>${e(account.role || (account.isAdmin ? 'admin' : 'kreator'))}</td><td>${e(displayDate(account.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="rb-panel rb-empty">Belum ada akun pengguna.</p>';
  }

  async function show(next) {
    if (next === 'accounts' && !isAdmin()) return;
    if (next === 'create') { editor(); return; }
    view = next;
    const subtitles = { overview: 'Pantau performa kampanye dalam satu tempat.', campaigns: 'Kelola kampanye dan bagikan tautannya.', accounts: 'Lihat akun yang terdaftar di wicend-twibbon.' };
    const body = shell(next, tabs[next], subtitles[next]);
    body.innerHTML = '<p role="status">Memuat…</p>';
    try {
      const data = await api(next === 'accounts' ? '/api/users' : '/api/manage');
      if (view !== next || !app.contains(body)) return;
      if (next === 'accounts') accounts(body, data);
      else {
        campaigns = data;
        if (next === 'overview') overview(body);
        else campaignList(body);
      }
    } catch (error) {
      if (!app.contains(body)) return;
      body.innerHTML = `<p class="rb-status" role="alert">${e(errorMessage(error))}</p><button type="button" class="btn outline">Coba lagi</button>`;
      body.querySelector('button').onclick = () => { if (!busy) show(next); };
    }
  }

  try { user = (await api('/api/me')).user; }
  catch { auth(); return; }
  if (user) await show('overview');
  else auth();
}
