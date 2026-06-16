'use strict';
/*
 * engine/index.js — MESIN ANALISIS TUNGGAL "Lensa Bandar".
 * ------------------------------------------------------------------
 * Berisi SELURUH logika analisis murni (tanpa I/O): matematika, de-vig,
 * deteksi pergerakan/jebakan, verdict, normalisasi odds-api.io.
 * Dipakai BERSAMA oleh Node (fetch-odds.js) & Cloudflare Worker (worker.js)
 * supaya tidak ada lagi dua salinan yang bisa melenceng.
 *
 * CommonJS (module.exports) — Node require() langsung; Worker meng-import
 * lewat bundler esbuild/wrangler (default import).
 *
 * TIDAK ADA fs/https/process di sini. Hanya perhitungan jujur.
 */

// =====================================================================
//  MATEMATIKA DASAR
// =====================================================================
function hkToDecimal(hk) { if (hk == null) return null; return hk >= 1.6 ? hk : hk + 1; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function pct(x) { return Math.round(x * 100); }
// Pemilih variasi deterministik (stabil per-laga, beda antar-laga) — biar bahasa tak seragam.
function pick(arr, seed) { let h = 0; const s = String(seed || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return arr[h % arr.length]; }
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
// line = handicap TUAN RUMAH (negatif = tuan rumah kasih voor). Return ±1 menang/kalah, 0 push, ±0.5 garis seperempat.
function settleAH(line, gh, ga, side) {
  if (line == null || gh == null || ga == null) return null;
  const diff = side === 'home' ? gh - ga : ga - gh;
  const hcp = side === 'home' ? line : -line;
  const parts = isQuarter(hcp) ? [hcp - 0.25, hcp + 0.25] : [hcp];
  let u = 0; for (const h of parts) { const a = diff + h; u += a > 0 ? 1 : a < 0 ? -1 : 0; }
  return u / parts.length;
}
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

// Lampu HANYA dari tanda jebakan nyata. Hal teknis (potongan, garis geser) → `tech` (cuma di angka mentah).
function gradeMarket(m, normalMargin) {
  const flags = [], tech = []; let score = 0;
  if (m.margin != null) {
    if (m.margin > normalMargin + 2.5) tech.push(`Jatah bandar besar (${m.margin.toFixed(1)}%)`);
    else if (m.margin > normalMargin + 1) tech.push(`Jatah bandar agak besar (${m.margin.toFixed(1)}%)`);
  }
  if (m.lineMove && m.lineMove.dir !== 'flat') tech.push('Garis bergeser');
  if (m.waterMoveHome && m.waterMoveHome.dir === 'down' && Math.abs(m.waterMoveHome.delta) >= 0.10) { score += 1; flags.push('Bayaran tuan rumah dikecilkan — pemasang menumpuk ke sana'); }
  if (m.waterMoveAway && m.waterMoveAway.dir === 'down' && Math.abs(m.waterMoveAway.delta) >= 0.10) { score += 1; flags.push('Bayaran tim tamu dikecilkan — pemasang menumpuk ke sana'); }
  if (m.divergence) { score += m.divergence.strong ? 2 : 1; flags.push(m.divergence.flag); }
  const light = score >= 3 ? 'red' : score >= 1 ? 'yellow' : 'green';
  return { light, flags, tech, score };
}

// Divergence: SBOBET (sharp) vs Bet365 (publik). Sisi yang publik beri bayaran LEBIH besar = umpan.
function computeDivergence(m, homeName, awayName) {
  if (!m.pub || m.pub.home == null || m.pub.away == null) return null;
  if (m.pub.line != null && m.line && m.line.now != null && m.pub.line !== m.line.now) return null;
  const shHome = hkToDecimal(m.nowHome), shAway = hkToDecimal(m.nowAway);
  const puHome = hkToDecimal(m.pub.home), puAway = hkToDecimal(m.pub.away);
  if (!shHome || !shAway || !puHome || !puAway) return null;
  const dHome = +(puHome - shHome).toFixed(3);
  const dAway = +(puAway - shAway).toFixed(3);
  const TH = 0.04;
  let side = null, gap = 0;
  if (dHome >= TH && dHome >= dAway) { side = 'home'; gap = dHome; }
  else if (dAway >= TH && dAway > dHome) { side = 'away'; gap = dAway; }
  if (!side) return null;
  const sideName = side === 'home' ? homeName : awayName;
  const strong = gap >= 0.08;
  return { side, gap, strong, flag: `Di Bet365, ${sideName} dikasih bayaran lebih besar untuk memancing pemasang ke sana` };
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

// ARAH BANDAR per pasar: ke mana sharp (SBOBET) bergerak. Tanpa pergerakan → belum ada arah.
function computeDirection(m, type, home, away) {
  if (!m.line || m.line.now == null) return { side: null, strength: 0, arrow: '→', text: '' };
  let homeVotes = 0, awayVotes = 0, reasons = [];
  const lm = m.lineMove;
  if (lm && lm.dir !== 'flat') {
    if (type === 'ah') { if (lm.delta < 0) { homeVotes++; reasons.push('garis melebar ke ' + home); } else { awayVotes++; reasons.push('garis menyusut ke ' + away); } }
    else { if (lm.delta > 0) { homeVotes++; reasons.push('garis naik (Over)'); } else { awayVotes++; reasons.push('garis turun (Under)'); } }
  }
  if (m.waterMoveHome && m.waterMoveHome.dir === 'down' && Math.abs(m.waterMoveHome.delta) >= 0.06) { homeVotes++; reasons.push('water mengeras sisi 1'); }
  if (m.waterMoveAway && m.waterMoveAway.dir === 'down' && Math.abs(m.waterMoveAway.delta) >= 0.06) { awayVotes++; reasons.push('water mengeras sisi 2'); }
  const net = homeVotes - awayVotes;
  if (net === 0) return { side: null, strength: 0, arrow: '→', text: 'Belum bergerak', bigMove: false };
  const side = net > 0 ? 'home' : 'away';
  const mag = (type === 'ah' && lm) ? Math.abs(lm.delta) : 0;
  const magBonus = mag >= 0.5 ? 2 : mag >= 0.25 ? 1 : 0;
  const strength = Math.min(3, Math.abs(net) + magBonus);
  return { side, strength, arrow: '➜', bigMove: mag >= 0.5 && mag <= 1.75, mag,
    label: sideLabel(type, side, home, away, m), reasons, text: 'Bandar geser ke ' + sideLabel(type, side, home, away, m) };
}

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
  const ah = dirs.find(d => d.key === 'ah');
  const primaryItem = ah || dirs[0];
  const primary = primaryItem.to;
  const parts = dirs.map(d => {
    const mv = (d.phrase && d.phrase.text !== 'water mengeras') ? ` (${d.phrase.text})` : '';
    return `${d.market}: ${d.to}${mv}`;
  });
  const narrative = parts.join(' · ') + '.';
  const items = dirs.map(d => ({ market: d.market, to: d.to, move: d.phrase ? d.phrase.text : null }));
  let insight = null;
  const ahM = markets.ah;
  if (ahM && ahM.direction && ahM.direction.bigMove && ahM.line && ahM.line.open != null) {
    const o = ahM.line.open, n = ahM.line.now, mag = Math.abs(n - o);
    const favName = o < 0 ? home : (o > 0 ? away : home);
    const gaining = (n > o) ? away : home;
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
  if (L == null) return { holds: '', signal: '' };
  const p = noVigProb(m.nowHome, m.nowAway);
  let holds = '';
  if (type === 'ah') {
    let favName, dogName, favP;
    if (L < 0) { favName = home; dogName = away; favP = p && p.home; }
    else if (L > 0) { favName = away; dogName = home; favP = p && p.away; }
    else { if (p && p.home >= p.away) { favName = home; dogName = away; favP = p.home; } else { favName = away; dogName = home; favP = p.away; } }
    holds = `Bandar jagokan: ${favName} ${strengthWord(Math.abs(L || 0))} (voor ${indoHandicap(L)}).` +
      (favP != null ? ` Tanpa potongan: peluang ${favName} ~${pct(favP)}% vs ${dogName}/seri ~${pct(1 - favP)}%.` : '');
    const lo = m.line && m.line.open, ln = m.line && m.line.now;
    if (lo != null && ln != null && Math.abs(ln - lo) >= 0.25) {
      const gaining = (ln > lo) ? away : home, weakening = gaining === home ? away : home;
      holds += ` ⚠️ Tapi voor lagi bergeser ${indoHandicap(lo)} → ${indoHandicap(ln)} — ${weakening} melemah, ${gaining} menguat. Jangan asal ambil ${weakening}.`;
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
  const favName = L < 0 ? home : (L > 0 ? away : home);
  const favSide = L < 0 ? 'home' : (L > 0 ? 'away' : 'home');
  const waterHardFav = (favSide === 'home' ? ah.waterMoveHome : ah.waterMoveAway);
  const hardening = waterHardFav && waterHardFav.dir === 'down' && Math.abs(waterHardFav.delta) >= 0.10;
  const divBaitFav = ah.divergence && ah.divergence.side === favSide;
  if (absL > 0 && absL < 0.6 && (hardening || divBaitFav)) {
    return { light: 'red', text: `Jebakan favorit: banyak orang taruh ke ${favName} karena kelihatan jagoan, padahal garisnya cuma ${indoHandicap(L)} — sebenarnya laganya jauh lebih ketat. Hati-hati ikut ramai.` };
  }
  const order = { green: 0, yellow: 1, red: 2 };
  let worst = 'green';
  for (const k of Object.keys(markets)) if (order[markets[k].light] > order[worst]) worst = markets[k].light;
  const seed = home + away;
  if (worst === 'red') return { light: 'red', text: pick(['Ada sisi yang ditarik ramai-ramai — jangan langsung percaya harga yang kelihatan manis.', 'Tarikan kuat ke satu sisi. Pelajari dulu sebelum ikut.', 'Satu sisi diramaikan keras. Hati-hati harga yang kelihatan enak.'], seed) };
  if (worst === 'yellow') return { light: 'yellow', text: pick(['Sebagian taruhan mulai diramaikan ke satu sisi. Cermati dulu.', 'Mulai ada gerakan ke satu sisi — perhatikan.', 'Ada tarikan tipis ke satu sisi. Jangan buru-buru ikut.'], seed) };
  return { light: 'green', text: pick(['Aman & tenang. Belum ada sisi yang dipancing mencolok.', 'Adem — tidak ada tarikan mencolok ke satu sisi.', 'Pasar wajar, belum ada yang diramaikan.'], seed) };
}

// =====================================================================
//  KESIMPULAN: "keuntungan bandar terkonsentrasi di sini"
// =====================================================================
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
  if (mk.waterMoveHome && mk.waterMoveHome.dir === 'down' && Math.abs(mk.waterMoveHome.delta) >= 0.10) return 'home';
  if (mk.waterMoveAway && mk.waterMoveAway.dir === 'down' && Math.abs(mk.waterMoveAway.delta) >= 0.10) return 'away';
  return null;
}
function deriveConclusion(match) {
  const m = match.markets, cands = [];
  const ah = m.ah, L = ah.line && ah.line.now, absL = Math.abs(L || 0);
  const favSide = L < 0 ? 'home' : (L > 0 ? 'away' : null);
  const favName = favSide === 'home' ? match.home : (favSide === 'away' ? match.away : null);
  const annotateAh = (side) => {
    const nm = side === 'home' ? match.home : match.away;
    return side === favSide ? `${nm} (favorit, garis ${indoHandicap(L)})` : nm;
  };
  const lab = (type, side, mk) => type === 'ah' ? annotateAh(side) : sideLabel(type, side, match.home, match.away, mk);
  const labShort = (type, side, mk) => type === 'ah' ? (side === 'home' ? match.home : match.away) : sideLabel(type, side, match.home, match.away, mk);
  if (match.verdict && /Jebakan favorit/i.test(match.verdict.text) && favName) {
    cands.push({ label: annotateAh(favSide), weight: 5, pick: { market: 'ah', side: favSide, line: L }, why: `${favName} kelihatan favorit jelas tapi garisnya cuma ${indoHandicap(L)}, jadi orang gampang nekat taruh besar ke situ` });
  }
  ['ah', 'ou'].forEach(k => {
    const mk = m[k];
    if (mk.divergence) {
      cands.push({ label: lab(k, mk.divergence.side, mk), weight: 4, pick: { market: k, side: mk.divergence.side, line: mk.line.now }, why: `${labShort(k, mk.divergence.side, mk)} dikasih bayaran lebih besar di Bet365 untuk memancing pemasang` });
    }
  });
  ['ah', 'ou', 'corner', 'cornerHT', 'card'].forEach(k => {
    const mk = m[k]; if (!mk) return; const hs = hardenSide(mk);
    if (hs) cands.push({ label: lab(k, hs, mk), weight: 3, pick: { market: k, side: hs, line: mk.line && mk.line.now }, why: `bayaran ${labShort(k, hs, mk)} dikecilkan karena uang menumpuk ke sana` });
  });
  if (!cands.length) {
    const calm = [
      'Bandar cuma ambil potongan wajar di dua sisi — belum ada yang diramaikan.',
      'Dua sisi seimbang, tidak ada sisi yang dipancing. Pasar adem.',
      'Belum ada tarikan ke satu sisi. Di sini bandar main wajar.',
    ];
    return { trapped: false, topPick: null, headline: 'Belum ada sisi yang dipancing.', detail: pick(calm, match.id), targets: [] };
  }
  const by = {};
  for (const c of cands) { const e = by[c.label] || (by[c.label] = { label: c.label, weight: 0, whys: [], pick: c.pick, maxw: 0 }); e.weight += c.weight; if (c.weight > e.maxw) { e.maxw = c.weight; e.pick = c.pick; } if (e.whys.indexOf(c.why) < 0) e.whys.push(c.why); }
  const ranked = Object.values(by).sort((a, b) => b.weight - a.weight);
  const top = ranked[0];
  const openers = ['Uang publik lagi ngumpul ke', 'Banyak yang ditarik ke', 'Arus taruhan condong ke', 'Orang ramai-ramai dipancing ke'];
  return {
    trapped: true,
    topPick: top.pick || null,
    headline: `Pemasang lagi dipancing ke: ${top.label}`,
    detail: `${pick(openers, match.id + top.label)} ${top.label}. Tandanya: ${top.whys.slice(0, 2).join('; ')}.`,
    targets: ranked.map(r => r.label),
  };
}

// =====================================================================
//  BIDAK JUJUR — "market sepi = bandar tak memancing = keyakinan paling asli".
//  PENGUAT grade (bukan jebakan). 1X2 babak 1 (harga draw-HT) TIDAK ada di sumber free →
//  "draw-HT murah" DIDEKATI dari Total HT rendah + voor HT ~imbang (INFERENSI, bukan harga draw langsung).
//  Tiap sinyal: {key, aktif, kekuatan, alasan} dengan alasan BERISI.
// =====================================================================
function honestSignals(match) {
  const m = match.markets, sig = [];
  const ouHTl = m.ouHT && m.ouHT.line && m.ouHT.line.now;
  const ahHTl = m.ahHT && m.ahHT.line && m.ahHT.line.now;
  const cornL = m.corner && m.corner.line && m.corner.line.now;
  const dDec = match.drawHT != null ? hkToDecimal(match.drawHT) : null;
  const drawImpl = dDec ? 1 / dDec : null;
  if (drawImpl != null && drawImpl >= 0.42) {
    // FAKTA: harga draw-HT LANGSUNG (jauh lebih kuat) → MENGGANTIKAN proxy inferensi.
    sig.push({ key: 'ht_draw_cheap', label: 'fakta', aktif: true, kekuatan: 3,
      alasan: `Harga DRAW babak 1 murah (${match.drawHT} ≈ ${pct(drawImpl)}% implied) — bandar terang-terangan menilai babak 1 imbang/skor rendah. Ini harga LANGSUNG (fakta), keyakinan asli bandar di market sepi.` });
  } else if (ouHTl != null && ouHTl <= 1.0) {
    // INFERENSI (proxy) — hanya bila TIDAK ada harga draw-HT asli.
    const tight = ahHTl == null || Math.abs(ahHTl) <= 0.5;
    sig.push({ key: 'ht_low_scoring', label: 'inferensi', aktif: true, kekuatan: tight ? 2 : 1,
      alasan: `Total gol babak 1 dipatok rendah (${ouHTl})${ahHTl != null && tight ? ` + voor HT ~imbang (${indoHandicap(ahHTl)})` : ''} — pasar diam-diam menilai babak 1 ketat/skor rendah (≈ draw-HT murah; INFERENSI dari total HT, bukan harga draw langsung). Market HT sepi → keyakinan asli bandar.` });
  }
  if (cornL != null && cornL >= 8 && cornL <= 11 && ouHTl != null && ouHTl <= 1.25) {
    sig.push({ key: 'controlled_game', label: 'inferensi', aktif: true, kekuatan: 2,
      alasan: `Corner moderat (${cornL}) + total HT rendah (${ouHTl}) — laga tempo terkontrol, bukan dipancing ke Over. Market sepi yang jujur → menguatkan baca arah.` });
  }
  return sig;
}

// =====================================================================
//  SKENARIO BANDAR (statis) — baca STRUKTUR satu snapshot, tak perlu pergerakan.
//  Klasifikasi VOOR (|handicap|) × TOTAL (garis O/U gol), lalu tentukan sisi giringan
//  (Bandar nyaman MENAMPUNG) vs sisi bandar (Bandar JAGOKAN diam-diam).
// =====================================================================
function scenario(v, t) {
  if (v == null || t == null) return { key: 'tak_jelas', label: 'data kurang' };
  v = Math.abs(v);
  if (v <= 0.75) return { key: 'ketat', label: 'laga ketat / koin-flip' };
  if (v >= 2.5) {
    if (t >= 3.25) return { key: 'rout_pesta', label: 'rout pesta gol' };
    if (t <= 2.75) return { key: 'besar_clean', label: 'menang besar tapi clean (≤3 gol)' };
    return { key: 'besar', label: 'menang besar' };
  }
  // unggul JELAS (1.75 ≤ v < 2.5) — bukan "sedang"
  if (v >= 1.75) {
    if (t >= 3.25) return { key: 'unggul_jelas_rame', label: 'unggul jelas + laga rame' };
    if (t <= 2.5) return { key: 'unggul_jelas_mampet', label: 'unggul jelas tapi mampet' };
    return { key: 'unggul_jelas', label: 'unggul jelas' };
  }
  // unggul menengah (0.75 < v < 1.75)
  if (v <= 1.5 && t <= 2.5) return { key: 'tipis_mampet', label: 'menang tipis mampet' };
  if (t >= 3.25) return { key: 'unggul_rame', label: 'unggul + laga rame' };
  if (t <= 2.5) return { key: 'unggul_mampet', label: 'unggul tapi cenderung mampet' };
  return { key: 'unggul', label: 'unggul sedang' };
}
function scenarioRead(match) {
  const ah = match.markets.ah, ou = match.markets.ou;
  const v = ah && ah.line && ah.line.now != null ? ah.line.now : null;
  const t = ou && ou.line && ou.line.now != null ? ou.line.now : null;
  const sc = scenario(v, t);
  // LAGA KETAT (voor ≤0.75) atau data kurang → SEIMBANG. Jangan paksa sisi (anti maksa kesimpulan).
  if (sc.key === 'ketat' || sc.key === 'tak_jelas') {
    return { key: sc.key, label: sc.label, voor: v, total: t, balanced: true, menampung: null, jagokan: null,
      basis: 'voor tipis — bandar tak condong kuat ke mana-mana',
      s1: `Skenario bandar: ${sc.label}`, s2: 'Laga seimbang — bandar tak condong kuat ke mana-mana.' };
  }
  // VOOR JELAS (>0.75) → tentukan sisi giringan (menampung) vs sisi bandar (jagokan).
  const favSide = v < 0 ? 'home' : 'away';
  const sideLbl = (side) => { const team = side === 'home' ? match.home : match.away; const sv = side === 'home' ? v : -v; return `${team} ${indoHandicap(sv)}`; };
  let menampungSide = null, basis = '';
  if (ah && ah.divergence && ah.divergence.side) { menampungSide = ah.divergence.side; basis = 'Bet365 bayar lebih besar di sini → digiring ke publik'; }
  else if (ah && ah.nowHome != null && ah.nowAway != null) {
    const dh = hkToDecimal(ah.nowHome), da = hkToDecimal(ah.nowAway);
    if (dh != null && da != null && Math.abs(dh - da) >= 0.03) { menampungSide = dh > da ? 'home' : 'away'; basis = 'sisi ini dibayar plus (juice lebih tinggi) → digiring'; }
  }
  if (!menampungSide) { menampungSide = favSide === 'home' ? 'away' : 'home'; basis = 'voor jelas, juice rata → bandar diam-diam di sisi favorit'; }
  const jagokanSide = menampungSide === 'home' ? 'away' : 'home';
  return { key: sc.key, label: sc.label, voor: v, total: t, balanced: false,
    menampung: sideLbl(menampungSide), jagokan: sideLbl(jagokanSide), basis,
    s1: `Skenario bandar: ${sc.label}`,
    s2: `Bandar nyaman menampung: ${sideLbl(menampungSide)}  ·  Bandar jagokan diam-diam: ${sideLbl(jagokanSide)}` };
}

// =====================================================================
//  DETEKTOR POLA BERLABEL (3C) — tiap fungsi MURNI: (match, ctx) → {key, aktif, kekuatan, alasan}.
//  ctx = { nowMs } untuk pola berbasis waktu. `alasan` WAJIB berisi & spesifik (bukan "true").
// =====================================================================
function _minsToKO(match, ctx) {
  const t = match && match.kickoff ? Date.parse(match.kickoff) : NaN;
  const now = (ctx && ctx.nowMs) || Date.now();
  return isNaN(t) ? null : (t - now) / 60000;
}
function _favAH(ah) { const L = ah && ah.line && ah.line.now; if (L == null) return null; return L < 0 ? 'home' : L > 0 ? 'away' : null; }
function _nm(match, side) { return side === 'home' ? match.home : match.away; }
function _off(key) { return { key, aktif: false, kekuatan: 0, alasan: '' }; }

// fake_favorite: favorit kelihatan jagoan tapi voor KECIL + tekanan publik ke favorit.
function detFakeFavorite(match) {
  const ah = match.markets.ah, L = ah.line && ah.line.now, absL = Math.abs(L || 0);
  if (!(absL > 0 && absL < 0.6)) return _off('fake_favorite');
  const favSide = _favAH(ah);
  const hard = favSide === 'home' ? ah.waterMoveHome : ah.waterMoveAway;
  const hardening = hard && hard.dir === 'down' && Math.abs(hard.delta) >= 0.06;
  const divFav = ah.divergence && ah.divergence.side === favSide;
  if (!hardening && !divFav) return _off('fake_favorite');
  const favN = _nm(match, favSide);
  return { key: 'fake_favorite', aktif: true, kekuatan: (hardening && divFav) ? 3 : 2,
    alasan: `${favN} kelihatan jagoan tapi voor cuma ${indoHandicap(L)} (laga sebenarnya ketat)` +
      (hardening ? `, bayaran ${favN} dikecilkan` : '') + (divFav ? `, Bet365 mengumpan ke ${favN}` : '') +
      ` — pemasang ditarik nekat taruh besar ke favorit padahal garis kecil.` };
}
// margin_trap: voor BESAR tapi de-vig cover ~koin → "menang bola ≠ menang voor".
function detMarginTrap(match) {
  const ah = match.markets.ah, L = ah.line && ah.line.now, absL = Math.abs(L || 0);
  if (absL < 1.75) return _off('margin_trap');
  const favSide = _favAH(ah);
  const coverP = favSide === 'home' ? ah.probHome : ah.probAway;
  if (coverP == null || coverP > 0.55) return _off('margin_trap');
  const favN = _nm(match, favSide), needGoals = Math.floor(absL) + 1;
  return { key: 'margin_trap', aktif: true, kekuatan: coverP <= 0.5 ? 3 : 2,
    alasan: `margin_trap: voor ${favN} ${indoHandicap(L)} (besar) padahal de-vig peluang COVER cuma ${pct(coverP)}% (≈ koin). ` +
      `Butuh ${favN} menang ≥${needGoals} gol; skor modal (menang tipis 1–2 gol) bikin GAGAL cover — pemasang "${favN} pasti menang besar" kejebak.` };
}
// total_trap: total digeser / bayaran satu sisi dikecilkan → memancing Over/Under.
function detTotalTrap(match) {
  const ou = match.markets.ou; if (!ou || ou.line.now == null) return _off('total_trap');
  const moved = ou.lineMove && ou.lineMove.dir !== 'flat';
  const overHard = ou.waterMoveHome && ou.waterMoveHome.dir === 'down' && Math.abs(ou.waterMoveHome.delta) >= 0.06;
  const underHard = ou.waterMoveAway && ou.waterMoveAway.dir === 'down' && Math.abs(ou.waterMoveAway.delta) >= 0.06;
  if (!moved && !overHard && !underHard) return _off('total_trap');
  const side = overHard ? 'Over' : underHard ? 'Under' : (ou.lineMove.delta > 0 ? 'Over' : 'Under');
  return { key: 'total_trap', aktif: true, kekuatan: (moved && (overHard || underHard)) ? 3 : 2,
    alasan: `total_trap: ${moved ? `total digeser ${ou.line.open}→${ou.line.now}` : `total ${ou.line.now}`}` +
      `${(overHard || underHard) ? `, bayaran ${side} dikecilkan` : ''} — arus pemasang dipancing ke ${side} ${ou.line.now} gol.` };
}
// line_freeze: <30mnt ke KO tapi garis & harga DIAM total → bandar membekukan.
function detLineFreeze(match, ctx) {
  const mins = _minsToKO(match, ctx); if (mins == null || mins > 30 || mins < -5) return _off('line_freeze');
  const ah = match.markets.ah; if (!ah || ah.line.now == null) return _off('line_freeze');
  const flatLine = !ah.lineMove || ah.lineMove.dir === 'flat';
  const flatH = !ah.waterMoveHome || Math.abs(ah.waterMoveHome.delta) < 0.03;
  const flatA = !ah.waterMoveAway || Math.abs(ah.waterMoveAway.delta) < 0.03;
  if (!(flatLine && flatH && flatA)) return _off('line_freeze');
  return { key: 'line_freeze', aktif: true, kekuatan: mins <= 15 ? 2 : 1,
    alasan: `line_freeze: ${Math.round(mins)} menit ke kickoff tapi voor (${ah.line.now}) & harga DIAM total — bandar membekukan garis: nyaman dgn posisi & tak mau kasih sinyal ke pasar.` };
}
// late_steam: pergerakan TAJAM di <30mnt ke KO → uang tajam menit akhir.
function detLateSteam(match, ctx) {
  const mins = _minsToKO(match, ctx); if (mins == null || mins > 30 || mins < -5) return _off('late_steam');
  const ah = match.markets.ah; if (!ah || ah.line.now == null) return _off('late_steam');
  const lineJump = ah.lineMove && ah.lineMove.dir !== 'flat' && Math.abs(ah.lineMove.delta) >= 0.25;
  const waterJump = (ah.waterMoveHome && ah.waterMoveHome.dir === 'down' && Math.abs(ah.waterMoveHome.delta) >= 0.08) ||
    (ah.waterMoveAway && ah.waterMoveAway.dir === 'down' && Math.abs(ah.waterMoveAway.delta) >= 0.08);
  if (!lineJump && !waterJump) return _off('late_steam');
  const toN = lineJump ? (ah.lineMove.delta < 0 ? match.home : match.away) : null;
  return { key: 'late_steam', aktif: true, kekuatan: lineJump ? 3 : 2,
    alasan: `late_steam: ${Math.round(mins)} menit ke kickoff` +
      `${lineJump ? `, voor bergerak ${indoHandicap(ah.line.open)}→${indoHandicap(ah.line.now)} ke ${toN}` : ', harga mengeras tajam'} — uang tajam masuk di menit-menit akhir.` };
}
// value_compression: garis sama tapi selisih harga dua sisi MENYEMPIT → value terkuras.
function detValueCompression(match) {
  const ah = match.markets.ah; if (!ah || ah.nowHome == null || ah.openHome == null) return _off('value_compression');
  const lineSame = !ah.lineMove || ah.lineMove.dir === 'flat';
  const openGap = Math.abs(ah.openHome - ah.openAway), nowGap = Math.abs(ah.nowHome - ah.nowAway);
  if (!(lineSame && openGap - nowGap >= 0.06)) return _off('value_compression');
  return { key: 'value_compression', aktif: true, kekuatan: (openGap - nowGap) >= 0.12 ? 2 : 1,
    alasan: `value_compression: di garis sama (${ah.line.now}), selisih harga dua sisi menyempit ${openGap.toFixed(2)}→${nowGap.toFixed(2)} — pasar mengetat, sisa nilai buat pemasang menipis (harga makin "pas"/efisien).` };
}
// reverse_line_movement: garis bergerak MELAWAN sisi publik (umpan Bet365 / favorit pembukaan).
function detReverseLineMovement(match) {
  const ah = match.markets.ah; if (!ah || ah.line.now == null) return _off('reverse_line_movement');
  const lm = ah.lineMove; if (!lm || lm.dir === 'flat' || Math.abs(lm.delta) < 0.25) return _off('reverse_line_movement');
  const favOpen = ah.line.open != null ? (ah.line.open < 0 ? 'home' : ah.line.open > 0 ? 'away' : null) : _favAH(ah);
  const pubSide = (ah.divergence && ah.divergence.side) || favOpen;
  if (!pubSide) return _off('reverse_line_movement');
  const lineToward = lm.delta < 0 ? 'home' : 'away';
  if (lineToward === pubSide) return _off('reverse_line_movement');
  return { key: 'reverse_line_movement', aktif: true, kekuatan: 3,
    alasan: `reverse_line_movement: publik condong ke ${_nm(match, pubSide)} (${ah.divergence ? 'umpan Bet365' : 'favorit pembukaan'}), TAPI voor malah bergerak ${indoHandicap(ah.line.open)}→${indoHandicap(ah.line.now)} ke ${_nm(match, lineToward)} — uang tajam melawan arah publik.` };
}
const DETECTORS = [detFakeFavorite, detMarginTrap, detTotalTrap, detLineFreeze, detLateSteam, detValueCompression, detReverseLineMovement];
function runDetectors(match, ctx) { return DETECTORS.map(fn => fn(match, ctx)).filter(d => d.aktif); }

// =====================================================================
//  GRADE A/B/C/D + CROSS-MARKET (3D) — gabung sinyal; bentrok → TURUNKAN grade + jelaskan.
//  Bidak jujur (market sepi) diberi BOBOT LEBIH TINGGI. D dipakai sungguhan saat bising/lemah.
// =====================================================================
function crossMarket(match) {
  const m = match.markets;
  // Sinyal tempo: O/U + corner + HT (+1 = lean Over/ramai, -1 = lean Under/sepi).
  const tempo = [];
  for (const k of ['ou', 'ouHT', 'corner', 'cornerHT']) {
    const mk = m[k]; if (!mk || !mk.direction || !mk.direction.side) continue;
    tempo.push({ k, v: mk.direction.side === 'home' ? 1 : -1 });
  }
  const over = tempo.filter(t => t.v > 0).map(t => t.k), under = tempo.filter(t => t.v < 0).map(t => t.k);
  let agree = false, conflict = false, note = '';
  if (tempo.length >= 2) {
    if (over.length && under.length) {
      conflict = true;
      note = `Sinyal tempo BENTROK: ${over.join('+')} mengarah Over/ramai tapi ${under.join('+')} mengarah Under/sepi — pasar tak satu suara, baca jadi bising.`;
    } else { agree = true; note = `Sinyal tempo SEARAH (${tempo.map(t => t.k).join('+')} → ${over.length ? 'Over/ramai' : 'Under/sepi'}) — saling menguatkan.`; }
  }
  // Konsistensi sisi: AH FT vs AH babak-1.
  const ahd = m.ah && m.ah.direction && m.ah.direction.side, ahHTd = m.ahHT && m.ahHT.direction && m.ahHT.direction.side;
  if (ahd && ahHTd && ahd !== ahHTd) { conflict = true; note += (note ? ' ' : '') + `Arah AH penuh (${_nm(match, ahd)}) BENTROK dgn AH babak-1 (${_nm(match, ahHTd)}).`; }
  else if (ahd && ahHTd && ahd === ahHTd) agree = true;
  return { agree, conflict, note };
}
function gradeMatch(match) {
  const detPower = (match.detectors || []).reduce((s, d) => s + (d.kekuatan || 0), 0);
  const dirPower = match.guidance && match.guidance.moved ? (match.guidance.strength || 0) : 0;
  // STRUKTURAL (statis, tanpa pergerakan): kejelasan skenario dari VOOR + sinyal giringan.
  const sc = match.scenario || {};
  const ahL = match.markets.ah && match.markets.ah.line ? match.markets.ah.line.now : null;
  const v = ahL != null ? Math.abs(ahL) : 0;
  // VOOR = driver utama (monotonik: makin besar voor, makin jelas skenario → power ≥).
  let structural = v >= 2.5 ? 3.5 : v >= 1.75 ? 2.5 : v >= 1.5 ? 2.0 : v >= 1.0 ? 1.3 : v >= 0.75 ? 0.6 : 0;
  if (match.markets.ah && match.markets.ah.divergence) structural += 1.5;      // divergence = giringan UTAMA (bonus di atas voor)
  else if (!sc.balanced && sc.menampung) structural += 0.6;                    // giringan dari juice (bonus kecil)
  // READ NYATA = structural(voor+giringan) + detektor + arah. INI yang menentukan HURUF grade.
  const readPower = +(detPower + dirPower + structural).toFixed(1);            // pergerakan = penguat OPSIONAL
  const cm = crossMarket(match);
  // cross-market (searah/bentrok) bagian dari read nyata; bidak jujur TIDAK (anti lompat-grade).
  const eff = +(readPower + (cm.agree ? 1.5 : 0) - (cm.conflict ? 3 : 0)).toFixed(1);
  const scenarioValid = sc.key && sc.key !== 'tak_jelas';
  let grade;
  if (eff >= 6.5) grade = 'A';                            // A WAJIB read nyata kuat (skenario besar + TWIST: margin_trap/divergence)
  else if (eff >= 3.5) grade = 'B';                       // voor besar saja (tanpa twist) → B
  else if (scenarioValid) grade = cm.conflict ? 'D' : 'C'; // bentrok+lemah → D (hindari); selain itu C (adem)
  else grade = 'D';
  // BIDAK JUJUR = penguat keyakinan DALAM grade (TIDAK mengubah huruf). Proxy (inferensi) ≠ draw-HT asli (fakta).
  const honest = match.honest || [];
  const honestFakta = honest.some(h => h.label === 'fakta');
  const honestNote = honest.length ? (honestFakta ? 'dikonfirmasi harga draw-HT asli (fakta)' : 'didukung bidak jujur proxy (inferensi lemah — tak menaikkan grade)') : null;
  const drivers = [];
  for (const d of (match.detectors || [])) drivers.push(d.alasan);
  for (const h of (match.honest || [])) drivers.push('Bidak jujur (' + (h.label || 'inferensi') + ', penguat — tak menaikkan grade): ' + h.alasan);
  if (cm.note) drivers.push(cm.note);
  return { grade, score: eff, readPower, structural, conflict: cm.conflict, agree: cm.agree, crossNote: cm.note,
    honestConfirm: honest.length > 0, honestFakta, honestNote, drivers, meaning: gradeMeaning(grade) + (honestNote ? ' · ' + honestNote : '') };
}
function gradeMeaning(g) {
  return g === 'A' ? 'sinyal kuat & konsisten' : g === 'B' ? 'sinyal lumayan'
    : g === 'C' ? 'campur/lemah — hati-hati' : 'bising/hindari — data tak cukup untuk dibaca, jangan paksa';
}
function lowerGrade(g) { const o = ['A', 'B', 'C', 'D'], i = o.indexOf(g); return i < 0 ? 'D' : o[Math.min(3, i + 1)]; }

// =====================================================================
//  MODIFIER LINEUP (4B) — WAJIB bisa MEMBALIK read (bukan catatan tempel).
//  Status lineup = FAKTA (dari paste); DAMPAK ke read = INFERENSI. Menurunkan grade
//  saat lineup bertentangan dgn arah odds, dengan ALASAN terbaca (tak diam-diam).
// =====================================================================
function applyLineup(match) {
  const lu = match.lineup;
  if (!lu || !(lu.favKeyOut || lu.dogStarIn || lu.dogPark)) return;
  const ou = match.markets.ou, oul = ou && ou.line && ou.line.now;
  const honest = (match.honest || []).map(h => h.key);
  const underLean = (oul != null && oul <= 2.25) || honest.includes('controlled_game') || honest.includes('ht_low_scoring') || honest.includes('ht_draw_cheap');
  const overLean = (oul != null && oul >= 3.25) || (ou && ou.direction && ou.direction.side === 'home');
  const changes = []; let down = 0;
  if (lu.favKeyOut) {
    changes.push('Striker kunci favorit CADANGAN → keyakinan voor besar (margin) & Over DITEKAN: favorit kurang tajam, cover voor besar makin ragu.');
    down += 1;
  }
  if (lu.dogStarIn) {
    if (underLean) { changes.push('Odds condong Under/laga ketat, TAPI bintang serang underdog STARTER → underdog hidup & Over lebih mungkin: keyakinan Under DITURUNKAN.'); down += 2; }
    else changes.push('Bintang serang underdog STARTER → underdog hidup, Over lebih mungkin (sejalan dgn odds).');
  }
  if (lu.dogPark) {
    if (overLean) { changes.push('Odds condong Over, TAPI underdog PARKIR/bertahan → laga bisa lebih tertutup: keyakinan Over diturunkan, Under didukung.'); down += 1; }
    else changes.push('Underdog PARKIR/bertahan → dukung Under & margin tipis (sejalan dgn odds).');
  }
  const before = match.grade.grade;
  let after = before;
  for (let i = 0; i < down; i++) after = lowerGrade(after);
  if (after !== before) { match.grade.grade = after; match.grade.meaning = gradeMeaning(after) + ' — DITURUNKAN oleh lineup'; }
  match.grade.drivers.push('Lineup → ' + changes.join(' '));
  match.lineupRead = { applied: true, oddsLean: underLean ? 'under' : overLean ? 'over' : 'none', changes, gradeBefore: before, gradeAfter: after, flip: after !== before };
}

// =====================================================================
//  OUTPUT TEMPLATE + LABEL FAKTA/INFERENSI/SPEKULASI (3E).
//  FAKTA = angka odds/garis (harga pasar). INFERENSI = arah dari pergerakan.
//  SPEKULASI = motif bandar (paling lemah, wajib dilabeli). Lineup = Fase 4.
// =====================================================================
function buildReport(match) {
  const m = match.markets, g = match.grade || {}, fmt = v => (v == null ? '—' : v);
  const factLine = (mk, name) => {
    if (!mk || mk.lineDisplay == null) return null;
    const moved = mk.lineMove && mk.lineMove.dir !== 'flat';
    return `${name}: garis ${moved ? mk.line.open + '→' + mk.line.now : mk.line.now + ' (tetap)'}` +
      `, harga ${fmt(mk.openHome)}→${fmt(mk.nowHome)} / ${fmt(mk.openAway)}→${fmt(mk.nowAway)}` +
      `${mk.margin != null ? `, margin ${mk.margin.toFixed(1)}%` : ''}`;
  };
  // FAKTA — angka odds (tak ada tafsir).
  const fakta = [];
  [['ah', 'AH gol'], ['ou', 'O/U gol'], ['ahHT', 'AH babak 1'], ['ouHT', 'O/U babak 1'], ['corner', 'Corner'], ['cornerHT', 'Corner B1']]
    .forEach(([k, nm]) => { const f = factLine(m[k], nm); if (f) fakta.push(f); });
  if (match.win && match.win.home != null) fakta.push(`1X2 de-vig: ${match.home} ${pct(match.win.home)}% / Seri ${pct(match.win.draw)}% / ${match.away} ${pct(match.win.away)}% (pendukung)`);
  if (match.lineup) { const ls = [match.lineup.favKeyOut ? 'striker favorit cadangan' : null, match.lineup.dogStarIn ? 'bintang serang underdog starter' : null, match.lineup.dogPark ? 'underdog parkir/bertahan' : null].filter(Boolean).join('; '); if (ls) fakta.push(`Lineup (status, fakta): ${ls}`); }
  // INFERENSI — arah dari pergerakan + pola terdeteksi + bidak jujur (penguat).
  const inferensi = [];
  if (match.guidance && match.guidance.moved) inferensi.push(`Arah bandar: ke ${match.guidance.primary} (${match.guidance.confidence}) — ${match.guidance.narrative}`);
  for (const d of (match.detectors || [])) inferensi.push(`[${d.key}] ${d.alasan}`);
  for (const h of (match.honest || [])) {
    if (h.label === 'fakta') fakta.push(`[bidak jujur · harga langsung] ${h.alasan}`);
    else inferensi.push(`[bidak jujur · inferensi] ${h.alasan}`);
  }
  if (match.lineupRead && match.lineupRead.changes.length) for (const c of match.lineupRead.changes) inferensi.push('[lineup→read] ' + c);
  if (!inferensi.length) inferensi.push('Belum ada arah yang bisa dibaca — garis & harga relatif diam.');
  // SPEKULASI — motif bandar (jelas dilabeli sebagai dugaan).
  const pancing = match.conclusion && match.conclusion.trapped ? match.conclusion.headline.replace('Pemasang lagi dipancing ke: ', '') : null;
  const spekulasi = [];
  if (pancing) spekulasi.push(`Dugaan motif: bandar memancing pemasang ke ${pancing}; margin terkonsentrasi di sisi ramai itu.`);
  else spekulasi.push('Dugaan motif: belum ada sisi yang jelas dipancing — kemungkinan bandar menampung dua sisi (main wajar).');
  // BANDAR PANCING / PEGANG
  const ahDir = m.ah && m.ah.direction && m.ah.direction.side;
  const bandarPegang = ahDir ? _nm(match, ahDir) : (match.guidance && match.guidance.primary) || null;
  // WHAT CONFIRMS / INVALIDATES (pemicu 30 menit → kickoff)
  const confirms = [], invalidates = [];
  if (match.guidance && match.guidance.moved) {
    confirms.push(`Garis lanjut bergerak ke ${match.guidance.primary} mendekati kickoff (late steam searah).`);
    invalidates.push('Garis berbalik arah / late steam ke sisi sebaliknya menjelang kickoff.');
  }
  if ((match.honest || []).length) confirms.push('Total HT tetap rendah & corner tetap moderat sampai kickoff (laga terkontrol).');
  if ((match.detectors || []).some(d => d.key === 'line_freeze')) confirms.push('Garis tetap beku sampai kickoff (bandar nyaman dgn posisi).');
  invalidates.push('Berita lineup (XI/absensi pemain kunci) yang mengubah kekuatan — bisa membalik baca (lihat Fase 4 / kirim manual).');
  if (!confirms.length) confirms.push('Muncul pergerakan jelas menjelang kickoff yang membentuk arah.');
  const sc = match.scenario || {};
  const lineupChange = match.lineupRead
    ? (match.lineupRead.flip
      ? `Read BERUBAH karena lineup: grade ${match.lineupRead.gradeBefore}→${match.lineupRead.gradeAfter}. ${match.lineupRead.changes.join(' ')}`
      : `Lineup tercatat (tak membalik arah): ${match.lineupRead.changes.join(' ')}`)
    : null;
  return { grade: g.grade, meaning: g.meaning, fakta, inferensi, spekulasi,
    scenarioLabel: sc.label, scenarioS1: sc.s1, scenarioS2: sc.s2, menampung: sc.menampung, jagokan: sc.jagokan, balanced: sc.balanced,
    bandarPancing: sc.menampung, bandarPegang: sc.jagokan, confirms, invalidates, lineupChange };
}

// Ringkasan papan (dipakai Node & Worker) — termasuk distribusi grade.
function summarize(matches) {
  const gc = { A: 0, B: 0, C: 0, D: 0 };
  for (const mt of matches) { const gr = mt.grade && mt.grade.grade; if (gc[gr] != null) gc[gr]++; }
  return {
    total: matches.length,
    live: matches.filter(mt => mt.live).length,
    trapped: matches.filter(mt => mt.conclusion && mt.conclusion.trapped).length,
    gradeA: gc.A, gradeB: gc.B, gradeC: gc.C, gradeD: gc.D,
  };
}

// =====================================================================
//  HISTORY v2 (perjalanan garis antar-waktu) — murni: terima objek hist, tak baca file.
//  Schema entry per laga: { v:2, open:<snap|null>, snaps:[<snap>...≤60], hl:{ [market]:{lineLo,lineHi} } }
//  Snapshot generik PER MARKET: { t, [market]:{l,h,a} }  (l=garis, h=juice home/over, a=juice away/under)
//  → forward-compatible: market baru (mis. ah_ht, ou_ht) otomatis terekam tanpa ubah schema.
//  BACK-COMPAT WAJIB: format lama (array of {ahLine,ahH,ahA,ouLine,ouO,ouU}) tetap kebaca via adapter;
//  baseline OPENING tidak boleh hilang (di-derive dari snapshot waras pertama).
// =====================================================================
const HIST_MARKETS = ['ah', 'ou', 'ahHT', 'ouHT', 'corner', 'cornerHT', 'card'];

// Snapshot SAH sebagai OPEN bila garisnya dekat main-line sekarang (now = hasil pickMainLine
// median-window, sudah anti-outlier → garis sampah -6 otomatis JAUH dari now dan ditolak).
// JANGAN tolak berbasis gap harga: voor BESAR SAH berharga ~imbang (mis. -3.5 @ 1.95/1.95) —
// justru di laga voor besar harga imbang itulah margin-trap & reverse-line-movement bekerja.
function snapSaneAh(snap, nowL) {
  const a = snap && snap.ah; if (!a || a.l == null || a.h == null || a.a == null) return false;
  return nowL == null || Math.abs(a.l - nowL) <= 1.5;
}
// Adapter: snapshot format LAMA → baru. (Sudah baru → dikembalikan apa adanya.)
function adaptSnap(s) {
  if (!s) return null;
  if (!('ahLine' in s) && !('ouLine' in s)) return s;     // sudah format baru
  const ns = { t: s.t };
  if (s.ahLine != null) ns.ah = { l: s.ahLine, h: s.ahH != null ? s.ahH : null, a: s.ahA != null ? s.ahA : null };
  if (s.ouLine != null) ns.ou = { l: s.ouLine, h: s.ouO != null ? s.ouO : null, a: s.ouU != null ? s.ouU : null };
  return ns;
}
// Hitung ulang open + high/low dari deretan snapshot (dipakai saat migrasi data lama).
function recomputeOpenHL(entry) {
  const snaps = entry.snaps || [];
  const nowL = snaps.length ? (snaps[snaps.length - 1].ah && snaps[snaps.length - 1].ah.l) : null;
  entry.open = snaps.find(s => snapSaneAh(s, nowL)) || snaps[0] || null;
  const hl = {};
  for (const s of snaps) for (const k of Object.keys(s)) {
    if (k === 't' || !s[k] || s[k].l == null) continue;
    const h = hl[k] || (hl[k] = { lineLo: s[k].l, lineHi: s[k].l });
    if (s[k].l < h.lineLo) h.lineLo = s[k].l; if (s[k].l > h.lineHi) h.lineHi = s[k].l;
  }
  entry.hl = hl;
  return entry;
}
// Adapter entry: format LAMA (array) ATAU baru ({v:2,...}) → selalu kembalikan {v:2,open,snaps,hl}.
function adaptEntry(e) {
  if (!e) return { v: 2, open: null, snaps: [], hl: {} };
  if (Array.isArray(e)) return recomputeOpenHL({ v: 2, open: null, snaps: e.map(adaptSnap).filter(Boolean), hl: {} });
  if (e.v === 2 && Array.isArray(e.snaps)) return e;
  return recomputeOpenHL({ v: 2, open: e.open ? adaptSnap(e.open) : null, snaps: (e.snaps || []).map(adaptSnap).filter(Boolean), hl: e.hl || {} });
}
// Snapshot baru dari hasil analisa: rekam SEMUA market yang tersambung (l + dua sisi juice).
function snapFromMatch(match) {
  const snap = { t: Date.now() };
  for (const k of Object.keys(match.markets)) {
    const mk = match.markets[k];
    if (!mk || mk.lineDisplay == null || !mk.line) continue;
    snap[k] = { l: mk.line.now, h: mk.nowHome != null ? mk.nowHome : null, a: mk.nowAway != null ? mk.nowAway : null };
  }
  return snap;
}
function sameSnap(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).filter(k => k !== 't'), kb = Object.keys(b).filter(k => k !== 't');
  if (ka.length !== kb.length) return false;
  for (const k of ka) { const x = a[k], y = b[k]; if (!y || x.l !== y.l || x.h !== y.h || x.a !== y.a) return false; }
  return true;
}
// Catat snapshot baru ke entry (ENTRY SUDAH dimigrasi via adaptEntry oleh pemanggil).
function updateHist(entry, match) {
  const snap = snapFromMatch(match);
  const last = entry.snaps[entry.snaps.length - 1];
  if (!sameSnap(last, snap)) entry.snaps.push(snap);
  if (entry.snaps.length > 60) entry.snaps = entry.snaps.slice(-60);
  // OPEN: set sekali (snapshot waras pertama), lalu beku — tak hilang walau snaps lama tergeser.
  if (!entry.open) { const nowL = snap.ah && snap.ah.l; entry.open = entry.snaps.find(s => snapSaneAh(s, nowL)) || entry.snaps[0] || null; }
  // HIGH/LOW: ekstrem garis sepanjang waktu (incremental → tetap akurat walau window geser).
  for (const k of Object.keys(snap)) {
    if (k === 't' || snap[k].l == null) continue;
    const h = entry.hl[k] || (entry.hl[k] = { lineLo: snap[k].l, lineHi: snap[k].l });
    if (snap[k].l < h.lineLo) h.lineLo = snap[k].l; if (snap[k].l > h.lineHi) h.lineHi = snap[k].l;
  }
  const moves = Math.max(0, entry.snaps.length - 1);
  const lastMoveAgo = entry.snaps.length ? Date.now() - entry.snaps[entry.snaps.length - 1].t : null;
  return { snapshots: entry.snaps.length, moves, lastMoveMin: lastMoveAgo != null ? Math.round(lastMoveAgo / 60000) : null,
    spark: entry.snaps.slice(-12).map(s => s.ah && s.ah.l), hl: entry.hl,
    openAh: entry.open && entry.open.ah ? entry.open.ah.l : null };
}

// =====================================================================
//  RANGKAI SATU LAGA
// =====================================================================
function analyzeMatch(raw, hist, isLive, ctx) {
  // Migrasi entry history (format lama→baru) lalu pakai OPEN beku sebagai baseline pergerakan.
  let entry = null;
  if (hist) entry = hist[raw.id] = adaptEntry(hist[raw.id]);
  if (isLive && entry && entry.open) {
    const op = entry.open;
    for (const k of HIST_MARKETS) {
      if (!raw[k] || !op[k] || !raw[k].line || raw[k].line.open !== raw[k].line.now) continue;
      const lo = op[k].l, nowL = raw[k].line.now;
      // AH: cek kewarasan ketat; market lain: cukup tak loncat jauh dari now.
      const ok = (k === 'ah') ? snapSaneAh(op, nowL) : (lo != null && (nowL == null || Math.abs(lo - nowL) <= 1.5));
      if (ok) { raw[k].line.open = lo; raw[k].openHome = op[k].h; raw[k].openAway = op[k].a; }
    }
  }
  const mk = (label, key, normalMargin) => buildMarket(Object.assign({ label, normalMargin, homeName: raw.home, awayName: raw.away }, raw[key]));
  const markets = {
    ah: mk('Handicap', 'ah', NORMAL_MARGIN.ah),
    ou: mk('Over/Under', 'ou', NORMAL_MARGIN.ou),
    ahHT: mk('Handicap Babak 1', 'ahHT', NORMAL_MARGIN.ah),
    ouHT: mk('Over/Under Babak 1', 'ouHT', NORMAL_MARGIN.ou),
    corner: mk('Corner (FT)', 'corner', NORMAL_MARGIN.corner),
    cornerHT: mk('Corner (Babak 1)', 'cornerHT', NORMAL_MARGIN.cornerHT),
    card: mk('Kartu', 'card', NORMAL_MARGIN.card),
  };
  // Tipe dasar tiap market (HT memakai logika sama dgn FT-nya: ahHT→ah, ouHT→ou).
  const TYPE = { ah: 'ah', ou: 'ou', ahHT: 'ah', ouHT: 'ou', corner: 'corner', cornerHT: 'cornerHT', card: 'card' };
  for (const k of Object.keys(markets)) {
    markets[k].read = generateRead(TYPE[k], markets[k], raw.home, raw.away);
    markets[k].direction = computeDirection(markets[k], TYPE[k], raw.home, raw.away);
  }
  for (const k of ['ah', 'ou', 'ahHT', 'ouHT']) {
    if (markets[k] && markets[k].divergence && markets[k].read.signal.indexOf('Bet365') === -1) {
      markets[k].read.signal += ' ↔ ' + markets[k].divergence.flag + '.';
    }
  }
  const verdict = matchVerdict(markets, raw.home, raw.away);
  const status = raw.status || 'pending';
  const out = { id: raw.id, home: raw.home, away: raw.away, group: raw.group || null, kickoff: raw.kickoff,
    status, live: String(status).toLowerCase() === 'live', score: raw.score || null, minute: raw.minute || null,
    win: raw.win || null, drawHT: raw.drawHT != null ? raw.drawHT : null, source: raw.source || null,
    overallLight: verdict.light, verdict, markets };
  out.conclusion = deriveConclusion(out);
  out.guidance = matchGuidance(markets, raw.home, raw.away);
  out.honest = honestSignals(out);
  out.detectors = runDetectors(out, ctx || { nowMs: Date.now() });
  out.scenario = scenarioRead(out);
  out.grade = gradeMatch(out);
  out.lineup = raw.lineup || null;
  applyLineup(out);                 // 4B: bisa menurunkan/membalik grade (set out.lineupRead)
  out.report = buildReport(out);
  if (hist) out.history = updateHist(entry, out);
  return out;
}

// =====================================================================
//  NORMALISASI odds-api.io (Sbobet acuan + Bet365 publik)
// =====================================================================
function bookArr(ev, name) {
  const bs = ev.bookmakers || {};
  return bs[name] || bs[name.toLowerCase()] || bs[name.toUpperCase()] || null;
}
function marketEntries(arr, names) {
  if (!Array.isArray(arr)) return null;
  for (const n of names) { const m = arr.find(x => (x.name || '').toLowerCase() === n.toLowerCase()); if (m && Array.isArray(m.odds)) return m.odds; }
  return null;
}
function entryLine(o) { return num(o.hdp != null ? o.hdp : o.max); }
function entrySides(o) {
  const a = o.home != null ? num(o.home) : num(o.over);
  const b = o.away != null ? num(o.away) : num(o.under);
  return [a, b];
}
// Pilih garis UTAMA = baris dengan odds paling seimbang (selisih terkecil) dalam rentang wajar,
// setelah membuang outlier jauh dari MEDIAN ladder (cegah entri sampah "menang").
function pickMainLine(odds, lo, hi) {
  if (!Array.isArray(odds)) return null;
  const valid = [];
  for (const o of odds) {
    const line = entryLine(o); const [a, b] = entrySides(o);
    if (a == null || b == null || line == null) continue;
    if (lo != null && (line < lo || line > hi)) continue;
    valid.push({ line, a, b });
  }
  if (!valid.length) return null;
  const lines = valid.map(v => v.line).sort((x, y) => x - y);
  const med = lines[Math.floor((lines.length - 1) / 2)];
  const pool = valid.filter(v => Math.abs(v.line - med) <= 1.5);
  let best = null, bestDiff = Infinity;
  for (const v of (pool.length ? pool : valid)) {
    const d = Math.abs(v.a - v.b);
    if (d < bestDiff) { bestDiff = d; best = v; }
  }
  return best;
}
function pickAtLine(odds, line) {
  if (!Array.isArray(odds) || line == null) return null;
  for (const o of odds) { if (entryLine(o) === line) { const [a, b] = entrySides(o); if (a != null && b != null) return { line, a, b }; } }
  return null;
}
function emptyMarket() { return { line: { open: null, now: null }, openHome: null, openAway: null, nowHome: null, nowAway: null, pub: null }; }
function buildLiveMarket(refOdds, pubOdds, lo, hi) {
  const ref = pickMainLine(refOdds, lo, hi);
  if (!ref) return emptyMarket();
  const pub = pickAtLine(pubOdds, ref.line);
  return {
    line: { open: ref.line, now: ref.line }, openHome: ref.a, openAway: ref.b, nowHome: ref.a, nowAway: ref.b,
    pub: pub ? { line: pub.line, home: pub.a, away: pub.b } : null,
  };
}
// Pilih satu market: Sbobet (acuan sharp) kalau ada main-line; kalau tidak, Bet365.
// Pembanding (pub) diambil dari buku lain pada GARIS yang sama.
function pickBook(sb, pb, names, lo, hi) {
  const sbM = marketEntries(sb, names), pbM = marketEntries(pb, names);
  if (pickMainLine(sbM, lo, hi)) return buildLiveMarket(sbM, pbM, lo, hi);
  return buildLiveMarket(pbM, sbM, lo, hi);
}
function normalizeOddsApiIo(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    const sb = bookArr(ev, 'Sbobet'), pb = bookArr(ev, 'Bet365');
    // GOL full-time: AH "Spread", O/U "Totals". (Nama market = otoritas; bukan tebak rentang.)
    const ah = pickBook(sb, pb, ['Spread', 'Asian Handicap'], -6, 6);
    const ou = pickBook(sb, pb, ['Totals', 'Over/Under'], 0.5, 6);
    if (ah.nowHome == null && ou.nowHome == null) continue;
    // GOL babak 1 (HT): AH "Spread HT", O/U "Totals HT".
    const ahHT = pickBook(sb, pb, ['Spread HT'], -4, 4);
    const ouHT = pickBook(sb, pb, ['Totals HT'], 0.25, 4);
    // CORNER (O/U) — market eksplisit (sebelumnya keliru dibaca dari "Totals" gol).
    const corner = buildLiveMarket(marketEntries(sb, ['Corners Totals']), marketEntries(pb, ['Corners Totals']), 5, 18);
    const cornerHT = buildLiveMarket(marketEntries(sb, ['Corners Totals HT']), null, 1.5, 10);
    // KARTU: "Bookings Totals".
    const card = buildLiveMarket(marketEntries(sb, ['Bookings Totals']), null, 1.5, 9);
    // 1X2 FT dari "ML". 1X2 BABAK 1 tidak ada di sumber free → null (tidak dikarang).
    const ml = (marketEntries(sb, ['ML', '1X2', 'Match Winner']) || [])[0] || (marketEntries(pb, ['ML', '1X2', 'Match Winner']) || [])[0] || null;
    const win = ml ? noVig3(ml.home, ml.draw, ml.away) : null;
    out.push({ id: String(ev.id || ev.eventId), home: ev.home, away: ev.away,
      group: (ev.league && (ev.league.name || ev.league)) || ev.leagueName || null, kickoff: ev.date || ev.commenceTime,
      status: ev.status || 'pending', win, ah, ou, ahHT, ouHT, corner, cornerHT, card });
  }
  return out;
}

// =====================================================================
//  INGEST MANUAL (4A) — paste 1 papan SBOBET. Sumber SETARA odds-api.io (bukan satu-satunya).
//  Format toleran: 1 market/baris, kata-kunci + angka. Harga boleh desimal (1.90) atau HK (0.90).
//    "Germany vs Curacao"            (baris tim)
//    "AH -3.5 1.90 2.10"  "OU 4.5 1.95 1.95"
//    "AH HT -1 1.95 1.95" "OU HT 1.5 1.90 2.00"
//    "1X2 1.04 11 26"     "Draw HT 2.05"     ← harga draw-HT ASLI → ganti proxy inferensi
//    "Corner 10.5 1.9 1.9" "Corner HT 4.5 1.95 1.95" "Card 4 1.9 1.9"
//  Mengembalikan {ok, raw, parsedView, warnings} — parsedView ditampilkan utk verifikasi user.
function parseManual(text) {
  if (!text || !String(text).trim()) return { ok: false, raw: null, parsedView: [], warnings: ['Input kosong.'] };
  const warnings = [];
  const raw = { id: 'manual', home: 'Tim A', away: 'Tim B', status: 'pending', source: 'manual', kickoff: null };
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const nums = l => (l.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const mk = n => (n.length >= 3 ? { line: { open: n[0], now: n[0] }, openHome: n[1], openAway: n[2], nowHome: n[1], nowAway: n[2], pub: null } : null);
  const isHT = l => /\b(ht|h1|babak\s*1|paruh|1st)\b/i.test(l);
  for (const l of lines) {
    const n = nums(l), ht = isHT(l);
    if (n.length <= 1 && /(\bvs\b|\bv\b|melawan|–|—|\s-\s)/i.test(l)) {
      const p = l.split(/\s*(?:\bvs\b|\bv\b|melawan|–|—|\s-\s)\s*/i).filter(Boolean);
      if (p.length === 2) { raw.home = p[0].trim(); raw.away = p[1].trim(); continue; }
    }
    // LINEUP (status pemain) — FAKTA; dampak ke read dihitung di applyLineup (INFERENSI).
    if (/(favorit|fav\b|jagoan|unggulan)/i.test(l) && /(cadangan|bench|absen|cedera|istirahat|\bout\b|rotasi|diistirahatkan)/i.test(l)) {
      const lu = raw.lineup || (raw.lineup = { favKeyOut: false, dogStarIn: false, dogPark: false, notes: [] }); lu.favKeyOut = true; lu.notes.push(l); continue;
    }
    if (/(underdog|undrdog|kuda hitam|tim lemah|non.?favorit)/i.test(l) && /(starter|\bstart\b|\bmain\b|turun|fit|comeback)/i.test(l)) {
      const lu = raw.lineup || (raw.lineup = { favKeyOut: false, dogStarIn: false, dogPark: false, notes: [] }); lu.dogStarIn = true; lu.notes.push(l); continue;
    }
    if (/(underdog|undrdog|tim lemah)/i.test(l) && /(parkir|bertahan|defensif|defensive|\bpark\b|5-?4-?1|4-?5-?1|5-?3-?2|low.?block|grebek)/i.test(l)) {
      const lu = raw.lineup || (raw.lineup = { favKeyOut: false, dogStarIn: false, dogPark: false, notes: [] }); lu.dogPark = true; lu.notes.push(l); continue;
    }
    if (/(1\s*x\s*2|\bml\b|match\s*win|menang)/i.test(l) && !/hand|spread|voor|over|under|total|corner|card|kartu|draw|seri/i.test(l)) {
      if (n.length >= 3) raw.win = noVig3(n[0], n[1], n[2]); else warnings.push(`1X2 perlu 3 angka: "${l}"`);
    } else if (/(draw|seri)/i.test(l) && ht) {
      if (n.length) raw.drawHT = n[n.length - 1]; else warnings.push(`Draw HT perlu 1 angka: "${l}"`);
    } else if (/(asian\s*hand|handicap|spread|\bah\b|voor)/i.test(l)) {
      const m = mk(n); if (m) raw[ht ? 'ahHT' : 'ah'] = m; else warnings.push(`AH${ht ? ' HT' : ''} perlu garis+2 harga: "${l}"`);
    } else if (/(over|under|total|\bo\/?u\b|\bou\b)/i.test(l) && !/corner/i.test(l)) {
      const m = mk(n); if (m) raw[ht ? 'ouHT' : 'ou'] = m; else warnings.push(`OU${ht ? ' HT' : ''} perlu garis+2 harga: "${l}"`);
    } else if (/(corner|pojok)/i.test(l)) {
      const m = mk(n); if (m) raw[ht ? 'cornerHT' : 'corner'] = m; else warnings.push(`Corner perlu garis+2 harga: "${l}"`);
    } else if (/(card|kartu|booking)/i.test(l)) {
      const m = mk(n); if (m) raw.card = m;
    }
  }
  const have = ['ah', 'ou', 'ahHT', 'ouHT', 'corner', 'cornerHT', 'card'].filter(k => raw[k]);
  if (!raw.ah && !raw.ou) warnings.push('Tidak menemukan AH/OU utama — cek format baris.');
  const fmtMk = (k, nm) => raw[k] ? `${nm}: garis ${raw[k].line.now}, harga ${raw[k].nowHome} / ${raw[k].nowAway}` : null;
  const parsedView = [`Laga: ${raw.home} vs ${raw.away}`,
    fmtMk('ah', 'AH gol'), fmtMk('ou', 'O/U gol'), fmtMk('ahHT', 'AH babak 1'), fmtMk('ouHT', 'O/U babak 1'),
    fmtMk('corner', 'Corner'), fmtMk('cornerHT', 'Corner B1'), fmtMk('card', 'Kartu'),
    raw.win ? `1X2 de-vig: ${pct(raw.win.home)}/${pct(raw.win.draw)}/${pct(raw.win.away)}` : null,
    raw.drawHT != null ? `Harga Draw HT ASLI: ${raw.drawHT} → GANTIKAN proxy inferensi` : null,
    raw.lineup ? `Lineup (fakta): ${[raw.lineup.favKeyOut ? 'striker favorit cadangan' : null, raw.lineup.dogStarIn ? 'bintang underdog starter' : null, raw.lineup.dogPark ? 'underdog parkir/bertahan' : null].filter(Boolean).join('; ')}` : null,
  ].filter(Boolean);
  return { ok: have.length > 0, raw, parsedView, warnings };
}

module.exports = {
  // matematika & settlement
  hkToDecimal, num, pct, pick, parseScore, twoWayMargin, isQuarter, settleAH, settleOU, noVigProb, noVig3, movement,
  // analisis
  NORMAL_MARGIN, gradeMarket, computeDivergence, buildMarket, computeDirection, movePhrase, matchGuidance,
  indoHandicap, strengthWord, generateRead, matchVerdict, sideLabel, hardenSide, deriveConclusion,
  honestSignals, scenario, scenarioRead, runDetectors, crossMarket, gradeMatch, buildReport, summarize, adaptSnap, adaptEntry, updateHist, snapFromMatch, analyzeMatch,
  // normalisasi sumber
  bookArr, marketEntries, entryLine, entrySides, pickMainLine, pickAtLine, emptyMarket, buildLiveMarket, normalizeOddsApiIo,
  parseManual,
};
