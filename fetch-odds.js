#!/usr/bin/env node
/*
 * fetch-odds.js — Mesin "Lensa Bandar"
 * ------------------------------------------------------------------
 * Membaca odds acuan SBOBET (sharp) + bandar publik (Bet365), lalu:
 *   1. Terjemahkan garis → "statistik yang dipegang bandar" (kalimat jelas).
 *   2. Deteksi giringan publik (sharp vs publik divergence) & pergerakan.
 *   3. Verdict satu kalimat per laga.
 *   4. Rekam snapshot antar-waktu (history.json) untuk membaca "perjalanan garis".
 * Output: data/matches.js (+ .json) yang dibaca index.html.
 *
 * NOL pelacakan taruhan. Hanya odds pasar publik + perhitungan jujur.
 *
 * SUMBER DATA (otomatis dipilih, prioritas gratis dulu):
 *   ODDS_API_IO_KEY=xxx node fetch-odds.js   # GRATIS selamanya (SBOBET: AH + O/U)
 *   ISPORTS_API_KEY=xxx  node fetch-odds.js   # trial 15 hari (semua: + corner + kartu)
 *   node fetch-odds.js --demo                 # data contoh (berlabel DEMO)
 *   node fetch-odds.js --watch 5              # segarkan tiap 5 menit
 */

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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
    if (!e.final) { // selama belum final, terus perbarui snapshot bacaan
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
    if (m.score && m.score.home != null) e.score = m.score; // skor terbaru
    if (fin) { e.final = true; e.settledAt = e.settledAt || now; }
    e.updatedAt = now;
  }
  return arch;
}

