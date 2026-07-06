# AUDIT KELAYAKAN KOMERSIAL — Lensa Bandar

_Fase 3. Tanggal: 2026-07-06. Semua klaim berbukti (path:baris / kutipan verbatim) atau ditandai
TIDAK TERVERIFIKASI. Skor 1–5 per dimensi. Bukan nasihat hukum._

---

## 🚨 BLOCKER — BACA INI DULU (tidak dikubur, sesuai aturan)

**B1 — FATAL · ToS odds-api.io MELARANG redistribusi/resale data tanpa izin tertulis.**
Kutipan verbatim, Terms of Service §9 "Data Usage and Restrictions" (diambil dari odds-api.io/terms, 2026-07-06):
> *"You may not resell, redistribute, or sublicense our data to third parties without prior written consent from Odds API"*
> *"If you wish to resell or redistribute our data commercially, you must contact us in writing at hello@odds-api.io to discuss licensing arrangements."*

Tidak ada tier berbayar yang memberi hak ini (halaman pricing: Free £0 · Starter £99/bln · Growth £179 · Pro £229 · Enterprise "Contact Sales" — semuanya soal kuota & jumlah bookmaker, **bukan hak redistribusi**). Artinya: **menjual akses ke app yang menampilkan data odds = melanggar ToS di semua tier standar.** Konsekuensi realistis: key dimatikan → produk mati mendadak di tangan pelanggan.
⚠️ Catatan jujur tambahan: **situs publik GRATIS yang sekarang pun** (GitHub Pages + worker JSON terbuka) secara harfiah sudah "membuat data dapat diakses pihak ketiga". Profil rendah & non-komersial ≠ patuh ToS.
**Jalur keluar yang sah:** (a) izin tertulis / lisensi komersial via hello@odds-api.io, ATAU (b) **model self-host**: jual SOFTWARE-nya, pembeli pakai **API key odds-api.io miliknya sendiri** → kamu tidak meredistribusi data siapa pun (lihat 3b Model B).

**B2 — INTEGRITAS · Sinyal inti terbukti nol edge.**
Backtest lengkap 52 laga WC2026 ([AKURASI-LENGKAP.md](AKURASI-LENGKAP.md)): sinyal "jebakan" 14/30 (47%), P/L **+0.00 unit** = koin. Menjual ini sebagai "alat menang melawan bandar" = **menjual klaim palsu** — dan pembeli produk taruhan MENGUJI klaim dengan uangnya sendiri, jadi kebohongan pasti ketahuan. Positioning yang bisa dipertahankan HANYA: *terminal informasi struktur pasar + metodologi terbuka + track record transparan* (halaman `uji-akurasi.html` kini tertaut dari app — pembeda jujur satu-satunya di ceruk ini).

**B3 — LEGAL ID · Menjual produk analisa odds ke pasar Indonesia = risiko sedang–tinggi.** (Rincian 3d.)

---

## 3a. Keamanan — skor gabungan **3.5/5**

### (i) GH_TOKEN worker — skor 2/5 (masalah diketahui, eksekusi disiapkan)
FAKTA: `worker.js:136` butuh `GH_TOKEN` hanya untuk `commitStatic` (`PUT /repos/{repo}/contents/data/matches.js`, `worker.js:142-152`); token terpasang = OAuth `gh` scope lebar (repo/workflow/gist/read:org — item pending sejak 2026-06-17). Kemampuan yang dibutuhkan: **Contents:write pada 1 repo**. 
**Eksekusi:** runbook langkah-demi-langkah siap di **[RUNBOOK-GH-TOKEN.md](RUNBOOK-GH-TOKEN.md)** (buat fine-grained PAT repo-tunggal → update secret di dashboard CF → verifikasi commit ~3 jam → revoke OAuth lama). Bagian yang butuh dashboard Cloudflare ditandai. Sisa risiko sampai dijalankan: bocornya 1 secret = seluruh akun GitHub.

### (ii) Paparan API key — skor 5/5 · VERDICT: **BERSIH, tidak pernah bocor**
FAKTA (scan riwayat penuh `git log --all -p`, 2026-07-06, 5 pola): `apiKey=<nilai>` → 0 temuan; token GitHub (`ghp_/github_pat_/gho_/ghs_`) → 0; token Telegram (`\d{8,10}:AA…`) → 0; token Cloudflare → 0; file sensitif pernah ter-track (`key|token|secret|.env`) → 0. `key.txt`/`cf-token.txt`/`telegram-token.txt` digitignore sejak awal (.gitignore baris 2,9,11) dan kini tak ada di disk. Key produksi hidup hanya sebagai secret env Worker (`worker.js:9`, `env.ODDS_API_IO_KEY`). Tidak perlu rotasi darurat.

