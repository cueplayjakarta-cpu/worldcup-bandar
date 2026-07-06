# Lensa Bandar — Terminal Pembaca Pergerakan Odds

Web app untuk **membaca struktur & pergerakan odds bandar acuan (SBOBET)** — AH/voor, Over/Under, HT babak-1, corner, kartu — lalu menerjemahkannya jadi bacaan jelas: **skenario yang dipegang bandar, ke mana publik digiring, grade A/B/C/D** dari 7 detektor pola berlabel + bidak jujur + lineup modifier.

## Positioning — baca ini dulu

**Ini terminal INFORMASI + metodologi terbuka + track record transparan. BUKAN alat menang.**

Kami menguji app ini terhadap hasil asli World Cup 2026 (52 laga, semua bacaan, termasuk yang gagal — [bukti lengkap](uji-akurasi.html) / [docs/AKURASI-LENGKAP.md](docs/AKURASI-LENGKAP.md)):

| Metrik | Hasil |
|---|---|
| Favorit 1X2 benar menang | 35/52 (67%) |
| Arah VOOR tepat | 11/19 (58%) · +1.50u pra-vig |
| Arah TOTAL tepat | 5/6 (83%) · +3.50u pra-vig |
| **Sinyal "jebakan" terbukti kalah** | **14/30 (47%) · +0.00 unit — setara lempar koin** |

Angka **47% / nol unit** itu kesimpulan paling penting dan kami tulis terbuka: **membaca pergerakan odds TIDAK memberi edge menang yang andal**. Yang app ini berikan: memahami struktur pasar, tidak ikut arus, main lebih sadar. *Alat informasi, bukan ajakan bertaruh, bukan jaminan untung, nol pelacakan taruhan.*

> 📖 Metodologi & alasan tiap keputusan: [docs/METODOLOGI.md](docs/METODOLOGI.md) · Bukti akurasi: [uji-akurasi.html](uji-akurasi.html)

---

## Status multi-liga

**Mekanisme: SIAP.** Registry config-driven di [config/leagues.js](config/leagues.js) — filter liga tunggal (dipakai Node & Worker), kalibrasi ambang per liga, cadence sadar-jadwal (mode `league` berhenti polling di hari kosong), gate fitur knockout per mode.

**Data: BELUM TERVERIFIKASI.** WC 2026 = satu-satunya liga `VERIFIED`. EPL / La Liga / Serie A / Bundesliga / Ligue 1 / UCL terdaftar `UNVERIFIED` — **nonaktif** sampai terbukti odds Sbobet+Bet365 terisi untuk liga itu di key API-mu:
```bash
ODDS_API_KEY=key_kamu node scripts/verify-league-coverage.js   # gate; liga Eropa baru bisa diuji saat kalender jalan (± Agustus)
```
Kalibrasi grade liga non-WC memakai placeholder nilai WC (`BELUM DIKALIBRASI`) — **jangan percaya grade non-WC sebelum ada backtest liga itu** ([docs/METODOLOGI.md](docs/METODOLOGI.md) bagian multi-liga).

### Cara menambah liga baru (3 langkah)
1. **Daftarkan** di `config/leagues.js`: entri `{id, nama, match:{re,country,exclude}, mode, cadence, kalibrasi, dataStatus:'UNVERIFIED'}`.
2. **Buktikan datanya**: `node scripts/verify-league-coverage.js` → verdict per liga → kalau LOLOS, ubah `dataStatus:'VERIFIED'`.
3. **Backtest kalibrasinya**: kumpulkan arsip liga itu, jalankan pola `accuracy.js`, setel `kalibrasi` — sebelum itu, grade liga tsb berstatus belum tervalidasi.

## Status komersial

