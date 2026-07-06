# AUDIT MULTI-LIGA — Lensa Bandar

_Fase 1 dari misi multi-liga & kelayakan komersial. Read-only — belum ada perubahan kode._
_Tanggal: 2026-07-06. Basis: commit `a772e04`. Semua temuan dilabeli FAKTA / INFERENSI / SPEKULASI._

---

## 1a. Inventaris hardcode turnamen

### Temuan kunci (FAKTA, dengan bukti)

**Tidak ada logika turnamen sama sekali di engine.** Grep menyeluruh (`knockout|gugur|qualify|penalt|extra time|best third|amnesty`) menemukan **nol** market knockout (To Qualify, extra time, penalti), **nol** logika best-third, **nol** yellow-card amnesty, **nol** simulasi grup/klasemen. Satu-satunya kata "babak" di engine = **babak 1 (HT)**, bukan babak gugur. App bekerja murni **per-laga** — `group` hanyalah label kosmetik dari nama liga (`engine/index.js:910`).

→ INFERENSI: fondasi portabilitas jauh lebih baik dari dugaan. Yang mengikat ke WC bukan logika analisa, melainkan **filter sumber data + branding**.

### Tabel hardcode

| # | File:Baris | Apa yang hardcoded | Dampak kalau ganti liga | Kelas |
|---|---|---|---|---|
| H1 | `fetch-odds.js:92` | `isWC` regex `/world[ -]?cup\|piala dunia\|fifa world/i` — filter event | Liga lain TERBUANG di sisi klien | **BLOCKER logika** |
| H2 | `worker.js:61` | **Duplikat** `isWC` yang sama di worker | Sama dgn H1 + titik drift Node↔worker (filter hidup di LUAR engine tunggal) | **BLOCKER logika** |
| H3 | `fetch-odds.js:95`, `worker.js:63` | Fallback: kalau 0 event WC → ambil 30/semua event apa pun | Multi-liga sebenarnya SUDAH mengalir lewat sini — tapi tak terkontrol (liga acak tercampur) | Perilaku tak disengaja |
| H4 | `fetch-odds.js:96` | `slice(0, 40)` cap 40 event per fetch | Multi-liga serentak (weekend) bisa terpotong sewenang-wenang | Kapasitas |
| H5 | `fetch-odds.js:142-176` | 6 laga demo tim WC, "Grup A–F" | Kosmetik; menyesatkan di liga lain | Kosmetik |
| H6 | `index.html:15,233` | Judul & subjudul "Piala Dunia 2026" | Branding salah | Kosmetik |
| H7 | `worker.js:104` | Teks bot Telegram "pembaca gerak bandar Piala Dunia" | Branding salah | Kosmetik |
| H8 | `README.md:1` | Judul "Piala Dunia 2026" | Dokumentasi salah | Kosmetik |
| H9 | `wrangler.toml:8-19`, `worker.js:43` | Cadence HOT/MED/SEPI + budget call dihitung utk jadwal turnamen harian, cap 100 req/jam | Liga mingguan: boros saat hari kosong, sempit saat weekend multi-liga (lihat 1c-ii) | **Kalibrasi** |
| H10 | `worker.js:23,86`, `*.command`, `SEGARKAN.command:22` | Nama repo/URL `worldcup-bandar` | Identitas repo, bukan logika — jalan apa adanya | Abaikan |

TIDAK TERVERIFIKASI: tidak ditemukan ID turnamen/kompetisi numerik di kode (filter murni regex nama liga) — jadi tidak ada "tournament ID" yang harus diganti.

---

## 1b. Audit API upstream (odds-api.io)

### FAKTA (bukti kode + panggilan tanpa-kuota)

