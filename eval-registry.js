#!/usr/bin/env node
'use strict';
/*
 * eval-registry.js — suite tes REGISTRY LIGA (Fase 2 multi-liga).
 * Melengkapi eval.js (127 tes WC yang WAJIB tetap hijau — regression zero).
 * Jalankan: node eval-registry.js  (exit 0 = semua lulus)
 */
const fs = require('fs');
const path = require('path');
const R = require('./config/leagues.js');
const E = require('./engine');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + (extra != null ? '  [' + extra + ']' : '') + '\x1b[0m'); }
}

console.log('\n── 1. Struktur registry ──');
check('registry memuat 7 liga', R.LEAGUES.length === 7, R.LEAGUES.length);
check('WC 2026 = entri PERTAMA (default)', R.LEAGUES[0].id === 'wc2026');
check('WC dataStatus VERIFIED', R.LEAGUES[0].dataStatus === 'VERIFIED');
check('liga domestik UNVERIFIED (gate: 0 event saat jeda musim, uji ulang Agustus)',
  ['epl', 'laliga', 'seriea', 'bundesliga', 'ligue1'].every(id => R.getLeague(id).dataStatus === 'UNVERIFIED'));
check('UCL VERIFIED (gate LOLOS 2026-07-14: Sbobet+Bet365 AH/OU/1X2 terisi, 28 event)',
  R.getLeague('ucl').dataStatus === 'VERIFIED');
const REQUIRED = ['id', 'nama', 'apiSportId', 'apiLeagueId', 'season', 'mode', 'cadence', 'kalibrasi', 'dataStatus'];
check('field wajib lengkap di TIAP liga', R.LEAGUES.every(l => REQUIRED.every(k => k in l)));
check('kalibrasi tiap liga punya ambangRout+ambangKetat+readPowerFloor',
  R.LEAGUES.every(l => ['ambangRout', 'ambangKetat', 'readPowerFloor'].every(k => typeof l.kalibrasi[k] === 'number')));
check('mode valid (league|knockout|hybrid)', R.LEAGUES.every(l => ['league', 'knockout', 'hybrid'].includes(l.mode)));

console.log('\n── 2. dataStatus gating + filter liga ──');
const active = R.activeLeagues();
check('activeLeagues() default = wc2026 + ucl (yang lolos gate saja)',
  active.map(l => l.id).sort().join(',') === 'ucl,wc2026', active.map(l => l.id).join(','));
const filter = R.buildEventFilter(active);
const evWC = { league: { name: 'FIFA World Cup' }, status: 'pending' };
const evEPL = { league: { name: 'Premier League', country: 'England' }, status: 'pending' };
const evUCLQ = { league: { name: 'UEFA Champions League Qualification' }, status: 'pending' };
check('filter MENERIMA event World Cup', filter(evWC) === true);
check('filter MENERIMA event kualifikasi UCL (approved + lolos gate)', filter(evUCLQ) === true);
check('filter MENOLAK event EPL selama UNVERIFIED', filter(evEPL) === false);
const filterAll = R.buildEventFilter(R.activeLeagues({ includeUnverified: true }));
check('includeUnverified: filter menerima EPL (preview/tes)', filterAll(evEPL) === true);
check('leagueOf memetakan event EPL → entri epl', (R.leagueOf(evEPL) || {}).id === 'epl');
check('leagueOfName("FIFA World Cup") → wc2026', (R.leagueOfName('FIFA World Cup') || {}).id === 'wc2026');
check('exclude: "AFC Champions League" BUKAN ucl',
  R.eventMatchesLeague({ league: { name: 'AFC Champions League' } }, R.getLeague('ucl')) === false);
check('country: "Serie A" Brasil BUKAN seriea Italia',
  R.eventMatchesLeague({ league: { name: 'Serie A', country: 'Brazil' } }, R.getLeague('seriea')) === false);
