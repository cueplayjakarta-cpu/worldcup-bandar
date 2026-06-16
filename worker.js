/*
 * worker.js — Cloudflare Worker "Lensa Bandar Live"
 * --------------------------------------------------------------------
 * Menarik odds SBOBET (via odds-api.io), menganalisa pakai MESIN TUNGGAL
 * (engine/index.js — sama persis dengan yang dipakai fetch-odds.js), lalu
 * menyajikan JSON yang SEGAR (~1 menit) dengan CORS. Halaman GitHub Pages
 * tinggal fetch ke URL Worker ini.
 *
 * API key disimpan sebagai SECRET (env.ODDS_API_IO_KEY), tidak pernah publik.
 * Free-tier: CPU 10ms/permintaan → jumlah laga dibatasi (LIMIT).
 */

// ---- mesin analisis tunggal (di-bundle oleh wrangler/esbuild) ----
import E from './engine/index.js';
const { analyzeMatch, normalizeOddsApiIo, parseScore } = E;

const ODDS_BASE = 'https://api.odds-api.io/v3';
const TTL_MS = 60000;          // segar ulang tiap ~60 detik
const LIMIT = 24;              // batasi jumlah laga (hemat CPU free-tier)
const CACHE_KEY = 'https://lensa-bandar.cache/matches-v3e';  // bump → cold-start fresh dgn grade/report
const HIST_KEY = 'https://lensa-bandar.cache/history';       // TETAP (jangan hilangkan baseline)
const META_KEY = 'https://lensa-bandar.cache/meta-v3e';

// Sisa kuota dari header API terakhir (untuk guard backoff).
let LAST_RL = { remaining: null, reset: null };

// ---- cache helpers ----
async function readMeta(){ try{ const m=await caches.default.match(META_KEY); if(m) return await m.json(); }catch(e){} return {}; }
async function writeMeta(meta){ try{ await caches.default.put(META_KEY,new Response(JSON.stringify(meta),{headers:{'Cache-Control':'max-age=86400'}})); }catch(e){} }
async function readCache(){ try{ const c=await caches.default.match(CACHE_KEY); if(c) return await c.json(); }catch(e){} return null; }
async function writeCache(out){ try{ await caches.default.put(CACHE_KEY,new Response(JSON.stringify(out),{headers:{'Cache-Control':'max-age=600'}})); }catch(e){} }

// Jarak (menit) ke kickoff terdekat; 0 kalau ada laga live.
function minutesToNextKO(matches){
  if(!Array.isArray(matches)) return Infinity;
  const now=Date.now(); let mins=Infinity;
  for(const m of matches){ if(m.live) return 0; if(m.kickoff){ const dm=(new Date(m.kickoff).getTime()-now)/60000; if(dm>-15 && dm<mins) mins=dm; } }
  return mins;
}
// Cadence ADAPTIF: HOT 3mnt (<60mnt/live), MED 10mnt (<3jam), SEPI 20mnt.
function cadenceMs(matches){ const m=minutesToNextKO(matches); if(m<=60) return 3*60000; if(m<=180) return 10*60000; return 20*60000; }

