# Mode LIVE cepat — Cloudflare Worker (gratis, tanpa VPS)

Tujuan: data segar **~1 menit** (bukan 5-10 menit seperti GitHub), tanpa nyentuh VPS/bot-mu. Worker jalan di server Cloudflare, **terisolasi total** — cuma akses internet odds-api.io. API key disimpan rahasia.

> GitHub tetap jadi "rumah" halaman. Worker cuma menyuplai **data live** ke halaman itu.

---

## A. Pasang Worker (lewat web dashboard, tanpa ngoding)

1. Bikin akun gratis di **https://dash.cloudflare.com** (verifikasi email).
2. Menu kiri: **Workers & Pages** → **Create** → **Create Worker**.
3. Kasih nama, mis. `lensa-bandar` → **Deploy** (biarkan kode contoh dulu).
4. Klik **Edit code**. Hapus semua isinya, lalu **tempel seluruh isi file `worker.js`**. Klik **Deploy** (kanan atas).
5. **Simpan API key sebagai Secret:** halaman Worker → **Settings** → **Variables and Secrets** → **Add** →
   - Type: **Secret**
   - Name: `ODDS_API_IO_KEY`
   - Value: tempel API key odds-api.io-mu → **Deploy/Save**.
6. **(Opsional, biar makin segar)** Settings → **Triggers** → **Cron Triggers** → **Add Cron Trigger** → isi `* * * * *` (tiap menit) → Save. Ini menghangatkan cache otomatis.
7. Salin **URL Worker**-mu (bentuknya `https://lensa-bandar.<sesuatu>.workers.dev`). Buka URL itu di browser — harus muncul **JSON berisi laga**. Kalau muncul JSON, Worker sudah hidup. 🎉

## B. Sambungkan halaman ke Worker

Pilih salah satu:

- **Cara permanen (disarankan):** buka `index.html`, cari baris `var DEFAULT_LIVE_URL = '';` lalu isi dengan URL Worker-mu:
  ```js
  var DEFAULT_LIVE_URL = 'https://lensa-bandar.xxxx.workers.dev';
  ```
  Simpan, lalu push ke GitHub (jalankan `beres.command`, atau commit lewat web). Setelah itu **semua orang** yang buka link dapat data live otomatis.

- **Cara cepat (tanpa push):** bagikan link dengan parameter, mis.
  `https://cueplayjakarta-cpu.github.io/worldcup-bandar/?live=https://lensa-bandar.xxxx.workers.dev`

Halaman akan menarik data dari Worker tiap **30 detik**, dan Worker menyegarkan dari SBOBET tiap **~1 menit**.

---

## Catatan jujur (free tier)
- Worker gratis: **10ms CPU/permintaan**. Karena itu jumlah laga dibatasi (`LIMIT = 24`, utamakan live + terdekat). Cukup untuk fokus laga yang lagi/akan main.
- Kalau muncul error CPU saat ramai: turunkan `LIMIT` di `worker.js` (mis. 16), **atau** upgrade **Workers Paid ($5/bln)** yang menghapus batas CPU — tetap jauh lebih murah dari opsi lain, dan tetap terisolasi dari botmu.
- API key **tidak pernah** ke halaman/publik — cuma ada sebagai Secret di Worker.
- Worker hanya bisa akses internet odds-api.io. **Nol akses** ke VPS/data/bot-mu.

## Matikan mode live (balik ke GitHub statis)
Kosongkan lagi `DEFAULT_LIVE_URL` (atau buka link tanpa `?live=`). Halaman balik pakai data statis GitHub.
