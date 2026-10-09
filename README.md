# ORBOW

**Onchain Record of Bots, Output & Wealth.** Explorer read-only untuk semua agent di launchpad Orbio, ditambah Create (template agent + kode starter).

## Isi

| File | Fungsi |
|---|---|
| `public/index.html` | Seluruh website (satu halaman, tanpa build step) |
| `api/orbio.js` | Proxy kecil ke API publik Orbio, hanya path baca yang diizinkan, cache 60 detik |
| `package.json` | Penanda ESM untuk fungsi Vercel |

Halaman: **Agents** (direktori + Skor ORBOW), **Profil agent** (grafik harga, Report Card PNG), **Network** (total + fee split + syarat launch), **Create** (6 template → identitas → syarat → kode starter), **Developers**.

## Deploy ke Vercel (±5 menit)

1. Buat repo GitHub baru, upload semua isi folder ini.
2. Di vercel.com → **Add New → Project** → pilih repo tadi → **Deploy**. Tidak perlu setting apa pun.
3. Buka URL-nya. Indikator di kanan atas harus **Live · Robinhood Chain**. Kalau tertulis **Sample data**, proxy belum bisa membaca Orbio (lihat di bawah).
4. Opsional: sambungkan domain sendiri (misalnya orbow.xyz) di **Settings → Domains**.

Cara cepat tanpa GitHub: `npm i -g vercel` lalu jalankan `vercel` di folder ini.

## Yang perlu dicek setelah live

- **Bentuk data asli.** Dokumentasi Orbio tidak menampilkan contoh JSON, jadi ORBOW membaca field secara fleksibel (mencari kunci seperti `stake`, `principal`, `fee`, `credit`, `cap`). Buka satu profil agent → **Raw launchpad record** untuk melihat field aslinya. Kalau ada angka yang salah skala atau kosong, sesuaikan fungsi `normalize()` dan `decFor()` di `public/index.html`.
- **Desimal.** $CREDIT dan USDG 6 desimal, $ORBIO 18 desimal. ORBOW menebak dari nama field.
- **Akses.** Orbio menyediakan endpoint ini sebagai bacaan publik tanpa key. Proxy memakai cache 60 detik supaya tidak membebani server mereka. Kalau Orbio meminta dibatasi, naikkan cache-nya.

## Belum ada (tahap berikutnya)

- **Alive Check**: butuh API key Orbio di server untuk membaca aktivitas X agent.
- **Launch langsung dari ORBOW** lewat SDK `@orbiodotso/sdk` dan wallet browser. Saat ini Create mengarahkan ke form launch Orbio.
- Orbit Map, Tools Market, Models, Watchlist, bot X ORBOW.

## Catatan

Proyek komunitas, tidak berafiliasi dengan Orbio. Skor ORBOW adalah ringkasan data publik, bukan saran investasi.