1. **Feed events TIDAK difilter liga di server.** `fetch-odds.js:86` → `GET /v3/events?sport=football` (tanpa parameter league). Seluruh filter liga terjadi di klien (H1/H2). Artinya: **event multi-liga sudah ada di feed yang sama** — dibuktikan fallback H3 yang pernah menyedot event non-WC.
2. **Endpoint yang dipakai sekarang**: `PUT /v3/bookmakers/selected/select?bookmakers=Sbobet,Bet365` (`fetch-odds.js:85`), `GET /v3/events` (`:86`), `GET /v3/events/live` (`:89`), `GET /v3/odds/multi?eventIds=…&bookmakers=Sbobet,Bet365` (`:101`, batch 10), `GET /v3/events/{id}` untuk hasil (`:198`). Worker memakai set yang sama (`worker.js:57,59,68`).
3. **Sbobet & Bet365 ADA di API** — diverifikasi langsung 2026-07-06 via `GET /v3/bookmakers` (endpoint tanpa auth): 266 bookmaker, `'Sbobet'` dan `'Bet365'` keduanya terdaftar.
4. **Endpoint daftar liga ada**: `GET /v3/leagues?sport={slug}` (dokumentasi resmi docs.odds-api.io, diambil 2026-07-06).
5. Kunci API **tidak lagi tersedia lokal** (`key.txt`/`cf-token.txt`/`telegram-token.txt` hilang dari Mac ini; key hanya tersisa di GitHub Secrets & env Worker — keduanya tak bisa dibaca balik). Verifikasi berkuota tidak bisa dilakukan dari sini.

### TIDAK TERVERIFIKASI (wajib dicek di dashboard/key odds-api.io)

| Pertanyaan | Cara cek persis |
|---|---|
| EPL, La Liga, Serie A, Bundesliga, Ligue 1, UCL muncul di feed key ini? | `GET /v3/leagues?sport=football&apiKey=…` → cari nama; lalu `GET /v3/events?sport=football` → inspeksi distribusi `league.name` |
| Format ID liga | Lihat struktur respons `/v3/leagues` (name/slug/id) |
| Odds **Sbobet+Bet365 terisi** utk liga-liga itu di paket sekarang (free tier)? | `GET /v3/odds/multi?eventIds=<1 event EPL>&bookmakers=Sbobet,Bet365` → cek `bookmakers.Sbobet` tidak kosong |
| Kuota free tier cukup utk >1 liga? | Header `x-ratelimit-remaining` (kode sudah membacanya, `worker.js` adaptive) — cap terukur 100 req/jam |

→ INFERENSI (ditandai): karena feed events sudah lintas-liga dan Sbobet/Bet365 ada di daftar bookmaker global, kemungkinan besar liga top tersedia; **tapi ketersediaan odds per-bookmaker per-liga di tier free belum terbukti** — jangan dianggap fakta sebelum dicek.

---

## 1c. Audit portabilitas mesin analisa

Verdict per komponen: **PORTABEL** (jalan apa adanya) / **PERLU ADAPTASI** (mekanisme netral, kalibrasi/konteks perlu diparameterkan) / **KHUSUS-WC**.

| Komponen | Bukti | Verdict | Effort |
|---|---|---|---|
| 7 detektor (`engine/index.js:419-513`) | Semua fungsi murni atas market+`ctx.nowMs`; nol asumsi turnamen. Ambang tertanam: fake_favorite voor<0.6, margin_trap ≥1.75 & cover≤55%, late_steam/line_freeze jendela 30 mnt, delta juice 0.06–0.10 | **PORTABEL** (mekanis); ambang → registry | S |
| Skenario voor×total (`:366-386`) | Ambang tertanam: ketat ≤0.75, rout ≥2.5, total 2.5/2.75/3.25 | **PERLU ADAPTASI** — lihat catatan (i) | M |
| Bidak jujur (`:337-359`) | Pakai market HT/corner generik (ouHT≤1.0, drawHT≥42%, corner 8–11) — market ini ada di semua liga yang diliput SBOBET | **PORTABEL**, ambang → registry | S |
| Grade readPower ≥6.5 (`:541-562`) | `structural` didorong besarnya voor (v≥2.5 → 3.5 poin) | **PERLU ADAPTASI** — lihat catatan (i) | M |
| Lineup modifier (`:585-611`) | Murni aturan favorit/underdog — tak kenal turnamen | **PORTABEL** | — |
| parseManual (`:925-974`) | Papan manual apa pun; kata kunci bahasa Indonesia | **PORTABEL** | — |
| normalizeOddsApiIo (`:889-914`) | Nama market odds-api.io generik (Spread/Totals/Corners Totals/Bookings Totals/ML); `group` ← `league.name` sudah generik (`:910`) | **PORTABEL** | — |
| History schema v2 (`:692-768`) | `HIST_MARKETS` generik per-market; **nol field WC**; snapshot forward-compatible | **PORTABEL** (FAKTA) | — |
| Settlement/backtest (`accuracy.js`, `engine:42-55`) | Matematika AH/OU universal | **PORTABEL** | — |
| eval.js 127 tes | Nama tim WC hanya kosmetik; substansi = matematika market | **PORTABEL** | — |
| Filter sumber `isWC` (H1/H2) | Regex nama turnamen, duplikat di 2 file | **KHUSUS-WC** → ganti registry | S |
| Cadence cron (H9) | Dirancang jadwal turnamen | **PERLU ADAPTASI** — lihat catatan (ii) | M |
| Demo + branding (H5–H8) | Teks/nama WC | **KHUSUS-WC** kosmetik | S |

