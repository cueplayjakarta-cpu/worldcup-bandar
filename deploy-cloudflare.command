#!/bin/bash
# 🚀 Deploy Worker "Lensa Bandar" ke Cloudflare via wrangler (pakai API Token).
# Token disimpan di cf-token.txt (lokal, tidak diunggah). Sekali set, seterusnya otomatis.
cd "$(dirname "$0")" || exit 1
exec > >(tee "deploy-log.txt") 2>&1

WR="npx --yes wrangler@latest"
command -v wrangler >/dev/null 2>&1 && WR="wrangler"
echo "▶ Memakai: $WR"

# --- API Token Cloudflare ---
if [ -f cf-token.txt ]; then export CLOUDFLARE_API_TOKEN="$(tr -d '[:space:]' < cf-token.txt)"; fi
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo
  echo "Perlu API Token Cloudflare (sekali saja). Cara bikin:"
  echo "  1) dash.cloudflare.com → klik ikon profil kanan atas → 'My Profile'"
  echo "  2) menu 'API Tokens' → 'Create Token'"
  echo "  3) pilih template 'Edit Cloudflare Workers' → Continue → Create Token"
  echo "  4) COPY token-nya"
  echo
  read -r -p "Tempel Cloudflare API Token di sini lalu Enter: " CFT
  CLOUDFLARE_API_TOKEN="$(printf '%s' "$CFT" | tr -d '[:space:]')"
  export CLOUDFLARE_API_TOKEN
  [ -n "$CLOUDFLARE_API_TOKEN" ] && { printf '%s' "$CLOUDFLARE_API_TOKEN" > cf-token.txt; chmod 600 cf-token.txt; echo "  ✓ Token disimpan (cf-token.txt) untuk pemakaian berikutnya."; }
fi
[ -z "$CLOUDFLARE_API_TOKEN" ] && { echo "✗ Token kosong — berhenti. Jalankan lagi & tempel token."; echo "(Tutup jendela.)"; exit 1; }

echo "▶ Deploy Worker (lensa-bandar)…"
DEPLOY_OUT="$($WR deploy 2>&1)"; echo "$DEPLOY_OUT"
URL="$(printf '%s' "$DEPLOY_OUT" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)"

if printf '%s' "$DEPLOY_OUT" | grep -qi 'error'; then
  echo; echo "✗ Deploy kena error (lihat di atas). Salin/kabari Claude — sering soal 'workers.dev subdomain' (daftar sekali di dashboard)."; echo "(Tutup jendela.)"; exit 1
fi

echo "▶ Simpan API key odds-api.io sebagai Secret…"
[ -f key.txt ] && printf '%s' "$(tr -d '[:space:]' < key.txt)" | $WR secret put ODDS_API_IO_KEY

echo
read -r -p "Tempel TOKEN bot Telegram (dari @BotFather), atau Enter untuk lewati: " TG
if [ -n "$TG" ]; then
  printf '%s' "$TG" | $WR secret put TELEGRAM_TOKEN
  if [ -n "$URL" ]; then echo "▶ Menyambungkan bot (setWebhook)…"; curl -s "https://api.telegram.org/bot${TG}/setWebhook?url=${URL}" >/dev/null && echo "  ✓ Bot tersambung"; fi
fi

echo
echo "════════════════════════════════════════"
if [ -n "$URL" ]; then echo "✅ SELESAI!  URL Worker: $URL"; echo "• Tes: buka URL itu → JSON laga. Bot: chat → /jebakan";
else echo "✅ Deploy beres (URL lihat output di atas, …workers.dev)."; fi
echo "════════════════════════════════════════"
echo "(Tutup jendela ini.)"