// ===================== AMBIL DATA (Worker fetch) =====================
async function jget(url){
  const r=await fetch(url,{cf:{cacheTtl:0}});
  const rem=r.headers.get('x-ratelimit-remaining'), reset=r.headers.get('x-ratelimit-reset');
  if(rem!=null||reset!=null) LAST_RL={remaining:rem!=null?+rem:null,reset:reset||null};
  if(r.status===429){ const e=new Error('HTTP 429'); e.rateLimited=true; e.reset=reset||null; throw e; }
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
async function fetchLive(key){
  const k=encodeURIComponent(key);
  const evRes=await jget(`${ODDS_BASE}/events?sport=football&apiKey=${k}`);
  const upcoming=Array.isArray(evRes)?evRes:(evRes.events||evRes.data||[]);
  let live=[]; try{ const lv=await jget(`${ODDS_BASE}/events/live?apiKey=${k}`); live=Array.isArray(lv)?lv:(lv.events||lv.data||[]); }catch(e){}
  const seen=new Set(),merged=[]; for(const e of [...live,...upcoming]){ const id=e.id||e.eventId; if(id==null||seen.has(id)) continue; seen.add(id); merged.push(e); }
  const isWC=e=>/world[ -]?cup|piala dunia|fifa world/i.test(JSON.stringify(e.league||e.leagueName||e.competition||''));
  const notDone=e=>{ const s=String(e.status||'').toLowerCase(); return s!=='settled'&&s!=='finished'&&s!=='cancelled'&&s!=='ft'; };
  let wc=merged.filter(e=>isWC(e)&&notDone(e)); if(!wc.length) wc=merged.filter(notDone);
  wc.sort((a,b)=>{ const la=/live/i.test(a.status||'')?0:1,lb=/live/i.test(b.status||'')?0:1; if(la!==lb) return la-lb; return new Date(a.date||a.commenceTime||0)-new Date(b.date||b.commenceTime||0); });
  wc=wc.slice(0,LIMIT);
  const meta={}; for(const e of [...live,...upcoming]){ const id=e.id||e.eventId; if(id==null) continue; meta[String(id)]={status:e.status,scores:e.scores||e.score||e.result||e.ss||null,time:e.time||e.minute||e.clock||e.timer||null}; }
  const ids=wc.map(e=>e.id||e.eventId).filter(Boolean); if(!ids.length) return [];
  const all=[]; for(let i=0;i<ids.length;i+=10){ const batch=ids.slice(i,i+10).join(','); const od=await jget(`${ODDS_BASE}/odds/multi?apiKey=${k}&eventIds=${batch}&bookmakers=Sbobet,Bet365`); const arr=Array.isArray(od)?od:(od.data||od.events||[]); all.push(...arr); }
  const matches=normalizeOddsApiIo(all);
  for(const mt of matches){ const x=meta[mt.id]; if(!x) continue; const sc=parseScore(x.scores); if(sc) mt.score=sc; if(x.status) mt.status=x.status; if(x.time!=null) mt.minute=String(x.time); }
  return matches;
}
async function buildOutput(env){
  const cache=caches.default;
  let hist={}; try{ const h=await cache.match(HIST_KEY); if(h) hist=await h.json(); }catch(e){}
  const raw=await fetchLive(env.ODDS_API_IO_KEY);
  const matches=raw.map(m=>analyzeMatch(m,hist,true));
  matches.sort((a,b)=>{ if(a.live!==b.live) return a.live?-1:1; return new Date(a.kickoff||0)-new Date(b.kickoff||0); });
  const summary=E.summarize(matches);
  const out={generatedAt:new Date().toISOString(),source:'odds-api.io / SBOBET (Cloudflare LIVE)',isDemo:false,reference:'SBOBET',compare:'Bet365 (publik)',markets:['Handicap','Over/Under','Corner FT','Corner B1','Kartu'],summary,note:'Alat informasi pergerakan odds. Tidak melacak taruhan siapa pun. Bukan jaminan untung.',matches};
  try{ await cache.put(HIST_KEY,new Response(JSON.stringify(hist),{headers:{'Cache-Control':'max-age=86400'}})); }catch(e){}
  return out;
}

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
const WEB_URL='https://cueplayjakarta-cpu.github.io/worldcup-bandar/';

// Untuk webhook Telegram: sajikan cache; kalau kosong & tidak backoff, tarik sekali.
async function getData(env, ctx){
  const c=await readCache(); if(c) return c;
  const out=await buildOutput(env);
  if(ctx&&ctx.waitUntil) ctx.waitUntil(writeCache(out)); else await writeCache(out);
  return out;
}

// ===================== BOT TELEGRAM =====================
async function tgSend(token, chatId, text){
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true})});
}
function botReply(out, raw){
  const ms=out.matches||[], cmd=(raw||'').toLowerCase(), s=out.summary||{};
  if(/^\/start|^\/help|halo|hai|menu/.test(cmd))
    return '🦞⚽ <b>Lensa Bandar</b> — pembaca gerak bandar Piala Dunia.\n\nPerintah:\n/jebakan — laga yang publik lagi dipancing\n/live — laga yang sedang berjalan\n/hari — ringkasan semua laga\n\nDetail lengkap (web): '+WEB_URL+'\n\n<i>Alat informasi, bukan ajakan bertaruh, bukan jaminan untung.</i>';
  if(/^\/live/.test(cmd)){
    const live=ms.filter(m=>m.live);
    if(!live.length) return 'Belum ada laga LIVE sekarang. Coba /jebakan atau /hari.';
    return '🔴 <b>SEDANG LIVE</b>\n\n'+live.map(m=>`• <b>${m.home} ${m.score?m.score.home+'-'+m.score.away:''} ${m.away}</b>${m.minute?" ("+String(m.minute).replace(/'+$/,'')+"')":''}\n  ${m.conclusion&&m.conclusion.trapped?'⚠️ dipancing ke: '+m.conclusion.headline.replace('Pemasang lagi dipancing ke: ',''):'✅ aman'}`).join('\n\n');
  }
  if(/^\/hari|^\/odds|^\/ringkas/.test(cmd)){
    const head=`📊 <b>${s.total||ms.length} laga</b> · ${s.trapped||0} ada jebakan · ${s.favoriteTraps||0} jebakan favorit · ${s.live||0} live`;
    const top=ms.slice(0,10).map(m=>{ const d=m.overallLight==='red'?'🔴':m.overallLight==='yellow'?'🟡':'🟢'; return `${d} ${m.home} v ${m.away}`; });
    return head+'\n\n'+top.join('\n')+'\n\nDetail: '+WEB_URL;
  }
  const trap=ms.filter(m=>m.conclusion&&m.conclusion.trapped).slice(0,12);
  const head=`🎯 <b>Hati-hati — publik lagi dipancing ke sini</b>\n(${s.total||ms.length} laga, ${s.trapped||0} ada jebakan)`;
  if(!trap.length) return head+'\n\nTidak ada jebakan mencolok saat ini. ✅\n\nDetail: '+WEB_URL;
  const lines=trap.map(m=>{ const d=m.overallLight==='red'?'🔴':'🟡'; const side=m.conclusion.headline.replace('Pemasang lagi dipancing ke: ',''); return `${d} ${m.home} v ${m.away}\n   → ${side}`; });
  return head+'\n\n'+lines.join('\n')+'\n\n<i>Ingat: ini peringatan biar nggak ikut arus, bukan ramalan pasti.</i>\nDetail: '+WEB_URL;
}
async function handleTelegram(request, env, ctx){
  let update; try{ update=await request.json(); }catch(e){ return new Response('ok'); }
  const msg=update.message||update.edited_message; if(!msg||!msg.chat) return new Response('ok');
  if(!env.TELEGRAM_TOKEN) return new Response('ok');
  try{ const out=await getData(env,ctx); await tgSend(env.TELEGRAM_TOKEN,msg.chat.id,botReply(out,(msg.text||'').trim())); }
  catch(e){ try{ await tgSend(env.TELEGRAM_TOKEN,msg.chat.id,'Maaf, lagi gangguan ambil data. Coba lagi sebentar ya.'); }catch(_){}}
  return new Response('ok');
}

