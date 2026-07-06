'use strict';
/*
 * config/leagues.js — REGISTRY LIGA (config-driven, Fase 2 multi-liga).
 * ---------------------------------------------------------------------
 * SATU sumber kebenaran untuk: liga mana yang aktif, cara mencocokkan event
 * feed odds-api.io ke liga, kalibrasi ambang per liga, dan cadence polling.
 * Dipakai BERSAMA oleh fetch-odds.js (Node) & worker.js (Cloudflare, via esbuild)
 * — menggantikan filter isWC yang dulu DUPLIKAT di dua file (titik drift).
 *
 * CommonJS murni, tanpa I/O — pola sama dengan engine/index.js.
 *
 * ATURAN dataStatus (gate 2a-PRA):
 *   'VERIFIED'   = odds Sbobet+Bet365 terbukti terisi utk liga ini → boleh aktif.
 *   'UNVERIFIED' = BELUM dibuktikan (jalankan scripts/verify-league-coverage.js,
 *                  tempel hasil, baru naikkan status). activeLeagues() default
 *                  HANYA memuat VERIFIED → perilaku sekarang identik (WC saja).
 */

// Kalibrasi default = nilai WC 2026 SAAT INI (sumber: engine/index.js sebelum
// parameterisasi — scenario() ambang 2.5/0.75, gradeMatch() floor A 6.5).
const DEFAULT_KAL = { ambangRout: 2.5, ambangKetat: 0.75, readPowerFloor: 6.5 };

// Placeholder liga reguler = nilai WC apa adanya.
// BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js — JANGAN mengklaim
// akurasi non-WC sebelum ada backtest (dicatat juga di docs/METODOLOGI.md).
const KAL_BELUM_DIKALIBRASI = { ambangRout: 2.5, ambangKetat: 0.75, readPowerFloor: 6.5 };

