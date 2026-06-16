# Lensa Bandar — Piala Dunia 2026

Web app untuk **membaca pergerakan odds SBOBET** (AH/voor, Over/Under, **HT babak-1**, Corner, Kartu) dan menilai arah bandar lewat **grade A/B/C/D** + 7 detektor pola berlabel, bidak jujur, dan lineup modifier.

**Prinsip:** AH/O-U di atas 1X2. Alat informasi, acuan **SBOBET**. **Nol pelacakan taruhan**. **Bukan jaminan untung.**

> 📖 **Cara kerja & alasan tiap keputusan: [docs/METODOLOGI.md](docs/METODOLOGI.md)** — detektor, sistem grade, bidak jujur (FAKTA vs inferensi), lineup modifier, ingest manual, arsitektur. Baca ini dulu biar metodologi tidak luntur.

---

## Isi folder

```
worldcup-bandar/
├── index.html        ← buka ini di browser (HP/laptop)
├── fetch-odds.js      ← ambil & analisis odds → tulis data/matches.js
├── eval.js            ← uji otomatis: buktikan deteksi benar (node eval.js)
├── data/
│   ├── matches.js     ← data yang dibaca index.html (dihasilkan otomatis)
│   ├── matches.json   ← versi JSON (untuk pemeriksaan)
│   └── history.json   ← rekaman pergerakan garis antar-waktu
└── README.md
```

## Apa yang dibaca app
- **"Bandar pegang: ..."** — garis bandar diterjemahkan jadi statistik jelas (selisih gol, peluang %, perkiraan corner/kartu). Peluang sudah dibersihkan dari potongan bandar (de-vig).
- **Bacaan/verdict** — satu kalimat per laga (mis. *"Jebakan favorit: publik condong ke Portugal, garis cuma −1/4…"*).
- **Giringan publik** — bandingkan **SBOBET (sharp)** vs **Bet365 (publik)**; sisi yang publik dikasih bayaran lebih = sisi umpan.
- **Pergerakan** — garis & water buka→sekarang, plus berapa kali bergerak.
- **Nol pelacakan taruhan.**

---

## Cara tercepat — klik dua kali (macOS)

Klik dua kali **`start.command`** di Finder. Ia mengambil data lalu membuka app di browser otomatis.
- Tanpa `key.txt` → jalan dengan **DEMO**.
- Dengan `key.txt` (berisi API key gratis, lihat bawah) → data **SBOBET asli**.

> Pertama kali, macOS bisa menolak (“tidak dikenal”). Klik kanan `start.command` → **Open** → **Open**. Cukup sekali.

## Atau buka manual

Cukup **buka `index.html`** (klik dua kali). Muncul banner **MODE DEMO** — angka contoh untuk menguji tampilan, **bukan odds asli**. Untuk menyegarkan data demo: `node fetch-odds.js --demo` (Node v24 sudah terpasang).

## Apa yang langsung kamu lihat
- **Ringkasan harian** di atas: berapa laga ada jebakan, jebakan favorit, dan tenang.
- Tiap laga: **Bacaan** (verdict) + **⚖️ Kesimpulan: keuntungan bandar mengintai di [sisi]** + kalimat **"Bandar pegang"** per pasar.

---

## Data SBOBET sungguhan — GRATIS (disarankan)

Pakai **odds-api.io free tier**: gratis selamanya, tanpa kartu kredit, memuat **SBOBET** untuk **Handicap + Over/Under + pergerakan + pembanding Bet365**. (Corner & kartu tidak ada di free tier — lihat bawah.)

**Langkah 1 — ambil API key gratis:**
1. Buka **https://odds-api.io** → masukkan email → key langsung dikirim (tanpa kartu).

**Langkah 2 — pasang key (paling mudah):**
Buat file bernama **`key.txt`** di folder ini, isi **hanya** key-nya, simpan. Lalu klik dua kali **`start.command`**. Selesai — data jadi SBOBET asli.

Atau lewat terminal:
```bash
cd worldcup-bandar
ODDS_API_IO_KEY=tempel_key_kamu node fetch-odds.js
```
Banner DEMO hilang, data jadi SBOBET asli. Buka ulang `index.html`.

**Segarkan otomatis tiap 5 menit** (odds bergerak menjelang kickoff):
```bash
ODDS_API_IO_KEY=xxxx node fetch-odds.js --watch 5
```

## Corner (GRATIS) & Kartu

**Corner FT + Corner Babak 1 sekarang GRATIS** — diambil dari market "Totals"/"Totals HT" Sbobet di odds-api.io (sudah otomatis). Tidak perlu langganan.

**Kartu** belum ada di feed gratis ini → app menandai **"Belum tersambung"** (tidak pernah dikarang). Kalau mau kartu, pakai **trial 15 hari iSports**:
1. Daftar **https://www.isportsapi.com/en/auth/register** → **Start Free Trial** → **Football** → salin **API Key**.
2. Jalankan: `ISPORTS_API_KEY=xxxx node fetch-odds.js`

> Catatan teknis: struktur respons tiap API difinalkan saat key aktif. Lapisan normalisasi
> ada di `normalizeOddsApiIo()` dan `fetchFromISports()` (sudah diberi komentar). Kalau nama
> field-nya beda, kirim aku satu contoh respons asli dan kurapikan dalam semenit.

## Uji otomatis (buktikan otaknya benar)
```bash
node eval.js     # 25 pengecekan: jebakan favorit, steam move, divergence, matematika
```

---

## Cara membaca

- **Lampu hijau** — margin wajar, pergerakan tenang.
- **Lampu kuning** — ada gerakan berarti / margin agak tinggi → hati-hati.
- **Lampu merah** — tanda jebakan (margin tinggi / garis di-shade ke favorit) → waspada.
- **▼ hijau** = bayaran sisi itu naik · **▲ merah** = bayaran turun (sisi "berat", biasanya ke situ publik dipancing).
- **Margin** = potongan bandar; makin besar makin "mahal" buat pemain. Corner & Kartu wajar lebih tinggi.

Tujuan alat ini: bantu main **lebih sedikit, lebih sadar, tidak terjebak** — bukan menjamin menang.

---

## Selanjutnya (saat siap)
- Hosting agar teman buka lewat link (tanpa Node) — ditunda sesuai rencana.
- Auto-refresh berkala.
- Penyetelan field iSports memakai respons trial asli.
