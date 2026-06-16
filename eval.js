#!/usr/bin/env node
/*
 * eval.js — Bukti bahwa "otak" Lensa Bandar benar membaca, bukan asal warna.
 * Memberi skenario terkontrol, lalu memastikan verdict & sinyalnya tepat.
 * Jalankan: node eval.js
 */
'use strict';
const A = require('./fetch-odds.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m' + (detail ? '  → ' + detail : '')); }
}

// Pembantu: bentuk satu pasar.
function mkt(line, oh, oa, nh, na, pub) {
  return { line: { open: line, now: line }, openHome: oh, openAway: oa, nowHome: nh, nowAway: na, pub: pub || null };
}
function mktMove(open, now, oh, oa, nh, na, pub) {
  return { line: { open: open, now: now }, openHome: oh, openAway: oa, nowHome: nh, nowAway: na, pub: pub || null };
}
const cleanCorner = mkt(9, 0.9, 0.9, 0.9, 0.9);
const cleanCard = mkt(4.5, 0.85, 0.85, 0.85, 0.85);
function match(id, home, away, ah, ou) {
  return A.analyzeMatch({ id, home, away, ah, ou, corner: cleanCorner, card: cleanCard }, null);
}

console.log('\n── 1. Jebakan favorit klasik (garis kecil + water mengeras + umpan publik) ──');
{
  const m = match('T1', 'Portugal', 'Belanda',
    mkt(-0.25, 0.95, 0.95, 0.84, 1.06, { line: -0.25, home: 0.97, away: 0.93 }),
    mkt(2.5, 0.93, 0.97, 0.93, 0.97));
  check('verdict = MERAH', m.verdict.light === 'red', m.verdict.light);
  check('verdict menyebut "Jebakan favorit"', /Jebakan favorit/i.test(m.verdict.text), m.verdict.text);
  check('AH menandai bayaran dikecilkan/menumpuk', /dikecilkan|menumpuk/i.test(m.markets.ah.read.signal));
  check('AH menandai umpan publik (Bet365)', /Bet365/i.test(m.markets.ah.read.signal));
}

console.log('\n── 2. Laga bersih (tenang, simetris, tanpa gerakan) ──');
{
  const m = match('T2', 'Kanada', 'Maroko',
    mkt(0.5, 0.93, 0.97, 0.93, 0.97, { line: 0.5, home: 0.93, away: 0.97 }),
    mkt(2.25, 0.94, 0.96, 0.94, 0.96, { line: 2.25, home: 0.94, away: 0.96 }));
  check('verdict = HIJAU', m.verdict.light === 'green', m.verdict.light);
  check('AH aman', /Aman/i.test(m.markets.ah.read.signal));
  check('tidak ada false-alarm divergence', m.markets.ah.divergence === null);
}

console.log('\n── 3. Steam move sharp (garis melebar besar + water mengeras) ──');
{
  const m = match('T3', 'Brasil', 'Serbia',
    mktMove(-1.0, -1.25, 0.88, 1.02, 0.78, 1.12, { line: -1.25, home: 0.92, away: 1.00 }),
    mkt(2.5, 0.93, 0.97, 0.93, 0.97));
  check('verdict = MERAH', m.verdict.light === 'red', m.verdict.light);
  check('BUKAN dilabeli jebakan favorit (garis sudah besar)', !/Jebakan favorit/i.test(m.verdict.text), m.verdict.text);
  check('AH catat garis bergeser (di tech/angka mentah)', /berges/i.test((m.markets.ah.tech || []).join(' ')));
  check('AH lampu merah dari tanda jebakan nyata', m.markets.ah.light === 'red', m.markets.ah.light);
}

