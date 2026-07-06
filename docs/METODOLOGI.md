# Lensa Bandar — Metodologi

Dokumen ini menjelaskan **kenapa** tiap keputusan dibuat, bukan cuma apa. Tujuannya: 3 bulan
lagi siapa pun (termasuk sesi AI lain) paham logikanya, biar metodologi tidak luntur.

## Prinsip inti (jangan dilanggar)
1. **AH (voor) & O/U di atas 1X2.** 1X2 cuma pendukung — "siapa menang" ≠ "menang berapa".
   Banyak orang ketuker: favorit 90% menang **bola** bisa cuma ~50% nutup **voor**.
2. **Garis ≠ harga (juice).** Dua hal dipisah:
   - **Garis bergerak** (mis. −0.75 → −1.25) = bandar **MENGHINDAR** (geser titik biar seimbang).
   - **Harga doang berubah** di garis sama = bandar **MENAMPUNG** (nyaman terima uang di situ).
3. **De-vig dulu** sebelum sebut probabilitas apa pun (buang margin bandar).
4. **Alat informasi, bukan ajakan taruhan.** Tidak ada "pasang ini", tidak ada jaminan menang.

---

## 1. Tujuh Detektor

Tiap detektor = fungsi murni di `engine/index.js`, mengembalikan `{key, aktif, kekuatan, alasan}`.
`alasan` **wajib berisi & spesifik** — bukan "true".

| Detektor | Mendeteksi apa | Ambang (ringkas) |
|---|---|---|
| **fake_favorite** | Favorit kelihatan jagoan tapi voor KECIL + publik ditarik ke favorit | `|voor| 0–0.6` & (harga favorit mengeras ≥0.06 **atau** Bet365 umpan ke favorit) |
| **margin_trap** | Voor BESAR padahal cover ≈ koin → "menang bola ≠ menang voor" | `|voor| ≥ 1.75` & peluang cover (de-vig) ≤ 55% |
| **total_trap** | Total digeser / harga satu sisi dikecilkan → mancing Over/Under | garis O/U gerak **atau** harga Over/Under mengeras ≥0.06 |
| **line_freeze** | <30 mnt ke kickoff tapi garis & harga DIAM total → bandar nyaman | KO dalam 30 mnt & garis flat & water <0.03 dua sisi |
| **late_steam** | Pergerakan TAJAM di <30 mnt → uang tajam menit akhir | KO dalam 30 mnt & garis gerak ≥0.25 **atau** harga mengeras ≥0.08 |
| **value_compression** | Garis sama tapi selisih harga dua sisi MENYEMPIT → value terkuras | garis tetap & (gap harga buka − kini) ≥0.06 |
| **reverse_line_movement** | Garis bergerak MELAWAN sisi publik (uang tajam lawan arus) | garis gerak ≥0.25 ke sisi **berlawanan** dgn publik (umpan Bet365 / favorit pembukaan) |

**Contoh pemicu + alasan:**
- *margin_trap* — Argentina voor −2½, harga dua sisi ~imbang → cover cuma ~50%.
  `"voor Argentina −2½ (besar) padahal de-vig peluang COVER cuma 50% (≈ koin). Butuh menang ≥3 gol; skor modal menang tipis 1–2 gol bikin GAGAL cover — pemasang 'pasti menang besar' kejebak."`
- *reverse_line_movement* — publik di favorit, garis malah geser ke underdog.
  `"publik condong ke X (umpan Bet365), TAPI voor malah bergerak −1 → −0½ ke Y — uang tajam melawan arah publik."`

> Catatan: detektor berbasis waktu (line_freeze, late_steam) butuh `ctx.nowMs`; di produksi
> diisi waktu server. Tanpa pergerakan (mis. input manual satu snapshot), detektor pergerakan
> tidak menyala — itu wajar, bukan bug.

---

## 2. Grade A / B / C / D

Grade = seberapa **jelas kita bisa baca arah bandar**, bukan "seberapa bagus taruhannya".

```
readPower   = Σ kekuatan detektor + kekuatan arah (guidance)      ← SINYAL BACA NYATA
honestBonus = Σ kekuatan bidak jujur × 1.5                        ← BONUS, bukan sumber utama
base        = readPower + honestBonus + (cross searah ? +1.5 : 0) − (cross bentrok ? −3 : 0)

bentrok     → C (base ≥ 4) atau D
A           → base ≥ 7  DAN readPower ≥ 3      (wajib ada read nyata + biasanya dikonfirmasi)
B           → base ≥ 3  DAN readPower ≥ 2
C           → base ≥ 1                          (termasuk "cuma bidak jujur" = tenang, bukan read kuat)
D           → sisanya                           (bising/sepi — jangan paksa baca)
```

**Kenapa A wajib `readPower` (bukan cuma bidak jujur)?**
Awalnya bidak jujur diberi pengali ×2 → laga sepi-tapi-jujur jadi A (pernah 12 dari 22 laga A —
salah). Laga tenang **bukan** read kuat; tak ada yang bisa dieksploit. Jadi A sekarang **wajib
ada pola/arah nyata** (detektor atau pergerakan), dan bidak jujur cuma **bonus ×1.5** yang
mengangkat read yang sudah ada. Hasil realistis: mayoritas laga C (tenang), A langka.