### Catatan khusus yang diminta

**(i) Kalibrasi ambang di liga reguler.** FAKTA: `scenario()` menyebut voor ≥2.5 = "rout/menang besar" dan `gradeMatch` memberi `structural=3.5` (hampir grade B otomatis) untuk voor ≥2.5. INFERENSI: di WC antar-negara voor ≥2.5 memang kejadian langka & informatif; di liga reguler (Man City/Bayern/PSG vs tim promosi) voor −2.5..−3.5 adalah **rutinitas mingguan** — distribusi grade akan menggelembung ke A/B dan kata "rout pesta gol" kehilangan makna pembeda. Ambang HARUS jadi parameter per-liga (`ambangRout`, `ambangKetat`, bobot structural), default = nilai WC sekarang. SPEKULASI (ditandai): nilai awal liga top mungkin perlu `ambangRout` ~3.0–3.25; **jangan diklaim akurat sebelum backtest liga itu** (aturan 2c).

**(ii) Cadence untuk jadwal mingguan.** FAKTA: cron `*/3` + tier HOT(<60mnt)/MED(<3j)/SEPI dgn budget dihitung utk papan turnamen harian (`wrangler.toml:8-19`); SEPI tetap ~12 call/jam sepanjang minggu. INFERENSI: liga mingguan = 5–6 hari kosong (boros ±1.700 call/minggu tanpa laga) lalu **lonjakan serentak** Sabtu 21:00 WIB — beberapa liga kick-off bersamaan, event ≫40 (cap H4), batch odds/multi membengkak → cap 100 req/jam bisa jebol justru saat paling dibutuhkan. Adaptasi: registry per-liga punya `cadence` + jendela hari-main; scheduler tidur saat tak ada fixture & membagi budget saat weekend padat.

**(iii) Schema history v2.** FAKTA: netral liga — tak ada field turnamen; key = event id. Aman dipakai lintas liga tanpa migrasi.

---

## Ringkasan verdict & effort

- **Mesin analisa: PORTABEL.** Tidak ada satu pun komponen analisa yang KHUSUS-WC. Yang khusus-WC hanya: filter sumber (1 regex, 2 tempat) + branding.
- **Pekerjaan nyata Fase 2**: (1) registry `config/leagues.js` [M], (2) ganti H1/H2 dgn matcher registry — sekaligus hilangkan duplikasi filter Node↔worker [S], (3) parameterkan ambang skenario/grade lewat ctx [M], (4) cadence sadar-jadwal [M], (5) kosmetik/demo [S].
- **Risiko terbesar bukan kode**: ketersediaan odds Sbobet+Bet365 per-liga di tier API sekarang (1b TIDAK TERVERIFIKASI) — kalau kosong, multi-liga mati di sumber data, bukan di mesin.

_Fase 2 belum dikerjakan — menunggu konfirmasi checkpoint ini._
