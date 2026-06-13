/*
 * worker.js — Cloudflare Worker "Lensa Bandar Live"
 * --------------------------------------------------------------------
 * Menarik odds SBOBET (via odds-api.io), menganalisa (mesin sama dgn fetch-odds.js),
 * lalu menyajikan matches.json yang SEGAR (~1 menit) dengan CORS.
 * Halaman (di GitHub Pages) tinggal fetch ke URL Worker ini.
 *
 * Terisolasi total dari VPS/bot kamu — Worker cuma akses internet odds-api.io.
 * API key disimpan sebagai SECRET (env.ODDS_API_IO_KEY), tidak pernah publik.
 *
 * Catatan free-tier: CPU 10ms/permintaan. Jumlah laga dibatasi (LIMIT) agar muat.
 * Kalau perlu lebih kuat: Workers Paid ($5/bln) menghapus batas CPU.
 */
'use strict';

const ODDS_BASE = 'https://api.odds-api.io/v3';
const TTL_MS = 60000;          // segar ulang tiap ~60 detik
const LIMIT = 24;              // batasi jumlah laga (hemat CPU free-tier)
const CACHE_KEY = 'https://lensa-bandar.cache/matches';
const HIST_KEY = 'https://lensa-bandar.cache/history';

// ===================== MESIN ANALISA (identik dgn fetch-odds.js) =====================
function hkToDecimal(hk){ if(hk==null) return null; return hk>=1.6?hk:hk+1; }
function num(v){ const n=parseFloat(v); return isNaN(n)?null:n; }
function pct(x){ return Math.round(x*100); }
function parseScore(s){ if(s==null) return null; if(typeof s==='object'){ if(s.home!=null&&s.away!=null) return {home:+s.home,away:+s.away}; if(s.current) return parseScore(s.current); if(s.ft&&s.ft.home!=null) return {home:+s.ft.home,away:+s.ft.away}; return null;} if(typeof s==='string'){ const m=s.match(/(\d+)\s*[-:]\s*(\d+)/); if(m) return {home:+m[1],away:+m[2]};} return null; }
function twoWayMargin(a,b){ const x=hkToDecimal(a),y=hkToDecimal(b); if(!x||!y) return null; return (1/x+1/y-1)*100; }
function noVigProb(home,away){ const dH=hkToDecimal(home),dA=hkToDecimal(away); if(!dH||!dA) return null; const a=1/dH,b=1/dA,s=a+b; return {home:a/s,away:b/s}; }
function noVig3(h,d,a){ const H=num(h),D=num(d),A=num(a); if(!H||!D||!A) return null; const ih=1/H,id=1/D,ia=1/A,s=ih+id+ia; return {home:+(ih/s).toFixed(4),draw:+(id/s).toFixed(4),away:+(ia/s).toFixed(4)}; }
function movement(open,now){ if(open==null||now==null) return {dir:'flat',delta:0}; const d=+(now-open).toFixed(2); if(Math.abs(d)<0.001) return {dir:'flat',delta:0}; return {dir:d>0?'up':'down',delta:d}; }

const NORMAL_MARGIN={ah:2.5,ou:2.5,corner:5.5,cornerHT:5.5,card:8};

