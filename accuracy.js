#!/usr/bin/env node
/*
 * accuracy.js — Backtest JUJUR: bandingkan bacaan app vs hasil asli.
 * Jalankan: node accuracy.js
 *
 * Membaca data/archive.json (terisi otomatis tiap kali fetch-odds.js jalan, saat laga selesai),
 * lalu menghitung: apakah favorit (1X2) benar menang, dan apakah "jebakan" yang kita tandai
 * memang KALAH (artinya menghindar = tepat). Ini bukti untuk menguji tesis kita.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./fetch-odds.js');

// ---------- 1) Uji rumus settlement dulu (biar matematikanya terbukti benar) ----------
let pass = 0, fail = 0;
function ck(name, got, exp) {
  const ok = Math.abs(got - exp) < 1e-9;
  if (ok) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '  (dapat ' + got + ', harusnya ' + exp + ')\x1b[0m'); }
}
console.log('\n── Uji rumus settlement ──');
ck('Home −0.5, skor 1-0 → menang (+1)', A.settleAH(-0.5, 1, 0, 'home'), 1);
ck('Home −1, skor 1-0 → push (0)', A.settleAH(-1, 1, 0, 'home'), 0);
ck('Home −0.25, skor 0-0 → setengah kalah (−0.5)', A.settleAH(-0.25, 0, 0, 'home'), -0.5);
ck('Away +0.5 (line −0.5 home), skor 0-1 → menang (+1)', A.settleAH(-0.5, 0, 1, 'away'), 1);
ck('Over 2.5, total 3 → menang (+1)', A.settleOU(2.5, 3, 'over'), 1);
ck('Over 2.5, total 2 → kalah (−1)', A.settleOU(2.5, 2, 'over'), -1);
ck('Over 2.25, total 2 → setengah kalah (−0.5)', A.settleOU(2.25, 2, 'over'), -0.5);
ck('Under 2.25, total 2 → setengah menang (+0.5)', A.settleOU(2.25, 2, 'under'), 0.5);
console.log('  → ' + pass + ' lulus, ' + fail + ' gagal');

// ---------- 2) Backtest dari arsip ----------
const ARCH = path.join(__dirname, 'data', 'archive.json');
let arch = {};
try { arch = JSON.parse(fs.readFileSync(ARCH, 'utf8')); } catch (e) {}
const finished = Object.values(arch).filter(e => e.final && e.score && e.score.home != null && e.read);

console.log('\n────────────────────────────');
console.log('BACKTEST — laga selesai terarsip: ' + finished.length);
if (!finished.length) {
  console.log('\nBelum ada laga selesai yang terarsip. Ini WAJAR di awal.');
  console.log('Arsip terisi sendiri tiap kali start.command / live.command jalan saat laga berlangsung→selesai.');
  console.log('Setelah beberapa laga, jalankan lagi: node accuracy.js → muncul angka akurasi nyata.');
  process.exit(fail ? 1 : 0);
}

let favTotal = 0, favHit = 0;          // kalibrasi: favorit 1X2 benar menang?
let trapTotal = 0, trapFadeWin = 0, trapUnits = 0;  // apakah menghindari jebakan = tepat?
const rows = [];
for (const e of finished) {
  const gh = e.score.home, ga = e.score.away, tot = gh + ga;
  const r = e.read;
  let favTxt = '-', trapTxt = '-';
  // Kalibrasi favorit menang
  if (r.win && r.win.home != null) {
    const favHome = r.win.home >= r.win.away;
    const favName = favHome ? e.home : e.away;
    const won = favHome ? gh > ga : ga > gh;
    favTotal++; if (won) favHit++;
    favTxt = favName + (won ? ' MENANG' : (gh === ga ? ' SERI' : ' kalah'));
  }
  // Uji jebakan: kalau kita tandai jebakan di sisi X, apakah sisi X KALAH (menghindar = tepat)?
  if (r.trapped && r.topPick && r.topPick.line != null) {
    const p = r.topPick; let u = null;
    if (p.market === 'ah') u = A.settleAH(p.line, gh, ga, p.side);
    else if (p.market === 'ou') u = A.settleOU(p.line, tot, p.side === 'home' ? 'over' : 'under');
    if (u != null) {
      trapTotal++; trapUnits += -u;            // "fade" = lawan jebakan → untung = -u
      if (u < 0) trapFadeWin++;
      trapTxt = 'jebakan ' + p.market.toUpperCase() + ' ' + (u < 0 ? 'KALAH (hindar tepat)' : u > 0 ? 'menang (publik benar)' : 'push');
    }
  }
  rows.push(`  ${e.home} ${gh}-${ga} ${e.away}  ·  ${favTxt}  ·  ${trapTxt}`);
}
console.log(rows.join('\n'));

console.log('\n── RINGKASAN ──');
if (favTotal) console.log(`Favorit 1X2 menang: ${favHit}/${favTotal} (${Math.round(favHit / favTotal * 100)}%)`);
if (trapTotal) {
  console.log(`Jebakan terbukti KALAH (menghindar tepat): ${trapFadeWin}/${trapTotal} (${Math.round(trapFadeWin / trapTotal * 100)}%)`);
  console.log(`Hasil "melawan jebakan" (unit, ~taruhan rata): ${trapUnits >= 0 ? '+' : ''}${trapUnits.toFixed(2)} dari ${trapTotal} laga`);
}
console.log('\nCatatan jujur: ini sampel kecil. Butuh puluhan laga sebelum angkanya bisa dipercaya.');
console.log('Corner/kartu tidak dinilai di sini (tak bisa dihitung dari skor gol).');
process.exit(fail ? 1 : 0);