console.log('\n── 4. Divergence saja (tanpa water move) tetap kebaca ──');
{
  const m = match('T4', 'Spanyol', 'Jepang',
    mkt(-0.25, 0.92, 0.98, 0.92, 0.98, { line: -0.25, home: 1.02, away: 0.88 }), // publik bayar jauh lebih di rumah
    mkt(2.5, 0.94, 0.96, 0.94, 0.96));
  check('divergence terdeteksi', m.markets.ah.divergence !== null);
  check('umpan ke sisi rumah (favorit)', m.markets.ah.divergence && m.markets.ah.divergence.side === 'home');
  check('verdict = MERAH (jebakan favorit via divergence)', m.verdict.light === 'red', m.verdict.light);
}

console.log('\n── 5. Umpan Over (total naik + water Over mengeras) ──');
{
  const m = match('T5', 'Jerman', 'Brasil',
    mkt(0, 0.95, 0.95, 0.95, 0.95),
    mktMove(3.0, 3.5, 0.96, 0.94, 0.86, 1.04)); // Over (home) mengeras 0.96→0.86
  check('OU = kuning/merah', m.markets.ou.light !== 'green', m.markets.ou.light);
  check('OU menandai gerakan/bayaran', /berges|dikecilkan|menumpuk/i.test(m.markets.ou.read.signal));
}

console.log('\n── 6. Sanity matematika ──');
{
  check('margin AH ~2.5% (0.92/0.98)', within(A.twoWayMargin(0.92, 0.98), 2.0, 3.5), String(A.twoWayMargin(0.92, 0.98)));
  check('margin Kartu ~8% (0.85/0.85)', A.twoWayMargin(0.85, 0.85) > 7, String(A.twoWayMargin(0.85, 0.85)));
  const p = A.noVigProb(0.95, 0.95);
  check('peluang simetris ~50/50', Math.abs(p.home - 0.5) < 0.01);
  check('peluang berjumlah 1', Math.abs(p.home + p.away - 1) < 1e-9);
  check('handicap −0.25 → "−1/4"', A.indoHandicap(-0.25) === '−1/4', A.indoHandicap(-0.25));
  check('handicap −1.75 → "−1 3/4"', A.indoHandicap(-1.75) === '−1 3/4', A.indoHandicap(-1.75));
  check('handicap +0.5 → "+1/2"', A.indoHandicap(0.5) === '+1/2', A.indoHandicap(0.5));
}

console.log('\n── 7. "Statistik bandar" tertulis jelas ──');
{
  const m = match('T7', 'Argentina', 'Korea',
    mkt(-1.0, 0.90, 1.00, 0.90, 1.00), mkt(2.5, 0.95, 0.95, 0.95, 0.95));
  check('AH berisi "Bandar pegang"', /Bandar pegang/.test(m.markets.ah.read.holds));
  check('AH sebut peluang %', /%/.test(m.markets.ah.read.holds));
  check('OU sebut perkiraan gol', /perkiraan ~2.5 gol/.test(m.markets.ou.read.holds), m.markets.ou.read.holds);
}

console.log('\n── 8. Kesimpulan "keuntungan bandar terkonsentrasi di sini" ──');
{
  const trap = match('T8a', 'Portugal', 'Belanda',
    mkt(-0.25, 0.95, 0.95, 0.84, 1.06, { line: -0.25, home: 0.97, away: 0.93 }),
    mkt(2.5, 0.93, 0.97, 0.93, 0.97));
  check('laga jebakan → conclusion.trapped = true', trap.conclusion.trapped === true);
  check('headline tunjuk sisi untung bandar (Portugal)', /Portugal/.test(trap.conclusion.headline), trap.conclusion.headline);
  check('headline beri anotasi favorit + garis', /favorit, garis −1\/4/.test(trap.conclusion.headline), trap.conclusion.headline);

  const clean = match('T8b', 'Kanada', 'Maroko',
    mkt(0.5, 0.93, 0.97, 0.93, 0.97, { line: 0.5, home: 0.93, away: 0.97 }),
    mkt(2.25, 0.94, 0.96, 0.94, 0.96, { line: 2.25, home: 0.94, away: 0.96 }));
  check('laga bersih → conclusion.trapped = false', clean.conclusion.trapped === false);

  const over = match('T8c', 'Jerman', 'Brasil',
    mkt(0, 0.95, 0.95, 0.95, 0.95),
    mktMove(3.0, 3.5, 0.96, 0.94, 0.86, 1.04));
  check('umpan Over → headline tunjuk "Over"', /Over/.test(over.conclusion.headline), over.conclusion.headline);
}

