#!/usr/bin/env node
/*
 * accuracy-full.js — Akurasi LENGKAP: SEMUA bacaan app vs hasil asli WC2026.
 *
 * Berbeda dgn accuracy.js (yang cuma menilai laga yg sempat di-settle worker = 12 laga),
 * script ini menempelkan SKOR FINAL ASLI (diverifikasi manual dari Wikipedia/ESPN/FIFA,
 * 3-4 Juli 2026) ke SEMUA entri arsip yang punya bacaan app — termasuk 46 laga yg dulu
 * cuma tersimpan placeholder 0-0 karena worker beku 21 Juni.
 *
 * 6 laga DIKECUALIKAN: fixture keliru dari feed odds-api free-tier (pasangan tak pernah
 * terjadi di WC2026 asli — Wales/Serbia tak lolos; sisanya beda grup). Ditandai null.
 *
 * Jalankan: node accuracy-full.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./fetch-odds.js');

// Skor final asli, key = "Home|Away" persis seperti tersimpan di arsip (nama Inggris).
// null = laga tak pernah terjadi (fixture keliru feed) → dikecualikan.
const RESULTS = {
  // ── 12 laga yg sudah ter-settle live (dikonfirmasi cocok dgn Wikipedia) ──
  'Canada|Bosnia and Herzegovina': [1, 1],
  'USA|Paraguay': [4, 1],
  'Qatar|Switzerland': [1, 1],
  'Brazil|Morocco': [1, 1],
  'Haiti|Scotland': [0, 1],
  'Australia|Turkiye': [2, 0],
  'Germany|Curacao': [7, 1],
  'Netherlands|Japan': [2, 2],
  'Ivory Coast|Ecuador': [1, 0],
  'Sweden|Tunisia': [5, 1],
  'Spain|Cape Verde': [0, 0],
  'Belgium|Egypt': [1, 1],
  // ── 40 laga yg dulu pending, skor asli diisi manual ──
  'Saudi Arabia|Uruguay': [1, 1],
  'Iran|New Zealand': [2, 2],
  'France|Senegal': [3, 1],
  'Iraq|Norway': [1, 4],
  'Argentina|Algeria': [3, 0],
  'Austria|Jordan': [3, 1],
  'Portugal|Congo DR': [1, 1],
  'England|Croatia': [4, 2],
  'Ghana|Panama': [1, 0],
  'Uzbekistan|Colombia': [1, 3],
  'Czechia|South Africa': [1, 1],
  'Switzerland|Bosnia and Herzegovina': [4, 1],
  'Canada|Qatar': [6, 0],
  'Mexico|Korea Republic': [1, 0],
  'USA|Australia': [2, 0],
  'Scotland|Morocco': [0, 1],
  'Brazil|Haiti': [3, 0],
  'Turkiye|Paraguay': [0, 1],
  'Netherlands|Sweden': [5, 1],
  'Germany|Ivory Coast': [2, 1],
  'Ecuador|Curacao': [0, 0],
  'Tunisia|Japan': [0, 4],
  'Spain|Saudi Arabia': [4, 0],
  'Belgium|Iran': [0, 0],
  'Uruguay|Cape Verde': [2, 2],
  'New Zealand|Egypt': [1, 3],
  'Argentina|Austria': [2, 0],
  'France|Iraq': [3, 0],
  'Norway|Senegal': [3, 2],
  'Jordan|Algeria': [1, 2],
  'Portugal|Uzbekistan': [5, 0],
  'England|Ghana': [0, 0],
  'Panama|Croatia': [0, 1],
  'Colombia|Congo DR': [1, 0],
  'Switzerland|Canada': [2, 1],
  'Bosnia and Herzegovina|Qatar': [3, 1],
  'Scotland|Brazil': [0, 3],
  'Morocco|Haiti': [4, 2],
  'Czechia|Mexico': [0, 3],
  'South Africa|Korea Republic': [1, 0],
};

// 6 fixture keliru (nama tersimpan dlm Bahasa Indonesia). Dikecualikan eksplisit.
const PHANTOM = new Set([
  'Portugal|Belanda', 'Amerika Serikat|Wales', 'Brasil|Serbia',
  'Jepang|Meksiko', 'Inggris|Iran', 'Kanada|Maroko',
]);

const arch = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'archive.json'), 'utf8'));
const vals = Object.values(arch).filter(e => e.read && e.read.win);

let favTotal = 0, favHit = 0, favDraw = 0;
let trapTotal = 0, trapFadeWin = 0, trapUnits = 0;
let ahTotal = 0, ahWin = 0, ahUnits = 0;      // arah AH (arah=nama tim): sisi condong menang settle?
let ouTotal = 0, ouWin = 0, ouUnits = 0;      // arah OU (arah=Over/Under): tepat?
let excluded = 0;
const rows = [];

for (const e of vals) {
  const key = `${e.home}|${e.away}`;
  if (PHANTOM.has(key)) { excluded++; rows.push(`  ✕ ${e.home} v ${e.away}  · fixture keliru feed (tak pernah terjadi)`); continue; }
  const res = RESULTS[key] || (e.final && e.score && e.score.home != null ? [e.score.home, e.score.away] : null);
  if (!res) { excluded++; rows.push(`  ? ${e.home} v ${e.away}  · hasil tak ditemukan`); continue; }
  const [gh, ga] = res, tot = gh + ga, r = e.read;
  let favTxt = '-', trapTxt = '', ahTxt = '';

  // 1) Favorit 1X2 (sisi win-prob tertinggi) — benar menang?
  if (r.win && r.win.home != null) {
    const favHome = r.win.home >= r.win.away;
    const favName = favHome ? e.home : e.away;
    const won = favHome ? gh > ga : ga > gh;
    const draw = gh === ga;
    favTotal++; if (won) favHit++; if (draw) favDraw++;
    favTxt = favName + (won ? ' ✓menang' : (draw ? ' ~seri' : ' ✗kalah'));
  }

  // 2) Arah app — ahLine tersimpan relatif HOME; settleAH pakai home-line + side.
  if (r.arah) {
    const arahHome = r.arah === e.home, arahAway = r.arah === e.away;
    if ((arahHome || arahAway) && r.ahLine != null) {                 // arah = nama tim → AH
      const u = A.settleAH(r.ahLine, gh, ga, arahHome ? 'home' : 'away');
      if (u != null) { ahTotal++; ahUnits += u; if (u > 0) ahWin++; ahTxt = ` · AH→${r.arah} ${u>0?'+':''}${u}`; }
    } else if (/^(over|under)/i.test(r.arah) && r.ouLine != null) {   // arah = Over/Under → OU
      const side = /over/i.test(r.arah) ? 'over' : 'under';
      const u = A.settleOU(r.ouLine, tot, side);
      if (u != null) { ouTotal++; ouUnits += u; if (u > 0) ouWin++; ahTxt = ` · OU→${r.arah} ${u>0?'+':''}${u}`; }
    }
  }

  // 3) Fade jebakan — kalau app tandai jebakan di sisi X, apakah X KALAH?
  if (r.trapped && r.topPick && r.topPick.line != null) {
    const p = r.topPick; let u = null;
    if (p.market === 'ah') u = A.settleAH(p.line, gh, ga, p.side);
    else if (p.market === 'ou') u = A.settleOU(p.line, tot, p.side === 'home' ? 'over' : 'under');
    if (u != null) {
      trapTotal++; trapUnits += -u; if (u < 0) trapFadeWin++;
      trapTxt = ` · jebakan ${p.market.toUpperCase()} ${u < 0 ? 'KALAH(hindar tepat)' : u > 0 ? 'menang(publik benar)' : 'push'}`;
    }
  }
  rows.push(`  ${e.home} ${gh}-${ga} ${e.away}  · ${favTxt}${ahTxt}${trapTxt}`);
}

console.log('\n════════ AKURASI LENGKAP — SEMUA bacaan app vs hasil asli WC2026 ════════\n');
console.log(rows.join('\n'));
const evaluated = favTotal;
console.log('\n── RINGKASAN ──');
console.log(`Total entri berbacaan: ${vals.length}  |  dinilai: ${evaluated}  |  dikecualikan: ${excluded}${excluded ? ' (fixture keliru/tak ditemukan)' : ' (arsip sudah bersih dari data demo)'}`);
console.log(`\n1) Favorit 1X2 benar menang: ${favHit}/${favTotal} (${Math.round(favHit/favTotal*100)}%)   [seri: ${favDraw}, kalah: ${favTotal-favHit-favDraw}]`);
if (ahTotal) console.log(`2a) Arah AH app tepat (garis handicap, settle menang): ${ahWin}/${ahTotal} (${Math.round(ahWin/ahTotal*100)}%)  ·  P/L unit: ${ahUnits>=0?'+':''}${ahUnits.toFixed(2)}`);
if (ouTotal) console.log(`2b) Arah OU app tepat (Over/Under, settle menang): ${ouWin}/${ouTotal} (${Math.round(ouWin/ouTotal*100)}%)  ·  P/L unit: ${ouUnits>=0?'+':''}${ouUnits.toFixed(2)}`);
if (trapTotal) {
  console.log(`3) "Jebakan" terbukti KALAH (menghindar tepat): ${trapFadeWin}/${trapTotal} (${Math.round(trapFadeWin/trapTotal*100)}%)`);
  console.log(`   P/L "melawan jebakan" (unit): ${trapUnits>=0?'+':''}${trapUnits.toFixed(2)} dari ${trapTotal} laga`);
}
console.log('\nCatatan jujur: taruhan flat 1 unit, tanpa vig/komisi. Corner & kartu tak dinilai (tak terhitung dari skor gol).');

// ── Tulis record markdown permanen ──
const md = [];
md.push('# Akurasi Lengkap — Lensa Bandar vs Hasil Asli WC2026');
md.push('');
md.push('_Semua bacaan app dievaluasi terhadap skor final asli World Cup 2026 (grup, 12–25 Jun 2026).');
md.push('Skor diverifikasi manual dari Wikipedia/ESPN/FIFA (dikumpulkan 4 Jul 2026). Dibuat oleh `accuracy-full.js`._');
md.push('');
md.push('## Ringkasan');
md.push('');
md.push(`- Entri berbacaan: **${vals.length}** — dinilai: **${evaluated}** — dikecualikan: **${excluded}**${excluded ? ' (fixture keliru/tak ditemukan)' : ' (arsip bersih dari data demo)'}`);
md.push(`- **Favorit 1X2 benar menang: ${favHit}/${favTotal} (${Math.round(favHit/favTotal*100)}%)** — seri ${favDraw}, kalah ${favTotal-favHit-favDraw} (cuma ${favTotal-favHit-favDraw} upset)`);
md.push(`- Arah AH (garis handicap) tepat: ${ahWin}/${ahTotal} (${Math.round(ahWin/ahTotal*100)}%) — P/L ${ahUnits>=0?'+':''}${ahUnits.toFixed(2)} unit`);
md.push(`- Arah OU (Over/Under) tepat: ${ouWin}/${ouTotal} (${Math.round(ouWin/ouTotal*100)}%) — P/L ${ouUnits>=0?'+':''}${ouUnits.toFixed(2)} unit`);
md.push(`- "Jebakan" terbukti kalah (fade tepat): ${trapFadeWin}/${trapTotal} (${Math.round(trapFadeWin/trapTotal*100)}%) — P/L melawan jebakan ${trapUnits>=0?'+':''}${trapUnits.toFixed(2)} unit`);
md.push('');
md.push('_Flat 1 unit, tanpa vig/komisi. Corner & kartu tak dinilai._');
md.push('');
md.push('## Per laga');
md.push('');
md.push('```');
md.push(rows.join('\n'));
md.push('```');
fs.writeFileSync(path.join(__dirname, 'docs', 'AKURASI-LENGKAP.md'), md.join('\n'));
console.log('\n📝 Record tersimpan: docs/AKURASI-LENGKAP.md');
