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
    holds = `Bandar pegang: ${favName} ${strengthWord(Math.abs(L || 0))} (garis ${indoHandicap(L)}).` +
      (favP != null ? ` Tanpa potongan: peluang ${favName} ~${pct(favP)}% vs ${dogName}/seri ~${pct(1 - favP)}%.` : '');
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
//  HISTORY (perjalanan garis antar-waktu) — murni: terima objek hist, tak baca file.
// =====================================================================
function updateHistory(hist, match) {
  const id = match.id;
  const snap = { t: Date.now(), ahLine: match.markets.ah.line.now, ouLine: match.markets.ou.line.now,
    ahH: match.markets.ah.nowHome, ahA: match.markets.ah.nowAway,
    ouO: match.markets.ou.nowHome, ouU: match.markets.ou.nowAway };
  if (!hist[id]) hist[id] = [];
  const last = hist[id][hist[id].length - 1];
  const changed = !last || last.ahLine !== snap.ahLine || last.ouLine !== snap.ouLine ||
    last.ahH !== snap.ahH || last.ahA !== snap.ahA || last.ouO !== snap.ouO || last.ouU !== snap.ouU;
  if (changed) hist[id].push(snap);
  if (hist[id].length > 60) hist[id] = hist[id].slice(-60);
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
  if (isLive && hist && hist[raw.id] && hist[raw.id].length) {
    const snaps = hist[raw.id];
    const saneAh = (s, nowL) =>
      s && s.ahLine != null && s.ahH != null && s.ahA != null &&
      !(Math.abs(s.ahLine) >= 1.5 && Math.abs(s.ahH - s.ahA) < 0.2) &&
      (nowL == null || Math.abs(s.ahLine - nowL) <= 1.5);
    const saneOu = (s, nowL) =>
      s && s.ouLine != null && s.ouO != null && s.ouU != null &&
      (nowL == null || Math.abs(s.ouLine - nowL) <= 1.0);
    if (raw.ah && raw.ah.line.open === raw.ah.line.now) {
      const h = snaps.find(s => saneAh(s, raw.ah.line.now));
      if (h) { raw.ah.line.open = h.ahLine; raw.ah.openHome = h.ahH; raw.ah.openAway = h.ahA; }
    }
    if (raw.ou && raw.ou.line.open === raw.ou.line.now) {
      const h = snaps.find(s => saneOu(s, raw.ou.line.now));
      if (h) { raw.ou.line.open = h.ouLine; raw.ou.openHome = h.ouO; raw.ou.openAway = h.ouU; }
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
  const dirTypes = { ah: 'ah', ou: 'ou', corner: 'corner', cornerHT: 'cornerHT', card: 'card' };
  for (const k of Object.keys(dirTypes)) if (markets[k]) markets[k].direction = computeDirection(markets[k], dirTypes[k], raw.home, raw.away);
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
function normalizeOddsApiIo(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const ev of events) {
    const sb = bookArr(ev, 'Sbobet'), pb = bookArr(ev, 'Bet365');
    const sbSpread = marketEntries(sb, ['Spread', 'Asian Handicap']);
    const pbSpread = marketEntries(pb, ['Spread', 'Asian Handicap']);
    const sbTotals = marketEntries(sb, ['Totals', 'Over/Under']);
    const pbTotals = marketEntries(pb, ['Totals', 'Over/Under']);
    const sbCorner = marketEntries(sb, ['Totals']);
    const sbCornerHT = marketEntries(sb, ['Totals HT']);
    let ah;
    if (pickMainLine(sbSpread, -6, 6)) ah = buildLiveMarket(sbSpread, pbSpread, -6, 6);
    else ah = buildLiveMarket(pbSpread, sbSpread, -6, 6);
    let ou;
    if (pickMainLine(sbTotals, 0.5, 5.5)) ou = buildLiveMarket(sbTotals, pbTotals, 0.5, 5.5);
    else ou = buildLiveMarket(pbTotals, sbTotals, 0.5, 5.5);
    if ((ah.nowHome == null) && (ou.nowHome == null)) continue;
    const corner = buildLiveMarket(sbCorner, null, 7, 16);
    const cornerHT = buildLiveMarket(sbCornerHT, null, 3.5, 9);
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

module.exports = {
  // matematika & settlement
  hkToDecimal, num, pct, pick, parseScore, twoWayMargin, isQuarter, settleAH, settleOU, noVigProb, noVig3, movement,
  // analisis
  NORMAL_MARGIN, gradeMarket, computeDivergence, buildMarket, computeDirection, movePhrase, matchGuidance,
  indoHandicap, strengthWord, generateRead, matchVerdict, sideLabel, hardenSide, deriveConclusion,
  updateHistory, analyzeMatch,
  // normalisasi sumber
  bookArr, marketEntries, entryLine, entrySides, pickMainLine, pickAtLine, emptyMarket, buildLiveMarket, normalizeOddsApiIo,
};
