#!/usr/bin/env node
/* DEBUG sekali-pakai: tarik 1 respons mentah odds-api.io untuk inspeksi field AH.
 * Tidak pernah mencetak API key. Output -> debug-raw.json (diupload sebagai artifact). */
const fs = require('fs');
const BASE = 'https://api.odds-api.io/v3';
const k = encodeURIComponent(process.env.ODDS_API_IO_KEY || '');

async function j(url, opt) { const r = await fetch(url, opt); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { _status: r.status, _text: t.slice(0, 300) }; } }

(async () => {
  if (!k) { console.error('NO KEY'); process.exit(1); }
  await j(`${BASE}/bookmakers/selected/select?bookmakers=Sbobet,Bet365&apiKey=${k}`, { method: 'PUT' }).catch(() => {});
  const ev = await j(`${BASE}/events?sport=football&apiKey=${k}`);
  const list = Array.isArray(ev) ? ev : (ev.events || ev.data || []);
  const wc = list.filter(e => JSON.stringify(e.league || e.leagueName || e.group || '').toLowerCase().includes('world'));
  const picks = (wc.length ? wc : list).slice(0, 3);
  const ids = picks.map(e => e.id || e.eventId).filter(Boolean);
  const od = await j(`${BASE}/odds/multi?apiKey=${k}&eventIds=${ids.join(',')}&bookmakers=Sbobet,Bet365`);
  const out = {
    eventsKeys: list[0] ? Object.keys(list[0]) : [],
    picked: picks.map(e => ({ id: e.id || e.eventId, home: e.home, away: e.away, league: e.league || e.leagueName })),
    rawOddsMulti: od,
  };
  fs.writeFileSync('debug-raw.json', JSON.stringify(out, null, 2));
  console.log('WROTE debug-raw.json; oddsMulti top-level type:', Array.isArray(od) ? 'array' : typeof od);
})();
