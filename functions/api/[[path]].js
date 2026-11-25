const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const order = 'created_at.desc,slug.asc';
const campaignSelect = 'slug,title,description,caption,category,frames,views,downloads,created_at,theme,owner:profiles(name)';
const authCap = 8192;
const frameCap = 8 * 1024 * 1024;
const pngPrefix = 'data:image/png;base64,';
const sessionAge = 7 * 86400;
const accessCookie = '__Host-rb_access';
const refreshCookie = '__Host-rb_refresh';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

async function body(request, cap) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Use application/json.');
  if (Number(request.headers.get('content-length')) > cap) fail(413, 'Request body too large.');
  if (!request.body) fail(400, 'Expected a JSON object.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let raw = '';
  let data;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) fail(413, 'Request body too large.');
      raw += decoder.decode(value, { stream: true });
    }
    data = JSON.parse(raw + decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof HttpError) throw error;
    fail(400, 'Invalid JSON.');
  } finally { reader.releaseLock(); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Expected a JSON object.');
  return data;
}

function text(value, label, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || /\u0000|[\uD800-\uDFFF]/u.test(value)) fail(400, `Invalid ${label}.`);
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) fail(400, `Invalid ${label} (maximum ${max} characters).`);
  return trimmed;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i;
});

async function isPng(frame) {
  if (!frame.startsWith(pngPrefix)) return false;
  const encoded = frame.slice(pngPrefix.length);
  if (encoded.length > 7_000_000 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    const decoded = atob(encoded);
    if (decoded.length < 57 || btoa(decoded) !== encoded || decoded.slice(0, 8) !== '\x89PNG\r\n\x1a\n') return false;
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    const depth = bytes[24], color = bytes[25], interlace = bytes[28];
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color];
    if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000 || !depths?.includes(depth) || bytes[26] || bytes[27] || interlace > 1) return false;
    const chunks = [];
    let palette = false, image = false, imageEnded = false, end = false;
    let chunkCount = 0;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      if (++chunkCount > 4096) return false;
      const size = view.getUint32(offset);
      const start = offset + 8, stop = start + size;
      if (stop + 4 > bytes.length) return false;
      const type = decoded.slice(offset + 4, start);
      if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) return false;
      let crc = 0xffffffff;
      for (let i = offset + 4; i < stop; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
      if ((~crc >>> 0) !== view.getUint32(stop)) return false;
      if (offset === 8 && type !== 'IHDR') return false;
      if (image && type !== 'IDAT') imageEnded = true;
      if (type === 'IHDR') {
        if (offset !== 8 || size !== 13) return false;
      } else if (type === 'PLTE') {
        if (image || palette || !size || size % 3 || size > 768 || color === 0 || color === 4 || (color === 3 && size / 3 > 2 ** depth)) return false;
        palette = true;
      } else if (type === 'IDAT') {
        if (imageEnded || (color === 3 && !palette)) return false;
        image = true;
        chunks.push(bytes.subarray(start, stop));
      } else if (type === 'IEND') {
        if (!image || size || stop + 4 !== bytes.length) return false;
        end = true;
        break;
      } else if (/^[A-Z]/.test(type) || ['acTL', 'fcTL', 'fdAT'].includes(type)) return false;
      offset = stop + 4;
    }
    if (!end) return false;
    const passes = interlace ? [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]] : [[0,0,1,1]];
    const scanlines = [];
    for (const [x, y, dx, dy] of passes) {
      if (x >= width || y >= height) continue;
      const stride = 1 + Math.ceil(Math.ceil((width - x) / dx) * channels * depth / 8);
      for (let row = y; row < height; row += dy) scanlines.push(stride);
    }
    const reader = new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    let row = 0, remaining = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return row === scanlines.length && remaining === 0;
        for (let i = 0; i < value.length;) {
          if (!remaining) {
            if (row >= scanlines.length || value[i] > 4) return false;
            remaining = scanlines[row++];
          }
          const consumed = Math.min(value.length - i, remaining);
          i += consumed;
          remaining -= consumed;
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  } catch { return false; }
}

async function fields(data, previous) {
  const title = text(data.title, 'title', 140);
  const description = text(data.description, 'description', 4000, false);
  const caption = text(data.caption, 'caption', 4000, false);
  const category = text(data.category, 'category', 100);
  const theme = text(data.theme ?? previous?.theme ?? 'green', 'theme', 32);
  if (!slugPattern.test(theme)) fail(400, 'Invalid theme.');
  const frames = data.frames;
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 12 || frames.some(f => typeof f !== 'string')) fail(400, 'Provide 1–12 PNG frames.');
  if (frames.reduce((total, frame) => total + frame.length, 0) > frameCap) fail(413, 'Frames are too large in total.');
  for (const frame of frames) {
    if (frame.startsWith('/frames/') && previous?.frames.includes(frame)) continue;
    if (!await isPng(frame)) fail(400, 'Use valid PNG data URLs or retain sample frames already on this campaign.');
  }
  return { title, description, caption, category, theme, frames };
}

