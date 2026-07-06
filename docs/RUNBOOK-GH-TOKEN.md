# RUNBOOK — Ganti GH_TOKEN worker ke Fine-Grained PAT (dan rotasi token lama)

_Masalah (audit 3a-i): secret `GH_TOKEN` di Cloudflare Worker saat ini adalah **OAuth token `gh`
ber-scope lebar** (repo, workflow, gist, read:org). Worker hanya butuh SATU kemampuan:
menulis `data/matches.js` ke repo `worldcup-bandar` (worker.js `commitStatic`, endpoint
`PUT /repos/{repo}/contents/{path}`). Kalau secret ini bocor, scope lebar = seluruh akun GitHub
tersandera. Fine-grained PAT membatasi ledakan ke 1 repo, 1 permission._

**Waktu total ±5 menit. Langkah 1–2 di GitHub, 3 di dashboard Cloudflare, 4 verifikasi, 5 rotasi.**

## 1. Buat Fine-Grained PAT (GitHub)
1. Buka https://github.com/settings/personal-access-tokens/new (login `cueplayjakarta-cpu`).
2. Isi:
   - **Token name**: `lensa-bandar-worker-static`
   - **Expiration**: 90 hari (pasang reminder perpanjang; jangan "no expiration").
   - **Resource owner**: `cueplayjakarta-cpu`
   - **Repository access**: *Only select repositories* → pilih **worldcup-bandar** SAJA.
   - **Permissions → Repository permissions → Contents: Read and write.** (Metadata: Read otomatis.)
     JANGAN beri permission lain (Actions/Workflows/dll — tidak dibutuhkan `commitStatic`).
3. **Generate token** → salin (mulai `github_pat_…`). Tampil sekali saja.

## 2. Simpan sementara dengan aman
- JANGAN taruh di file dalam repo. Kalau perlu parkir: Notes/`~/gh-pat-baru.txt` di luar folder repo, hapus setelah langkah 3.

## 3. Update secret Worker (dashboard Cloudflare) ⚠️ butuh dashboard
1. https://dash.cloudflare.com → **Workers & Pages** → worker **lensa-bandar**.
2. **Settings → Variables and Secrets** → baris `GH_TOKEN` → **Edit** → tempel PAT baru → **Save**.
   (Ini rolling-restart worker; tidak perlu deploy kode, `wrangler` tidak dibutuhkan.)
   Alternatif CLI kalau punya CF API token: `npx wrangler secret put GH_TOKEN` lalu tempel saat diminta.

## 4. Verifikasi worker masih bisa commit cadangan
- Tulis-balik terjadi tiap ~3 jam. Cek: https://github.com/cueplayjakarta-cpu/worldcup-bandar/commits/main
  — dalam ≤3 jam harus muncul commit baru `worker: refresh cadangan statis …`.
- Cek cepat via API worker: buka `https://lensa-bandar.cueplayjakarta.workers.dev` → JSON tetap segar.
- Kalau >4 jam tak ada commit: dashboard CF → worker → **Logs** → cari error 401/403 dari api.github.com
  → berarti PAT salah scope/repo — ulangi langkah 1 (paling sering: lupa pilih repo, atau Contents cuma Read).

## 5. ROTASI token lama (WAJIB — inilah intinya)
Token lama = OAuth `gh` CLI. Dua opsi, pilih satu:
- **Opsi bersih (disarankan):** revoke sesi OAuth `gh` lalu login ulang dgn scope minim:
  1. https://github.com/settings/applications → **Authorized OAuth Apps** → **GitHub CLI** → *Revoke*.
  2. Di Mac: `gh auth login` ulang (pilih scope default; tak perlu gist/read:org).
  (Konsekuensi: `gh` di Mac ini butuh login ulang sekali — push/PR tetap jalan setelahnya.)
- **Opsi minimal:** kalau tak mau ganggu `gh` lokal, cukup pastikan token lama TIDAK dipakai di mana pun
  selain CLI (sudah digantikan PAT di worker) — risiko sisa: token lebar masih hidup di keychain Mac.
  Tetap direkomendasikan opsi bersih saat senggang.

## Catatan keamanan terkait (dari audit 3a)
- Riwayat git **bersih** — tidak pernah ada key/token ter-commit (scan 5 pola, 2026-07-06).
- `key.txt`/`cf-token.txt`/`telegram-token.txt` digitignore sejak awal dan kini tidak ada di disk lokal.
- Secret produksi tinggal di env Worker (benar). Jangan pernah memindahkannya ke repo/GitHub Pages.
