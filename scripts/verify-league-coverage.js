#!/usr/bin/env node
'use strict';
/*
 * scripts/verify-league-coverage.js — GATE 2a-PRA multi-liga.
 * -----------------------------------------------------------
 * Menjawab dengan BUKTI: apakah odds Sbobet DAN Bet365 (AH/OU/1X2) TERISI
 * untuk EPL, La Liga, Serie A, Bundesliga, Ligue 1, dan Liga Champions
 * pada paket API key ini. Hasil = dasar menaikkan dataStatus di
 * config/leagues.js dari UNVERIFIED → VERIFIED (per liga).
 *
 * Jalankan sendiri (key TIDAK pernah tampil di output/log/argumen):
 *   ODDS_API_KEY=xxxx node scripts/verify-league-coverage.js
 *   — atau taruh key di file `key.txt` di root repo (gitignored).
 *
 * Konsumsi kuota: 2 + (≤1 per liga yang ada event-nya) ≈ maks 8 request.
 * CATATAN JUJUR: Juli = jeda musim liga Eropa. Kalau suatu liga 0 event,
 * skrip bilang "TAK BISA DIUJI SEKARANG" — itu BUKAN bukti tidak tersedia.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const R = require('../config/leagues.js');

// ---- key: env dulu, lalu key.txt. JANGAN dari argv, JANGAN di-log. ----
function readKey() {
  const env = process.env.ODDS_API_KEY || process.env.ODDS_API_IO_KEY;
  if (env && env.trim()) return env.trim();
  try { return fs.readFileSync(path.join(__dirname, '..', 'key.txt'), 'utf8').trim(); } catch (e) { return null; }
}
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => {
        const rl = res.headers['x-ratelimit-remaining'];
        try { resolve({ status: res.statusCode, body: JSON.parse(b), rl }); }
        catch (e) { resolve({ status: res.statusCode, body: null, rl, rawLen: b.length }); }
      });
    }).on('error', reject);
  });
}
// Redaksi: kalau ada string yang tak sengaja memuat key, jangan pernah cetak URL/error mentah.
function safeErr(e) { return String(e && e.message || e).replace(/apiKey=[^&\s]+/gi, 'apiKey=***'); }

const TARGETS = ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl'].map(id => R.getLeague(id));

function marketFilled(bookArr, names) {
  if (!Array.isArray(bookArr)) return false;
  for (const n of names) {
    const m = bookArr.find(x => (x.name || '').toLowerCase() === n.toLowerCase());
    if (m && Array.isArray(m.odds) && m.odds.length) return true;
  }
  return false;
}
function checkBook(ev, book) {
  const bs = (ev && ev.bookmakers) || {};
  const arr = bs[book] || bs[book.toLowerCase()] || bs[book.toUpperCase()] || null;
  return {
    ah: marketFilled(arr, ['Spread', 'Asian Handicap']),
    ou: marketFilled(arr, ['Totals', 'Over/Under']),
    x12: marketFilled(arr, ['ML', '1X2', 'Match Winner']),
  };
}
const fmt = b => (b ? '✓' : '✗');

(async () => {
  const key = readKey();
  if (!key) {
    console.error('Key tidak ditemukan. Set env ODDS_API_KEY=... atau isi key.txt di root repo.');
    process.exit(2);
  }
  const k = encodeURIComponent(key);
  const BASE = 'https://api.odds-api.io/v3';
  let used = 0, lastRl = null;

  // 1) Daftar liga — cocokkan nama PERSIS (untuk mengisi apiLeagueId registry).
  console.log('1) Menarik daftar liga (/v3/leagues?sport=football)…');
  const lg = await get(`${BASE}/leagues?sport=football&apiKey=${k}`); used++; lastRl = lg.rl || lastRl;
  const leagues = Array.isArray(lg.body) ? lg.body : ((lg.body && (lg.body.leagues || lg.body.data)) || []);
  if (lg.status !== 200) { console.error(`   GAGAL: HTTP ${lg.status} — cek key/paket.`); process.exit(1); }
  console.log(`   ${leagues.length} liga football di API.`);

  // 2) Events sekarang — distribusi liga di feed.
  console.log('2) Menarik papan event (/v3/events?sport=football)…');
  const ev = await get(`${BASE}/events?sport=football&apiKey=${k}`); used++; lastRl = ev.rl || lastRl;
  const events = Array.isArray(ev.body) ? ev.body : ((ev.body && (ev.body.events || ev.body.data)) || []);
  console.log(`   ${events.length} event di feed saat ini.\n`);

  const rows = [];
  for (const t of TARGETS) {
    const inList = leagues.filter(l => R.eventMatchesLeague({ league: l }, t));
    const evs = events.filter(e => R.eventMatchesLeague(e, t));
    let sb = null, b365 = null, sampled = null;
    if (evs.length) {
      const ids = evs.slice(0, 2).map(e => e.id || e.eventId).filter(Boolean).join(',');
      const od = await get(`${BASE}/odds/multi?apiKey=${k}&eventIds=${ids}&bookmakers=Sbobet,Bet365`); used++; lastRl = od.rl || lastRl;
      const arr = Array.isArray(od.body) ? od.body : ((od.body && (od.body.data || od.body.events)) || []);
      sampled = arr.length;
      // "terisi" = MINIMAL SATU event sampel punya market itu (bukti ketersediaan).
      const agg = (book) => arr.reduce((a, e) => { const c = checkBook(e, book); return { ah: a.ah || c.ah, ou: a.ou || c.ou, x12: a.x12 || c.x12 }; }, { ah: false, ou: false, x12: false });
      sb = agg('Sbobet'); b365 = agg('Bet365');
    }
    const verdictNow =
      !inList.length && !evs.length ? 'TAK DITEMUKAN di /leagues & feed — cek nama/paket'
      : !evs.length ? 'ADA di /leagues, 0 event saat ini (jeda musim?) — TAK BISA DIUJI SEKARANG'
      : (sb && b365 && sb.ah && sb.ou && b365.ah && b365.ou) ? 'LOLOS GATE (Sbobet+Bet365 terisi) → boleh VERIFIED'
      : 'ADA event tapi odds Sbobet/Bet365 TIDAK LENGKAP → JANGAN naikkan status';
    rows.push({ liga: t.nama, id: t.id,
      diLeagues: inList.length ? `${inList.length}× (${(inList[0].name || inList[0].league || JSON.stringify(inList[0])).toString().slice(0, 40)})` : '-',
      events: evs.length, sampel: sampled == null ? '-' : sampled,
      sbobet: sb ? `AH${fmt(sb.ah)} OU${fmt(sb.ou)} 1X2${fmt(sb.x12)}` : '-',
      bet365: b365 ? `AH${fmt(b365.ah)} OU${fmt(b365.ou)} 1X2${fmt(b365.x12)}` : '-',
      verdict: verdictNow });
  }

  console.log('══════════ HASIL GATE 2a-PRA — tempelkan tabel ini apa adanya ══════════\n');
  for (const r of rows) {
    console.log(`■ ${r.liga} [${r.id}]`);
    console.log(`   di /leagues : ${r.diLeagues}`);
    console.log(`   event feed  : ${r.events}  ·  sampel odds: ${r.sampel}`);
    console.log(`   Sbobet      : ${r.sbobet}`);
    console.log(`   Bet365      : ${r.bet365}`);
    console.log(`   VERDICT     : ${r.verdict}\n`);
  }
  console.log(`Request terpakai skrip ini: ${used}${lastRl != null ? ` · sisa kuota (header): ${lastRl}` : ''}`);
  console.log('Aturan: liga hanya boleh VERIFIED di config/leagues.js kalau verdict-nya LOLOS GATE.');
  console.log('Kalau "TAK BISA DIUJI SEKARANG": ulangi saat liga itu punya jadwal (pre-season Agustus).');
})().catch(e => { console.error('Gagal:', safeErr(e)); process.exit(1); });
