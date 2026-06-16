#!/usr/bin/env node
/*
 * fetch-odds.js — LAPISAN I/O + generator "Lensa Bandar" (Node).
 * ------------------------------------------------------------------
 * Mesin analisis kini ada di engine/index.js (dipakai bersama Worker).
 * File ini hanya: ambil odds (HTTP), baca/tulis file (history/archive/output),
 * dan menjalankan engine atas data tersebut.
 *
 * SUMBER DATA (otomatis dipilih, prioritas gratis dulu):
 *   ODDS_API_IO_KEY=xxx node fetch-odds.js   # GRATIS (SBOBET: AH + O/U)
 *   ISPORTS_API_KEY=xxx  node fetch-odds.js   # trial
 *   node fetch-odds.js --demo                 # data contoh (berlabel DEMO)
 *   node fetch-odds.js --watch 5              # segarkan tiap 5 menit
 */

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ---- mesin analisis tunggal ----
const E = require('./engine');
const { num, parseScore, normalizeOddsApiIo, analyzeMatch } = E;

const OUT_DIR = path.join(__dirname, 'data');
const OUT_FILE = path.join(OUT_DIR, 'matches.json');
const HIST_FILE = path.join(OUT_DIR, 'history.json');
const ARCH_FILE = path.join(OUT_DIR, 'archive.json');
const SBOBET_COMPANY_ID = 31;

// ARSIP BACKTEST: simpan bacaan terakhir tiap laga + skor akhir → bukti untuk uji tesis.
function loadArchive() { try { return JSON.parse(fs.readFileSync(ARCH_FILE, 'utf8')); } catch (e) { return {}; } }
function updateArchive(arch, matches) {
  const now = Date.now();
  for (const m of matches) {
    const fin = /settled|finished|ended|^ft$/i.test(String(m.status || ''));
    const e = arch[m.id] || (arch[m.id] = { id: m.id, home: m.home, away: m.away, kickoff: m.kickoff });
    if (!e.final) {
      e.read = {
        win: m.win || null,
        trapped: !!(m.conclusion && m.conclusion.trapped),
        topPick: (m.conclusion && m.conclusion.topPick) || null,
        arah: (m.guidance && m.guidance.primary) || null,
        ahLine: m.markets.ah.lineDisplay != null ? m.markets.ah.line.now : null,
        ouLine: m.markets.ou.lineDisplay != null ? m.markets.ou.line.now : null,
        overallLight: m.overallLight,
      };
      e.status = m.status;
    }
    const started = /live|settled|finished|ended|^ft$|inplay|playing|1h|2h|ht/i.test(String(m.status || ''));
    if (m.score && m.score.home != null && started) e.score = m.score;
    if (fin) { e.final = true; e.settledAt = e.settledAt || now; e.finalScore = e.score || null; }
    e.updatedAt = now;
  }
  return arch;
}

// ---- HISTORY: baca file (penulisan snapshot dilakukan engine.updateHistory via analyzeMatch) ----
function loadHistory() { try { return JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch (e) { return {}; } }

// =====================================================================
//  SUMBER DATA NYATA (HTTP)
// =====================================================================
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('Bukan JSON: ' + b.slice(0, 160))); } }); }).on('error', reject);
  });
}
function httpReq(method, url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const u = new URL(url);
    const req = lib.request({ method, hostname: u.hostname, path: u.pathname + u.search }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)); });
    req.on('error', () => resolve(null)); req.end();
  });
}