function gradeMarket(m,normalMargin){
  const flags=[],tech=[]; let score=0;
  if(m.margin!=null){ if(m.margin>normalMargin+2.5) tech.push(`Jatah bandar besar (${m.margin.toFixed(1)}%)`); else if(m.margin>normalMargin+1) tech.push(`Jatah bandar agak besar (${m.margin.toFixed(1)}%)`); }
  if(m.lineMove&&m.lineMove.dir!=='flat') tech.push('Garis bergeser');
  if(m.waterMoveHome&&m.waterMoveHome.dir==='down'&&Math.abs(m.waterMoveHome.delta)>=0.07){ score+=1; flags.push('Bayaran tuan rumah dikecilkan — pemasang menumpuk ke sana'); }
  if(m.waterMoveAway&&m.waterMoveAway.dir==='down'&&Math.abs(m.waterMoveAway.delta)>=0.07){ score+=1; flags.push('Bayaran tim tamu dikecilkan — pemasang menumpuk ke sana'); }
  if(m.divergence){ score+=m.divergence.strong?2:1; flags.push(m.divergence.flag); }
  const light=score>=3?'red':score>=1?'yellow':'green';
  return {light,flags,tech,score};
}
function computeDivergence(m,homeName,awayName){
  if(!m.pub||m.pub.home==null||m.pub.away==null) return null;
  if(m.pub.line!=null&&m.line&&m.line.now!=null&&m.pub.line!==m.line.now) return null;
  const shHome=hkToDecimal(m.nowHome),shAway=hkToDecimal(m.nowAway),puHome=hkToDecimal(m.pub.home),puAway=hkToDecimal(m.pub.away);
  if(!shHome||!shAway||!puHome||!puAway) return null;
  const dHome=+(puHome-shHome).toFixed(3),dAway=+(puAway-shAway).toFixed(3),TH=0.04;
  let side=null,gap=0;
  if(dHome>=TH&&dHome>=dAway){side='home';gap=dHome;} else if(dAway>=TH&&dAway>dHome){side='away';gap=dAway;}
  if(!side) return null;
  const sideName=side==='home'?homeName:awayName,strong=gap>=0.08;
  return {side,gap,strong,flag:`Di Bet365, ${sideName} dikasih bayaran lebih besar untuk memancing pemasang ke sana`};
}
function buildMarket(o){
  const margin=twoWayMargin(o.nowHome,o.nowAway),probs=noVigProb(o.nowHome,o.nowAway);
  const m={label:o.label,line:o.line,openHome:o.openHome,openAway:o.openAway,nowHome:o.nowHome,nowAway:o.nowAway,pub:o.pub||null,margin,
    probHome:probs?+(probs.home).toFixed(4):null,probAway:probs?+(probs.away).toFixed(4):null,
    waterMoveHome:movement(o.openHome,o.nowHome),waterMoveAway:movement(o.openAway,o.nowAway),
    lineMove:movement(o.line&&o.line.open,o.line&&o.line.now),lineDisplay:(o.line&&o.line.now!=null)?`${o.line.now}`:null};
  m.divergence=computeDivergence(m,o.homeName,o.awayName);
  const g=gradeMarket(m,o.normalMargin); m.light=g.light; m.flags=g.flags; m.tech=g.tech; m.score=g.score;
  return m;
}
function computeDirection(m,type,home,away){
  if(!m.line||m.line.now==null) return {side:null,strength:0,arrow:'→',text:'',bigMove:false};
  let hv=0,av=0; const reasons=[],lm=m.lineMove;
  if(lm&&lm.dir!=='flat'){ if(type==='ah'){ if(lm.delta<0){hv++;reasons.push('garis melebar ke '+home);} else {av++;reasons.push('garis menyusut ke '+away);} } else { if(lm.delta>0){hv++;reasons.push('garis naik (Over)');} else {av++;reasons.push('garis turun (Under)');} } }
  if(m.waterMoveHome&&m.waterMoveHome.dir==='down'&&Math.abs(m.waterMoveHome.delta)>=0.04){hv++;reasons.push('water mengeras sisi 1');}
  if(m.waterMoveAway&&m.waterMoveAway.dir==='down'&&Math.abs(m.waterMoveAway.delta)>=0.04){av++;reasons.push('water mengeras sisi 2');}
  const net=hv-av;
  if(net===0) return {side:null,strength:0,arrow:'→',text:'Belum bergerak',bigMove:false};
  const side=net>0?'home':'away',mag=(type==='ah'&&lm)?Math.abs(lm.delta):0,magBonus=mag>=0.5?2:mag>=0.25?1:0,strength=Math.min(3,Math.abs(net)+magBonus);
  return {side,strength,arrow:'➜',bigMove:mag>=0.5,mag,label:sideLabel(type,side,home,away,m),reasons,text:'Bandar geser ke '+sideLabel(type,side,home,away,m)};
}
function movePhrase(mk,type,home,away){ const o=mk.line&&mk.line.open,n=mk.line&&mk.line.now,to=mk.direction&&mk.direction.label;
  if(o!=null&&n!=null&&o!==n){ const fmt=type==='ah'?indoHandicap:(v=>`${v}`); return {market:mk.label,text:`${fmt(o)} → ${fmt(n)}`,to}; }
  if(to) return {market:mk.label,text:'water mengeras',to}; return null; }