const publicCampaign = ({ slug, title, description, caption, category, frames, views, downloads, created_at, theme, owner }) => ({
  slug, title, description, caption, category, frames, views, downloads, createdAt: created_at, theme, ownerName: owner?.name ?? null,
});
const publicUser = ({ id, name, email, role, created_at }) => ({ id, name, email, role, createdAt: created_at });
const cookieToken = /^[A-Za-z0-9._~-]{1,3800}$/;

function supabase(env) {
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Invalid Supabase configuration');
  async function call(prefix, path, key, { token = key, method = 'GET', data, params, prefer } = {}) {
    const target = new URL(`${prefix}/${path}`, url.origin);
    if (params) target.search = new URLSearchParams(params).toString();
    const headers = { apikey: key, Authorization: `Bearer ${token}`, Accept: 'application/json' };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(target, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(15000) });
    const raw = await response.text();
    return { status: response.status, ok: response.ok, value: raw ? JSON.parse(raw) : null };
  }
  return {
    auth: (path, options) => call('/auth/v1', path, env.SUPABASE_ANON_KEY, options),
    rest: (path, options) => call('/rest/v1', path, env.SUPABASE_SERVICE_ROLE_KEY, options),
  };
}

function dbResult(result) {
  if (!result.ok) {
    if (result.value?.code === '23505') fail(409, 'Slug already exists.');
    fail(502, 'Database request failed. Please try again.');
  }
  return result.value;
}

function authFailure(result, register = false) {
  if (result.status === 429) fail(429, 'Too many requests. Please try again later.');
  if ([400, 401, 403, 422].includes(result.status)) {
    if (!register && result.value?.code === 'email_not_confirmed') fail(401, 'Confirm your email before signing in.');
    if (register) fail(400, 'Could not register. Check the email and password requirements.');
    fail(401, 'Invalid email or password.');
  }
  fail(502, 'Authentication is temporarily unavailable.');
}