export default {
  // Permintaan halaman: SELALU sajikan cache (cron yang me-refresh). Hanya cold-start
  // yang menarik API — biar konsumsi kuota terikat ke cron, bukan jumlah pengunjung.
  async fetch(request, env, ctx){
    if(request.method==='OPTIONS') return new Response(null,{headers:CORS});
    if(request.method==='POST') return handleTelegram(request, env, ctx);   // webhook Telegram
    if(!env.ODDS_API_IO_KEY) return new Response(JSON.stringify({error:'ODDS_API_IO_KEY belum diset (Settings → Variables → Secret)'}),{status:500,headers:CORS});
    const cached=await readCache();
    if(cached) return new Response(JSON.stringify(cached),{headers:CORS});
    const meta=await readMeta(); const now=Date.now();
    if(meta.backoffUntil && now<meta.backoffUntil) return new Response(JSON.stringify({error:'rate-limited',retryAt:new Date(meta.backoffUntil).toISOString()}),{status:503,headers:CORS});
    try{ const out=await buildOutput(env); ctx.waitUntil(writeCache(out)); return new Response(JSON.stringify(out),{headers:CORS}); }
    catch(e){ if(e&&e.rateLimited){ meta.backoffUntil=(e.reset&&Date.parse(e.reset))||(now+15*60000); ctx.waitUntil(writeMeta(meta)); }
      return new Response(JSON.stringify({error:String(e&&e.message||e)}),{status:502,headers:CORS}); }
  },
  // Cron tiap 3 menit; di sinilah ADAPTIF + backoff diputuskan.
  async scheduled(event, env, ctx){
    if(!env.ODDS_API_IO_KEY) return;
    const now=Date.now(); const meta=await readMeta();
    if(meta.backoffUntil && now<meta.backoffUntil) return;                 // hormati backoff 429
    const cached=await readCache();
    const cad=cadenceMs(cached&&cached.matches);
    if(meta.lastFetchAt && (now-meta.lastFetchAt)<cad) return;             // belum waktunya (adaptif)
    try{
      const out=await buildOutput(env); await writeCache(out);
      meta.lastFetchAt=now; meta.lastError=null;
      if(LAST_RL.remaining!=null && LAST_RL.remaining<12 && LAST_RL.reset) meta.backoffUntil=Date.parse(LAST_RL.reset)||0; else meta.backoffUntil=0;
    }catch(e){
      if(e&&e.rateLimited) meta.backoffUntil=(e.reset&&Date.parse(e.reset))||(now+15*60000);
      else meta.backoffUntil=now+5*60000;
      meta.lastError=String(e&&e.message||e);
    }
    await writeMeta(meta);
  }
};