**Kenapa bentrok menurunkan grade?** Kalau O/U mengarah Over tapi corner mengarah Under (atau
AH penuh beda arah dgn AH babak-1), pasar **tak satu suara** → baca jadi bising. Itu **−3** dan
sering jatuh ke **D**. **Grade D dipakai sungguhan** — kalau data berisik, jujur bilang "hindari",
jangan paksa kesimpulan.

---

## 3. Bidak Jujur — kenapa market sepi lebih jujur

Di market ramai (AH/O-U utama) bandar **menggiring** — harga dimanipulasi untuk mancing publik.
Di market **sepi** (draw babak-1, corner) publik jarang main, jadi bandar **tak perlu bohong**;
harga di situ = **keyakinan asli** bandar. Makanya bidak jujur jadi penguat grade.

| Sinyal | Label | Dari mana |
|---|---|---|
| **ht_draw_cheap** | **FAKTA** | Harga draw babak-1 ASLI (dari paste manual), implied ≥42% = "murah" |
| **ht_low_scoring** | **INFERENSI** | Proxy: total HT rendah (≤1.0) + voor HT ~imbang → *kira-kira* draw-HT murah |
| **controlled_game** | **INFERENSI** | Corner moderat (8–11) + total HT rendah (≤1.25) → laga tempo terkontrol |

**Penting:** kalau paste manual berisi harga draw-HT **asli**, `ht_draw_cheap` (FAKTA, kekuatan 3)
**menggantikan** proxy `ht_low_scoring` (inferensi). Harga langsung selalu menang atas tebakan.
Sumber free (odds-api.io) **tidak punya** 1X2 babak-1, jadi tanpa paste manual kita cuma punya
proxy — dan kita **jujur melabelinya inferensi**, bukan fakta.

---

## 4. Lineup Modifier

Lineup di-input **manual** (paste XI/absensi) — **tidak** auto, tidak ada janji free-tier. Modifier
**bisa MEMBALIK read**, bukan catatan tempel: ia menurunkan grade saat lineup bertentangan dgn arah
odds, dengan **alasan terbaca** (tak diam-diam ubah grade).

| Aturan | Kondisi | Dampak |
|---|---|---|
| 1 | Striker kunci **favorit cadangan** | Tekan keyakinan voor besar (margin) & Over (−1 langkah) |
| 2 | **Bintang serang underdog starter** | Kalau odds condong Under → **Under DITURUNKAN** (−2 langkah) |
| 3 | **Underdog parkir/bertahan** | Kalau odds condong Over → Over diturunkan, Under didukung (−1 langkah) |

Output eksplisit: **"Read BERUBAH karena lineup: grade C→D. …"** Status lineup = **FAKTA**;
dampak ke read = **INFERENSI**.

**PRINSIP: lineup itu modifier PROPORSIONAL, bukan penentu tunggal.** Ia menggeser grade beberapa
langkah relatif terhadap read odds — bukan tombol ajaib yang membanting A→D sendirian tanpa konteks.
Kalau lineup **sejalan** dgn odds, ia cuma mencatat (tak menurunkan). Penurunan hanya terjadi saat
ada **kontradiksi** nyata, dan selalu disertai alasan.

*Validasi (Belgia–Mesir): Lukaku cadangan + Salah starter, odds condong Under → grade C→D, dgn alasan
"voor besar & Over ditekan… Under diturunkan". Cocok dgn baca manual kita.*

---

## 5. Cara Pakai Ingest Manual

Panel "Analisa MANUAL" di situs / endpoint Worker `POST ?manual=1`. **1 market per baris**, harga
boleh desimal (1.90) atau HK (0.90). Parser toleran spasi/baris/huruf-besar-kecil, dan
**menampilkan hasil parse untuk diverifikasi sebelum dipakai**.

```
Germany vs Curacao
AH -3.5 1.90 2.10            ← garis, harga home, harga away
OU 4.5 1.95 1.95
AH HT -1 1.95 1.95
OU HT 1.0 1.90 2.00
1X2 1.04 11 26
Draw HT 2.05                 ← harga draw babak-1 ASLI → ganti proxy inferensi
Corner 10.5 1.9 1.9
Card 4 1.9 1.9
Lukaku (favorit) cadangan    ← lineup: striker favorit out
Salah (underdog) starter     ← lineup: bintang underdog main
```

### Keterbatasan jujur (jangan disembunyikan)
- **1X2 babak-1 tidak ada** di sumber free → null, tidak dikarang. Draw-HT hanya dari paste manual.
- **Proxy HT = inferensi**, bukan fakta. Hanya harga draw-HT asli yang FAKTA.
- **Pergerakan garis bukan jaminan menang.** Margin bandar tetap jalan; ini alat baca arah, bukan tiket.
- Input manual satu snapshot → tak ada pergerakan, jadi detektor RLM/steam tidak menyala (wajar).