function matchGuidance(markets,home,away){
  const dirs=[];
  for(const k of ['ah','ou','corner','cornerHT']){ const mk=markets[k]; if(mk&&mk.direction&&mk.direction.side){ const ph=movePhrase(mk,k,home,away); dirs.push({key:k,market:mk.label,to:mk.direction.label,strength:mk.direction.strength,phrase:ph}); } }
  if(!dirs.length) return {moved:false,primary:null,narrative:null,items:[],confidence:'—',strength:0};
  dirs.sort((a,b)=>b.strength-a.strength); const maxS=dirs[0].strength,confidence=maxS>=3?'Kuat':maxS>=2?'Sedang':'Lemah';
  const ah=dirs.find(d=>d.key==='ah'),primaryItem=ah||dirs[0],primary=primaryItem.to;
  const parts=dirs.map(d=>{ const mv=(d.phrase&&d.phrase.text!=='water mengeras')?` (${d.phrase.text})`:''; return `${d.market}: ${d.to}${mv}`; });
  const narrative=parts.join(' · ')+'.';
  const items=dirs.map(d=>({market:d.market,to:d.to,move:d.phrase?d.phrase.text:null}));
  let insight=null; const ahM=markets.ah;
  if(ahM&&ahM.direction&&ahM.direction.bigMove&&ahM.line&&ahM.line.open!=null){ const o=ahM.line.open,n=ahM.line.now,mag=Math.abs(n-o),favName=o<0?home:(o>0?away:home),gaining=(n>o)?away:home,weakening=gaining===home?away:home;
    insight=`Voor ${favName} bergeser ${indoHandicap(o)} → ${indoHandicap(n)} (sekitar ${mag} bola). Pergerakan sebesar ini jarang — biasanya tanda uang/info tajam menilai ${gaining} lebih kuat dari perkiraan awal, atau ${weakening} lagi bermasalah. Jangan asal ambil favorit cuma karena namanya besar.`; }
  return {moved:true,primary,narrative,items,confidence,strength:maxS,insight};
}
function indoHandicap(L){ if(L==null) return '-'; const sign=L<0?'−':(L>0?'+':''),a=Math.abs(L),whole=Math.floor(a),frac=+(a-whole).toFixed(2),fmap={0:'',0.25:'1/4',0.5:'1/2',0.75:'3/4'},fr=fmap[frac]!=null?fmap[frac]:String(frac); let body; if(whole===0) body=fr||'0'; else body=fr?`${whole} ${fr}`:`${whole}`; return sign+body; }
function strengthWord(absL){ if(absL<0.3) return 'unggul sangat tipis — nyaris imbang'; if(absL<0.7) return 'unggul tipis'; if(absL<1.1) return 'cukup unggul'; if(absL<1.6) return 'unggul jelas'; return 'sangat dominan'; }
function generateRead(type,m,home,away){
  const L=m.line&&m.line.now; if(L==null) return {holds:'',signal:''}; const p=noVigProb(m.nowHome,m.nowAway); let holds='';
  if(type==='ah'){ let favName,dogName,favP; if(L<0){favName=home;dogName=away;favP=p&&p.home;} else if(L>0){favName=away;dogName=home;favP=p&&p.away;} else { if(p&&p.home>=p.away){favName=home;dogName=away;favP=p.home;} else {favName=away;dogName=home;favP=p.away;} }
    holds=`Bandar pegang: ${favName} ${strengthWord(Math.abs(L||0))} (garis ${indoHandicap(L)}).`+(favP!=null?` Tanpa potongan: peluang ${favName} ~${pct(favP)}% vs ${dogName}/seri ~${pct(1-favP)}%.`:'');
    const lo=m.line&&m.line.open,ln=m.line&&m.line.now; if(lo!=null&&ln!=null&&Math.abs(ln-lo)>=0.25){ const gaining=(ln>lo)?away:home,weakening=gaining===home?away:home; holds+=` ⚠️ Tapi garis lagi bergeser ${indoHandicap(lo)} → ${indoHandicap(ln)} — ${weakening} melemah, ${gaining} menguat. Jangan asal ambil ${weakening}.`; }
  } else if(type==='ou'){ const pOver=p&&p.home,tempo=L>=3.5?'laga diharap rame / banyak gol':(L<=2.25?'laga ketat / sedikit gol':'gol sedang'); holds=`Bandar pegang: perkiraan ~${L} gol (${tempo}).`+(pOver!=null?` Peluang Over ${L} ~${pct(pOver)}%, Under ~${pct(1-pOver)}%.`:''); }
  else if(type==='corner'){ const pOver=p&&p.home; holds=`Bandar pegang: perkiraan ~${L} corner (full-time).`+(pOver!=null?` Peluang Over ${L} ~${pct(pOver)}%.`:''); }
  else if(type==='cornerHT'){ const pOver=p&&p.home; holds=`Bandar pegang: perkiraan ~${L} corner (babak 1).`+(pOver!=null?` Peluang Over ${L} ~${pct(pOver)}%.`:''); }
  else if(type==='card'){ const pOver=p&&p.home; holds=`Bandar pegang: perkiraan ~${L} kartu.`+(pOver!=null?` Peluang Over ${L} ~${pct(pOver)}%.`:''); }
  let signal; if(!m.flags||!m.flags.length) signal='Aman — belum ada tanda menjebak.'; else signal='⚠️ '+m.flags.join('; ')+'.';
  if(type==='ah'&&m.light!=='green'&&Math.abs(L||0)>0&&Math.abs(L||0)<0.5) signal+=' Garisnya kecil padahal favorit — di sinilah orang gampang nekat taruh besar, dan itu yang dimau bandar.';
  return {holds,signal};
}
function matchVerdict(markets,home,away){
  const ah=markets.ah,L=ah.line&&ah.line.now,absL=Math.abs(L||0),favName=L<0?home:(L>0?away:home),favSide=L<0?'home':(L>0?'away':'home');
  const waterHardFav=(favSide==='home'?ah.waterMoveHome:ah.waterMoveAway),hardening=waterHardFav&&waterHardFav.dir==='down'&&Math.abs(waterHardFav.delta)>=0.07,divBaitFav=ah.divergence&&ah.divergence.side===favSide;
  if(absL>0&&absL<0.6&&(hardening||divBaitFav)) return {light:'red',text:`Jebakan favorit: banyak orang taruh ke ${favName} karena kelihatan jagoan, padahal garisnya cuma ${indoHandicap(L)} — sebenarnya laganya jauh lebih ketat. Hati-hati ikut ramai.`};
  const order={green:0,yellow:1,red:2}; let worst='green'; for(const k of Object.keys(markets)) if(order[markets[k].light]>order[worst]) worst=markets[k].light;
  if(worst==='red') return {light:'red',text:'Ada sisi yang ditarik ramai-ramai. Jangan langsung percaya harga yang kelihatan manis.'};
  if(worst==='yellow') return {light:'yellow',text:'Sebagian taruhan mulai diramaikan ke satu sisi. Cermati dulu.'};
  return {light:'green',text:'Aman & tenang. Belum ada sisi yang dipancing mencolok.'};
}
function sideLabel(type,side,home,away,mk){ const L=mk.line&&mk.line.now; if(type==='ah') return side==='home'?home:away; if(type==='ou') return side==='home'?`Over ${L} gol`:`Under ${L} gol`; if(type==='corner') return side==='home'?`Over ${L} corner`:`Under ${L} corner`; if(type==='cornerHT') return side==='home'?`Over ${L} corner B1`:`Under ${L} corner B1`; if(type==='card') return side==='home'?`Over ${L} kartu`:`Under ${L} kartu`; return side; }
function hardenSide(mk){ if(mk.waterMoveHome&&mk.waterMoveHome.dir==='down'&&Math.abs(mk.waterMoveHome.delta)>=0.07) return 'home'; if(mk.waterMoveAway&&mk.waterMoveAway.dir==='down'&&Math.abs(mk.waterMoveAway.delta)>=0.07) return 'away'; return null; }
function deriveConclusion(match){
  const m=match.markets,cands=[],ah=m.ah,L=ah.line&&ah.line.now,favSide=L<0?'home':(L>0?'away':null),favName=favSide==='home'?match.home:(favSide==='away'?match.away:null);
  const annotateAh=(side)=>{ const nm=side==='home'?match.home:match.away; return side===favSide?`${nm} (favorit, garis ${indoHandicap(L)})`:nm; };
  const lab=(type,side,mk)=>type==='ah'?annotateAh(side):sideLabel(type,side,match.home,match.away,mk);
  const labShort=(type,side,mk)=>type==='ah'?(side==='home'?match.home:match.away):sideLabel(type,side,match.home,match.away,mk);
  if(match.verdict&&/Jebakan favorit/i.test(match.verdict.text)&&favName) cands.push({label:annotateAh(favSide),weight:5,pick:{market:'ah',side:favSide,line:L},why:`${favName} kelihatan favorit jelas tapi garisnya cuma ${indoHandicap(L)}, jadi orang gampang nekat taruh besar ke situ`});
  ['ah','ou'].forEach(k=>{ const mk=m[k]; if(mk.divergence) cands.push({label:lab(k,mk.divergence.side,mk),weight:4,pick:{market:k,side:mk.divergence.side,line:mk.line.now},why:`${labShort(k,mk.divergence.side,mk)} dikasih bayaran lebih besar di Bet365 untuk memancing pemasang`}); });
  ['ah','ou','corner','cornerHT','card'].forEach(k=>{ const mk=m[k]; if(!mk) return; const hs=hardenSide(mk); if(hs) cands.push({label:lab(k,hs,mk),weight:3,pick:{market:k,side:hs,line:mk.line&&mk.line.now},why:`bayaran ${labShort(k,hs,mk)} dikecilkan karena uang menumpuk ke sana`}); });
  if(!cands.length) return {trapped:false,topPick:null,headline:'Belum ada sisi yang dipancing.',detail:'Bandar cuma mengambil potongan wajar di kedua sisi. Tidak terlihat satu sisi pun yang sedang diramaikan untuk menjebak pemasang.',targets:[]};
  const by={}; for(const c of cands){ const e=by[c.label]||(by[c.label]={label:c.label,weight:0,whys:[],pick:c.pick,maxw:0}); e.weight+=c.weight; if(c.weight>e.maxw){e.maxw=c.weight;e.pick=c.pick;} if(e.whys.indexOf(c.why)<0) e.whys.push(c.why); }
  const ranked=Object.values(by).sort((a,b)=>b.weight-a.weight),top=ranked[0];
  return {trapped:true,topPick:top.pick||null,headline:`Pemasang lagi dipancing ke: ${top.label}`,detail:`Banyak orang sedang diarahkan untuk bertaruh ke ${top.label} — tandanya: ${top.whys.slice(0,2).join('; ')}. Di sisi yang ramai inilah harga sudah merugikan, dan di situ bandar paling untung. Jadi hati-hati ikut arus: ramai belum tentu benar. (Bukan berarti sisi lawan pasti menang.)`,targets:ranked.map(r=>r.label)};
}
function analyzeMatch(raw,hist,isLive){
  if(isLive&&hist&&hist[raw.id]&&hist[raw.id][0]){ const h0=hist[raw.id][0];
    if(raw.ah&&raw.ah.line.open===raw.ah.line.now){ if(h0.ahLine!=null) raw.ah.line.open=h0.ahLine; if(h0.ahH!=null) raw.ah.openHome=h0.ahH; if(h0.ahA!=null) raw.ah.openAway=h0.ahA; }
    if(raw.ou&&raw.ou.line.open===raw.ou.line.now){ if(h0.ouLine!=null) raw.ou.line.open=h0.ouLine; if(h0.ouO!=null) raw.ou.openHome=h0.ouO; if(h0.ouU!=null) raw.ou.openAway=h0.ouU; } }
  const mk=(label,key,nm)=>buildMarket(Object.assign({label,normalMargin:nm,homeName:raw.home,awayName:raw.away},raw[key]));
  const markets={ah:mk('Handicap','ah',NORMAL_MARGIN.ah),ou:mk('Over/Under','ou',NORMAL_MARGIN.ou),corner:mk('Corner (FT)','corner',NORMAL_MARGIN.corner),cornerHT:mk('Corner (Babak 1)','cornerHT',NORMAL_MARGIN.cornerHT),card:mk('Kartu','card',NORMAL_MARGIN.card)};
  markets.ah.read=generateRead('ah',markets.ah,raw.home,raw.away); markets.ou.read=generateRead('ou',markets.ou,raw.home,raw.away);
  markets.corner.read=generateRead('corner',markets.corner,raw.home,raw.away); markets.cornerHT.read=generateRead('cornerHT',markets.cornerHT,raw.home,raw.away); markets.card.read=generateRead('card',markets.card,raw.home,raw.away);
  for(const k of ['ah','ou','corner','cornerHT','card']) if(markets[k]) markets[k].direction=computeDirection(markets[k],k,raw.home,raw.away);
  const verdict=matchVerdict(markets,raw.home,raw.away),status=raw.status||'pending';
  const out={id:raw.id,home:raw.home,away:raw.away,group:raw.group||null,kickoff:raw.kickoff,status,live:String(status).toLowerCase()==='live',score:raw.score||null,minute:raw.minute||null,win:raw.win||null,overallLight:verdict.light,verdict,markets};
  out.conclusion=deriveConclusion(out); out.guidance=matchGuidance(markets,raw.home,raw.away);
  if(hist){ const id=out.id,snap={t:Date.now(),ahLine:markets.ah.line.now,ouLine:markets.ou.line.now,ahH:markets.ah.nowHome,ahA:markets.ah.nowAway,ouO:markets.ou.nowHome,ouU:markets.ou.nowAway};
    if(!hist[id]) hist[id]=[]; const last=hist[id][hist[id].length-1]; const ch=!last||last.ahLine!==snap.ahLine||last.ouLine!==snap.ouLine||last.ahH!==snap.ahH||last.ahA!==snap.ahA||last.ouO!==snap.ouO||last.ouU!==snap.ouU; if(ch) hist[id].push(snap); if(hist[id].length>60) hist[id]=hist[id].slice(-60);
    out.history={snapshots:hist[id].length,moves:Math.max(0,hist[id].length-1)}; }
  return out;
}
// ---- normalisasi odds-api.io ----
function bookArr(ev,name){ const bs=ev.bookmakers||{}; return bs[name]||bs[name.toLowerCase()]||bs[name.toUpperCase()]||null; }
function marketEntries(arr,names){ if(!Array.isArray(arr)) return null; for(const n of names){ const m=arr.find(x=>(x.name||'').toLowerCase()===n.toLowerCase()); if(m&&Array.isArray(m.odds)) return m.odds; } return null; }
function entryLine(o){ return num(o.hdp!=null?o.hdp:o.max); }
function entrySides(o){ const a=o.home!=null?num(o.home):num(o.over),b=o.away!=null?num(o.away):num(o.under); return [a,b]; }
function pickMainLine(odds,lo,hi){ if(!Array.isArray(odds)) return null; let best=null,bd=Infinity; for(const o of odds){ const line=entryLine(o),[a,b]=entrySides(o); if(a==null||b==null||line==null) continue; if(lo!=null&&(line<lo||line>hi)) continue; const d=Math.abs(a-b); if(d<bd){bd=d;best={line,a,b};} } return best; }
function pickAtLine(odds,line){ if(!Array.isArray(odds)||line==null) return null; for(const o of odds){ if(entryLine(o)===line){ const [a,b]=entrySides(o); if(a!=null&&b!=null) return {line,a,b}; } } return null; }
function emptyMarket(){ return {line:{open:null,now:null},openHome:null,openAway:null,nowHome:null,nowAway:null,pub:null}; }
function buildLiveMarket(refOdds,pubOdds,lo,hi){ const ref=pickMainLine(refOdds,lo,hi); if(!ref) return emptyMarket(); const pub=pickAtLine(pubOdds,ref.line); return {line:{open:ref.line,now:ref.line},openHome:ref.a,openAway:ref.b,nowHome:ref.a,nowAway:ref.b,pub:pub?{line:pub.line,home:pub.a,away:pub.b}:null}; }
function normalizeOddsApiIo(events){
  if(!Array.isArray(events)) return []; const out=[];
  for(const ev of events){
    const sb=bookArr(ev,'Sbobet'),pb=bookArr(ev,'Bet365');
    const sbSpread=marketEntries(sb,['Spread','Asian Handicap']),pbSpread=marketEntries(pb,['Spread','Asian Handicap']),sbTotals=marketEntries(sb,['Totals','Over/Under']),pbTotals=marketEntries(pb,['Totals','Over/Under']);
    let ah; if(pickMainLine(sbSpread,-6,6)) ah=buildLiveMarket(sbSpread,pbSpread,-6,6); else ah=buildLiveMarket(pbSpread,sbSpread,-6,6);
    let ou; if(pickMainLine(sbTotals,0.5,5.5)) ou=buildLiveMarket(sbTotals,pbTotals,0.5,5.5); else ou=buildLiveMarket(pbTotals,sbTotals,0.5,5.5);
    if((ah.nowHome==null)&&(ou.nowHome==null)) continue;
    const corner=buildLiveMarket(marketEntries(sb,['Totals']),null,7,16),cornerHT=buildLiveMarket(marketEntries(sb,['Totals HT']),null,3.5,9);
    const ml=(marketEntries(sb,['ML','1X2','Match Winner'])||[])[0]||(marketEntries(pb,['ML','1X2','Match Winner'])||[])[0]||null,win=ml?noVig3(ml.home,ml.draw,ml.away):null;
    out.push({id:String(ev.id||ev.eventId),home:ev.home,away:ev.away,group:(ev.league&&(ev.league.name||ev.league))||ev.leagueName||null,kickoff:ev.date||ev.commenceTime,status:ev.status||'pending',win,ah,ou,corner,cornerHT,card:emptyMarket()});
  }
  return out;
}

