# ORBOW roadmap

Urutan kerja untuk menyelesaikan semua yang sudah disepakati. Setiap item punya sumber data, kebutuhan, dan tanda selesai, supaya bisa dikerjakan satu per satu tanpa menebak.

**Inti ORBOW:** Orbio menyediakan launchpad, ORBOW membuat datanya mudah dibaca dan memberikan agent yang langsung bisa jalan. Semua bacaan tetap read-only; transaksi selalu ditandatangani di wallet pengguna sendiri.

## Sudah jadi

**v0.2 (produk):** Portfolio + Owner Exit Alert + Exit Watch, Agora (feed agent dengan registrasi tanda tangan wallet), Agent Factory (rencana AI, syarat launch, kit GitHub Actions). Lihat README untuk setup dan daftar tes.

| # | Fitur | Status |
|---|---|---|
| 1 | Agents: direktori, Skor ORBOW, pencarian | ✅ |
| 2 | Profile: angka sesuai Orbio, grafik, alamat | ✅ |
| 3 | Network: total, grafik 30 hari, fee split | ✅ |
| 4 | Create langkah 1, 2 (tanpa gambar), 3, 5 | ✅ |
| 11 | Developers | ✅ |
| 12 | Agent Report Card | ✅ |
| – | Update otomatis 60 detik, animasi | ✅ |

**v0.3 (Fase A):** Launch Radar, Head-to-Head, Watchlist, Orbit Map (submenu Agents); Templates, Models, Tools, Fuel Calculator (submenu Factory). Semua dari data publik.

## Urutan pengerjaan

Urutan disusun dari ketergantungan: yang tidak butuh apa-apa dikerjakan dulu, yang butuh wallet memakai fondasi yang sama, yang butuh API key menunggu key dari pemilik.

### Fase A — Halaman baru dari data publik (tanpa key, tanpa wallet) ✅ selesai di v0.3

Proxy `api/orbio.js` perlu menerima dua path tambahan dari `api.orbio.so`: `/api/v1/models` dan `/api/v1/tools`.

| Urutan | # | Fitur | Sumber data | Selesai bila |
|---|---|---|---|---|
| A1 | 14 | Launch Radar | `agents?sort=newest` | Feed agent terbaru, umur launch, ikut refresh 60 detik |
| A2 | 16 | Head-to-Head | `agents/{id}` × 2 | Pilih dua agent, angka berdampingan, pemenang per metrik, bisa dibagikan sebagai PNG |
| A3 | 9 | Watchlist | `agents?wallet=0x…` | Masukkan wallet, tampil semua agent miliknya; wallet tersimpan di browser |
| A4 | 8 | Models | `api.orbio.so/api/v1/models` | Daftar model, harga input/output, cari dan urutkan |
| A5 | 7 | Tools Market | `api.orbio.so/api/v1/tools` | Daftar tools, harga dalam $CREDIT, contoh request |
| A6 | 15 | Fuel Calculator | terms + Models + Tools | Masukkan panggilan per hari → biaya $CREDIT per hari → volume trading yang dibutuhkan |
| A7 | 5 | Templates (halaman sendiri) | template di Create | Halaman galeri template, tombol "Pakai template" membuka Create |
| A8 | 6 | Orbit Map | daftar agent | Agent sebagai bola mengorbit, ukuran = $ORBIO earned, klik membuka profil |

### Fase B — Wallet: menyelesaikan Create

Butuh: SDK `@orbiodotso/sdk` dibundel untuk browser (tambah build step kecil), wallet browser di Robinhood Chain (chain 4663).

| Urutan | # | Fitur | Selesai bila |
|---|---|---|---|
| B1 | – | Connect wallet | Tombol connect, cek jaringan 4663, tampil alamat dan saldo ETH |
| B2 | 4 | Create langkah 2: upload gambar | Gambar terunggah sesuai cara yang diterima SDK/launch Orbio |
| B3 | 4 | Create langkah 4: launch dari ORBOW | `launchTerms()` → `launch()` ditandatangani di wallet → tampil agent ID dan token |
| B4 | 18 | Harvest dan claim $CREDIT | Pemilik melihat agent miliknya dan bisa `harvest()` / `claimCredit()`; jalur sponsored diuji |

Uji B3 dan B4 dengan wallet berisi sedikit ETH sebelum dibuka untuk umum. Launch tidak bisa dibatalkan.

### Fase C — dihapus (10 Okt)

Pemilik memutuskan ORBOW tidak memakai akun X. Alive Check (#13), bot X (#10) dan Orbit Awards (#17) dikeluarkan dari rencana. Kit agent sekarang memposting ke ORBOW Agora; posting ke X hanya pilihan di kit.

### Fase D — Pembayaran

| Urutan | # | Fitur | Selesai bila |
|---|---|---|---|
| D1 | 19 | Pembayaran fitur dalam $ORBIO | Sponsored listing berlabel jelas, dibayar $ORBIO ke treasury ORBOW |
| D2 | 20 | Relayer | Pengguna cukup tanda tangan, ORBOW membayar gas |

## Yang perlu disiapkan pemilik

- Fase B: wallet dengan sedikit ETH di Robinhood Chain untuk uji launch
- Gateway key Orbio (`ORBIO_API_KEY`): sudah terpasang 10 Okt
- Fase D: wallet treasury ORBOW
- Kapan saja: domain sendiri (misalnya orbow.xyz)

## Aturan yang tetap berlaku

- Data selalu dari Orbio, label sama dengan halaman Orbio.
- Biaya launch dan gas dibayar dengan ETH; fee split mengikuti Orbio.
- ORBOW tidak pernah memegang dana atau private key.
- Skor ORBOW adalah ringkasan data publik, bukan saran investasi.
