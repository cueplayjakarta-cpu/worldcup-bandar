#!/usr/bin/env node
/* DEBUG sekali-pakai: tarik respons mentah odds-api.io untuk inspeksi field AH.
 * Tidak pernah mencetak API key. Output -> debug-raw.json (artifact). */
const fs = require('fs');
const BASE = 'https://api.odds-api.io/v3';
const k = encodeURIComponent(process.env.ODDS_API_IO_KEY || '');

async function j(url, opt) { const r = await fetch(url, opt); const t = await r.text(); try { return JSON.parse(t); } catch (e) { return { _status: r.status, _text: t.slice(0, 300) }; } }

(async () => {
  if (!k) { console.error('NO KEY'); process.exit(1); }
  await j(`${BASE}/bookmakers/selected/select?bookmakers=Sbobet,Bet365&apiKey=${k}`, { method: 'PUT' }).catch(() => {});
  const ev = await j(`${BASE}/events?sport=football&apiKey=${k}`);
  const list = Array.isArray(ev) ? ev : (ev.events || ev.data || []);
  const wc = list.filter(e => JSON.stringify(e.league || '').toLowerCase().includes('world'));
  // hanya yang BELUM selesai (ada odds): status bukan finished/ended, dan tanggal ke depan bila ada
  const upcoming = (wc.length ? wc : list).filter(e => !/finish|end|closed/i.test(String(e.status || '')));
  const ids = upcoming.map(e => e.id || e.eventId).filter(Boolean).slice(0, 10);
  const od = await j(`${BASE}/odds/multi?apiKey=${k}&eventIds=${ids.join(',')}&bookmakers=Sbobet,Bet365`);
  const events = Array.isArray(od) ? od : (od.events || od.data || []);

  // cari event pertama yang punya Sbobet + market Spread/Asian Handicap, dump entri-nya
  let sample = null;
  for (const e of events) {
    const bs = e.bookmakers || {};
    const sb = bs.Sbobet || bs.sbobet || bs.SBOBET;
    const markets = sb && (sb.markets || sb.odds || sb);
    let spread = null;
    if (Array.isArray(markets)) spread = markets.find(m => /spread|asian|handicap/i.test(m.name || ''));
    if (spread) { sample = { eventId: e.id, home: e.home, away: e.away, bookmakerKeys: Object.keys(bs), sbobetShape: Array.isArray(markets) ? 'array' : typeof markets, spreadMarket: spread }; break; }
    if (!sample && sb) sample = { eventId: e.id, home: e.home, away: e.away, bookmakerKeys: Object.keys(bs), sbobetRaw: sb };
  }
  const out = {
    upcomingCount: upcoming.length, idsTried: ids, eventsReturned: events.length,
    firstEventShape: events[0] ? { keys: Object.keys(events[0]), bookmakerKeys: Object.keys(events[0].bookmakers || {}) } : null,
    sample,
    rawFirstEvent: events[0] || null,
  };
  fs.writeFileSync('debug-raw.json', JSON.stringify(out, null, 2));
  console.log('events returned:', events.length, '| sample found:', !!sample);
})();