console.log('\n── 9. Parser format resmi odds-api.io (Sbobet + Bet365) ──');
{
  // Bentuk persis dari docs.odds-api.io/guides/fetching-odds
  const sample = [{
    id: 555, home: 'Manchester United', away: 'Liverpool', date: '2026-06-20T15:00:00Z', status: 'pending',
    league: { name: 'FIFA World Cup' },
    bookmakers: {
      Sbobet: [
        { name: 'ML', odds: [{ home: '2.10', draw: '3.40', away: '3.20' }] },
        { name: 'Asian Handicap', odds: [{ hdp: -0.5, home: '1.95', away: '1.85' }] },
        { name: 'Over/Under', odds: [{ max: 2.5, over: '1.90', under: '1.90' }] },
      ],
      Bet365: [
        { name: 'Asian Handicap', odds: [{ hdp: -0.5, home: '2.02', away: '1.80' }] },
        { name: 'Over/Under', odds: [{ max: 2.5, over: '1.95', under: '1.86' }] },
      ],
    },
  }];
  const norm = A.normalizeOddsApiIo(sample);
  check('hasil 1 laga', norm.length === 1, String(norm.length));
  const r = norm[0];
  check('home/away terbaca', r.home === 'Manchester United' && r.away === 'Liverpool');
  check('AH Sbobet hdp/odds terbaca', r.ah.line.now === -0.5 && r.ah.nowHome === 1.95 && r.ah.nowAway === 1.85, JSON.stringify(r.ah));
  check('AH publik Bet365 terbaca', r.ah.pub && r.ah.pub.home === 2.02);
  check('O/U max→line, over/under terbaca', r.ou.line.now === 2.5 && r.ou.nowHome === 1.90 && r.ou.nowAway === 1.90);
  check('corner/kartu kosong (free tier)', r.corner.nowHome === null && r.card.nowHome === null);
  // Pastikan tembus sampai analisis (kalimat "Bandar pegang" + divergence Bet365 lebih bagus di home).
  const am = A.analyzeMatch(r, null, false);
  check('analisis hasilkan "Bandar pegang"', /Bandar pegang/.test(am.markets.ah.read.holds), am.markets.ah.read.holds);
  check('divergence menandai umpan publik di Man Utd', am.markets.ah.divergence && am.markets.ah.divergence.side === 'home');
}

