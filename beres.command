#!/bin/bash
# Perbaikan final: simpan API key ke GitHub (Secret) + bereskan folder + jalankan robot sekarang.
cd "$(dirname "$0")" || exit 1
REPO="cueplayjakarta-cpu/worldcup-bandar"

echo "▶ Membatalkan proses git yang menggantung…"
git rebase --abort 2>/dev/null
git merge  --abort 2>/dev/null

echo "▶ Menyimpan API key ke GitHub sebagai Secret…"
if gh secret set ODDS_API_IO_KEY -b "$(tr -d '[:space:]' < key.txt)" -R "$REPO"; then
  echo "  ✓ Secret tersimpan"
else
  echo "  ✗ Gagal simpan secret — salin pesan ini ke Claude."
fi

echo "▶ Menyinkron folder lokal dengan GitHub…"
git fetch origin main 2>/dev/null
git reset --hard origin/main 2>/dev/null

echo "▶ Menjalankan robot ambil data ASLI sekarang…"
gh workflow run refresh.yml -R "$REPO" 2>/dev/null && echo "  ✓ Robot dijalankan" || echo "  (kalau gagal, tak apa — robot tetap jalan otomatis tiap 5 menit)"

echo
echo "✅ BERES. Tunggu ~2 menit, lalu refresh link app-mu."
echo "   Data SBOBET asli akan muncul, dan lanjut update otomatis sendiri."
echo
echo "(Tutup jendela ini.)"