// =====================================================================
//  MATEMATIKA DASAR
// =====================================================================
function hkToDecimal(hk) { if (hk == null) return null; return hk >= 1.6 ? hk : hk + 1; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function pct(x) { return Math.round(x * 100); }
// Baca skor dari berbagai kemungkinan bentuk: {home,away}, {current}, "1-0", {ft},...
function parseScore(s) {
  if (s == null) return null;
  if (typeof s === 'object') {
    if (s.home != null && s.away != null) return { home: +s.home, away: +s.away };
    if (s.current) return parseScore(s.current);
    if (s.ft && s.ft.home != null) return { home: +s.ft.home, away: +s.ft.away };
    return null;
  }
  if (typeof s === 'string') { const m = s.match(/(\d+)\s*[-:]\s*(\d+)/); if (m) return { home: +m[1], away: +m[2] }; }
  return null;
}

function twoWayMargin(a, b) { const x = hkToDecimal(a), y = hkToDecimal(b); if (!x || !y) return null; return (1 / x + 1 / y - 1) * 100; }

// ---------- SETTLEMENT (untuk backtest) ----------
function isQuarter(h) { const f = Math.abs(h) % 1; return Math.abs(f - 0.25) < 1e-9 || Math.abs(f - 0.75) < 1e-9; }
// Hasil membackup `side` di Asian Handicap. line = handicap TUAN RUMAH (negatif = tuan rumah kasih voor).
// Return unit: +1 menang, -1 kalah, 0 push, ±0.5 untuk garis seperempat.
function settleAH(line, gh, ga, side) {
  if (line == null || gh == null || ga == null) return null;
  const diff = side === 'home' ? gh - ga : ga - gh;        // selisih gol dari sisi yang dibackup
  const hcp = side === 'home' ? line : -line;              // handicap untuk sisi itu
  const parts = isQuarter(hcp) ? [hcp - 0.25, hcp + 0.25] : [hcp];
  let u = 0; for (const h of parts) { const a = diff + h; u += a > 0 ? 1 : a < 0 ? -1 : 0; }
  return u / parts.length;
}
// Hasil membackup Over/Under. side 'over'|'under'.
function settleOU(line, total, side) {
  if (line == null || total == null) return null;
  const parts = isQuarter(line) ? [line - 0.25, line + 0.25] : [line];
  let u = 0; for (const L of parts) { const d = side === 'over' ? total - L : L - total; u += d > 0 ? 1 : d < 0 ? -1 : 0; }
  return u / parts.length;
}
function noVigProb(home, away) { const dH = hkToDecimal(home), dA = hkToDecimal(away); if (!dH || !dA) return null; const a = 1 / dH, b = 1 / dA, s = a + b; return { home: a / s, away: b / s }; }
// Peluang menang 1X2 (de-vig 3 arah) dari odds Menang/Seri/Kalah.
function noVig3(h, d, a) { const H = num(h), D = num(d), A = num(a); if (!H || !D || !A) return null; const ih = 1 / H, id = 1 / D, ia = 1 / A, s = ih + id + ia; return { home: +(ih / s).toFixed(4), draw: +(id / s).toFixed(4), away: +(ia / s).toFixed(4) }; }
function movement(open, now) { if (open == null || now == null) return { dir: 'flat', delta: 0 }; const d = +(now - open).toFixed(2); if (Math.abs(d) < 0.001) return { dir: 'flat', delta: 0 }; return { dir: d > 0 ? 'up' : 'down', delta: d }; }

// =====================================================================
//  ANALISIS PASAR
// =====================================================================
const NORMAL_MARGIN = { ah: 2.5, ou: 2.5, corner: 5.5, cornerHT: 5.5, card: 8 };

// Lampu HANYA dari tanda jebakan nyata (uang publik ditarik ke satu sisi).
// Hal teknis (potongan bandar, garis geser) dipisah ke `tech` → cuma muncul di "angka mentah",
// tidak bikin lampu kuning dan tidak ditampilkan sebagai peringatan menakutkan.
function gradeMarket(m, normalMargin) {
  const flags = [], tech = []; let score = 0;
  if (m.margin != null) {
    if (m.margin > normalMargin + 2.5) tech.push(`Jatah bandar besar (${m.margin.toFixed(1)}%)`);
    else if (m.margin > normalMargin + 1) tech.push(`Jatah bandar agak besar (${m.margin.toFixed(1)}%)`);
  }
  if (m.lineMove && m.lineMove.dir !== 'flat') tech.push('Garis bergeser');
  if (m.waterMoveHome && m.waterMoveHome.dir === 'down' && Math.abs(m.waterMoveHome.delta) >= 0.07) { score += 1; flags.push('Bayaran tuan rumah dikecilkan — pemasang menumpuk ke sana'); }
  if (m.waterMoveAway && m.waterMoveAway.dir === 'down' && Math.abs(m.waterMoveAway.delta) >= 0.07) { score += 1; flags.push('Bayaran tim tamu dikecilkan — pemasang menumpuk ke sana'); }
  if (m.divergence) { score += m.divergence.strong ? 2 : 1; flags.push(m.divergence.flag); }
  const light = score >= 3 ? 'red' : score >= 1 ? 'yellow' : 'green';
  return { light, flags, tech, score };
}

// Divergence: SBOBET (sharp) vs Bet365 (publik). Sisi yang publik beri bayaran
// LEBIH besar = sisi umpan (dibuat menarik agar uang publik masuk ke sana).
function computeDivergence(m, homeName, awayName) {
  if (!m.pub || m.pub.home == null || m.pub.away == null) return null;
  // Hanya banding bila garis sama (kalau beda, harga tak sebanding).
  if (m.pub.line != null && m.line && m.line.now != null && m.pub.line !== m.line.now) return null;
  const shHome = hkToDecimal(m.nowHome), shAway = hkToDecimal(m.nowAway);
  const puHome = hkToDecimal(m.pub.home), puAway = hkToDecimal(m.pub.away);
  if (!shHome || !shAway || !puHome || !puAway) return null;
  const dHome = +(puHome - shHome).toFixed(3); // publik bayar lebih di rumah?
  const dAway = +(puAway - shAway).toFixed(3);
  const TH = 0.04;
  let side = null, gap = 0;
  if (dHome >= TH && dHome >= dAway) { side = 'home'; gap = dHome; }
  else if (dAway >= TH && dAway > dHome) { side = 'away'; gap = dAway; }
  if (!side) return null;
  const sideName = side === 'home' ? homeName : awayName;
  const strong = gap >= 0.08;
  return {
    side, gap, strong,
    flag: `Di Bet365, ${sideName} dikasih bayaran lebih besar untuk memancing pemasang ke sana`,
  };
}

function buildMarket(o) {
  const margin = twoWayMargin(o.nowHome, o.nowAway);
  const probs = noVigProb(o.nowHome, o.nowAway);
  const m = {
    label: o.label, line: o.line, openHome: o.openHome, openAway: o.openAway,
    nowHome: o.nowHome, nowAway: o.nowAway, pub: o.pub || null, margin,
    probHome: probs ? +(probs.home).toFixed(4) : null, probAway: probs ? +(probs.away).toFixed(4) : null,
    waterMoveHome: movement(o.openHome, o.nowHome),
    waterMoveAway: movement(o.openAway, o.nowAway),
    lineMove: movement(o.line && o.line.open, o.line && o.line.now),
    lineDisplay: (o.line && o.line.now != null) ? `${o.line.now}` : null,
  };
  m.divergence = computeDivergence(m, o.homeName, o.awayName);
  const g = gradeMarket(m, o.normalMargin);
  m.light = g.light; m.flags = g.flags; m.tech = g.tech; m.score = g.score;
  return m;
}

// ARAH BANDAR per pasar: ke mana sharp (SBOBET) bergerak = sinyal yang diikuti.
// Suara dari pergerakan garis + pengerasan water. Tanpa pergerakan → belum ada arah.
function computeDirection(m, type, home, away) {
  if (!m.line || m.line.now == null) return { side: null, strength: 0, arrow: '→', text: '' };
  let homeVotes = 0, awayVotes = 0, reasons = [];
  const lm = m.lineMove;
  if (lm && lm.dir !== 'flat') {
    if (type === 'ah') { if (lm.delta < 0) { homeVotes++; reasons.push('garis melebar ke ' + home); } else { awayVotes++; reasons.push('garis menyusut ke ' + away); } }
    else { if (lm.delta > 0) { homeVotes++; reasons.push('garis naik (Over)'); } else { awayVotes++; reasons.push('garis turun (Under)'); } }
  }
  if (m.waterMoveHome && m.waterMoveHome.dir === 'down' && Math.abs(m.waterMoveHome.delta) >= 0.04) { homeVotes++; reasons.push('water mengeras sisi 1'); }
  if (m.waterMoveAway && m.waterMoveAway.dir === 'down' && Math.abs(m.waterMoveAway.delta) >= 0.04) { awayVotes++; reasons.push('water mengeras sisi 2'); }
  const net = homeVotes - awayVotes;
  if (net === 0) return { side: null, strength: 0, arrow: '→', text: 'Belum bergerak', bigMove: false };
  const side = net > 0 ? 'home' : 'away';
  // Besar pergerakan handicap = sinyal kunci. Geser ≥½ bola itu BESAR (sharp), bukan lemah.
  const mag = (type === 'ah' && lm) ? Math.abs(lm.delta) : 0;
  const magBonus = mag >= 0.5 ? 2 : mag >= 0.25 ? 1 : 0;
  const strength = Math.min(3, Math.abs(net) + magBonus);
  return { side, strength, arrow: '➜', bigMove: mag >= 0.5, mag,
    label: sideLabel(type, side, home, away, m), reasons, text: 'Bandar geser ke ' + sideLabel(type, side, home, away, m) };
}

// Frasa pergerakan satu pasar: "−2½ → −¾ (ke South Africa)".
function movePhrase(mk, type, home, away) {
  const o = mk.line && mk.line.open, n = mk.line && mk.line.now;
  const to = mk.direction && mk.direction.label;
  if (o != null && n != null && o !== n) {
    const fmt = type === 'ah' ? indoHandicap : (v => `${v}`);
    return { market: mk.label, text: `${fmt(o)} → ${fmt(n)}`, to };
  }
  if (to) return { market: mk.label, text: 'water mengeras', to };
  return null;
}

// ARAH BANDAR match-level: SATU kalimat jelas + sisi utama + keyakinan.
function matchGuidance(markets, home, away) {
  const dirs = [];
  for (const k of ['ah', 'ou', 'corner', 'cornerHT']) {
    const mk = markets[k];
    if (mk && mk.direction && mk.direction.side) {
      const ph = movePhrase(mk, k, home, away);
      dirs.push({ key: k, market: mk.label, to: mk.direction.label, strength: mk.direction.strength, phrase: ph });
    }
  }
  if (!dirs.length) return { moved: false, primary: null, narrative: null, items: [], confidence: '—', strength: 0 };
  dirs.sort((a, b) => b.strength - a.strength);
  const maxS = dirs[0].strength;
  const confidence = maxS >= 3 ? 'Kuat' : maxS >= 2 ? 'Sedang' : 'Lemah';
  // Sisi utama: utamakan Handicap (menyebut tim); kalau tak ada, pakai sinyal terkuat.
  const ah = dirs.find(d => d.key === 'ah');
  const primaryItem = ah || dirs[0];
  const primary = primaryItem.to;
  // Narasi: rangkai per pasar — "{pasar}: {sisi} (geser a → b)".
  const parts = dirs.map(d => {
    const mv = (d.phrase && d.phrase.text !== 'water mengeras') ? ` (${d.phrase.text})` : '';
    return `${d.market}: ${d.to}${mv}`;
  });
  const narrative = parts.join(' · ') + '.';
  const items = dirs.map(d => ({ market: d.market, to: d.to, move: d.phrase ? d.phrase.text : null }));
  // INSIGHT tajam: pergerakan handicap besar = bandar/uang tajam tahu sesuatu.
  let insight = null;
  const ahM = markets.ah;
  if (ahM && ahM.direction && ahM.direction.bigMove && ahM.line && ahM.line.open != null) {
    const o = ahM.line.open, n = ahM.line.now, mag = Math.abs(n - o);
    const favName = o < 0 ? home : (o > 0 ? away : home);     // yang dijagokan saat pembukaan
    const gaining = (n > o) ? away : home;                     // sisi yang menguat
    const weakening = gaining === home ? away : home;
    insight = `Voor ${favName} bergeser ${indoHandicap(o)} → ${indoHandicap(n)} (sekitar ${mag} bola). Pergerakan sebesar ini jarang — biasanya tanda uang/info tajam menilai ${gaining} lebih kuat dari perkiraan awal, atau ${weakening} lagi bermasalah. Jangan asal ambil favorit cuma karena namanya besar.`;
  }
  return { moved: true, primary, narrative, items, confidence, strength: maxS, insight };
}

// =====================================================================
//  "STATISTIK YANG DIPEGANG BANDAR" → kalimat
// =====================================================================
function indoHandicap(L) {
  if (L == null) return '-';
  const sign = L < 0 ? '−' : (L > 0 ? '+' : '');
  const a = Math.abs(L), whole = Math.floor(a), frac = +(a - whole).toFixed(2);
  const fmap = { 0: '', 0.25: '1/4', 0.5: '1/2', 0.75: '3/4' };
  const fr = fmap[frac] != null ? fmap[frac] : String(frac);
  let body; if (whole === 0) body = fr || '0'; else body = fr ? `${whole} ${fr}` : `${whole}`;
  return sign + body;
}
function strengthWord(absL) {
  if (absL < 0.3) return 'unggul sangat tipis — nyaris imbang';
  if (absL < 0.7) return 'unggul tipis';
  if (absL < 1.1) return 'cukup unggul';
  if (absL < 1.6) return 'unggul jelas';
  return 'sangat dominan';
}
function generateRead(type, m, home, away) {
  const L = m.line && m.line.now;
  if (L == null) return { holds: '', signal: '' }; // pasar belum tersambung — jangan hasilkan kalimat
  const p = noVigProb(m.nowHome, m.nowAway);
  let holds = '';
  if (type === 'ah') {
    let favName, dogName, favP;
    if (L < 0) { favName = home; dogName = away; favP = p && p.home; }
    else if (L > 0) { favName = away; dogName = home; favP = p && p.away; }
    else { if (p && p.home >= p.away) { favName = home; dogName = away; favP = p.home; } else { favName = away; dogName = home; favP = p.away; } }
    holds = `Bandar pegang: ${favName} ${strengthWord(Math.abs(L || 0))} (garis ${indoHandicap(L)}).` +
      (favP != null ? ` Tanpa potongan: peluang ${favName} ~${pct(favP)}% vs ${dogName}/seri ~${pct(1 - favP)}%.` : '');
    // Kalau garis lagi bergeser cukup besar, ingatkan agar tak asal ambil favorit.
    const lo = m.line && m.line.open, ln = m.line && m.line.now;
    if (lo != null && ln != null && Math.abs(ln - lo) >= 0.25) {
      const gaining = (ln > lo) ? away : home, weakening = gaining === home ? away : home;
      holds += ` ⚠️ Tapi garis lagi bergeser ${indoHandicap(lo)} → ${indoHandicap(ln)} — ${weakening} melemah, ${gaining} menguat. Jangan asal ambil ${weakening}.`;
    }
  } else if (type === 'ou') {
    const pOver = p && p.home;
    const tempo = L >= 3.5 ? 'laga diharap rame / banyak gol' : (L <= 2.25 ? 'laga ketat / sedikit gol' : 'gol sedang');
    holds = `Bandar pegang: perkiraan ~${L} gol (${tempo}).` + (pOver != null ? ` Peluang Over ${L} ~${pct(pOver)}%, Under ~${pct(1 - pOver)}%.` : '');
  } else if (type === 'corner') {
    const pOver = p && p.home;
    holds = `Bandar pegang: perkiraan ~${L} corner (full-time).` + (pOver != null ? ` Peluang Over ${L} ~${pct(pOver)}%.` : '');
  } else if (type === 'cornerHT') {
    const pOver = p && p.home;
    holds = `Bandar pegang: perkiraan ~${L} corner (babak 1).` + (pOver != null ? ` Peluang Over ${L} ~${pct(pOver)}%.` : '');
  } else if (type === 'card') {
    const pOver = p && p.home;
    holds = `Bandar pegang: perkiraan ~${L} kartu.` + (pOver != null ? ` Peluang Over ${L} ~${pct(pOver)}%.` : '');
  }
  let signal;
  if (!m.flags || !m.flags.length) signal = 'Aman — belum ada tanda menjebak.';
  else signal = '⚠️ ' + m.flags.join('; ') + '.';
  // Peringatan "garis kecil di favorit" hanya saat memang ada sinyal (bukan saat tenang).
  if (type === 'ah' && m.light !== 'green' && Math.abs(L || 0) > 0 && Math.abs(L || 0) < 0.5) {
    signal += ' Garisnya kecil padahal favorit — di sinilah orang gampang nekat taruh besar, dan itu yang dimau bandar.';
  }
  return { holds, signal };
}

// =====================================================================
//  VERDICT SATU KALIMAT PER LAGA
// =====================================================================
function matchVerdict(markets, home, away) {
  const ah = markets.ah;
  const L = ah.line && ah.line.now;
  const absL = Math.abs(L || 0);
  // Siapa favorit menurut garis.
  const favName = L < 0 ? home : (L > 0 ? away : home);
  // Jebakan favorit: garis kecil DI favorit + (water mengeras di favorit ATAU divergence umpan ke favorit).
  const favSide = L < 0 ? 'home' : (L > 0 ? 'away' : 'home');
  const waterHardFav = (favSide === 'home' ? ah.waterMoveHome : ah.waterMoveAway);
  const hardening = waterHardFav && waterHardFav.dir === 'down' && Math.abs(waterHardFav.delta) >= 0.07;
  const divBaitFav = ah.divergence && ah.divergence.side === favSide;
  if (absL > 0 && absL < 0.6 && (hardening || divBaitFav)) {
    return { light: 'red', text: `Jebakan favorit: banyak orang taruh ke ${favName} karena kelihatan jagoan, padahal garisnya cuma ${indoHandicap(L)} — sebenarnya laganya jauh lebih ketat. Hati-hati ikut ramai.` };
  }
  // Selain itu: ambil yang terburuk.
  const order = { green: 0, yellow: 1, red: 2 };
  let worst = 'green';
  for (const k of Object.keys(markets)) if (order[markets[k].light] > order[worst]) worst = markets[k].light;
  if (worst === 'red') return { light: 'red', text: 'Ada sisi yang ditarik ramai-ramai. Jangan langsung percaya harga yang kelihatan manis.' };
  if (worst === 'yellow') return { light: 'yellow', text: 'Sebagian taruhan mulai diramaikan ke satu sisi. Cermati dulu.' };
  return { light: 'green', text: 'Aman & tenang. Belum ada sisi yang dipancing mencolok.' };
}

// =====================================================================
//  KESIMPULAN: "keuntungan bandar terkonsentrasi di sini"
// =====================================================================
// Label sisi sesuai jenis pasar.
function sideLabel(type, side, home, away, mk) {
  const L = mk.line && mk.line.now;
  if (type === 'ah') return side === 'home' ? home : away;
  if (type === 'ou') return side === 'home' ? `Over ${L} gol` : `Under ${L} gol`;
  if (type === 'corner') return side === 'home' ? `Over ${L} corner` : `Under ${L} corner`;
  if (type === 'cornerHT') return side === 'home' ? `Over ${L} corner B1` : `Under ${L} corner B1`;
  if (type === 'card') return side === 'home' ? `Over ${L} kartu` : `Under ${L} kartu`;
  return side;
}
function hardenSide(mk) {
  if (mk.waterMoveHome && mk.waterMoveHome.dir === 'down' && Math.abs(mk.waterMoveHome.delta) >= 0.07) return 'home';
  if (mk.waterMoveAway && mk.waterMoveAway.dir === 'down' && Math.abs(mk.waterMoveAway.delta) >= 0.07) return 'away';
  return null;
}
// Kumpulkan kandidat "sisi untung bandar", beri bobot, pilih yang terkuat.
function deriveConclusion(match) {
  const m = match.markets, cands = [];
  const ah = m.ah, L = ah.line && ah.line.now, absL = Math.abs(L || 0);
  const favSide = L < 0 ? 'home' : (L > 0 ? 'away' : null);
  const favName = favSide === 'home' ? match.home : (favSide === 'away' ? match.away : null);

  // Label kanonik: untuk AH, sisi favorit diberi anotasi agar semua sinyal menyatu.
  const annotateAh = (side) => {
    const nm = side === 'home' ? match.home : match.away;
    return side === favSide ? `${nm} (favorit, garis ${indoHandicap(L)})` : nm;
  };
  const lab = (type, side, mk) => type === 'ah' ? annotateAh(side) : sideLabel(type, side, match.home, match.away, mk);
  const labShort = (type, side, mk) => type === 'ah' ? (side === 'home' ? match.home : match.away) : sideLabel(type, side, match.home, match.away, mk);

  if (match.verdict && /Jebakan favorit/i.test(match.verdict.text) && favName) {
    cands.push({ label: annotateAh(favSide), weight: 5, pick: { market: 'ah', side: favSide, line: L }, why: `${favName} kelihatan favorit jelas tapi garisnya cuma ${indoHandicap(L)}, jadi orang gampang nekat taruh besar ke situ` });
  }
  // Sisi yang dibuat menarik di bandar publik (umpan) — AH & O/U.
  ['ah', 'ou'].forEach(k => {
    const mk = m[k];
    if (mk.divergence) {
      cands.push({ label: lab(k, mk.divergence.side, mk), weight: 4, pick: { market: k, side: mk.divergence.side, line: mk.line.now }, why: `${labShort(k, mk.divergence.side, mk)} dikasih bayaran lebih besar di Bet365 untuk memancing pemasang` });
    }
  });
  // Bayaran satu sisi dikecilkan (tanda uang menumpuk ke sana) di tiap pasar.
  ['ah', 'ou', 'corner', 'cornerHT', 'card'].forEach(k => {
    const mk = m[k]; if (!mk) return; const hs = hardenSide(mk);
    if (hs) cands.push({ label: lab(k, hs, mk), weight: 3, pick: { market: k, side: hs, line: mk.line && mk.line.now }, why: `bayaran ${labShort(k, hs, mk)} dikecilkan karena uang menumpuk ke sana` });
  });

  if (!cands.length) {
    return { trapped: false, topPick: null, headline: 'Belum ada sisi yang dipancing.', detail: 'Bandar cuma mengambil potongan wajar di kedua sisi. Tidak terlihat satu sisi pun yang sedang diramaikan untuk menjebak pemasang.', targets: [] };
  }
  const by = {};
  for (const c of cands) { const e = by[c.label] || (by[c.label] = { label: c.label, weight: 0, whys: [], pick: c.pick, maxw: 0 }); e.weight += c.weight; if (c.weight > e.maxw) { e.maxw = c.weight; e.pick = c.pick; } if (e.whys.indexOf(c.why) < 0) e.whys.push(c.why); }
  const ranked = Object.values(by).sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  return {
    trapped: true,
    topPick: top.pick || null,
    headline: `Pemasang lagi dipancing ke: ${top.label}`,
    detail: `Banyak orang sedang diarahkan untuk bertaruh ke ${top.label} — tandanya: ${top.whys.slice(0, 2).join('; ')}. Di sisi yang ramai inilah harga sudah merugikan, dan di situ bandar paling untung. Jadi hati-hati ikut arus: ramai belum tentu benar. (Bukan berarti sisi lawan pasti menang.)`,
    targets: ranked.map(r => r.label),
  };
}

// =====================================================================
//  HISTORY (perjalanan garis antar-waktu)
// =====================================================================
function loadHistory() { try { return JSON.parse(fs.readFileSync(HIST_FILE, 'utf8')); } catch (e) { return {}; } }
function updateHistory(hist, match) {
  const id = match.id;
  const snap = { t: Date.now(), ahLine: match.markets.ah.line.now, ouLine: match.markets.ou.line.now,
    ahH: match.markets.ah.nowHome, ahA: match.markets.ah.nowAway,
    ouO: match.markets.ou.nowHome, ouU: match.markets.ou.nowAway };
  if (!hist[id]) hist[id] = [];
  const last = hist[id][hist[id].length - 1];
  // Simpan hanya bila ada perubahan (hindari duplikat).
  const changed = !last || last.ahLine !== snap.ahLine || last.ouLine !== snap.ouLine ||
    last.ahH !== snap.ahH || last.ahA !== snap.ahA || last.ouO !== snap.ouO || last.ouU !== snap.ouU;
  if (changed) hist[id].push(snap);
  if (hist[id].length > 60) hist[id] = hist[id].slice(-60); // simpan 60 snapshot terakhir
  const arr = hist[id];
  const moves = Math.max(0, arr.length - 1);
  const lastMoveAgo = arr.length ? Date.now() - arr[arr.length - 1].t : null;
  return { snapshots: arr.length, moves, lastMoveMin: lastMoveAgo != null ? Math.round(lastMoveAgo / 60000) : null,
    spark: arr.slice(-12).map(s => s.ahLine) };
}

// =====================================================================
//  RANGKAI SATU LAGA
// =====================================================================
function analyzeMatch(raw, hist, isLive) {
  // Data LIVE memberi open==now per tarikan. Pakai snapshot pertama di history sebagai
  // "pembukaan" agar pergerakan garis & water nyata terbaca antar-run. (Demo tidak disentuh.)
  if (isLive && hist && hist[raw.id] && hist[raw.id][0]) {
    const h0 = hist[raw.id][0];
    if (raw.ah && raw.ah.line.open === raw.ah.line.now) {
      if (h0.ahLine != null) raw.ah.line.open = h0.ahLine;
      if (h0.ahH != null) raw.ah.openHome = h0.ahH;
      if (h0.ahA != null) raw.ah.openAway = h0.ahA;
    }
    if (raw.ou && raw.ou.line.open === raw.ou.line.now) {
      if (h0.ouLine != null) raw.ou.line.open = h0.ouLine;
      if (h0.ouO != null) raw.ou.openHome = h0.ouO;
      if (h0.ouU != null) raw.ou.openAway = h0.ouU;
    }
  }
  const mk = (label, key, normalMargin) => buildMarket(Object.assign({ label, normalMargin, homeName: raw.home, awayName: raw.away }, raw[key]));
  const markets = {
    ah: mk('Handicap', 'ah', NORMAL_MARGIN.ah),
    ou: mk('Over/Under', 'ou', NORMAL_MARGIN.ou),
    corner: mk('Corner (FT)', 'corner', NORMAL_MARGIN.corner),
    cornerHT: mk('Corner (Babak 1)', 'cornerHT', NORMAL_MARGIN.cornerHT),
    card: mk('Kartu', 'card', NORMAL_MARGIN.card),
  };
  markets.ah.read = generateRead('ah', markets.ah, raw.home, raw.away);
  markets.ou.read = generateRead('ou', markets.ou, raw.home, raw.away);
  markets.corner.read = generateRead('corner', markets.corner, raw.home, raw.away);
  markets.cornerHT.read = generateRead('cornerHT', markets.cornerHT, raw.home, raw.away);
  markets.card.read = generateRead('card', markets.card, raw.home, raw.away);
  // Arah bandar (sharp) per pasar.
  const dirTypes = { ah: 'ah', ou: 'ou', corner: 'corner', cornerHT: 'cornerHT', card: 'card' };
  for (const k of Object.keys(dirTypes)) if (markets[k]) markets[k].direction = computeDirection(markets[k], dirTypes[k], raw.home, raw.away);
  // sisipkan divergence ke signal (kalau ada) agar tampil di app
  for (const k of ['ah', 'ou']) {
    if (markets[k].divergence && markets[k].read.signal.indexOf('Bet365') === -1) {
      markets[k].read.signal += (markets[k].light === 'green' ? ' ' : ' ') + '↔ ' + markets[k].divergence.flag + '.';
    }
  }
  const verdict = matchVerdict(markets, raw.home, raw.away);
  const status = raw.status || 'pending';
  const out = { id: raw.id, home: raw.home, away: raw.away, group: raw.group || null, kickoff: raw.kickoff,
    status, live: String(status).toLowerCase() === 'live', score: raw.score || null, minute: raw.minute || null,
    win: raw.win || null, overallLight: verdict.light, verdict, markets };
  out.conclusion = deriveConclusion(out);
  out.guidance = matchGuidance(markets, raw.home, raw.away);
  if (hist) out.history = updateHistory(hist, out);
  return out;
}

// =====================================================================
//  SUMBER DATA NYATA (adapter — difinalkan saat key aktif)
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
// Alur resmi (docs.odds-api.io): /v3/events → filter Piala Dunia → /v3/odds/multi (≤10 event/permintaan).
const ODDS_BASE = 'https://api.odds-api.io/v3';
async function fetchFromOddsApiIo(apiKey) {
  const k = encodeURIComponent(apiKey);
  // 0) Auto-pilih 2 bookmaker free tier: Sbobet (sharp) + Bet365 (publik). Best-effort.
  await httpReq('PUT', `${ODDS_BASE}/bookmakers/selected/select?bookmakers=Sbobet,Bet365&apiKey=${k}`);
  // 1) Event akan datang (14 hari) + event yang sedang LIVE.
  const evRes = await httpGet(`${ODDS_BASE}/events?sport=football&apiKey=${k}`);
  const upcoming = Array.isArray(evRes) ? evRes : (evRes.events || evRes.data || []);
  let live = [];
  try { const lv = await httpGet(`${ODDS_BASE}/events/live?apiKey=${k}`); live = Array.isArray(lv) ? lv : (lv.events || lv.data || []); } catch (e) {}
  // 2) Gabung (live dulu) + buang duplikat.
  const seen = new Set(); const merged = [];
  for (const e of [...live, ...upcoming]) { const id = e.id || e.eventId; if (id == null || seen.has(id)) continue; seen.add(id); merged.push(e); }
  // 3) Saring Piala Dunia & buang yang sudah selesai. Cadangan: 30 event terdekat yang belum selesai.
  const isWC = e => /world[ -]?cup|piala dunia|fifa world/i.test(JSON.stringify(e.league || e.leagueName || e.competition || ''));
  const notDone = e => { const s = String(e.status || '').toLowerCase(); return s !== 'settled' && s !== 'finished' && s !== 'cancelled' && s !== 'ft'; };
  let wc = merged.filter(e => isWC(e) && notDone(e));
  if (!wc.length) wc = merged.filter(notDone).slice(0, 30);
  const ids = wc.map(e => e.id || e.eventId).filter(Boolean).slice(0, 40);
  if (!ids.length) return [];
  // 3) Ambil odds per batch 10 event (1 request per batch).
  const all = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10).join(',');
    const od = await httpGet(`${ODDS_BASE}/odds/multi?apiKey=${k}&eventIds=${batch}&bookmakers=Sbobet,Bet365`);
    const arr = Array.isArray(od) ? od : (od.data || od.events || []);
    all.push(...arr);
  }
  // Peta skor/status/menit dari objek EVENT (live + upcoming) — skor tidak ada di respons odds.
  const meta = {};
  for (const e of [...live, ...upcoming]) {
    const id = e.id || e.eventId; if (id == null) continue;
    meta[String(id)] = { status: e.status, scores: e.scores || e.score || e.result || e.ss || null,
      time: e.time || e.minute || e.clock || e.timer || e.elapsed || (e.status && e.status.minute) || null };
  }
  // Simpan sampel lengkap (event live + odds) untuk audit/finalisasi field skor.
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
function bookArr(ev, name) {
  const bs = ev.bookmakers || {};
  return bs[name] || bs[name.toLowerCase()] || bs[name.toUpperCase()] || null;
}
function marketEntries(arr, names) {
  if (!Array.isArray(arr)) return null;
  for (const n of names) { const m = arr.find(x => (x.name || '').toLowerCase() === n.toLowerCase()); if (m && Array.isArray(m.odds)) return m.odds; }
  return null;
}
function entryLine(o) { return num(o.hdp != null ? o.hdp : o.max); }       // garis: hdp atau max
function entrySides(o) {                                                    // sisi: home/away ATAU over/under
  const a = o.home != null ? num(o.home) : num(o.over);
  const b = o.away != null ? num(o.away) : num(o.under);
  return [a, b];
}
// Pilih garis UTAMA = baris dengan odds paling seimbang (selisih terkecil) dalam rentang wajar.
function pickMainLine(odds, lo, hi) {
  if (!Array.isArray(odds)) return null;
  let best = null, bestDiff = Infinity;
  for (const o of odds) {
    const line = entryLine(o); const [a, b] = entrySides(o);
    if (a == null || b == null || line == null) continue;
    if (lo != null && (line < lo || line > hi)) continue;
    const d = Math.abs(a - b);
    if (d < bestDiff) { bestDiff = d; best = { line, a, b }; }
  }
  return best;
}
// Cari baris pada GARIS yang sama (untuk banding harga sharp vs publik yang valid).
function pickAtLine(odds, line) {
  if (!Array.isArray(odds) || line == null) return null;
  for (const o of odds) { if (entryLine(o) === line) { const [a, b] = entrySides(o); if (a != null && b != null) return { line, a, b }; } }
  return null;
}
function emptyMarket() { return { line: { open: null, now: null }, openHome: null, openAway: null, nowHome: null, nowAway: null, pub: null }; }
function buildLiveMarket(refOdds, pubOdds, lo, hi) {
  const ref = pickMainLine(refOdds, lo, hi);
  if (!ref) return emptyMarket();
  const pub = pickAtLine(pubOdds, ref.line); // hanya banding pada garis yang sama
  return {
    line: { open: ref.line, now: ref.line }, openHome: ref.a, openAway: ref.b, nowHome: ref.a, nowAway: ref.b,
    pub: pub ? { line: pub.line, home: pub.a, away: pub.b } : null,
  };
}
function normalizeOddsApiIo(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    const sb = bookArr(ev, 'Sbobet'), pb = bookArr(ev, 'Bet365');
    const sbSpread = marketEntries(sb, ['Spread', 'Asian Handicap']);
    const pbSpread = marketEntries(pb, ['Spread', 'Asian Handicap']);
    const sbTotals = marketEntries(sb, ['Totals', 'Over/Under']);
    const pbTotals = marketEntries(pb, ['Totals', 'Over/Under']);
    // Sbobet "Totals" = total CORNER (full-time, ~5–16); "Totals HT" = corner babak 1 (~2–9).
    const sbCorner = marketEntries(sb, ['Totals']);       // dikonfirmasi pemilik = corner FT
    const sbCornerHT = marketEntries(sb, ['Totals HT']);  // = corner babak 1
    // AH: acuan Sbobet; kalau tak ada, Bet365. Pub = buku lain pada garis yang sama.
    let ah;
    if (pickMainLine(sbSpread, -6, 6)) ah = buildLiveMarket(sbSpread, pbSpread, -6, 6);
    else ah = buildLiveMarket(pbSpread, sbSpread, -6, 6);
    // O/U GOL: hanya terima garis di rentang gol wajar (0.5–5.5). Kalau Sbobet "Totals"
    // berisi angka corner (≥7), acuan gol jatuh ke Bet365.
    let ou;
    if (pickMainLine(sbTotals, 0.5, 5.5)) ou = buildLiveMarket(sbTotals, pbTotals, 0.5, 5.5);
    else ou = buildLiveMarket(pbTotals, sbTotals, 0.5, 5.5);
    if ((ah.nowHome == null) && (ou.nowHome == null)) continue;
    // Corner dari Sbobet (gratis) — HANYA bila angkanya benar-benar rentang corner
    // (FT ≥7, babak1 ≥3.5), supaya total GOL tak pernah salah dikira corner.
    const corner = buildLiveMarket(sbCorner, null, 7, 16);
    const cornerHT = buildLiveMarket(sbCornerHT, null, 3.5, 9);
    // Peluang menang 1X2 (Menang/Seri/Kalah) dari market ML — acuan Sbobet, fallback Bet365.
    const mlSb = (marketEntries(sb, ['ML', '1X2', 'Match Winner']) || [])[0];
    const mlPb = (marketEntries(pb, ['ML', '1X2', 'Match Winner']) || [])[0];
    const ml = mlSb || mlPb || null;
    const win = ml ? noVig3(ml.home, ml.draw, ml.away) : null;
    out.push({ id: String(ev.id || ev.eventId), home: ev.home, away: ev.away,
      group: (ev.league && (ev.league.name || ev.league)) || ev.leagueName || null, kickoff: ev.date || ev.commenceTime,
      status: ev.status || 'pending', win, ah, ou, corner, cornerHT, card: emptyMarket() });
  }
  return out;
}

