# Penerapan wicend-twibbon: Supabase + GitHub + Cloudflare Pages

**GitHub** menyimpan kode dan menjalankan pemeriksaan. **Cloudflare Pages** menyajikan `public/` dan menjalankan API `/api/*` dari `functions/`. **Supabase** mengurus akun, database kampanye, frame dan statistik. Jangan aktifkan GitHub Pages untuk aplikasi ini: hosting statis saja tidak dapat menjalankan API. Foto pengunjung tetap diproses di browser.

## 1. Buat proyek Supabase

1. Masuk ke [Supabase](https://supabase.com/dashboard), pilih **New project**, tentukan nama, region, dan password database yang kuat. Tunggu proyek siap.
2. Buka **SQL Editor → New query**. Salin **seluruh** isi [`supabase/migrations/202611250001_init.sql`](supabase/migrations/202611250001_init.sql), lalu klik **Run** sekali pada proyek baru. Skrip membuat tabel, trigger profil, aturan akses dan data contoh. Jangan jalankan ulang setelah sukses. Jika sudah punya tabel `profiles` atau `campaigns`, lebih aman buat proyek Supabase khusus wicend-twibbon.
3. Di **Authentication → Sign In / Providers**, aktifkan **Email** dan izinkan pendaftaran. Untuk produksi, biarkan konfirmasi email aktif. Siapkan **Custom SMTP** di pengaturan Authentication agar email bisa dikirim ke alamat pengguna umum; layanan email bawaan Supabase memiliki batasan penerima dan kuota. Uji pengiriman dengan alamat di luar tim proyek.
4. Salin **Project URL** (misalnya `https://abcd1234.supabase.co`) dari **Connect** atau pengaturan proyek. Buka **Project Settings → API Keys → Legacy API keys** dan salin nilai `anon` dan `service_role`. Konfigurasi ini memakai **legacy keys**. `service_role` melewati RLS dan hanya boleh tersimpan sebagai secret di Cloudflare atau `.dev.vars` lokal; jangan taruh di berkas `public/`, Wrangler TOML, atau commit Git.

## 2. Masukkan kode ke GitHub

Buat repositori GitHub baru bernama `wicend-twibbon`. Untuk mengikuti perintah ini, biarkan repositori kosong (jangan tambahkan README dari GitHub). Jalankan PowerShell dari folder induk proyek:

```powershell
cd wicend-twibbon
git init -b main
git add .
git status
git commit -m "Siapkan wicend-twibbon untuk Cloudflare Pages dan Supabase"
git remote add origin https://github.com/NAMA-AKUN/wicend-twibbon.git
git push -u origin main
```

Pastikan `public/`, `functions/`, `supabase/`, `wrangler.toml` dan `.github/workflows/check.yml` berada di root repo. Periksa `git status` sebelum commit: `.dev.vars`, `.env`, dan `wicend-twibbon.sqlite` tidak boleh ikut. Di tab **Actions** pastikan workflow **Periksa aplikasi** lulus. Workflow ini memeriksa sintaks dan paket deploy; yang menerapkan aplikasi adalah integrasi Git Cloudflare.

## 3. Hubungkan Cloudflare Pages ke GitHub

1. Di [Cloudflare Dashboard](https://dash.cloudflare.com/), buka **Workers & Pages → Create → Pages → Connect to Git**. Otorisasi GitHub dan pilih repo `wicend-twibbon`. Pilih **Pages**, bukan **Workers** atau **Direct Upload**.
2. Masukkan pengaturan berikut. Nama proyek bisa berbeda jika sudah dipakai; bila berbeda, sesuaikan juga `name` di `wrangler.toml` dengan nama proyek Pages.

   | Pengaturan | Nilai |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | Kosong |
   | Build output directory | `public` |
   | Root directory | Kosong (root repo); jika kode ada dalam monorepo, gunakan `wicend-twibbon` |

3. Klik **Save and Deploy**. Setelah itu buka proyek Pages → **Settings → Variables and Secrets**. Di lingkungan **Production**, masukkan:

   | Nama | Nilai | Jenis |
   |---|---|---|
   | `SUPABASE_URL` | Project URL Supabase | Text |
   | `SUPABASE_ANON_KEY` | Legacy `anon` key | Secret |
   | `SUPABASE_SERVICE_ROLE_KEY` | Legacy `service_role` key | Secret |

4. Dari **Deployments**, ulangi deployment produksi (**Retry deployment**) atau push commit berikutnya. Tanpa variabel, halaman statis bisa terbuka tetapi `/api/*` tidak akan berfungsi. Untuk Preview, gunakan proyek Supabase terpisah dan tambahkan ketiga nilai ke lingkungan **Preview** bila diperlukan; jangan gunakan database produksi untuk uji coba.
5. Catat alamat produksi, misalnya `https://wicend-twibbon.pages.dev`. Untuk domain pribadi, gunakan **Custom domains → Set up a custom domain** dan ikuti petunjuk DNS sebelum mengarahkan pengguna ke domain itu.

## 4. Atur domain login dan buat akun admin

1. Di Supabase → **Authentication → URL Configuration**, isi **Site URL** dengan origin produksi (misalnya `https://wicend-twibbon.pages.dev`). Jika memakai domain pribadi sebagai alamat utama, gunakan domain itu. Tambahkan origin lokal/preview yang diperlukan ke **Redirect URLs** hanya jika memang digunakan. Konfirmasi email mengarahkan pengguna ke Site URL; setelah itu buka **Ruang Kreator** dan masuk secara manual.
2. Daftar melalui **Ruang Kreator**, konfirmasi email, lalu masuk untuk memastikan akun berfungsi.
3. Di Supabase **SQL Editor**, jalankan kueri ini dengan mengganti email contoh. Pastikan baris yang dikembalikan memang akun Anda:

   ```sql
   update public.profiles as p
   set role = 'admin'
   from auth.users as u
   where p.id = u.id
     and lower(u.email) = lower('admin@example.com')
     and u.email_confirmed_at is not null
   returning p.id, p.email, p.role;
   ```

4. Muat ulang dashboard. Tab **Akun pengguna** seharusnya muncul. Untuk mencabut hak, ubah `role` menjadi `'user'` dengan kueri yang sama. Jangan gunakan akun admin untuk pengujian akses kreator biasa.

## 5. Uji dan perbarui

- Buka `/api/campaigns` pada domain produksi: jawabannya harus JSON berisi kampanye contoh. Buka `/c/bumi-lebih-hijau` langsung dan muat ulang untuk memastikan rute editor bekerja.
- Buat akun kreator biasa, unggah frame PNG transparan potret, publikasikan, dan buka URL kampanye dari jendela privat. Pilih rasio **9:16**, unggah foto, lalu periksa ukuran PNG dan perubahan statistik di dashboard. Uji juga bahwa kreator biasa tidak bisa mengelola kampanye milik akun lain.
- Setiap push ke `main` memicu deploy baru. Untuk pemulihan kode, gunakan rollback deployment di Cloudflare; perubahan skema SQL tidak ikut di-rollback. Cadangkan database sebelum perubahan skema.
- Bila halaman menampilkan HTML alih-alih JSON pada `/api/*`, cek lokasi `functions/` di root dan pastikan deployment berasal dari integrasi Pages Git. Jika ada pesan konfigurasi atau kegagalan upstream, cek nama variabel dan lingkungan **Production**, jalankan deploy ulang, lalu periksa log Functions. Jika email tidak tiba, periksa spam, SMTP, rate limit, dan log Authentication Supabase.

### Pengembangan lokal

`node server.mjs` tetap menjalankan versi SQLite yang terpisah dari Supabase. Untuk menguji Pages Functions dengan Supabase, salin `.dev.vars.example` ke `.dev.vars`, isi dengan kredensial proyek **uji**, lalu jalankan dari direktori `wicend-twibbon`:

```powershell
Copy-Item .dev.vars.example .dev.vars
# Edit .dev.vars sebelum menjalankan:
npx.cmd wrangler pages dev public
```

Gunakan URL yang ditampilkan Wrangler. Gunakan `npm.cmd test` pada Windows bila PowerShell menolak `npm.ps1`. Data SQLite lokal, akun dan kata sandi demo **tidak dipindahkan otomatis**; proyek Supabase mulai dengan basis data sendiri. Frame PNG disimpan bersama data kampanye, bukan di bucket; untuk penggunaan berskala besar, pindahkan frame ke Supabase Storage lewat migrasi terpisah.
