#!/bin/bash
# Lensa Bandar — deploy otomatis ke GitHub Pages (link permanen, gratis).
# Klik dua kali. Skrip ini: pasang GitHub CLI bila perlu → login → bikin repo public →
# upload → simpan API key sebagai Secret → nyalakan Pages → kasih link.
# key.txt TIDAK pernah diunggah (dilindungi .gitignore).

set -e
cd "$(dirname "$0")" || exit 1
REPO="worldcup-bandar"

echo "▶ Lensa Bandar — deploy ke GitHub Pages"
echo

# 1) GitHub CLI
if ! command -v gh >/dev/null 2>&1; then
  echo "▶ Memasang GitHub CLI (gh)…"
  if command -v brew >/dev/null 2>&1; then brew install gh; else
    echo "✗ Homebrew tidak ada. Pasang gh manual: https://cli.github.com  lalu jalankan lagi."; exit 1; fi
fi

# 2) Login bila belum
if ! gh auth status >/dev/null 2>&1; then
  echo "▶ Login GitHub — ikuti instruksi di browser yang terbuka…"
  gh auth login -h github.com -p https -w
fi
USER=$(gh api user -q .login)
echo "▶ Akun: $USER"

# 3) Siapkan git (key.txt otomatis dikecualikan oleh .gitignore)
git init -q 2>/dev/null || true
git add -A
git rm --cached -q key.txt 2>/dev/null || true   # pengaman ekstra: jangan pernah commit key
git commit -q -m "Lensa Bandar — deploy" 2>/dev/null || echo "  (tidak ada perubahan untuk di-commit)"
git branch -M main

# 4) Buat repo + push (atau pakai yang sudah ada)
if gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  echo "▶ Repo sudah ada, push pembaruan…"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$USER/$REPO.git"
  git push -u origin main --force
else
  echo "▶ Membuat repo public & upload…"
  gh repo create "$REPO" --public --source=. --remote=origin --push
fi

# 5) Simpan API key sebagai Secret (dari key.txt, lewat stdin)
if [ -f key.txt ]; then
  printf '%s' "$(tr -d '[:space:]' < key.txt)" | gh secret set ODDS_API_IO_KEY -R "$USER/$REPO"
  echo "▶ API key tersimpan sebagai Secret (aman)."
else
  echo "! key.txt tak ada — set manual nanti di Settings → Secrets (ODDS_API_IO_KEY)."
fi

# 6) Nyalakan Pages (branch main / root)
gh api -X POST "repos/$USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || gh api -X PUT "repos/$USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/" >/dev/null 2>&1 \
  || echo "  (Pages mungkin sudah aktif — cek Settings → Pages bila perlu)"

# 7) Jalankan refresh pertama
gh workflow run "Refresh odds" -R "$USER/$REPO" >/dev/null 2>&1 || true

echo
echo "✅ SELESAI! Link kamu (aktif dalam 1–2 menit):"
echo
echo "   https://$USER.github.io/$REPO/"
echo
echo "Bagikan link itu ke teman-temanmu. Data auto-update tiap ~10 menit."