// GRATIS: odds-api.io (acuan Sbobet + publik Bet365). AH + O/U. Corner/kartu = null (tak ada di free tier).
const ODDS_BASE = 'https://api.odds-api.io/v3';
async function fetchFromOddsApiIo(apiKey) {
  const k = encodeURIComponent(apiKey);
  await httpReq('PUT', `${ODDS_BASE}/bookmakers/selected/select?bookmakers=Sbobet,Bet365&apiKey=${k}`);
  const evRes = await httpGet(`${ODDS_BASE}/events?sport=football&apiKey=${k}`);
  const upcoming = Array.isArray(evRes) ? evRes : (evRes.events || evRes.data || []);
  let live = [];
  try { const lv = await httpGet(`${ODDS_BASE}/events/live?apiKey=${k}`); live = Array.isArray(lv) ? lv : (lv.events || lv.data || []); } catch (e) {}
  const seen = new Set(); const merged = [];
  for (const e of [...live, ...upcoming]) { const id = e.id || e.eventId; if (id == null || seen.has(id)) continue; seen.add(id); merged.push(e); }
  const isWC = e => /world[ -]?cup|piala dunia|fifa world/i.test(JSON.stringify(e.league || e.leagueName || e.competition || ''));
  const notDone = e => { const s = String(e.status || '').toLowerCase(); return s !== 'settled' && s !== 'finished' && s !== 'cancelled' && s !== 'ft'; };
  let wc = merged.filter(e => isWC(e) && notDone(e));
  if (!wc.length) wc = merged.filter(notDone).slice(0, 30);
  const ids = wc.map(e => e.id || e.eventId).filter(Boolean).slice(0, 40);
  if (!ids.length) return [];
  const all = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10).join(',');
    const od = await httpGet(`${ODDS_BASE}/odds/multi?apiKey=${k}&eventIds=${batch}&bookmakers=Sbobet,Bet365`);
    const arr = Array.isArray(od) ? od : (od.data || od.events || []);
    all.push(...arr);
  }
  const meta = {};
  for (const e of [...live, ...upcoming]) {
    const id = e.id || e.eventId; if (id == null) continue;
    meta[String(id)] = { status: e.status, scores: e.scores || e.score || e.result || e.ss || null,
      time: e.time || e.minute || e.clock || e.timer || e.elapsed || (e.status && e.status.minute) || null };
  }
  try { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(path.join(OUT_DIR, 'raw-sample.json'),
    JSON.stringify({ liveEvents: live.slice(0, 4), wcEvents: wc.slice(0, 3), odds: all.slice(0, 3) }, null, 2)); } catch (e) {}
  const matches = normalizeOddsApiIo(all);
  for (const mt of matches) {
    const x = meta[mt.id]; if (!x) continue;
    const sc = parseScore(x.scores); if (sc) mt.score = sc;
    if (x.status) mt.status = x.status;
    if (x.time != null) mt.minute = String(x.time);
  }
  return matches;
}

// TRIAL: iSports (semua pasar).
async function fetchFromISports(apiKey) {
  const url = `http://api.isportsapi.com/sport/football/odds/main?api_key=${encodeURIComponent(apiKey)}&companyId=${SBOBET_COMPANY_ID}`;
  const res = await httpGet(url);
  const data = (res && (res.data || res.result)) || [];
  if (!Array.isArray(data)) return [];
  return data.map(d => ({
    id: String(d.matchId || d.id), home: d.homeName || d.home, away: d.awayName || d.away, group: d.groupName || null, kickoff: d.matchTime || d.kickoff,
    ah: { line: { open: num(d.ahLineOpen), now: num(d.ahLineNow) }, openHome: num(d.ahOpenHome), openAway: num(d.ahOpenAway), nowHome: num(d.ahNowHome), nowAway: num(d.ahNowAway), pub: null },
    ou: { line: { open: num(d.ouLineOpen), now: num(d.ouLineNow) }, openHome: num(d.ouOpenOver), openAway: num(d.ouOpenUnder), nowHome: num(d.ouNowOver), nowAway: num(d.ouNowUnder), pub: null },
    corner: { line: { open: num(d.cnLineOpen), now: num(d.cnLineNow) }, openHome: num(d.cnOpenOver), openAway: num(d.cnOpenUnder), nowHome: num(d.cnNowOver), nowAway: num(d.cnNowUnder), pub: null },
    card: { line: { open: num(d.cdLineOpen), now: num(d.cdLineNow) }, openHome: num(d.cdOpenOver), openAway: num(d.cdOpenUnder), nowHome: num(d.cdNowOver), nowAway: num(d.cdNowUnder), pub: null },
  }));
}