check('regex WC registry identik dgn isWC lama (piala dunia cocok)',
  R.eventMatchesLeague({ league: 'Piala Dunia 2026' }, R.getLeague('wc2026')) === true);

console.log('\n── 3. Mode gating (fitur knockout) ──');
check('toQualify DILARANG utk mode league (epl)', R.modeAllows(R.getLeague('epl'), 'toQualify') === false);
check('toQualify BOLEH utk hybrid (wc2026)', R.modeAllows(R.getLeague('wc2026'), 'toQualify') === true);
check('fitur non-knockout boleh utk semua mode', R.modeAllows(R.getLeague('epl'), 'ah') === true);

console.log('\n── 4. Kalibrasi (default = WC, override per liga) ──');
check('DEFAULT_KAL registry == DEFAULT_KAL engine (sinkron)',
  JSON.stringify(R.DEFAULT_KAL) === JSON.stringify(E.DEFAULT_KAL));
check('kalibrasiFor(wc2026) = default WC 2.5/0.75/6.5',
  JSON.stringify(R.kalibrasiFor(R.getLeague('wc2026'))) === JSON.stringify({ ambangRout: 2.5, ambangKetat: 0.75, readPowerFloor: 6.5 }));
check('kalibrasiFor(null) → default (liga tak dikenal aman)',
  JSON.stringify(R.kalibrasiFor(null)) === JSON.stringify(R.DEFAULT_KAL));
check('scenario default: voor 2.5 total 3.5 = rout_pesta', E.scenario(2.5, 3.5).key === 'rout_pesta');
check('scenario override ambangRout 3.0: voor 2.5 BUKAN rout lagi',
  E.scenario(2.5, 3.5, { ambangRout: 3.0, ambangKetat: 0.75, readPowerFloor: 6.5 }).key !== 'rout_pesta');
check('scenario override ambangKetat 1.0: voor 0.9 jadi ketat',
  E.scenario(0.9, 2.4, { ambangRout: 2.5, ambangKetat: 1.0, readPowerFloor: 6.5 }).key === 'ketat'
  && E.scenario(0.9, 2.4).key !== 'ketat');

// analyzeMatch end-to-end: ctx.kalibrasi mengalir sampai scenario+grade.
const mkRaw = () => ({ id: 'K1', home: 'Alpha', away: 'Beta', status: 'pending', kickoff: null,
  ah: { line: { open: -2.5, now: -2.5 }, openHome: 1.95, openAway: 1.95, nowHome: 1.95, nowAway: 1.95, pub: null },
  ou: { line: { open: 3.5, now: 3.5 }, openHome: 1.9, openAway: 1.9, nowHome: 1.9, nowAway: 1.9, pub: null } });
const d1 = E.analyzeMatch(mkRaw(), null, false);
const d2 = E.analyzeMatch(mkRaw(), null, false, { nowMs: Date.now(), kalibrasi: { ambangRout: 3.0 } });
check('analyzeMatch tanpa ctx = perilaku WC (rout_pesta)', d1.scenario.key === 'rout_pesta', d1.scenario.key);
check('analyzeMatch ctx.kalibrasi mengubah skenario', d2.scenario.key !== 'rout_pesta', d2.scenario.key);
check('structural ikut kalibrasi (override < default)', d2.grade.structural < d1.grade.structural,
  d2.grade.structural + ' vs ' + d1.grade.structural);
// readPowerFloor: setup kuat (voor besar + divergence Bet365) → A default; floor 99 → tak mungkin A.
const strong = () => ({ id: 'K2', home: 'Alpha', away: 'Beta', status: 'pending', kickoff: null,
  ah: { line: { open: -2.75, now: -2.75 }, openHome: 1.95, openAway: 1.95, nowHome: 1.95, nowAway: 1.95,
    pub: { line: -2.75, home: 2.05, away: 1.87 } },
  ou: { line: { open: 3.25, now: 3.25 }, openHome: 1.9, openAway: 1.9, nowHome: 1.9, nowAway: 1.9, pub: null } });
