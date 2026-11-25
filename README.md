# wicend-twibbon

Aplikasi Twibbon berbahasa Indonesia. Foto pengunjung diproses dengan Canvas di browser; server menyimpan akun, kampanye, frame kreator, dan statistik di SQLite.

## Penerapan publik

Ikuti [panduan Supabase + GitHub + Cloudflare Pages](DEPLOY.md) untuk menerapkan aplikasi beserta API, autentikasi, dan database produksi.

## Jalankan secara lokal

Butuh Node.js 24 atau lebih baru. Tidak perlu memasang paket.

```powershell
cd wicend-twibbon
node server.mjs
```

Buka <http://127.0.0.1:3000>. Kampanye contoh langsung tersedia. Daftar di **Ruang Kreator** untuk membuat kampanye, atau konfigurasi akun admin sebelum menjalankan server:

```powershell
$env:ADMIN_EMAIL = 'admin@example.com'
$env:ADMIN_PASSWORD = '<ganti-dengan-password-kuat>'
node server.mjs
```

Pengaturan opsional: `HOST`, `PORT`, `DB_PATH`. Default penyimpanan: `wicend-twibbon.sqlite` di folder proyek. Untuk pemasangan publik, gunakan HTTPS dan aktifkan cookie Secure (`COOKIE_SECURE=1`). Tautan kampanye menggunakan alamat tempat aplikasi dijalankan, jadi URL `127.0.0.1` tidak dapat diakses teman dari perangkat lain.

## Cara pakai

- Pengunjung: buka kampanye, pilih bingkai, pasang dan atur foto, lalu ekspor PNG tanpa watermark. Kontrol foto juga mendukung tombol panah pada pratinjau.
- Kreator: gunakan PNG transparan sesuai rasio yang diinginkan, misalnya 1080 × 1920 untuk Story. Unggah beberapa frame, atur urutan, publikasikan dan bagikan URL. Dashboard menampilkan jumlah kunjungan dan unduhan.
- Editor: gunakan rasio asli bingkai, atau pilih 1:1, 4:5, 9:16, 16:9, 3:2, dan 2:3. Frame tidak diregangkan saat rasio berbeda; area di luar bingkai tetap transparan.
- Admin: lihat akun dan kelola kampanye dari semua kreator.
- Instagram/TikTok tidak mendukung unggah otomatis dari situs ini. Gunakan menu berbagi perangkat bila tersedia atau unduh PNG dan unggah dari aplikasi tujuan.

Angka pada kampanye contoh bersifat ilustratif; statistik baru merupakan hitungan aktivitas, bukan pengguna unik atau unggahan media sosial yang terverifikasi.