export async function onRequest({ request, env }) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  const reply = (status, value) => new Response(JSON.stringify(value), { status, headers });
  const setCookie = (name, value, age) => headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`);
  const clear = () => { setCookie(accessCookie, '', 0); setCookie(refreshCookie, '', 0); };
  const cookie = name => {
    const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    return cookieToken.test(value ?? '') ? value : null;
  };
  const save = session => {
    const { access_token: access, refresh_token: refresh, expires_in: expiry } = session;
    if (typeof access !== 'string' || typeof refresh !== 'string' || !cookieToken.test(access) || !cookieToken.test(refresh) || !Number.isFinite(expiry) || expiry <= 0) fail(502, 'Authentication is temporarily unavailable.');
    setCookie(accessCookie, access, Math.min(Math.ceil(expiry), sessionAge));
    setCookie(refreshCookie, refresh, sessionAge);
  };
  try {
    const { origin, pathname: path } = new URL(request.url);
    const method = request.method;
    if (method !== 'GET' && (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site')) fail(403, 'Same-origin requests only.');
    const { auth, rest } = supabase(env);
    const verifiedProfile = async token => {
      const result = await auth('user', { token });
      if ([401, 403].includes(result.status)) return null;
      if (!result.ok || !uuidPattern.test(result.value?.id ?? '')) fail(502, 'Authentication is temporarily unavailable.');
      const [profile] = dbResult(await rest('profiles', { params: { id: `eq.${result.value.id}`, select: 'id,name,email,role,created_at' } }));
      if (!profile || !['user', 'admin'].includes(profile.role)) fail(403, 'Account profile unavailable.');
      return publicUser(profile);
    };
    const resolveSession = async (persist = true) => {
      let access = cookie(accessCookie);
      const refresh = cookie(refreshCookie);
      let user = access ? await verifiedProfile(access) : null;
      if (user || !refresh) return { user, access: user ? access : null };
      const result = await auth('token', { method: 'POST', params: { grant_type: 'refresh_token' }, data: { refresh_token: refresh } });
      if (!result.ok) {
        if ([400, 401, 403].includes(result.status)) return { user: null, access: null };
        authFailure(result);
      }
      access = result.value?.access_token;
      if (typeof access !== 'string' || !cookieToken.test(access)) fail(502, 'Authentication is temporarily unavailable.');
      user = await verifiedProfile(access);
      if (!user) return { user: null, access: null };
      if (persist) save(result.value);
      return { user, access };
    };
    if (path === '/api/me' && method === 'GET') return reply(200, { user: (await resolveSession()).user });
    if (path === '/api/logout' && method === 'POST') {
      try {
        const { access } = await resolveSession(false);
        if (access) {
          const result = await auth('logout', { method: 'POST', token: access, params: { scope: 'local' } });
          if (!result.ok && ![401, 403, 404].includes(result.status)) authFailure(result);
        }
      } finally { clear(); }
      return reply(200, { user: null });
    }
    if (method === 'POST' && ['/api/register', '/api/login'].includes(path)) {
      const register = path === '/api/register';
      const data = await body(request, authCap);
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      const { password } = data;
      const minimum = register ? 8 : 1;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < minimum || password.length > 256) fail(400, `Provide a valid email and a password of ${minimum}–256 characters.`);
      const result = register
        ? await auth('signup', { method: 'POST', data: { email, password, data: { name: text(data.name, 'name', 100) } } })
        : await auth('token', { method: 'POST', params: { grant_type: 'password' }, data: { email, password } });
      if (!result.ok) authFailure(result, register);
      if (register && !result.value?.access_token) {
        clear();
        return reply(201, { user: null, confirmationRequired: true, message: 'Check your email to confirm your account, then sign in.' });
      }
      const access = result.value?.access_token;
      if (typeof access !== 'string' || !cookieToken.test(access)) fail(502, 'Authentication is temporarily unavailable.');
      const user = await verifiedProfile(access);
      if (!user) fail(401, 'Could not verify your session.');
      save(result.value);
      return reply(register ? 201 : 200, { user });
    }

    const find = async (slug, select = campaignSelect) => dbResult(await rest('campaigns', { params: { slug: `eq.${slug}`, select, limit: 1 } }))[0] ?? fail(404, 'Campaign not found.');
    const list = async ownerId => dbResult(await rest('campaigns', { params: {
      select: campaignSelect, order, limit: 100, ...(ownerId ? { owner_id: `eq.${ownerId}` } : {}),
    } })).map(publicCampaign);
    if (path === '/api/campaigns' && method === 'GET') return reply(200, await list());
    const campaign = /^\/api\/campaigns\/([a-z0-9-]{1,100})(?:\/(view|download))?$/.exec(path);
    if (campaign && slugPattern.test(campaign[1])) {
      const [, slug, action] = campaign;
      if (!action && method === 'GET') return reply(200, publicCampaign(await find(slug)));
      if (action && method === 'POST') {
        const [stats] = dbResult(await rest('rpc/rb_increment_stat', { method: 'POST', data: { p_slug: slug, p_action: action } }));
        if (!stats) fail(404, 'Campaign not found.');
        return reply(200, stats);
      }
    }

    const managed = /^\/api\/manage\/([a-z0-9-]{1,100})$/.exec(path);
    if (path === '/api/manage' || path === '/api/users' || (managed && slugPattern.test(managed[1]))) {
      const { user } = await resolveSession();
      if (!user) fail(401, 'Sign in first.');
      const admin = user.role === 'admin';
      if (path === '/api/users' && method === 'GET') {
        if (!admin) fail(403, 'Administrator access required.');
        const accounts = dbResult(await rest('profiles', { params: { select: 'id,name,email,role,created_at', order: 'created_at.asc,id.asc', limit: 1000 } }));
        return reply(200, accounts.map(publicUser));
      }
      if (path === '/api/manage' && method === 'GET') return reply(200, await list(admin ? null : user.id));
      if (path === '/api/manage' && method === 'POST') {
        const data = await body(request, frameCap + 65536);
        const values = await fields(data);
        const explicit = data.slug !== undefined && data.slug !== '';
        const base = explicit ? text(data.slug, 'slug', 100) : values.title.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').slice(0, 85).replace(/^-|-$/g, '') || 'campaign';
        if (!slugPattern.test(base)) fail(400, 'Slug must contain lowercase letters, digits, and separating hyphens.');
        for (let i = 1; i <= (explicit ? 1 : 10); i++) {
          const slug = i === 1 ? base : `${base}-${i}`;
          const result = await rest('campaigns', { method: 'POST', prefer: 'return=representation', params: { select: campaignSelect }, data: { ...values, slug, owner_id: user.id } });
          if (!explicit && result.value?.code === '23505') continue;
          return reply(201, publicCampaign(dbResult(result)[0]));
        }
        fail(409, 'Slug already exists. Choose a different slug.');
      }
      if (managed && ['PUT', 'DELETE'].includes(method)) {
        const slug = managed[1];
        const row = await find(slug, 'id,owner_id,revision,theme');
        if (!admin && row.owner_id !== user.id) fail(403, 'You do not own this campaign.');
        const params = { id: `eq.${row.id}`, revision: `eq.${row.revision}`, ...(admin ? {} : { owner_id: `eq.${user.id}` }) };
        let values;
        if (method === 'PUT') {
          const data = await body(request, frameCap + 65536);
          const [previous] = dbResult(await rest('campaigns', { params: { ...params, select: 'frames,theme' } }));
          if (!previous) fail(409, 'Campaign changed. Reload and try again.');
          values = { ...await fields(data, previous), revision: crypto.randomUUID() };
        }
        const [updated] = dbResult(await rest('campaigns', { method: method === 'PUT' ? 'PATCH' : 'DELETE', prefer: 'return=representation', data: values, params: { ...params, select: method === 'PUT' ? campaignSelect : 'id' } }));
        if (!updated) fail(409, 'Campaign changed. Reload and try again.');
        return reply(200, method === 'PUT' ? publicCampaign(updated) : { ok: true });
      }
    }
    fail(404, 'API route not found.');
  } catch (error) {
    if (error instanceof HttpError) return reply(error.status, { error: error.message });
    return reply(502, { error: 'Service temporarily unavailable.' });
  }
}