const s1 = E.analyzeMatch(strong(), null, false);
const s2 = E.analyzeMatch(strong(), null, false, { nowMs: Date.now(), kalibrasi: { readPowerFloor: 99 } });
check('setup kuat → grade A dgn floor default', s1.grade.grade === 'A', s1.grade.grade + ' score=' + s1.grade.score);
check('readPowerFloor 99 → grade A MUSTAHIL', s2.grade.grade !== 'A', s2.grade.grade);

console.log('\n── 5. Cadence sadar-jadwal ──');
const NOW = Date.now();
const wcOnly = [R.getLeague('wc2026')], eplOnly = [R.getLeague('epl')];
check('WC live → HOT 3 mnt (paritas worker lama)', R.cadenceMsFor(wcOnly, [{ live: true }], NOW) === 3 * 60000);
check('WC KO 2 jam → MED 10 mnt', R.cadenceMsFor(wcOnly, [{ live: false, kickoff: new Date(NOW + 2 * 3600000).toISOString() }], NOW) === 10 * 60000);
check('WC papan kosong → SEPI 20 mnt, TIDAK skip (hybrid)', R.cadenceMsFor(wcOnly, [], NOW) === 20 * 60000);
check('mode league: KO 20 jam (> quietSkip 12j) → SKIP (null)',
  R.cadenceMsFor(eplOnly, [{ live: false, kickoff: new Date(NOW + 20 * 3600000).toISOString() }], NOW) === null);
check('mode league: papan kosong → SKIP (null)', R.cadenceMsFor(eplOnly, [], NOW) === null);
check('mode league: KO 2 jam → MED 10 mnt (bangun lagi)',
  R.cadenceMsFor(eplOnly, [{ live: false, kickoff: new Date(NOW + 2 * 3600000).toISOString() }], NOW) === 10 * 60000);
check('campuran wc+epl: TAK PERNAH skip (ada hybrid)',
  R.cadenceMsFor([R.getLeague('wc2026'), R.getLeague('epl')], [], NOW) === 20 * 60000);

console.log('\n── 6. Prioritas event (live > <3 jam > sisanya) ──');
const evs = [
  { id: 'far', status: 'pending', date: new Date(NOW + 5 * 3600000).toISOString() },
  { id: 'live', status: 'live', date: new Date(NOW - 3600000).toISOString() },
  { id: 'soon', status: 'pending', date: new Date(NOW + 3600000).toISOString() },
];
const pr = R.prioritizeEvents(evs, NOW);
check('urutan: live, <3jam, sisanya', pr.map(e => e.id).join(',') === 'live,soon,far', pr.map(e => e.id).join(','));
check('cap memotong dari prioritas terendah', R.prioritizeEvents(evs, NOW, 2).map(e => e.id).join(',') === 'live,soon');