console.log('\n── 10. Mapping market BENAR + HT (Spread/Totals HT) + bidak jujur ──');
{
  // Struktur SBOBET asli (dikonfirmasi dari sampel live France–Senegal).
  const sample = [{
    id: 777, home: 'France', away: 'Senegal', date: '2026-06-11T19:00:00Z', league: { name: 'FIFA World Cup' },
    bookmakers: {
      Sbobet: [
        { name: 'ML', odds: [{ home: '1.46', draw: '4.46', away: '6.90' }] },
        { name: 'Spread', odds: [{ hdp: -1.5, home: '2.42', away: '1.64' }, { hdp: -1.25, home: '2.08', away: '1.86' }] },
        { name: 'Totals', odds: [{ hdp: 2.75, over: '2.00', under: '1.92' }, { hdp: 2.25, over: '1.58', under: '2.51' }] },
        { name: 'Spread HT', odds: [{ hdp: -0.75, home: '2.40', away: '1.63' }, { hdp: -0.5, home: '1.99', away: '1.93' }] },
        { name: 'Totals HT', odds: [{ hdp: 1, over: '1.78', under: '2.13' }, { hdp: 1.25, over: '2.21', under: '1.72' }] },
        { name: 'Corners Totals', odds: [{ hdp: 9.5, over: '1.87', under: '1.95' }, { hdp: 9, over: '1.67', under: '2.17' }] },
        { name: 'Corners Totals HT', odds: [{ hdp: 4.5, over: '1.87', under: '1.95' }, { hdp: 4, over: '1.68', under: '2.16' }] },
        { name: 'Bookings Totals', odds: [{ hdp: 3.5, over: '1.92', under: '1.90' }, { hdp: 3.25, over: '1.64', under: '2.21' }] },
      ],
    },
  }];
  const r = A.normalizeOddsApiIo(sample)[0];
  const m = A.analyzeMatch(r, null, false);
  check('AH gol (Spread) = -1.25', r.ah.line.now === -1.25, String(r.ah.line.now));
  check('O/U GOL dari "Totals" = 2.75 (bukan corner!)', r.ou.line.now === 2.75, String(r.ou.line.now));
  check('AH BABAK 1 (Spread HT) = -0.5', r.ahHT.line.now === -0.5, String(r.ahHT.line.now));
  check('O/U BABAK 1 gol (Totals HT) = 1', r.ouHT.line.now === 1, String(r.ouHT.line.now));
  check('Corner FT dari "Corners Totals" = 9.5', r.corner.line.now === 9.5, String(r.corner.line.now));
  check('Corner B1 dari "Corners Totals HT" = 4.5', r.cornerHT.line.now === 4.5, String(r.cornerHT.line.now));
  check('Kartu dari "Bookings Totals" = 3.5', r.card.line.now === 3.5, String(r.card.line.now));
  check('1X2 FT dari ML (home favorit)', m.win && m.win.home > m.win.away, JSON.stringify(m.win));
  check('market HT terbangun (label + de-vig)', m.markets.ahHT.lineDisplay != null && m.markets.ouHT.probHome != null);
  check('tidak ada "null" di kalimat manapun', !/~null|Over null/.test(JSON.stringify(m.markets)), 'ada null');
  // BIDAK JUJUR: total HT rendah (1) + voor HT ~imbang (-0.5) + corner moderat (9.5).
  const h = m.honest || [];
  check('bidak jujur: ht_low_scoring aktif', h.some(s => s.key === 'ht_low_scoring' && s.aktif), JSON.stringify(h.map(s=>s.key)));
  check('bidak jujur: controlled_game aktif', h.some(s => s.key === 'controlled_game'), JSON.stringify(h.map(s=>s.key)));
  check('bidak jujur: alasan BERISI (bukan kosong)', h.length > 0 && h.every(s => s.alasan && s.alasan.length > 20), JSON.stringify(h.map(s=>s.alasan&&s.alasan.length)));
}

console.log('\n── 11. Status LIVE terbawa ke output ──');
{
  const liveMatch = A.analyzeMatch({ id: 'L1', home: 'A', away: 'B', status: 'live',
    ah: mkt(-0.5, 0.95, 0.95, 0.95, 0.95), ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95), corner: cleanCorner, card: cleanCard }, null, false);
  check('status live → m.live = true', liveMatch.live === true, String(liveMatch.live));
  const pend = A.analyzeMatch({ id: 'P1', home: 'A', away: 'B',
    ah: mkt(-0.5, 0.95, 0.95, 0.95, 0.95), ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95), corner: cleanCorner, card: cleanCard }, null, false);
  check('tanpa status → m.live = false', pend.live === false, String(pend.live));
}