**Model: lisensi SELF-HOST — bukan SaaS langganan.** Alasan (bukan selera): ToS odds-api.io §9 melarang *resale/redistribute/sublicense* data tanpa izin tertulis — menjual akses ke app hosted = melanggar di semua tier. Rincian + kutipan: [docs/AUDIT-KOMERSIAL.md](docs/AUDIT-KOMERSIAL.md) (verdict: **belum layak jual**; jalur bersyarat: [docs/ROADMAP-KOMERSIAL.md](docs/ROADMAP-KOMERSIAL.md)).

Yang sah dijual: **perangkat lunaknya** — pembeli deploy sendiri dengan **API key odds-api.io miliknya sendiri** (lihat "Deploy sendiri" di bawah). Mode jual menganonimkan brand bandar: setel `ANONIM = true` di [config/branding.js](config/branding.js) → "Bandar Acuan / Bandar Pembanding" (default `false` = nama asli, untuk pemakaian pribadi).

---

## Menjalankan (pemakaian pribadi)

- **macOS, paling cepat:** klik dua kali `start.command` — tanpa `key.txt` jalan DEMO; dengan `key.txt` (API key gratis dari https://odds-api.io) data asli.
- **Terminal:** `ODDS_API_IO_KEY=key node fetch-odds.js` → buka `index.html`. Refresh berkala: `--watch 5`.
- **Produksi (punya Brad):** Cloudflare Worker (`worker.js`, cron adaptif, cache-first — pengunjung tidak mengonsumsi kuota API) + GitHub Pages + cadangan statis `data/matches.js` yang di-commit worker tiap ~3 jam.

## Deploy sendiri (untuk calon pemegang lisensi)

**Bawa key odds-api.io-mu sendiri** (free tier cukup untuk 1 liga; cap 100 req/jam):
1. Fork/salin repo → `npx wrangler deploy` (butuh akun Cloudflare gratis) → set secret: `npx wrangler secret put ODDS_API_IO_KEY`.
2. Opsional: `GH_TOKEN` fine-grained (Contents:write, 1 repo) untuk cadangan statis — panduan aman: [docs/RUNBOOK-GH-TOKEN.md](docs/RUNBOOK-GH-TOKEN.md); `TELEGRAM_TOKEN` untuk bot.
3. Arahkan `WORKER` di `index.html` ke URL worker-mu, host `index.html` di mana saja (GitHub Pages/CF Pages).
4. Mode jual/publik: `ANONIM=true` di `config/branding.js`. Baca batas kuota di [docs/METODOLOGI.md](docs/METODOLOGI.md) (matematika 100 req/jam; >2 liga aktif → `hotMin ≥ 4`).

## Uji otomatis

```bash
node eval.js            # 127 tes engine (detektor, grade, skenario, parser, lineup)
node eval-registry.js   # 60 tes registry, kalibrasi, cadence, filter tunggal, rilis & branding
node accuracy.js        # rumus settlement + backtest arsip
node accuracy-full.js   # backtest LENGKAP vs hasil asli WC2026 (52 laga)
```

## Isi folder

```
index.html                 UI (buka di browser)          engine/index.js   mesin analisis tunggal (murni)
worker.js                  Cloudflare Worker (live)      config/leagues.js registry liga (filter/kalibrasi/cadence)
fetch-odds.js              generator Node                config/branding.js toggle anonim brand
uji-akurasi.html           bukti akurasi publik          scripts/verify-league-coverage.js  gate data liga
eval.js · eval-registry.js suite tes                     accuracy.js · accuracy-full.js     backtest
docs/                      METODOLOGI · AKURASI-LENGKAP · AUDIT-MULTILIGA · AUDIT-KOMERSIAL · ROADMAP-KOMERSIAL · RUNBOOK-GH-TOKEN
data/                      matches.js/json (output) · history.json (garis antar-waktu) · archive.json (backtest)
```

---

**Tujuan alat ini: bantu main lebih sedikit, lebih sadar, tidak terjebak — bukan menjamin menang.** Angka kami sendiri (47%) bilang begitu.