console.log('\n── 7. Filter TUNGGAL dipakai dua sisi (tutup titik drift, bukti sumber) ──');
const srcFetch = fs.readFileSync(path.join(__dirname, 'fetch-odds.js'), 'utf8');
const srcWorker = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
check('fetch-odds.js memanggil R.buildEventFilter', /R\.buildEventFilter\(/.test(srcFetch));
check('worker.js memanggil R.buildEventFilter', /R\.buildEventFilter\(/.test(srcWorker));
check('regex isWC lama HILANG dari fetch-odds.js', !/world\[ -\]\?cup/.test(srcFetch));
check('regex isWC lama HILANG dari worker.js', !/world\[ -\]\?cup/.test(srcWorker));
check('regex liga hidup HANYA di config/leagues.js',
  /world\[ -\]\?cup/.test(fs.readFileSync(path.join(__dirname, 'config', 'leagues.js'), 'utf8')));
check('worker mengimpor registry', /import R from '\.\/config\/leagues\.js'/.test(srcWorker));
check('fetch-odds me-require registry', /require\('\.\/config\/leagues\.js'\)/.test(srcFetch));

console.log('\n── 8. Rilis: bukti akurasi tertaut & ter-render (4c) ──');
const srcIndex = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
check('index.html memuat link ke uji-akurasi.html', /href="uji-akurasi\.html"/.test(srcIndex));
let uji = null;
try { uji = fs.readFileSync(path.join(__dirname, 'uji-akurasi.html'), 'utf8'); } catch (e) {}
check('uji-akurasi.html ADA (link tidak putus di rilis)', uji != null);
check('menampilkan label jujur "47%" + "koin"', uji != null && uji.includes('47%') && /koin/i.test(uji));
check('menampilkan 52 laga dinilai', uji != null && uji.includes('52'));
const rowCount = uji ? (uji.match(/<pre>([\s\S]*?)<\/pre>/) || ['', ''])[1].trim().split('\n').length : 0;
check('rincian per laga ≥52 baris', rowCount >= 52, rowCount);
check('KEKALAHAN ikut ditampilkan (ada ✗ / publik benar)', uji != null && (uji.includes('✗') || uji.includes('publik benar')));
check('disclaimer "bukan ajakan bertaruh" ada di halaman bukti', uji != null && /bukan ajakan bertaruh/i.test(uji));

console.log('\n── 9. Toggle anonim brand (4a — config, bukan hardcode) ──');
const BR = require('./config/branding.js');
check('default mode PRIBADI: ANONIM=false, label asli', BR.ANONIM === false && BR.LABELS.sharp === 'SBOBET' && BR.LABELS.pub === 'Bet365');
check('payload reference/compare turun dari LABELS', BR.reference === BR.LABELS.sharp && BR.compare.indexOf(BR.LABELS.pub) === 0);
// Engine: narasi divergence ikut label (setter), lalu DIKEMBALIKAN ke default.
const mkDiv = () => ({ nowHome: 1.95, nowAway: 1.95, pub: { home: 2.05, away: 1.87 }, line: { now: -1 } });
const f1 = E.computeDivergence(Object.assign(mkDiv(), { pub: { home: 2.05, away: 1.87, line: -1 } }), 'Alpha', 'Beta');
check('narasi default menyebut Bet365', f1 != null && f1.flag.includes('Bet365'), f1 && f1.flag);
E.setBrandLabels({ sharp: 'Bandar Acuan', pub: 'Bandar Pembanding' });
const f2 = E.computeDivergence(Object.assign(mkDiv(), { pub: { home: 2.05, away: 1.87, line: -1 } }), 'Alpha', 'Beta');
check('setBrandLabels: narasi jadi "Bandar Pembanding" (tanpa Bet365)',
  f2 != null && f2.flag.includes('Bandar Pembanding') && !f2.flag.includes('Bet365'), f2 && f2.flag);
E.setBrandLabels({ sharp: 'SBOBET', pub: 'Bet365' });   // pulihkan default
check('fetch-odds memakai branding (setBrandLabels + BR.reference)',
  /setBrandLabels\(BR\.LABELS\)/.test(srcFetch2()) && /reference:\s*BR\.reference/.test(srcFetch2()));
check('worker memakai branding (setBrandLabels + BR.reference)',
  /setBrandLabels\(BR\.LABELS\)/.test(srcWorker2()) && /reference:BR\.reference/.test(srcWorker2()));
check('UI header brand dinamis dari payload (applyBrand + id brandRef)',
  /applyBrand\(/.test(srcIndex) && /id="brandRef"/.test(srcIndex));
function srcFetch2() { return fs.readFileSync(path.join(__dirname, 'fetch-odds.js'), 'utf8'); }
function srcWorker2() { return fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8'); }

console.log('\n────────────────────────────');
console.log(`HASIL REGISTRY: ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