### (iii) Rate-limit & skala pengunjung — skor 4/5 · **BUKAN blocker**
FAKTA (`worker.js:155-170`): permintaan halaman **selalu dilayani dari cache**; hanya cold-start yang menembus upstream — komentar kode eksplisit: *"biar konsumsi kuota terikat ke cron, bukan jumlah pengunjung"*. Kuota upstream dikonsumsi cron adaptif (3/10/20 mnt) + guard `x-ratelimit-remaining<12` + backoff 429 (`worker.js:44-46,183`).
**Hitungan:** 100 orang buka app serentak = 100 hit cache Worker + **0 request upstream** (di luar 1 cold-start bila cache kosong). Konsumsi upstream tetap ≈ ≤100 req/jam dari cron, independen dari trafik. Cloudflare free tier 100.000 req/hari ≈ 69 req/menit rata-rata — cukup ribuan pengunjung.
Celah kecil (−1): `POST ?manual=1` dan webhook Telegram **tanpa auth/rate-limit** (`worker.js:159-161`) — vektor pemborosan CPU worker (bukan kuota odds-api). Mitigasi murah: batasi ukuran body + rate-limit per-IP bila dikomersialkan.

## 3b. Arsitektur multi-user — skor kesiapan **2/5** (single-tenant hari ini)

Kondisi: GitHub Pages statis + 1 Worker tanpa auth + localStorage per-browser. Belum ada konsep "user".

| | **A. SaaS penuh** | **B. Lisensi self-host** ⭐ | **C. Kanal ringan (Telegram berbayar)** |
|---|---|---|---|
| Bentuk | auth + billing + DB, kamu host semua | jual kode + skrip setup; pembeli deploy CF sendiri **dgn API key sendiri** | grup/bot berbayar yang mengirim hasil analisa |
| Effort | **L** (4–8 minggu: auth, entitlement, Stripe/Midtrans, dashboard, isolasi) | **S–M** (1–2 minggu: installer `wrangler`, README komersial, lisensi, dukungan) | **S** (bot sudah ada — `worker.js:91-123`) |
| Infra/bulan | Workers Paid $5 + DB (Supabase Pro $25 / D1 ~$0–5) + domain ≈ **$30–40** + fee payment 3% | **≈ $0** (infra ditanggung pembeli; CF free tier cukup) | $0–5 |
| Cocok dgn arsitektur sekarang | Rendah — worker harus dirombak (auth, per-user entitlement) | **Tinggi** — repo sudah self-contained (deploy.command, wrangler.toml, engine tunggal, registry liga) | Tinggi (bot jalan) |
| Nasib vs **B1 (ToS)** | ❌ TETAP melanggar (kamu meredistribusi data ke pelanggan) kecuali dapat lisensi tertulis | ✅ **LOLOS** — tiap pembeli konsumen langsung odds-api.io dgn key & ToS-nya sendiri; kamu menjual perangkat lunak, bukan data | ❌ Mengirim odds/analisa turunan data ke pelanggan = redistribusi; butuh izin tertulis juga |
| Time-to-market | Lambat | **Cepat** | Cepat tapi ilegal-ToS |

**Rekomendasi: Model B (lisensi self-host)** — satu-satunya yang tidak menabrak B1, effort terkecil, paling cocok dgn arsitektur, dan selaras B2 (yang dijual = perangkat + metodologi + transparansi, bukan janji menang). Harga wajar: lisensi sekali (mis. $99–199) + opsi setup berbayar. Catatan: pasar produk semacam ini kecil & teknis — ini **produk sampingan**, bukan bisnis skala.

## 3c. Lisensi data — skor **1/5** · VERDICT: **DILARANG tanpa izin tertulis** (kutipan di B1)

- Semua tier publik (£0–£229/bln) hanya menaikkan kuota/bookmaker; **hak redistribusi tidak dijual sebagai tier** — hanya via "licensing arrangements" tertulis (email hello@odds-api.io). Harga lisensi komersial: TIDAK TERVERIFIKASI (tidak dipublikasikan).
- **Merek dagang:** menampilkan "SBOBET"/"Bet365" di produk BERBAYAR = risiko klaim asosiasi/endorsement palsu (kedua merek terdaftar; SBOBET juga terblokir di Indonesia — lihat 3d, memperburuk optik). Mitigasi murah & disarankan untuk versi jual: anonimkan jadi **"Bandar Acuan (sharp)" / "Bandar Publik"** — engine tak berubah, hanya label UI (`index.html:233`, `worker.js:75` `reference/compare`). Untuk versi privat sekarang: risiko praktis rendah.

## 3d. Legal ringkas Indonesia — skor **2/5** · risiko: **SEDANG–TINGGI untuk produk berbayar**