// =====================================================================
//  DATA DEMO (berlabel jelas)
// =====================================================================
function demoMatches() {
  return [
    { id: 'D1', home: 'Portugal', away: 'Belanda', group: 'Grup A', kickoff: '2026-06-12T19:00:00Z', status: 'live', score: { home: 1, away: 1 }, minute: "63'",
      ah: { line: { open: -0.25, now: -0.25 }, openHome: 0.95, openAway: 0.95, nowHome: 0.84, nowAway: 1.06, pub: { line: -0.25, home: 0.97, away: 0.93 } },
      ou: { line: { open: 3.5, now: 4.0 }, openHome: 0.92, openAway: 0.98, nowHome: 0.90, nowAway: 1.00, pub: { line: 4.0, home: 0.93, away: 0.97 } },
      corner: { line: { open: 9.5, now: 9.5 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 },
      cornerHT: { line: { open: 4.5, now: 4.5 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 },
      card: { line: { open: 4.0, now: 4.0 }, openHome: 0.85, openAway: 0.85, nowHome: 0.85, nowAway: 0.85 } },
    { id: 'D2', home: 'Amerika Serikat', away: 'Wales', group: 'Grup B', kickoff: '2026-06-12T22:00:00Z',
      ah: { line: { open: -0.5, now: -0.5 }, openHome: 0.90, openAway: 1.00, nowHome: 0.92, nowAway: 0.98, pub: { line: -0.5, home: 0.93, away: 0.97 } },
      ou: { line: { open: 2.25, now: 2.25 }, openHome: 0.95, openAway: 0.95, nowHome: 0.94, nowAway: 0.96, pub: { line: 2.25, home: 0.95, away: 0.95 } },
      corner: { line: { open: 9.0, now: 9.0 }, openHome: 0.92, openAway: 0.88, nowHome: 0.92, nowAway: 0.88 },
      card: { line: { open: 5.0, now: 5.0 }, openHome: 0.88, openAway: 0.82, nowHome: 0.88, nowAway: 0.82 } },
    { id: 'D3', home: 'Brasil', away: 'Serbia', group: 'Grup C', kickoff: '2026-06-13T19:00:00Z',
      ah: { line: { open: -1.0, now: -1.25 }, openHome: 0.88, openAway: 1.02, nowHome: 0.78, nowAway: 1.12, pub: { line: -1.0, home: 0.90, away: 1.00 } },
      ou: { line: { open: 2.5, now: 2.5 }, openHome: 0.93, openAway: 0.97, nowHome: 0.93, nowAway: 0.97, pub: { line: 2.5, home: 0.94, away: 0.96 } },
      corner: { line: { open: 10.5, now: 10.5 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 },
      card: { line: { open: 4.5, now: 4.5 }, openHome: 0.83, openAway: 0.87, nowHome: 0.83, nowAway: 0.87 } },
    { id: 'D4', home: 'Jepang', away: 'Meksiko', group: 'Grup D', kickoff: '2026-06-13T22:00:00Z',
      ah: { line: { open: 0.25, now: 0.25 }, openHome: 0.97, openAway: 0.93, nowHome: 0.99, nowAway: 0.91, pub: { line: 0.25, home: 0.98, away: 0.92 } },
      ou: { line: { open: 2.25, now: 2.5 }, openHome: 0.96, openAway: 0.94, nowHome: 0.88, nowAway: 1.02, pub: { line: 2.5, home: 0.90, away: 1.00 } },
      corner: { line: { open: 9.5, now: 9.5 }, openHome: 0.91, openAway: 0.89, nowHome: 0.91, nowAway: 0.89 },
      card: { line: { open: 5.5, now: 5.5 }, openHome: 0.86, openAway: 0.84, nowHome: 0.86, nowAway: 0.84 } },
    { id: 'D5', home: 'Inggris', away: 'Iran', group: 'Grup E', kickoff: '2026-06-14T19:00:00Z',
      ah: { line: { open: -2.0, now: -1.25 }, openHome: 0.90, openAway: 1.00, nowHome: 0.95, nowAway: 0.95, pub: { line: -1.25, home: 0.95, away: 0.95 } },
      ou: { line: { open: 2.5, now: 2.75 }, openHome: 0.95, openAway: 0.95, nowHome: 0.97, nowAway: 0.93, pub: { line: 2.75, home: 0.97, away: 0.93 } },
      corner: { line: { open: 10.0, now: 10.0 }, openHome: 0.89, openAway: 0.91, nowHome: 0.89, nowAway: 0.91 },
      card: { line: { open: 4.5, now: 4.5 }, openHome: 0.84, openAway: 0.86, nowHome: 0.84, nowAway: 0.86 } },
    { id: 'D6', home: 'Kanada', away: 'Maroko', group: 'Grup F', kickoff: '2026-06-14T22:00:00Z',
      ah: { line: { open: 0.5, now: 0.5 }, openHome: 0.93, openAway: 0.97, nowHome: 0.93, nowAway: 0.97, pub: { line: 0.5, home: 0.93, away: 0.97 } },
      ou: { line: { open: 2.25, now: 2.25 }, openHome: 0.94, openAway: 0.96, nowHome: 0.94, nowAway: 0.96, pub: { line: 2.25, home: 0.94, away: 0.96 } },
      corner: { line: { open: 9.0, now: 9.0 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 },
      card: { line: { open: 5.0, now: 5.0 }, openHome: 0.85, openAway: 0.85, nowHome: 0.85, nowAway: 0.85 } },
  ].map(m => {
    if (!m.cornerHT) m.cornerHT = { line: { open: 4.5, now: 4.5 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 };
    if (!m.win) {
      const L = m.ah.line.now;
      m.win = L <= -1.5 ? { home: 0.66, draw: 0.21, away: 0.13 }
        : L <= -0.75 ? { home: 0.55, draw: 0.26, away: 0.19 }
        : L <= -0.25 ? { home: 0.46, draw: 0.28, away: 0.26 }
        : L >= 0.5 ? { home: 0.27, draw: 0.28, away: 0.45 }
        : { home: 0.38, draw: 0.30, away: 0.32 };
    }
    return m;
  });
}

// =====================================================================
//  MAIN
// =====================================================================
async function checkResults(arch, apiKey) {
  const k = encodeURIComponent(apiKey), now = Date.now(), H = 3600 * 1000;
  const due = Object.values(arch).filter(e => !e.final && e.kickoff &&
    (now - new Date(e.kickoff).getTime()) > 2 * H && (now - new Date(e.kickoff).getTime()) < 48 * H);
  let n = 0;
  for (const e of due.slice(0, 12)) {
    try {
      const ev = await httpGet(`${ODDS_BASE}/events/${e.id}?apiKey=${k}`);
      const obj = Array.isArray(ev) ? ev[0] : (ev.event || ev.data || ev);
      if (!obj) continue;
      const sc = parseScore(obj.scores || obj.score || obj.result || obj.ss);
      const st = String(obj.status || '').toLowerCase();
      if (sc) e.score = sc;
      const done = /settled|finished|ended|ft/.test(st) || ((now - new Date(e.kickoff).getTime()) > 3 * H && sc);
      if (done) { e.final = true; e.settledAt = e.settledAt || now; e.finalScore = sc || e.score || null; e.status = st || 'finished'; }
      n++;
    } catch (err) {}
  }
  return n;
}

async function runOnce() {
  const args = process.argv.slice(2);
  const DEMO = args.includes('--demo');
  const ODDS_KEY = process.env.ODDS_API_IO_KEY || '';
  const ISPORTS_KEY = process.env.ISPORTS_API_KEY || '';
  let raw = [], source = 'DEMO';

  if (!DEMO && ODDS_KEY) {
    try { raw = await fetchFromOddsApiIo(ODDS_KEY); source = 'odds-api.io / SBOBET (GRATIS)'; if (!raw.length) throw new Error('kosong'); }
    catch (e) { console.warn('! odds-api.io gagal/kosong (' + e.message + ') — pakai DEMO. Setel field di normalizeOddsApiIo().'); raw = demoMatches(); source = 'DEMO'; }
  } else if (!DEMO && ISPORTS_KEY) {
    try { raw = await fetchFromISports(ISPORTS_KEY); source = 'iSports / SBOBET (trial)'; if (!raw.length) throw new Error('kosong'); }
    catch (e) { console.warn('! iSports gagal/kosong (' + e.message + ') — pakai DEMO.'); raw = demoMatches(); source = 'DEMO'; }
  } else {
    raw = demoMatches();
    if (!DEMO) console.warn('! Tidak ada API key — memakai DEMO. (--demo untuk senyapkan)');
  }

  const hist = loadHistory();
  const isLive = source !== 'DEMO';
  const matches = raw.map(m => analyzeMatch(m, hist, isLive));
  matches.sort((a, b) => { if (a.live !== b.live) return a.live ? -1 : 1; return new Date(a.kickoff || 0) - new Date(b.kickoff || 0); });
  const hasCorner = matches.some(m => m.markets.corner.lineDisplay != null);
  const summary = {
    total: matches.length,
    live: matches.filter(m => m.live).length,
    trapped: matches.filter(m => m.conclusion && m.conclusion.trapped).length,
    favoriteTraps: matches.filter(m => m.verdict && /Jebakan favorit/i.test(m.verdict.text)).length,
    clean: matches.filter(m => m.verdict && m.verdict.light === 'green').length,
  };
  const out = {
    generatedAt: new Date().toISOString(), source, isDemo: source === 'DEMO',
    reference: 'SBOBET', compare: 'Bet365 (publik)', markets: ['Handicap', 'Over/Under', 'Corner FT', 'Corner B1', 'Kartu'],
    cornerAvailable: hasCorner, summary,
    note: 'Alat informasi pergerakan odds. Tidak melacak taruhan siapa pun. Bukan jaminan untung.',
    matches,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'matches.js'), 'window.__BANDAR_DATA__ = ' + JSON.stringify(out) + ';\n');
  fs.writeFileSync(HIST_FILE, JSON.stringify(hist));
  const arch = loadArchive();
  if (isLive && process.env.ODDS_API_IO_KEY) { try { const n = await checkResults(arch, process.env.ODDS_API_IO_KEY); if (n) console.log(`  · cek hasil: ${n} laga lewat diperiksa`); } catch (e) {} }
  updateArchive(arch, matches); fs.writeFileSync(ARCH_FILE, JSON.stringify(arch, null, 2));
  console.log(`✓ ${matches.length} laga · sumber: ${source} · ${new Date().toLocaleTimeString('id-ID')}`);
}

async function main() {
  const args = process.argv.slice(2);
  const wIdx = args.indexOf('--watch');
  if (wIdx !== -1) {
    const mins = Math.max(1, parseInt(args[wIdx + 1] || '5', 10));
    console.log(`▶ Mode watch: segarkan tiap ${mins} menit. Ctrl+C untuk berhenti.`);
    await runOnce();
    setInterval(() => runOnce().catch(e => console.error('✗', e.message)), mins * 60000);
  } else {
    await runOnce();
  }
}

// Ekspor mesin (untuk eval.js / accuracy.js) — sumber tunggal = engine.
module.exports = E;

if (require.main === module) main().catch(e => { console.error('✗', e); process.exit(1); });
