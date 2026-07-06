# ROADMAP KOMERSIAL — Lensa Bandar (Model B: Lisensi Self-Host)

_Fase 4, 2026-07-06. Premis dari [AUDIT-KOMERSIAL.md](AUDIT-KOMERSIAL.md): **BELUM LAYAK JUAL**;
SaaS langganan **DIBLOKIR** ToS odds-api.io §9 (resale data dilarang tanpa izin tertulis) — TIDAK ada
di roadmap ini. Jalur satu-satunya yang sah tanpa negosiasi lisensi: **jual software, pembeli pakai
API key sendiri.** Kejujuran tak bisa ditawar: sinyal inti terbukti 47% / +0.00 unit (koin) — semua
materi jual memakai positioning informasi + track record, tanpa kata "menang/profit/edge"._

---

## 🚦 GATE MANUSIA — butuh Brad / profesional, BUKAN kode. Roadmap tidak jalan melewati ini.

| Gate | Aksi | Siapa | Estimasi |
|---|---|---|---|
| **G1** | Jalankan [RUNBOOK-GH-TOKEN.md](RUNBOOK-GH-TOKEN.md): fine-grained PAT + rotasi OAuth lama (perlu terlepas dari jual/tidak) | Brad (GitHub + dashboard CF) | 5 mnt |
| **G2** | **Keputusan**: lanjut Model B self-host, atau berhenti di alat pribadi? (Ekspektasi jujur di audit: produk ceruk kecil) | Brad | keputusan |
| **G3** | **Konsultasi advokat** SEBELUM menjual/memasarkan ke pasar Indonesia (ITE 27(2); audit 3d: risiko sedang–tinggi). Alternatif tanpa advokat: pasar non-ID saja | Brad + profesional hukum | 1 sesi |
| **G4** | Gate data liga: jalankan `scripts/verify-league-coverage.js` dgn key saat kalender Eropa mulai (± Agustus 2026); tempel hasil → naikkan `dataStatus` per liga yang LOLOS | Brad (butuh key) | 10 mnt, tunggu Agustus |

## Dependency graph

```
G1 token ──────────────────────────────┐
G2 keputusan Model B ──┬─► T1 installer/BYOK ─► T2 dok lisensor ─► T4 onboarding ─► RILIS jual
                       │                                              ▲
                       ├─► T3 anonim brand [SELESAI ✅]───────────────┘
G3 advokat (pasar ID) ─┴─► (kalau non-ID: T5 i18n EN — opsional, L)
G4 verifikasi liga (Agustus) ─► T6 aktifkan liga VERIFIED ─► T7 backtest kalibrasi liga
   (T6/T7 jalur nilai-produk, paralel dgn jalur jual; T7 WAJIB sebelum klaim grade liga baru)
```

## Item kerja (setelah gate)

| # | Item | Isi | Estimasi | Bergantung |
|---|---|---|---|---|
| T1 | Installer BYOK ("bring your own key") | skrip `init.command`/`npm run setup`: tanya key → `wrangler secret put` → deploy → smoke test; template `wrangler.toml` per-buyer | **M** (2–4 hari) | G2 |
| T2 | Dokumentasi lisensor | README "Deploy sendiri" (✅ dasar sudah ada) diperluas: troubleshooting, batas kuota, FAQ; file LICENSE komersial | **S** (1–2 hari) | T1 |
| T3 | Anonimisasi brand sebagai toggle | ✅ **SELESAI Fase 4**: `config/branding.js` (`ANONIM=true` → "Bandar Acuan/Bandar Pembanding"), mengalir engine→payload→UI, 7 tes. Sisa kecil: teks bantuan paste manual masih menyebut SBOBET (`index.html:247,475`) — kosmetik, ikut T4 | **S** (sisa: jam-an) | — |
| T4 | Onboarding user baru | overlay intro 3 langkah + glossary (VOOR/TOTAL/menampung/jagokan) + link metodologi | **S–M** (2–3 hari) | G2 |
| T5 | i18n EN (opsional, hanya bila pasar non-ID) | semua string narasi tertanam di engine ber-bahasa ID → butuh lapisan label | **L** (1–2 minggu) | G3 |
| T6 | Aktifkan liga lolos gate | ubah `dataStatus` per hasil G4; cek `hotMin ≥ 4` bila >2 liga (matematika kuota di METODOLOGI) | **S** (menit) | G4 |
| T7 | Backtest kalibrasi per liga baru | kumpulkan arsip ≥1 putaran; pola `accuracy.js`; setel `kalibrasi` registry; sebelum ini grade liga = BELUM DIVALIDASI | **M** per liga (tunggu data ≥ 1 bulan) | T6 |

**Total jalur jual (setelah G1–G3): ± 1–2 minggu kerja efektif.** Harga acuan audit: lisensi sekali $99–199 + setup berbayar opsional.

## Yang secara sadar TIDAK ada di roadmap
- **SaaS langganan / grup sinyal Telegram berbayar** — diblokir ToS §9 (redistribusi data), lihat audit 3b/3c. Satu-satunya pintu: izin tertulis hello@odds-api.io (silakan tempuh kalau mau — hasilnya mengubah roadmap ini).
- **Klaim akurasi/menang dalam bentuk apa pun** — bertentangan dgn data sendiri (47% / 0.00u). Etalase jualan = transparansi ([uji-akurasi.html](../uji-akurasi.html)), bukan janji.
