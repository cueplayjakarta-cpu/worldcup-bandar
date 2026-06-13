#!/bin/bash
# 🔄 TOMBOL REFRESH — klik dua kali: tarik data SBOBET terbaru + unggah ke situs.
# "Lokal menang" saat bentrok (Mac ini sumber kebenaran). Aman, tidak buang kode.
cd "$(dirname "$0")" || exit 1
[ -f key.txt ] && export ODDS_API_IO_KEY="$(tr -d '[:space:]' < key.txt)"
git config user.email >/dev/null 2>&1 || git config user.email "lensa@bandar.local"
git config user.name  >/dev/null 2>&1 || git config user.name  "Lensa Bandar"

echo "▶ 1/3 Menarik data SBOBET terbaru (+ cek hasil laga selesai)…"
node fetch-odds.js || node fetch-odds.js --demo

echo "▶ 2/3 Menyiapkan unggahan…"
git rebase --abort 2>/dev/null; git merge --abort 2>/dev/null
git add -A
git commit -q -m "refresh $(date -u +%FT%TZ)" 2>/dev/null || echo "  (tidak ada perubahan baru)"
git fetch origin main -q 2>/dev/null
git merge -X ours origin/main -m "sync (lokal menang)" -q 2>/dev/null || git merge --abort 2>/dev/null

echo "▶ 3/3 Mengunggah…"
if git push -q origin main 2>/dev/null; then
  echo; echo "✅ TERKIRIM! Situs update dalam ~1 menit."
  command -v open >/dev/null 2>&1 && open "https://cueplayjakarta-cpu.github.io/worldcup-bandar/"
else
  echo; echo "✗ Gagal mengunggah — salin semua tulisan ini, kirim ke Claude."
fi
echo; echo "(Tutup jendela ini.)"