Fakta regulasi (due diligence, bukan nasihat hukum):
- Perjudian (termasuk online) ilegal total di Indonesia: KUHP 303/303bis; KUHP baru (UU 1/2023, berlaku 2026) Pasal 426–427.
- **UU ITE Pasal 27 ayat (2)** (dan revisi UU 1/2024): melarang mendistribusikan/mentransmisikan/**membuat dapat diaksesnya** Informasi/Dokumen Elektronik **bermuatan perjudian** — ini menjangkau KONTEN, bukan hanya transaksi. Sanksi pidana di Pasal 45.
- Praktik penegakan: Komdigi (d/h Kominfo) memblokir jutaan konten terkait judi online secara agresif, termasuk situs yang dianggap mempromosikan/memfasilitasi — tanpa perlu ada transaksi di situs itu.
- Posisi produk: **informasi/analisa** (tanpa transaksi, tanpa deposit, tanpa afiliasi bandar). Disclaimer sudah konsisten di 3 titik: `index.html:233` *"Alat informasi, bukan ajakan bertaruh, bukan jaminan untung"*, output worker (`worker.js:75` `note`), bot Telegram (`worker.js:99`). Ini memperkuat posisi (menunjukkan itikad: edukasi, bukan ajakan) — tetapi **tidak memberi imunitas** terhadap Pasal 27(2) maupun pemblokiran, karena kontennya tetap odds situs judi (SBOBET) yang diblokir di Indonesia.
- **Verdict:** penggunaan pribadi = risiko rendah (status quo). **Menjual ke pasar Indonesia = sedang–tinggi** (pemblokiran hampir pasti begitu dikenal; eksposur pidana ITE bergantung interpretasi "bermuatan perjudian" — nyata, bukan teoretis). Yang memperkuat posisi: tanpa transaksi, disclaimer, framing edukasi/track-record, tidak menautkan ke situs bandar. **Keputusan jual butuh konsultasi advokat** — faktual selesai di sini.

## 3e. Kesiapan produk — skor **2.5/5**

| Aspek | Kondisi (bukti) | Gap |
|---|---|---|
| Onboarding | **Nol** — user baru langsung papan penuh istilah (VOOR/menampung/jagokan); legenda grade ada (`index.html:238`) tapi tanpa intro | Overlay 3 langkah + glossary; effort S |
| Dokumentasi | `METODOLOGI.md` bagus utk developer; user-facing belum ada | Panduan pengguna 1 halaman; S |
| **Bukti akurasi** | ✅ **DIIMPLEMENTASIKAN sekarang**: `lensa-bandar-uji-akurasi.html` ternyata TIDAK PERNAH ADA (temuan) → dibuat **`uji-akurasi.html`** (KPI + 52 laga + bacaan jujur "47% = koin") + **link nyata di header app** (`index.html:234`) | — selesai; regen manual saat backtest baru |
| UX mobile | Viewport OK (`index.html:5`), manifest PWA (`:7`), layout kartu responsif | Belum diuji formal lintas device; M |
| i18n | ID-only — cukup untuk pasar awal ID… yang justru pasar berisiko legal tertinggi (3d). EN dibutuhkan bila pivot pasar luar | L (semua string tertanam di engine berbahasa ID) |

## 3f. VERDICT KESELURUHAN

| Dimensi | Skor |
|---|---|
| Keamanan (3a) | 3.5/5 |
| Arsitektur multi-user (3b) | 2/5 |
| **Lisensi data (3c)** | **1/5 — blocker** |
| Legal ID (3d) | 2/5 |
| Kesiapan produk (3e) | 2.5/5 |
| Kejujuran/track-record (pembeda) | 4/5 |

### ❌ BELUM LAYAK JUAL — dengan jalur bersyarat yang jelas

Blocker berurutan (harus selesai SEBELUM rupiah pertama):
1. **B1 ToS**: pilih — (a) minta lisensi tertulis ke hello@odds-api.io (sebutkan use case, minta harga), ATAU (b) **pivot ke Model B self-host** (pembeli pakai key sendiri) — rekomendasi kuat: (b), karena gratis, cepat, dan pasti sah.
2. **B2 positioning**: kunci semua materi jual ke "terminal informasi + metodologi + backtest transparan". Dilarang kata "menang/profit/edge". Halaman `uji-akurasi.html` = etalase utama.
3. **B3 pasar**: jangan jual ke pasar Indonesia tanpa konsultasi advokat; alternatif: pasar non-ID (butuh i18n EN) atau tetap produk pribadi.
4. Jalankan [RUNBOOK-GH-TOKEN.md](RUNBOOK-GH-TOKEN.md) (rotasi token — perlu terlepas dari jual/tidak).
5. Kalau lanjut Model B: rapikan onboarding + installer + anonimkan brand bandar → baru buka penjualan.

**Rekomendasi monetisasi:** Model B (lisensi self-host, $99–199 sekali beli + setup berbayar opsional), pasar non-ID atau komunitas teknis, positioning jujur. **Ekspektasi realistis:** produk ceruk-kecil; nilai terbesarnya tetap sebagai portofolio rekayasa & alat pribadi — data akurasi sendiri bilang tak ada edge yang bisa dijual sebagai edge.