console.log('\n── 12. Arah Bandar (direction) + persentase + guidance ──');
{
  // AH garis melebar -1.0→-1.25 + water mengeras home → arah ke home.
  const m = A.analyzeMatch({ id: 'A1', home: 'Brasil', away: 'Serbia',
    ah: mktMove(-1.0, -1.25, 0.88, 1.02, 0.78, 1.12), ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95),
    corner: cleanCorner, card: cleanCard }, null, true);
  check('AH direction.side = home', m.markets.ah.direction.side === 'home', JSON.stringify(m.markets.ah.direction));
  check('AH direction.label = Brasil', m.markets.ah.direction.label === 'Brasil');
  check('guidance.moved = true', m.guidance.moved === true);
  check('guidance.primary = Brasil', m.guidance.primary === 'Brasil', m.guidance.primary);
  check('guidance.narrative menyebut Brasil', /Brasil/.test(m.guidance.narrative || ''), m.guidance.narrative);
  check('persentase no-vig terisi (probHome)', m.markets.ah.probHome != null && m.markets.ah.probHome > 0.5);
  check('probHome+probAway = 1', Math.abs(m.markets.ah.probHome + m.markets.ah.probAway - 1) < 1e-3);

  const clean = A.analyzeMatch({ id: 'A2', home: 'X', away: 'Y',
    ah: mkt(-0.25, 0.95, 0.95, 0.95, 0.95), ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95), corner: cleanCorner, card: cleanCard }, null, true);
  check('laga tanpa gerakan → guidance.moved = false', clean.guidance.moved === false);
  check('narrative idle (null)', clean.guidance.narrative === null);
}