// ===================== AMBIL DATA (Worker fetch) =====================
async function jget(url){ const r=await fetch(url,{cf:{cacheTtl:0}}); if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }
async function fetchLive(key){
  const k=encodeURIComponent(key);
  const evRes=await jget(`${ODDS_BASE}/events?sport=football&apiKey=${k}`);
  const upcoming=Array.isArray(evRes)?evRes:(evRes.events||evRes.data||[]);
  let live=[]; try{ const lv=await jget(`${ODDS_BASE}/events/live?apiKey=${k}`); live=Array.isArray(lv)?lv:(lv.events||lv.data||[]); }catch(e){}
  const seen=new Set(),merged=[]; for(const e of [...live,...upcoming]){ const id=e.id||e.eventId; if(id==null||seen.has(id)) continue; seen.add(id); merged.push(e); }
  const isWC=e=>/world[ -]?cup|piala dunia|fifa world/i.test(JSON.stringify(e.league||e.leagueName||e.competition||''));
  const notDone=e=>{ const s=String(e.status||'').toLowerCase(); return s!=='settled'&&s!=='finished'&&s!=='cancelled'&&s!=='ft'; };
  let wc=merged.filter(e=>isWC(e)&&notDone(e)); if(!wc.length) wc=merged.filter(notDone);
  // utamakan yang live + terdekat, batasi LIMIT (hemat CPU)
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
  const summary={total:matches.length,live:matches.filter(m=>m.live).length,trapped:matches.filter(m=>m.conclusion&&m.conclusion.trapped).length,favoriteTraps:matches.filter(m=>m.verdict&&/Jebakan favorit/i.test(m.verdict.text)).length,clean:matches.filter(m=>m.verdict&&m.verdict.light==='green').length};
  const out={generatedAt:new Date().toISOString(),source:'odds-api.io / SBOBET (Cloudflare LIVE)',isDemo:false,reference:'SBOBET',compare:'Bet365 (publik)',markets:['Handicap','Over/Under','Corner FT','Corner B1','Kartu'],summary,note:'Alat informasi pergerakan odds. Tidak melacak taruhan siapa pun. Bukan jaminan untung.',matches};
  try{ await cache.put(HIST_KEY,new Response(JSON.stringify(hist),{headers:{'Cache-Control':'max-age=86400'}})); }catch(e){}
  return out;
}

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};