// TRIAL: iSports (semua pasar). Disempurnakan dengan field asli saat trial aktif.
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
      // Jebakan favorit + divergence: Bet365 kasih bayaran lebih bagus di Portugal (umpan).
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
      // Steam move: garis melebar + water mengeras di Brasil (sharp money).
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
      // Steam besar: voor Inggris anjlok −2 → −1¼ (Iran menguat ¾ bola) — insight tajam.
      ah: { line: { open: -2.0, now: -1.25 }, openHome: 0.90, openAway: 1.00, nowHome: 0.95, nowAway: 0.95, pub: { line: -1.25, home: 0.95, away: 0.95 } },
      ou: { line: { open: 2.5, now: 2.75 }, openHome: 0.95, openAway: 0.95, nowHome: 0.97, nowAway: 0.93, pub: { line: 2.75, home: 0.97, away: 0.93 } },
      corner: { line: { open: 10.0, now: 10.0 }, openHome: 0.89, openAway: 0.91, nowHome: 0.89, nowAway: 0.91 },
      card: { line: { open: 4.5, now: 4.5 }, openHome: 0.84, openAway: 0.86, nowHome: 0.84, nowAway: 0.86 } },
    { id: 'D6', home: 'Kanada', away: 'Maroko', group: 'Grup F', kickoff: '2026-06-14T22:00:00Z',
      // Bersih: tenang, tak ada giringan.
      ah: { line: { open: 0.5, now: 0.5 }, openHome: 0.93, openAway: 0.97, nowHome: 0.93, nowAway: 0.97, pub: { line: 0.5, home: 0.93, away: 0.97 } },
      ou: { line: { open: 2.25, now: 2.25 }, openHome: 0.94, openAway: 0.96, nowHome: 0.94, nowAway: 0.96, pub: { line: 2.25, home: 0.94, away: 0.96 } },
      corner: { line: { open: 9.0, now: 9.0 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 },
      card: { line: { open: 5.0, now: 5.0 }, openHome: 0.85, openAway: 0.85, nowHome: 0.85, nowAway: 0.85 } },
  ].map(m => {
    // Lengkapi corner babak 1 untuk laga demo yang belum punya (≈ separuh corner FT).
    if (!m.cornerHT) m.cornerHT = { line: { open: 4.5, now: 4.5 }, openHome: 0.90, openAway: 0.90, nowHome: 0.90, nowAway: 0.90 };
    // Peluang menang 1X2 contoh (Menang/Seri/Kalah) — diperkirakan dari garis handicap.
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
  // Urutkan: yang sedang LIVE dulu, lalu berdasarkan jam kickoff.
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
  // Arsip backtest (analisa + skor akhir) — bukti untuk uji akurasi tesis.
  const arch = loadArchive(); updateArchive(arch, matches); fs.writeFileSync(ARCH_FILE, JSON.stringify(arch, null, 2));
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

// Ekspor untuk eval.js
module.exports = { analyzeMatch, matchVerdict, computeDivergence, generateRead, buildMarket, noVigProb, twoWayMargin, indoHandicap, deriveConclusion, normalizeOddsApiIo, settleAH, settleOU, isQuarter, NORMAL_MARGIN };

if (require.main === module) main().catch(e => { console.error('✗', e); process.exit(1); });