const LEAGUES = [
  {
    id: 'wc2026', nama: 'Piala Dunia 2026',
    apiSportId: 'football',
    apiLeagueId: null,                     // feed difilter regex nama (tak pernah pakai ID sejak awal)
    season: '2026',
    mode: 'hybrid',                        // grup + gugur
    // match = regex PERSIS sama dgn isWC lama (fetch-odds.js:92 / worker.js:61) → zero regression.
    match: { re: /world[ -]?cup|piala dunia|fifa world/i, country: null, exclude: null },
    cadence: { hotMin: 3, medMin: 10, idleMin: 20, quietSkipHours: null },   // = perilaku worker sekarang
    kalibrasi: { ambangRout: 2.5, ambangKetat: 0.75, readPowerFloor: 6.5 },  // tervalidasi backtest WC (accuracy-full.js, 52 laga)
    dataStatus: 'VERIFIED',
  },
  // ------- Liga besar: SEMUA UNVERIFIED sampai gate 2a-PRA lolos per liga. -------
  // apiLeagueId: TIDAK TERVERIFIKASI — isi dari output scripts/verify-league-coverage.js.
  // match.country membedakan liga senama antarnegara (mis. Serie A Brasil, Bundesliga Austria);
  // regex final disetel dari nama liga PERSIS yang dilaporkan skrip gate.
  {
    id: 'epl', nama: 'Premier League (Inggris)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'league',
    match: { re: /premier league/i, country: /england|inggris/i, exclude: /women|u21|u23|2\b/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 30, quietSkipHours: 12 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
  {
    id: 'laliga', nama: 'La Liga (Spanyol)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'league',
    match: { re: /la ?liga/i, country: /spain|spanyol/i, exclude: /women|segunda|2\b/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 30, quietSkipHours: 12 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
  {
    id: 'seriea', nama: 'Serie A (Italia)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'league',
    match: { re: /serie a/i, country: /italy|italia/i, exclude: /women|brazil|brasil/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 30, quietSkipHours: 12 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
  {
    id: 'bundesliga', nama: 'Bundesliga (Jerman)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'league',
    match: { re: /bundesliga/i, country: /germany|jerman/i, exclude: /austria|women|2\.\s*bundesliga|zweite/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 30, quietSkipHours: 12 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
  {
    id: 'ligue1', nama: 'Ligue 1 (Prancis)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'league',
    match: { re: /ligue 1/i, country: /france|prancis/i, exclude: /women|2\b/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 30, quietSkipHours: 12 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
  {
    id: 'ucl', nama: 'Liga Champions (UEFA)',
    apiSportId: 'football', apiLeagueId: null, season: '2026/27', mode: 'hybrid',
    match: { re: /champions league/i, country: null, exclude: /afc|caf|concacaf|ofc|women/i },
    cadence: { hotMin: 3, medMin: 10, idleMin: 20, quietSkipHours: 24 },
    kalibrasi: Object.assign({}, KAL_BELUM_DIKALIBRASI),  // BELUM DIKALIBRASI: butuh backtest liga ini, lihat accuracy.js
    dataStatus: 'UNVERIFIED',
  },
];

// =====================================================================
//  MATCHER — SATU-SATUNYA tempat logika "event ini liga apa" (2c).
// =====================================================================
// Teks liga dari event feed (bentuknya beragam: string / {name,country} / dsb.)
// — pakai JSON.stringify persis seperti isWC lama supaya perilaku identik.
function eventLeagueText(e) {
  return JSON.stringify((e && (e.league || e.leagueName || e.competition)) || '');
}
function eventMatchesLeague(e, lg) {
  if (!lg || !lg.match || !lg.match.re) return false;
  const txt = eventLeagueText(e);
  if (!lg.match.re.test(txt)) return false;
  if (lg.match.exclude && lg.match.exclude.test(txt)) return false;
  if (lg.match.country && !lg.match.country.test(txt)) return false;
  return true;
}
// Liga aktif = dataStatus VERIFIED (default). {includeUnverified:true} hanya utk tes/preview.
function activeLeagues(opts) {
  const all = (opts && opts.includeUnverified) ? LEAGUES : LEAGUES.filter(l => l.dataStatus === 'VERIFIED');
  return all;
}
// Filter event untuk fetch-odds.js & worker.js — KEDUANYA wajib lewat sini.
function buildEventFilter(leagues) {
  const ls = leagues || activeLeagues();
  return (e) => ls.some(lg => eventMatchesLeague(e, lg));
}
// Liga pemilik sebuah event / nama liga (utk kalibrasi per laga).
function leagueOf(e, leagues) {
  const ls = leagues || LEAGUES;
  for (const lg of ls) if (eventMatchesLeague(e, lg)) return lg;
  return null;
}
function leagueOfName(name, leagues) {
  if (!name) return null;
  return leagueOf({ league: String(name) }, leagues);
}
function getLeague(id) { return LEAGUES.find(l => l.id === id) || null; }

// =====================================================================
//  KALIBRASI (2d) — default = WC; liga lain override lewat registry.
// =====================================================================
function kalibrasiFor(lg) { return Object.assign({}, DEFAULT_KAL, (lg && lg.kalibrasi) || {}); }

// =====================================================================
//  MODE GATING — fitur khusus babak gugur hanya utk mode knockout/hybrid.
//  (Engine BELUM punya market ini — gate disiapkan agar penambahan nanti aman.)
// =====================================================================
const KNOCKOUT_FEATURES = ['toQualify', 'extraTime', 'penalties'];
function modeAllows(lg, feature) {
  if (!lg) return false;
  if (KNOCKOUT_FEATURES.indexOf(feature) >= 0) return lg.mode === 'knockout' || lg.mode === 'hybrid';
  return true;
}

// =====================================================================
//  CADENCE SADAR-JADWAL (2e) — pengganti cadenceMs() worker yang dulu tertanam.
//  Mengembalikan ms antar-fetch, atau NULL = SKIP (tak ada laga dalam jendela
//  quietSkipHours dan SEMUA liga aktif bermode 'league' → jangan buang kuota).
//  WC (hybrid, quietSkipHours null) → tak pernah skip → perilaku sekarang identik.
// =====================================================================
function minutesToNextKO(matches, nowMs) {
  if (!Array.isArray(matches)) return Infinity;
  const now = nowMs || Date.now();
  let mins = Infinity;
  for (const m of matches) {
    if (m.live) return 0;
    if (m.kickoff) { const dm = (new Date(m.kickoff).getTime() - now) / 60000; if (dm > -15 && dm < mins) mins = dm; }
  }
  return mins;
}
function cadenceMsFor(leagues, matches, nowMs) {
  const ls = (leagues && leagues.length) ? leagues : activeLeagues();
  const m = minutesToNextKO(matches, nowMs);
  // SKIP hari kosong: hanya bila SEMUA liga aktif 'league' (WC/hybrid tak pernah tidur).
  const allLeague = ls.length > 0 && ls.every(l => l.mode === 'league');
  if (allLeague) {
    const skipH = Math.min.apply(null, ls.map(l => (l.cadence && l.cadence.quietSkipHours) || Infinity));
    if (isFinite(skipH) && m > skipH * 60) return null;
  }
  // Tier dari liga paling agresif (aman utk papan campuran).
  const hot = Math.min.apply(null, ls.map(l => l.cadence.hotMin));
  const med = Math.min.apply(null, ls.map(l => l.cadence.medMin));
  const idle = Math.min.apply(null, ls.map(l => l.cadence.idleMin));
  if (m <= 60) return hot * 60000;
  if (m <= 180) return med * 60000;
  return idle * 60000;
}

// =====================================================================
//  PRIORITAS EVENT (2e) — saat papan multi-liga melewati cap event:
//  live > kickoff <3 jam > sisanya (tiap kelas urut kickoff naik).
//  Untuk papan WC sekarang hasilnya identik dgn sort lama worker (live dulu,
//  lalu kickoff) — kelas <3 jam mempertahankan urutan kickoff menaik.
// =====================================================================
function prioritizeEvents(events, nowMs, cap) {
  if (!Array.isArray(events)) return [];
  const now = nowMs || Date.now();
  const t = e => new Date(e.date || e.commenceTime || e.kickoff || 0).getTime();
  const cls = e => {
    if (/live|inplay|1h|2h|\bht\b/i.test(String(e.status || ''))) return 0;
    return (t(e) - now) <= 3 * 3600000 ? 1 : 2;
  };
  const sorted = events.slice().sort((a, b) => { const ca = cls(a), cb = cls(b); if (ca !== cb) return ca - cb; return t(a) - t(b); });
  return cap != null ? sorted.slice(0, cap) : sorted;
}

module.exports = {
  LEAGUES, DEFAULT_KAL,
  eventLeagueText, eventMatchesLeague, activeLeagues, buildEventFilter, leagueOf, leagueOfName, getLeague,
  kalibrasiFor, modeAllows, KNOCKOUT_FEATURES,
  minutesToNextKO, cadenceMsFor, prioritizeEvents,
};
