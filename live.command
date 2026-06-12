#!/bin/bash
# Lensa Bandar — MODE LIVE (ikuti bola jalan dari Mac).
# Menarik odds tiap 1 menit terus-menerus + buka app. Biarkan jendela ini terbuka saat nonton.
# Halaman web auto-refresh tiap 30 detik, jadi angkanya ikut bergerak.
# Tekan Ctrl+C untuk berhenti.

cd "$(dirname "$0")" || exit 1
[ -f key.txt ] && export ODDS_API_IO_KEY="$(tr -d '[:space:]' < key.txt)"
command -v open >/dev/null 2>&1 && open index.html
echo "▶ MODE LIVE aktif — refresh tiap 1 menit. Ctrl+C untuk berhenti."
node fetch-odds.js --watch 1