export default {
  async fetch(request, env, ctx){
    if(request.method==='OPTIONS') return new Response(null,{headers:CORS});
    if(!env.ODDS_API_IO_KEY) return new Response(JSON.stringify({error:'ODDS_API_IO_KEY belum diset (Settings → Variables → Secret)'}),{status:500,headers:CORS});
    const cache=caches.default;
    // sajikan dari cache bila masih segar (<60 dtk)
    try{ const c=await cache.match(CACHE_KEY); if(c){ const data=await c.clone().json(); if(Date.now()-new Date(data.generatedAt).getTime()<TTL_MS) return new Response(JSON.stringify(data),{headers:CORS}); } }catch(e){}
    try{
      const out=await buildOutput(env);
      ctx.waitUntil(cache.put(CACHE_KEY,new Response(JSON.stringify(out),{headers:{'Cache-Control':'max-age=120'}})));
      return new Response(JSON.stringify(out),{headers:CORS});
    }catch(e){
      // kalau gagal tarik, sajikan cache lama bila ada
      try{ const c=await cache.match(CACHE_KEY); if(c) return new Response(c.body,{headers:CORS}); }catch(_){}
      return new Response(JSON.stringify({error:String(e)}),{status:502,headers:CORS});
    }
  },
  // Cron (opsional) — hangatkan cache tiap 1 menit
  async scheduled(event, env, ctx){
    if(!env.ODDS_API_IO_KEY) return;
    try{ const out=await buildOutput(env); await caches.default.put(CACHE_KEY,new Response(JSON.stringify(out),{headers:{'Cache-Control':'max-age=120'}})); }catch(e){}
  }
};