console.log('\n── 13. History v2: migrasi back-compat + open + high/low ──');
{
  // Format LAMA (array of {ahLine,ahH,ahA,ouLine,ouO,ouU}).
  const oldM1 = [
    { t: 1, ahLine: -1.0, ahH: 0.95, ahA: 0.95, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
    { t: 2, ahLine: -0.75, ahH: 0.92, ahA: 0.98, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
  ];
  // M2 punya snap RACUN (-6 imbang) lalu garis benar -3.5 (gap juice wajar 0.20).
  const oldM2 = [
    { t: 1, ahLine: -6, ahH: 1.88, ahA: 1.92, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
    { t: 2, ahLine: -3.5, ahH: 1.90, ahA: 2.10, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
  ];
  const e1 = A.adaptEntry(oldM1);
  check('migrasi → v2 + snaps array', e1.v === 2 && Array.isArray(e1.snaps), JSON.stringify(e1).slice(0, 60));
  check('snap lama kebaca (ah.l)', e1.snaps[0].ah && e1.snaps[0].ah.l === -1.0, JSON.stringify(e1.snaps[0]));
  check('OPEN = snap pertama waras (-1.0)', e1.open && e1.open.ah.l === -1.0, JSON.stringify(e1.open && e1.open.ah));
  check('high/low AH terisi (lo -1, hi -0.75)', e1.hl.ah && e1.hl.ah.lineLo === -1.0 && e1.hl.ah.lineHi === -0.75, JSON.stringify(e1.hl.ah));
  const e2 = A.adaptEntry(oldM2);
  check('OPEN tolak snap racun -6 (pilih -3.5)', e2.open && e2.open.ah.l === -3.5, JSON.stringify(e2.open && e2.open.ah));

  // 3A: voor BESAR dengan harga IMBANG harus LOLOS sbg open (jangan di-skip karena gap kecil).
  // Snap pembukaan -3.5 @1.95/1.95 (imbang) lalu -3.25 @1.80/2.20 — open HARUS -3.5, bukan -3.25.
  const e3 = A.adaptEntry([
    { t: 1, ahLine: -3.5, ahH: 1.95, ahA: 1.95, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
    { t: 2, ahLine: -3.25, ahH: 1.80, ahA: 2.20, ouLine: 2.5, ouO: 0.95, ouU: 0.95 },
  ]);
  check('voor besar imbang -3.5 @1.95/1.95 LOLOS sbg open (bukan di-skip ke -3.25)', e3.open && e3.open.ah.l === -3.5, JSON.stringify(e3.open && e3.open.ah));

  // analyzeMatch pakai hist LAMA → baseline open benar, TANPA pergerakan palsu, + migrasi in-place.
  const hist = { M2: JSON.parse(JSON.stringify(oldM2)) };
  const raw = { id: 'M2', home: 'A', away: 'B',
    ah: { line: { open: -3.5, now: -3.5 }, openHome: 1.90, openAway: 2.10, nowHome: 1.90, nowAway: 2.10 },
    ou: { line: { open: 2.5, now: 2.5 }, openHome: 0.95, openAway: 0.95, nowHome: 0.95, nowAway: 0.95 },
    corner: cleanCorner, card: cleanCard };
  const am = A.analyzeMatch(raw, hist, true);
  check('backfill open AH = -3.5 (bukan -6 racun)', am.markets.ah.line.open === -3.5, String(am.markets.ah.line.open));
  check('tak ada pergerakan palsu (lineMove flat)', am.markets.ah.lineMove.dir === 'flat', JSON.stringify(am.markets.ah.lineMove));
  check('hist M2 termigrasi v2 in-place', hist.M2 && hist.M2.v === 2, typeof hist.M2);
  check('out.history bawa high/low', !!(am.history && am.history.hl && am.history.hl.ah));
  // snapshot generik rekam SEMUA market tersambung (forward-compat market HT nanti).
  const snap = A.snapFromMatch(am);
  check('snapFromMatch rekam ah+ou+corner', !!(snap.ah && snap.ou && snap.corner), Object.keys(snap).join(','));
}

console.log('\n── 14. Detektor berlabel (3C) — tiap pola aktif + alasan BERISI ──');
{
  const KO = '2026-12-01T00:00:00Z', near = { nowMs: Date.parse(KO) - 10 * 60000 };
  const base = (ah, ou, extra) => Object.assign({ id: 'X', home: 'Argentina', away: 'Aljazair', ah, ou: ou || mkt(2.5, 0.95, 0.95, 0.95, 0.95), corner: cleanCorner, card: cleanCard }, extra || {});
  const dets = (raw, ctx) => (A.analyzeMatch(raw, null, true, ctx).detectors || []);
  const has = (ds, key) => ds.find(d => d.key === key);

  let d = has(dets(base(mkt(-0.25, 0.95, 0.95, 0.84, 1.06, { line: -0.25, home: 0.97, away: 0.93 }))), 'fake_favorite');
  check('fake_favorite aktif + alasan berisi', !!(d && d.alasan.length > 25), JSON.stringify(d && d.alasan.slice(0, 70)));

  d = has(dets(base(mkt(-2.5, 1.95, 1.95, 1.95, 1.95))), 'margin_trap');
  check('margin_trap aktif + alasan sebut COVER%/skor modal', !!(d && /COVER|cover/.test(d.alasan) && /gol/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 80)));

  d = has(dets(base(mkt(0, 0.95, 0.95, 0.95, 0.95), mktMove(2.5, 2.75, 0.95, 0.95, 0.86, 1.04))), 'total_trap');
  check('total_trap aktif + alasan sebut Over', !!(d && /Over/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 70)));

  d = has(dets(base(mkt(-1, 0.95, 0.95, 0.95, 0.95), null, { kickoff: KO }), near), 'line_freeze');
  check('line_freeze aktif (<30mnt, garis diam)', !!(d && /membekukan/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 70)));

  d = has(dets(base(mktMove(-1, -1.25, 0.95, 0.95, 0.95, 0.95), null, { kickoff: KO }), near), 'late_steam');
  check('late_steam aktif (<30mnt, voor lompat)', !!(d && /menit akhir/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 70)));

  d = has(dets(base(mktMove(-1, -1, 0.85, 1.05, 0.93, 0.97))), 'value_compression');
  check('value_compression aktif (selisih harga menyempit)', !!(d && /menyempit/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 70)));

  d = has(dets(base(mktMove(-1, -0.5, 0.90, 1.00, 0.90, 1.00))), 'reverse_line_movement');
  check('reverse_line_movement aktif + alasan "melawan arah publik"', !!(d && /melawan arah publik/.test(d.alasan)), JSON.stringify(d && d.alasan.slice(0, 90)));
}