---

## 6. Arsitektur

```
engine/index.js   ← SATU mesin analisis murni (matematika, de-vig, detektor, grade, report, parser).
                    Tanpa I/O. Dipakai BERSAMA oleh:
  ├─ fetch-odds.js (Node)        — lapisan I/O: HTTP odds-api.io + tulis file (generator statis)
  └─ worker.js (Cloudflare)      — lapisan I/O: fetch + cache + endpoint manual + serve JSON
```

**Kenapa disatukan?** Dulu ada **dua salinan mesin** (fetch-odds.js & worker.js) yang melenceng
diam-diam — perbaikan di satu file lupa di file lain, jadi situs live pakai logika lama. Sekarang
keduanya `import`/`require` engine yang sama → satu sumber kebenaran, **tak ada drift**.

- **History v2** (`{open, snaps, hl}`, generik per-market) → forward-compatible (market HT otomatis
  terekam), high/low untuk RLM, back-compat migrasi format lama (baseline opening tak hilang).
- **Worker primer + statis cadangan:** situs ambil dari Worker (cron adaptif: padat dekat kickoff,
  santai saat sepi, backoff saat kuota 429); kalau Worker gagal → jatuh ke `data/matches.js` statis.

### Uji
`node eval.js` (113 test: detektor, grade, bidak jujur, parser, lineup) & `node accuracy.js`
(rumus settlement + backtest). **Update test tiap ubah logika** — jangan biarkan test lama hijau
padahal logika berubah.

## Multi-liga (Fase 2) — registry, gate data, kalibrasi & kuota

### Registry liga (`config/leagues.js`)
Satu sumber kebenaran: filter event (dulu regex `isWC` DUPLIKAT di `fetch-odds.js` + `worker.js` —
titik drift, kini satu fungsi `buildEventFilter` dipakai keduanya), kalibrasi ambang per liga, mode
(`league`/`knockout`/`hybrid` — fitur khusus gugur di-gate mode), dan cadence polling.
WC 2026 = entri pertama & default; perilaku sekarang identik (eval.js 127/127 + eval-registry.js).

### Gate data (2a-PRA) — `scripts/verify-league-coverage.js`
Liga non-WC berstatus **UNVERIFIED** dan TIDAK aktif sampai terbukti odds **Sbobet+Bet365 terisi**
untuk liga itu di paket API sekarang. Jalankan skrip gate dengan key (env `ODDS_API_KEY` / `key.txt`;
key tak pernah tampil di output), tempel hasil, baru naikkan `dataStatus` per liga.

### KEJUJURAN KALIBRASI — grade non-WC BELUM DIVALIDASI
Ambang skenario/grade (`ambangRout` 2.5, `ambangKetat` 0.75, `readPowerFloor` 6.5) **tervalidasi
hanya untuk WC 2026** (backtest `accuracy-full.js`, 52 laga). Liga reguler memakai placeholder =
nilai WC dengan tanda `// BELUM DIKALIBRASI` — di liga reguler favorit besar (voor ≥2.5) adalah
rutinitas mingguan, jadi distribusi grade PASTI bergeser. **Jangan mengklaim akurasi grade untuk
liga mana pun sebelum ada backtest liga itu** (pakai pola `accuracy.js` pada arsip liga tsb).
Dan ingat verdict backtest WC: sinyal "jebakan" = 47% / +0.00 unit — **alat baca pasar, bukan edge**;
menambah liga TIDAK mengubah fakta ini.

### Cadence sadar-jadwal & matematika kuota (cap odds-api.io = 100 req/jam)
Biaya per fetch = 1 (`events`) + 1 (`events/live`) + ceil(N/10) (`odds/multi`), N = laga di papan.

| Skenario | N (cap) | Call/fetch | Cadence HOT | Fetch/jam | Req/jam | Vs cap 100 |
|---|---|---|---|---|---|---|
| WC sekarang (1 liga) | ≤24 | ≤5 | 3 mnt | 20 | ≤100 | pas — ditolong backoff |
| Weekend 6 liga serentak | 24 (LIMIT) | 5 | 3 mnt | 20 | **100** | **TEMBUS margin nol** |
| Weekend 6 liga, hotMin=4 | 24 | 5 | 4 mnt | 15 | 75 | aman |
| Weekend 6 liga, hotMin=5 | 24 | 5 | 5 mnt | 12 | 60 | aman |

Mitigasi terpasang: (1) **prioritas** `prioritizeEvents` live > kickoff <3 jam > sisanya — saat papan
melewati cap, laga penting tak terpotong; (2) **quiet-skip**: mode `league` berhenti polling saat tak
ada laga dalam `quietSkipHours` (hari kosong liga ≈ 5–6 hari/minggu → hemat ±1.500 call/minggu);
(3) guard kuota lama tetap: baca `x-ratelimit-remaining`, backoff <12 & saat 429.
**Aturan operasional:** bila >2 liga VERIFIED aktif bersamaan, naikkan `hotMin` ke ≥4 di registry
ATAU upgrade paket API — jangan biarkan 100/jam pas-pasan.
