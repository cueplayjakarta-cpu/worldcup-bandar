# Bagikan ke teman — link permanen (gratis, tanpa ngoding)

Hasil akhir: satu link seperti `https://NAMAMU.github.io/worldcup-bandar/` yang bisa dibuka siapa saja di HP, **auto-update tiap ~10 menit**, dan **Mac-mu tidak perlu nyala**. API key-mu tetap rahasia.

Butuh ~10 menit, sekali saja. Ikuti urut.

---

## ⚠️ Aturan emas
**JANGAN pernah mengunggah file `key.txt`.** Itu API key-mu. Di langkah upload, jangan pilih `key.txt`. Key-nya kita simpan terpisah sebagai "Secret" (langkah 4).

---

## 1. Buat akun GitHub
Buka **https://github.com** → Sign up (gratis). Catat username-mu.

## 2. Buat repository
- Klik **+** (kanan atas) → **New repository**.
- **Repository name:** `worldcup-bandar`
- Pilih **Public** (wajib, agar gratis & auto-update jalan).
- Klik **Create repository**.

## 3. Upload file proyek
- Di halaman repo baru, klik **uploading an existing file** (atau **Add file → Upload files**).
- Buka folder `worldcup-bandar` di Mac. **Pilih semua isinya KECUALI `key.txt`**, lalu seret ke halaman GitHub.
  - Pastikan ikut: `index.html`, `fetch-odds.js`, `manifest.json`, `icon.svg`, folder `data`, dan folder `.github` (berisi workflow auto-update).
  - Jika folder `.github` tak ikut terseret, ulangi seret folder itu saja sekali lagi.
- Klik **Commit changes**.

## 4. Simpan API key sebagai Secret (aman, tak terlihat publik)
- Di repo: **Settings** → kiri: **Secrets and variables** → **Actions**.
- Klik **New repository secret**.
- **Name:** `ODDS_API_IO_KEY`
- **Secret:** tempel API key odds-api.io-mu.
- **Add secret**.

## 5. Nyalakan situs (GitHub Pages)
- **Settings** → kiri: **Pages**.
- **Source:** Deploy from a branch → **Branch: `main`** → folder **`/ (root)`** → **Save**.
- Tunggu 1–2 menit. Di atas akan muncul link situsmu.

## 6. Jalankan refresh pertama
- Tab **Actions** (atas) → kalau diminta, klik **I understand... enable workflows**.
- Pilih **Refresh odds** → kanan **Run workflow** → **Run workflow**.
- Tunggu ~1 menit (lingkaran hijau = sukses). Ini mengisi data live pertama kali. Selanjutnya otomatis tiap ~10 menit.

## 7. Bagikan!
Link-mu: **`https://NAMAMU.github.io/worldcup-bandar/`** (ganti NAMAMU dengan username GitHub).
Kirim ke grup teman. Selesai. 🎉

---

## Teman: jadikan ikon aplikasi (opsional)
Buka link di HP → menu browser → **"Add to Home Screen"**. Muncul ikon "Lensa Bandar" seperti aplikasi biasa.

## Perawatan
- **Tidak perlu apa-apa.** Data memperbarui sendiri tiap ~10 menit lewat GitHub.
- Mau ganti API key? Ulangi langkah 4 (timpa secret yang sama).

## Catatan
- Repo **Public** berarti angka odds bisa dilihat publik — itu wajar (bukan rahasia). **API key tetap rahasia** karena disimpan di Secrets, bukan di file.
- Kartu tetap "Belum tersambung" (butuh sumber berbayar); Handicap, Over/Under, Corner FT, Corner Babak 1 jalan gratis.