console.log('\n── 15. Grade A/B/C/D + cross-market (3D) ──');
{
  const mkRaw = (o) => Object.assign({ id: 'G', home: 'Brasil', away: 'Serbia', corner: cleanCorner, card: cleanCard, ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95), ah: mkt(0, 0.95, 0.95, 0.95, 0.95) }, o);
  // BENTROK tempo: O/U → Over, Corner → Under.
  const conflict = A.analyzeMatch(mkRaw({
    ou: mktMove(2.5, 2.75, 0.95, 0.95, 0.86, 1.04),
    corner: mktMove(9, 9, 0.90, 0.90, 0.95, 0.83),
  }), null, true);
  check('cross-market BENTROK terdeteksi + dijelaskan', conflict.grade.conflict === true && /BENTROK/.test(conflict.grade.crossNote), JSON.stringify(conflict.grade.crossNote));
  check('bentrok → grade turun ke C/D', conflict.grade.grade === 'C' || conflict.grade.grade === 'D', conflict.grade.grade);
  // QUIET → grade D (jangan paksa baca).
  const quiet = A.analyzeMatch(mkRaw({ ah: mkt(-0.5, 0.95, 0.95, 0.95, 0.95) }), null, true);
  check('laga sepi tanpa sinyal → grade D', quiet.grade.grade === 'D', quiet.grade.grade);
  check('grade D bermakna bising/hindari', /bising|hindari/.test(quiet.grade.meaning), quiet.grade.meaning);
  // BIDAK JUJUR (bobot ×2) mengangkat grade.
  const honest = A.analyzeMatch(mkRaw({
    ah: mkt(-1, 0.95, 0.95, 0.95, 0.95), ahHT: mkt(-0.5, 0.95, 0.95, 0.95, 0.95),
    ouHT: mkt(1.0, 0.95, 0.95, 0.95, 0.95), corner: mkt(9.5, 0.9, 0.9, 0.9, 0.9),
  }), null, true);
  check('bidak jujur (HT rendah + corner moderat) → grade A', honest.grade.grade === 'A', honest.grade.grade + ' score=' + honest.grade.score);
  check('grade drivers berisi alasan', honest.grade.drivers.length > 0 && honest.grade.drivers.every(x => x && x.length > 10));
}

console.log('\n── 16. Output template + label FAKTA/INFERENSI/SPEKULASI (3E) ──');
{
  const am = A.analyzeMatch({ id: 'R', home: 'Portugal', away: 'Belanda',
    ah: mkt(-0.25, 0.95, 0.95, 0.84, 1.06, { line: -0.25, home: 0.97, away: 0.93 }),
    ou: mkt(2.5, 0.95, 0.95, 0.95, 0.95), corner: cleanCorner, card: cleanCard }, null, true);
  const r = am.report;
  check('report ada (grade + 3 label)', !!(r && r.fakta && r.inferensi && r.spekulasi), Object.keys(r || {}).join(','));
  check('FAKTA = angka odds (garis/harga)', r.fakta.length > 0 && /garis|harga/.test(r.fakta.join(' ')));
  check('INFERENSI berisi pola/arah', r.inferensi.length > 0 && r.inferensi.join(' ').length > 20);
  check('SPEKULASI dilabeli "Dugaan motif"', r.spekulasi.some(s => /Dugaan motif/.test(s)), JSON.stringify(r.spekulasi).slice(0, 80));
  check('what-confirms & what-invalidates ada', r.confirms.length > 0 && r.invalidates.length > 0);
  check('one-liner "bandar tahan uang di __" terisi', !!(r.tahanUangDi && r.tahanUangDi.length > 2), r.tahanUangDi);
  check('invalidates sebut lineup (untuk Fase 4)', r.invalidates.some(s => /lineup/i.test(s)));
  const sm = A.summarize([am, am]);
  check('summarize bawa gradeA..D + total', sm.total === 2 && ('gradeA' in sm) && ('gradeD' in sm), JSON.stringify(sm));
}

function within(x, lo, hi) { return x != null && x >= lo && x <= hi; }

console.log('\n────────────────────────────');
console.log(`HASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
