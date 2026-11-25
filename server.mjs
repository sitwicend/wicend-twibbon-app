import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, sep } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.DB_PATH || resolve(import.meta.dirname, 'wicend-twibbon.sqlite'));
const publicDir = resolve(import.meta.dirname, 'public');
const derive = promisify(scrypt);
const cap = 24 * 1024 * 1024;
const sessionAge = 7 * 24 * 60 * 60;
const cookie = 'rb_session';
const secureCookie = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digest = token => createHash('sha256').update(token).digest('hex');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    caption TEXT NOT NULL, category TEXT NOT NULL, frames TEXT NOT NULL,
    views INTEGER NOT NULL DEFAULT 0, downloads INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL, owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    theme TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS campaigns_owner ON campaigns(owner_id);
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY);
`);

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
}
const dummyHash = await passwordHash(randomBytes(32).toString('hex'));
function credentials(data, minimum = 1) {
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = data.password;
  if (email.length > 254 || !emailPattern.test(email) || typeof password !== 'string' || password.length < minimum || password.length > 256) {
    fail(400, `Provide a valid email and a password of ${minimum}–256 characters.`);
  }
  return { email, password };
}

let adminId = null;
if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) {
  const { email, password } = credentials({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, 8);
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing && existing.role !== 'admin') throw new Error('ADMIN_EMAIL belongs to an existing non-admin account.');
  if (existing) {
    adminId = existing.id;
    const hash = await passwordHash(password, existing.password.split(':')[0]);
    if (hash !== existing.password) {
      db.exec('BEGIN IMMEDIATE');
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, adminId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(adminId);
      db.exec('COMMIT');
    }
  } else {
    adminId = db.prepare("INSERT INTO users (name,email,password,role) VALUES ('Admin',?,?,'admin')").run(email, await passwordHash(password)).lastInsertRowid;
  }
}

const seeds = [
  ['bumi-lebih-hijau', 'Bumi Lebih Hijau', 'Ajak teman dan keluarga menjaga lingkungan, mulai dari kebiasaan kecil.', 'Langkah kecil hari ini, bumi lebih hijau esok hari. #BumiLebihHijau', 'Lingkungan', ['/frames/bumi.svg', '/frames/bumi-alt.svg'], 1280, 364, 'green'],
  ['semangat-merdeka', 'Semangat Merdeka', 'Rayakan kemerdekaan Indonesia bersama orang-orang terdekat.', 'Dirgahayu Indonesia! #SemangatMerdeka', 'Hari Besar Nasional', ['/frames/merdeka.svg'], 945, 281, 'coral'],
  ['generasi-belajar', 'Generasi Belajar', 'Bagikan semangat belajar dan dukung pendidikan untuk semua.', 'Belajar hari ini, berkarya esok hari. #GenerasiBelajar', 'Pendidikan', ['/frames/belajar.svg'], 672, 198, 'blue'],
];
db.exec('BEGIN IMMEDIATE');
if (db.prepare("INSERT OR IGNORE INTO metadata VALUES ('seed-v1')").run().changes) {
  const insert = db.prepare('INSERT INTO campaigns VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  for (const [slug,title,description,caption,category,frames,views,downloads,theme] of seeds) {
    insert.run(slug,title,description,caption,category,JSON.stringify(frames),views,downloads,new Date().toISOString(),adminId,theme);
  }
}
db.exec('COMMIT');

const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });
const campaignSelect = 'SELECT c.*, u.name AS ownerName FROM campaigns c LEFT JOIN users u ON c.owner_id = u.id';
const bySlug = db.prepare(`${campaignSelect} WHERE c.slug = ?`);
const getCampaign = slug => bySlug.get(slug) ?? fail(404, 'Campaign not found.');
function campaign({ owner_id, frames, ...row }) {
  return { ...row, frames: JSON.parse(frames) };
}
function tokenFor(req) {
  return /(?:^|;\s*)rb_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}
function currentUser(req) {
  const token = tokenFor(req);
  return token ? db.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires > ?').get(digest(token), Date.now()) ?? null : null;
}
function revoke(req) {
  const token = tokenFor(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(token));
}
function setSession(req, res, user) {
  revoke(req);
  let token = '';
  if (user) {
    token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), user.id, Date.now() + sessionAge * 1000);
  }
  res.setHeader('Set-Cookie', `${cookie}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${user ? sessionAge : 0}${secureCookie ? '; Secure' : ''}`);
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Use application/json.');
  if (Number(req.headers['content-length']) > cap) fail(413, 'Request body too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > cap) fail(413, 'Request body too large.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Invalid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  return value;
}
function text(value, label, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail(400, `Invalid ${label} (maximum ${max} characters).`);
  return value.trim();
}
function isPng(value) {
  const prefix = 'data:image/png;base64,';
  if (!value.startsWith(prefix)) return false;
  const encoded = value.slice(prefix.length);
  if (encoded.length > 7_000_000 || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded) || /=/.test(encoded.slice(0, -2))) return false;
  const bytes = Buffer.from(encoded, 'base64');
  return bytes.length >= 45 && bytes.toString('base64') === encoded && bytes.subarray(0, 16).equals(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')) && bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
}
function fields(data, previous) {
  const { frames } = data;
  const allowed = previous ? JSON.parse(previous.frames).filter(frame => frame.startsWith('/frames/')) : [];
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 12 || frames.some(frame => typeof frame !== 'string' || (!allowed.includes(frame) && !isPng(frame)))) {
    fail(400, 'Provide 1–12 PNG data URLs or retain built-in frames already on this campaign.');
  }
  const theme = text(data.theme ?? previous?.theme ?? 'green', 'theme', 32);
  if (!slugPattern.test(theme)) fail(400, 'Invalid theme.');
  return [text(data.title, 'title', 140), text(data.description, 'description', 4000, false), text(data.caption, 'caption', 4000, false), text(data.category, 'category', 100), JSON.stringify(frames), theme];
}
function chooseSlug(value, title) {
  if (value !== undefined && value !== '') {
    const slug = text(value, 'slug', 100);
    if (!slugPattern.test(slug)) fail(400, 'Slug must contain lowercase letters, digits, and separating hyphens.');
    if (bySlug.get(slug)) fail(409, 'Slug already exists.');
    return slug;
  }
  const base = title.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').slice(0, 85).replace(/^-|-$/g, '') || 'campaign';
  let slug = base;
  for (let n = 2; bySlug.get(slug); n++) slug = `${base}-${n}`;
  return slug;
}

async function api(req, res, path) {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'Cross-site requests are not allowed.');
    if (req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid request origin.'); }
      if (!['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) fail(403, 'Cross-origin requests are not allowed.');
    }
  }
  if (method === 'GET' && path === '/api/me') return json(res, 200, { user: currentUser(req) });
  if (method === 'POST' && path === '/api/logout') {
    setSession(req, res, null);
    return json(res, 200, { user: null });
  }
  if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
    const data = await body(req);
    const register = path === '/api/register';
    const { email, password } = credentials(data, register ? 8 : 1);
    const lookup = db.prepare('SELECT * FROM users WHERE email = ?');
    let row = lookup.get(email);
    if (register) {
      const name = text(data.name, 'name', 100);
      const hash = await passwordHash(password);
      if (lookup.get(email)) fail(409, 'Email already registered.');
      const { lastInsertRowid: id } = db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?,'user')").run(name, email, hash);
      row = { id, name, email, role: 'user' };
    } else {
      const expected = row?.password ?? dummyHash;
      const actual = await passwordHash(password, expected.split(':')[0]);
      if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) || !row) fail(401, 'Invalid email or password.');
    }
    setSession(req, res, row);
    return json(res, register ? 201 : 200, { user: publicUser(row) });
  }
  const order = ' ORDER BY c.createdAt DESC, c.rowid ASC';
  if (method === 'GET' && path === '/api/campaigns') return json(res, 200, db.prepare(campaignSelect + order).all().map(campaign));
  const publicRoute = /^\/api\/campaigns\/([a-z0-9-]+)(?:\/(view|download))?$/.exec(path);
  if (publicRoute) {
    const [, slug, action] = publicRoute;
    if (!action && method === 'GET') return json(res, 200, campaign(getCampaign(slug)));
    if (action && method === 'POST') {
      const column = action === 'view' ? 'views' : 'downloads';
      if (!db.prepare(`UPDATE campaigns SET ${column} = ${column} + 1 WHERE slug = ?`).run(slug).changes) fail(404, 'Campaign not found.');
      return json(res, 200, campaign(getCampaign(slug)));
    }
  }
  const managed = /^\/api\/manage\/([a-z0-9-]+)$/.exec(path);
  if (path === '/api/manage' || managed || path === '/api/users') {
    const user = currentUser(req) ?? fail(401, 'Sign in first.');
    const admin = user.role === 'admin';
    if (path === '/api/users' && method === 'GET') {
      if (!admin) fail(403, 'Administrator access required.');
      return json(res, 200, db.prepare('SELECT id,name,email,role FROM users ORDER BY id').all());
    }
    if (path === '/api/manage' && method === 'GET') {
      const rows = admin ? db.prepare(campaignSelect + order).all() : db.prepare(campaignSelect + ' WHERE c.owner_id = ?' + order).all(user.id);
      return json(res, 200, rows.map(campaign));
    }
    if (path === '/api/manage' && method === 'POST') {
      const data = await body(req);
      const [title, description, caption, category, frames, theme] = fields(data);
      const slug = chooseSlug(data.slug, title);
      db.prepare('INSERT INTO campaigns (slug,title,description,caption,category,frames,createdAt,owner_id,theme) VALUES (?,?,?,?,?,?,?,?,?)').run(slug,title,description,caption,category,frames,new Date().toISOString(),user.id,theme);
      return json(res, 201, campaign(getCampaign(slug)));
    }
    if (managed && ['PUT', 'DELETE'].includes(method)) {
      const [, slug] = managed;
      const data = method === 'PUT' ? await body(req) : null;
      const row = getCampaign(slug);
      if (!admin && row.owner_id !== user.id) fail(403, 'You do not own this campaign.');
      if (method === 'DELETE') {
        db.prepare('DELETE FROM campaigns WHERE slug = ?').run(slug);
        return json(res, 200, { ok: true });
      }
      db.prepare('UPDATE campaigns SET title=?,description=?,caption=?,category=?,frames=?,theme=? WHERE slug=?').run(...fields(data, row), slug);
      return json(res, 200, campaign(getCampaign(slug)));
    }
  }
  fail(404, 'API route not found.');
}

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.avif': 'image/avif', '.gif': 'image/gif' };
function inside(root, file) {
  const rel = relative(root, file);
  return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function serve(req, res, path) {
  if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
  const parts = path.split('/').slice(1);
  if (parts.some(part => part.startsWith('.') || /[\\:\x00-\x1f]/.test(part))) fail(404, 'File not found.');
  const spa = ['/', '/jelajah', '/dashboard'].includes(path) || /^\/c\/[a-z0-9-]+\/?$/.test(path);
  const requested = resolve(publicDir, ...(spa ? ['index.html'] : parts));
  if (!inside(publicDir, requested)) fail(404, 'File not found.');
  let bytes;
  try {
    const root = await realpath(publicDir);
    const file = await realpath(requested);
    if (!inside(root, file) || relative(root, file).split(sep).some(part => part.startsWith('.')) || !(await stat(file)).isFile()) fail(404, 'File not found.');
    bytes = await readFile(file);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) fail(404, 'File not found.');
    throw error;
  }
  res.writeHead(200, { 'Content-Type': types[extname(requested).toLowerCase()] || 'application/octet-stream', 'Content-Length': bytes.length });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  let isApi = false;
  try {
    if (!req.url?.startsWith('/')) fail(400, 'Invalid request path.');
    let path;
    try { path = decodeURIComponent(req.url.split('?')[0]); } catch { fail(400, 'Invalid request path.'); }
    isApi = path === '/api' || path.startsWith('/api/');
    if (isApi) await api(req, res, path);
    else await serve(req, res, path);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    if (status === 413) res.setHeader('Connection', 'close');
    const message = status === 500 ? 'Internal server error.' : error.message;
    if (isApi) json(res, status, { error: message });
    else {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(message);
    }
  }
});
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST || '127.0.0.1', () => {
  const { address, port } = server.address();
  console.log(`wicend-twibbon listening on http://${address.includes(':') ? `[${address}]` : address}:${port}`);
});
