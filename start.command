#!/bin/bash
# Lensa Bandar — peluncur sekali-klik (macOS).
# Klik dua kali file ini di Finder: ambil data → buka app di browser.
# Kalau ada file key.txt (berisi API key odds-api.io), datanya jadi SBOBET asli.
# Tanpa key.txt, jalan dengan data DEMO.

cd "$(dirname "$0")" || exit 1

if [ -f key.txt ]; then
  export ODDS_API_IO_KEY="$(tr -d '[:space:]' < key.txt)"
  echo "▶ Memakai API key dari key.txt (data SBOBET asli)…"
else
  echo "▶ Tidak ada key.txt — memakai data DEMO. (Lihat README untuk data asli gratis.)"
fi

if command -v node >/dev/null 2>&1; then
  node fetch-odds.js || node fetch-odds.js --demo
else
  echo "✗ Node.js tidak ditemukan. Pasang Node lalu coba lagi."
fi

# Buka app di browser default.
if command -v open >/dev/null 2>&1; then open index.html; fi
echo "✓ Selesai. Kalau browser tak terbuka, klik dua kali index.html."
