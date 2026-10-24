const $ = id => document.getElementById(id);
const palette = ['#fa5874','#4dd9ad','#69b8ff','#f6c46a','#bb91fb','#ff9670','#76e4e8','#e67ab5','#a1dc72','#e6a879','#9aafff','#f2db73'];
const state = {series:[], selected:new Set(), colors:{}, quantities:{}, presets:[], rates:null, rateDate:'', rateError:'', ratio:'9:16', elapsed:0, playing:false, lastTick:0, exporting:false, hover:null, importTarget:null};
const canvas = $('chart'), ctx = canvas.getContext('2d');
const fmtMoney = (n,c='CNY',compact=true) => {
  if(!Number.isFinite(n)) return '—';
  const prefix = c==='USD'?'$':c==='EUR'?'€':'';
  if(compact && Math.abs(n)>=100000000) return prefix+(n/100000000).toFixed(2)+'亿';
  if(compact && Math.abs(n)>=10000) return prefix+(n/10000).toFixed(1)+'万';
  return prefix+n.toLocaleString('zh-CN',{maximumFractionDigits:2})+(c==='CNY'?'元':'');
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function toast(message){const el=$('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.add('hidden'),3500)}
async function api(path,options={}){const response=await fetch(path,options);let body;try{body=await response.json()}catch{body={detail:'服务器响应无法解析'}}if(!response.ok)throw Error(body.detail||'请求失败');return body}
const post=(path,obj)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
function applyRates(data,stale=false){const cny=Number(data?.rates?.CNY),eur=Number(data?.rates?.EUR);if(!Number.isFinite(cny)||cny<=0||!Number.isFinite(eur)||eur<=0)return false;state.rates={USD:1,CNY:cny,EUR:eur};state.rateDate=data.date||'';state.rateError='';$('rateInfo').textContent=`参考汇率：1 USD = ${state.rates.CNY.toFixed(4)} CNY · ${state.rates.EUR.toFixed(5)} EUR（${state.rateDate}${stale?' · 缓存':''}）`;render();return true}
async function loadRates(){let cached=null;try{cached=JSON.parse(localStorage.getItem('skinRevealFxRates')||'null');if(cached)applyRates(cached,true)}catch{}if(cached?.savedAt&&Date.now()-cached.savedAt<12*3600*1000)return;try{const response=await fetch('https://api.frankfurter.dev/v2/rates?base=USD&quotes=CNY,EUR');if(!response.ok)throw Error(`汇率服务 HTTP ${response.status}`);const rows=await response.json();if(!Array.isArray(rows))throw Error('汇率服务返回格式无效');const data={date:rows.find(row=>row&&row.base==='USD')?.date,rates:Object.fromEntries(rows.filter(row=>row&&row.base==='USD'&&['CNY','EUR'].includes(row.quote)&&Number.isFinite(row.rate)&&row.rate>0).map(row=>[row.quote,row.rate]))};if(!applyRates(data))throw Error('汇率服务没有返回 CNY/EUR 汇率');try{localStorage.setItem('skinRevealFxRates',JSON.stringify({...data,savedAt:Date.now()}))}catch{}}catch(e){state.rateError=e.message;if(cached)applyRates(cached,true);else $('rateInfo').textContent='汇率获取失败：'+e.message+'；请检查网络连接';render()}}
function config(){return {selected:[...state.selected],colors:state.colors,quantities:state.quantities,ratio:state.ratio,names:$('names').value,start:$('start').value,end:$('end').value,currency:$('currency').value,metric:$('metric').value,interval:$('interval').value,title:$('title').value,normalize:$('normalize').checked,logscale:$('logscale').checked,grid:$('grid').checked,watermark:$('watermark').checked,duration:$('duration').value,fps:$('fps').value,format:$('format').value}}
function applyConfig(c){for(const id of ['names','start','end','currency','metric','title','duration','fps','format'])if(c[id]!==undefined)$(id).value=c[id];$('interval').value=c.interval||'month';for(const id of ['normalize','logscale','grid','watermark'])if(c[id]!==undefined)$(id).checked=!!c[id];state.selected=new Set(c.selected||[]);state.colors=c.colors||{};state.quantities=c.quantities||{};setRatio(c.ratio||'9:16');renderList();render()}
function setRatio(r){state.ratio=r;document.querySelectorAll('[data-ratio]').forEach(b=>b.classList.toggle('active',b.dataset.ratio===r));const sizes={'9:16':[720,1280],'16:9':[1280,720],'1:1':[900,900]};[canvas.width,canvas.height]=sizes[r];render()}
async function reload(){const [catalog,presets]=await Promise.all([api('/api/catalog'),api('/api/presets')]);state.series=catalog.series;state.presets=presets;state.selected=new Set([...state.selected].filter(id=>state.series.some(s=>s.id===id)));renderList();renderPresets();render()}
function renderList(){const el=$('seriesList');$('seriesCount').textContent=state.series.length;if(!state.series.length){el.innerHTML='<div class="muted">还没有导入数据</div>';return}el.innerHTML='';state.series.forEach((s,i)=>{const row=document.createElement('div');row.className='series-item';const check=document.createElement('input');check.type='checkbox';check.checked=state.selected.has(s.id);check.onchange=()=>{check.checked?state.selected.add(s.id):state.selected.delete(s.id);render()};const label=document.createElement('b');label.textContent=s.name;const small=document.createElement('small');small.textContent=`${s.source} · ${s.rows.length} 点`;label.appendChild(small);const qty=document.createElement('input');qty.type='number';qty.min='1';qty.step='1';qty.title=`${s.name} 买入件数`;qty.setAttribute('aria-label',`${s.name} 买入件数`);qty.value=String(Math.max(1,Math.floor(Number(state.quantities[s.id])||1)));qty.onchange=()=>{const value=Math.max(1,Math.floor(Number(qty.value)||1));qty.value=String(value);state.quantities[s.id]=value;render()};const unit=document.createElement('span');unit.className='quantity-unit';unit.textContent='件';const color=document.createElement('input');color.type='color';color.value=state.colors[s.id]||palette[i%palette.length];color.oninput=()=>{state.colors[s.id]=color.value;render()};const del=document.createElement('button');del.textContent='×';del.title='删除本地数据';del.onclick=async()=>{await api('/api/series/'+encodeURIComponent(s.id),{method:'DELETE'});state.selected.delete(s.id);delete state.quantities[s.id];await reload()};row.append(check,label,qty,unit,color,del);el.appendChild(row)})}
function renderPresets(){const el=$('presets');el.innerHTML='';if(!state.presets.length){el.innerHTML='<div class="muted">还没有保存预设</div>';return}for(const p of state.presets){const row=document.createElement('div');row.className='preset';const link=document.createElement('a');link.textContent=p.title;link.onclick=()=>{applyConfig(p.config);toast('已载入预设')};const del=document.createElement('button');del.textContent='×';del.onclick=async()=>{await api('/api/presets/'+p.id,{method:'DELETE'});await reload()};row.append(link,del);el.append(row)}}
function selectedSeries(){return state.series.filter(s=>state.selected.has(s.id))}
function resamplePoints(points,interval){if(interval==='raw'||points.length<2)return points;const buckets=new Map();for(const p of points){const date=new Date(p.t),year=date.getUTCFullYear(),month=date.getUTCMonth();const key=interval==='quarter'?`${year}-Q${Math.floor(month/3)+1}`:`${year}-${month}`;buckets.set(key,p)}const kept=[points[0]];for(const p of buckets.values())if(p.t!==kept.at(-1).t)kept.push(p);return kept}
function dataset(){const c=config(),start=Date.parse(c.start||'2013-01-01'),end=Date.parse(c.end||new Date().toISOString().slice(0,10));const items=selectedSeries().map((s,i)=>{const source=s.currency||(/CSGOSKINS|API JSON/i.test(s.source)?'USD':'CNY'),factor=state.rates&&state.rates[source]&&state.rates[c.currency]?state.rates[c.currency]/state.rates[source]:(source===c.currency?1:null);return {...s,quantity:Math.max(1,Math.floor(Number(state.quantities[s.id])||1)),color:state.colors[s.id]||palette[state.series.indexOf(s)%palette.length],points:factor===null?[]:resamplePoints(s.rows.map(r=>({t:Date.parse(r.date),date:r.date,raw:r[s.metric_only||c.metric]*factor})).filter(p=>Number.isFinite(p.raw)&&p.t>=start&&p.t<=end).sort((a,b)=>a.t-b.t),c.interval)}}).filter(s=>s.points.length>=2);if(!items.length)return null;const minT=Math.min(...items.map(s=>s.points[0].t)),maxT=Math.max(...items.map(s=>s.points.at(-1).t));for(const s of items){s.base=s.points[0].raw;for(const p of s.points)p.value=c.normalize?p.raw/s.base*100:p.raw*s.quantity}return {items,minT,maxT,c}}
function interpolate(points,t){if(t<=points[0].t)return points[0];if(t>=points.at(-1).t)return points.at(-1);let lo=0,hi=points.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid].t<t)lo=mid;else hi=mid}const a=points[lo],b=points[hi],f=(t-a.t)/(b.t-a.t||1);return {t,date:new Date(t).toISOString().slice(0,10),raw:a.raw+(b.raw-a.raw)*f,value:a.value+(b.value-a.value)*f}}
function nice(v){if(v<=0)return 1;const e=10**Math.floor(Math.log10(v)),f=v/e;return (f<=1?1:f<=2?2:f<=5?5:10)*e}
function label(ctx,text,x,y,color,size=25,align='left',bold=true){ctx.font=`${bold?700:400} ${size}px "Microsoft YaHei",sans-serif`;ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,x,y)}
function rect(ctx,x,y,w,h,fill,r=0){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
function draw(target,seconds,w=target.canvas.width,h=target.canvas.height){
  const data=dataset();target.clearRect(0,0,w,h);target.fillStyle='#0d121a';target.fillRect(0,0,w,h);
  const portrait=h>w,scale=w/(portrait?720:1280), intro=.6, dur=Number($('duration').value), revealEnd=dur-3;
  target.save();target.scale(scale,scale);const W=w/scale,H=h/scale;
  const g=target.createRadialGradient(W*.52,H*.32,20,W*.52,H*.35,H*.8);g.addColorStop(0,'#18222a');g.addColorStop(.55,'#101721');g.addColorStop(1,'#0b1017');target.fillStyle=g;target.fillRect(0,0,W,H);
  if(!data){target.restore();return}
  const {items,minT,maxT,c}=data,progress=clamp((seconds-intro)/(revealEnd-intro),0,1),t=minT+(maxT-minT)*progress;
  const fade=clamp(seconds/intro,0,1);target.globalAlpha=fade;
  const title=c.title.trim()||`假如 ${new Date(minT).getFullYear()} 年买入 ${items.length===1?`${items[0].quantity} 件 ${items[0].name}`:`${items.length} 种 CS 饰品`}`;
  const top=portrait?110:70;
  label(target,title,W/2,top,'#f4f5f7',portrait?28:28,'center');
  rect(target,W/2-24,top+31,48,2,'#4bca9d');
  label(target,items.length===1?'一直持有 · 红利复投':'多件饰品 · 历史价格对比',W/2,top+51,'#6ec59d',16,'center',false);
  const single=items.length===1;
  const first=items[0],current=interpolate(first.points,t),invest=first.base*first.quantity,now=current.raw*first.quantity,rate=now/invest-1;
  const mainColor=rate>=0?'#f15a77':'#56d9ae';
  if(single){label(target,(rate>=0?'+':'')+(rate*100).toFixed(2)+'%',W-40,top+100,mainColor,portrait?36:37,'right');label(target,(rate>=0?'+':'')+fmtMoney(now-invest,c.currency),W-40,top+138,mainColor,18,'right',false);label(target,new Date(t).toISOString().slice(0,10),W-40,top+174,'#c6cdd5',18,'right',false)}
  const L=portrait?98:96,R=portrait?85:73,T=portrait?300:182,B=portrait?190:86;
  const plot={x:L,y:T,w:W-L-R,h:H-T-B};
  let windowStart=minT,windowEnd=maxT;
  if(single){const span=Math.max(30*86400000,(maxT-minT)*.24);windowStart=Math.max(minT,t-span*.68);windowEnd=windowStart+span;if(windowEnd>maxT){windowEnd=maxT;windowStart=Math.max(minT,maxT-span)}}
  const windowPoints=[];for(const s of items){for(const p of s.points)if(p.t>=windowStart&&p.t<=t)windowPoints.push(p.value);if(t>=s.points[0].t)windowPoints.push(interpolate(s.points,t).value)}
  const vals=windowPoints.filter(v=>Number.isFinite(v)&&v>0),vmin=Math.min(...vals),vmax=Math.max(...vals);
  let yMin=Math.max(.00001,vmin-(vmax-vmin)*.18),yMax=vmax+(vmax-vmin)*.18;
  if(yMax<=yMin){yMin=vmin*.8;yMax=vmax*1.2}
  if(c.logscale){yMin=Math.max(.00001,yMin);yMax=Math.max(yMin*1.001,yMax)}
  const yy=v=>{const a=c.logscale?Math.log(yMin):yMin,b=c.logscale?Math.log(yMax):yMax,q=c.logscale?Math.log(Math.max(v,.00001)):v;return plot.y+plot.h-(q-a)/(b-a)*plot.h};
  const xx=ts=>plot.x+(ts-windowStart)/(windowEnd-windowStart||1)*plot.w;
  if(c.grid){target.strokeStyle='#ffffff23';target.lineWidth=1;for(let i=0;i<=5;i++){const y=plot.y+plot.h*i/5;target.beginPath();target.moveTo(plot.x,y);target.lineTo(plot.x+plot.w,y);target.stroke();const val=c.logscale?Math.exp(Math.log(yMax)+(Math.log(yMin)-Math.log(yMax))*i/5):yMax+(yMin-yMax)*i/5;label(target,c.normalize?val.toFixed(0):fmtMoney(val,c.currency),plot.x-10,y,'#85909c',12,'right',false)}}
  target.save();target.beginPath();target.rect(plot.x,plot.y,plot.w,plot.h);target.clip();
  const headLabels=[];
  for(let i=0;i<items.length;i++){
    const s=items[i];if(t<s.points[0].t)continue;
    const line=s.points.filter(p=>p.t>=windowStart&&p.t<=t);if(line.length===0||line[0].t>windowStart)line.unshift(interpolate(s.points,Math.max(windowStart,s.points[0].t)));
    const end=interpolate(s.points,t);if(end.t>s.points[0].t&&line.at(-1).t<end.t)line.push(end);
    if(line.length<2)continue;
    target.lineCap='round';target.lineJoin='round';target.shadowBlur=0;
    for(let k=1;k<line.length;k++){
      const a=line[k-1],b=line[k],color=single?(b.value>=a.value?'#f15a77':'#4cd4a8'):s.color;
      target.strokeStyle=color;target.lineWidth=single?2.7:3.2;target.beginPath();target.moveTo(xx(a.t),yy(a.value));target.lineTo(xx(b.t),yy(b.value));target.stroke();
    }
    const x=xx(end.t),y=yy(end.value),headColor=single?(end.value>=line[line.length-2].value?'#f15a77':'#4cd4a8'):s.color;target.shadowColor=headColor;target.shadowBlur=18;target.fillStyle=headColor;target.beginPath();target.arc(x,y,8,0,Math.PI*2);target.fill();target.shadowBlur=0;
    headLabels.push({s,x,y,end,headColor});
  }
  target.restore();
  headLabels.sort((a,b)=>a.y-b.y);let previous=plot.y+10;for(const a of headLabels){a.labelY=clamp(Math.max(a.y,previous+36),plot.y+15,plot.y+plot.h-20);previous=a.labelY}
  if(seconds<revealEnd)for(const a of headLabels){const {s,x,y,end,labelY,headColor:color}=a;const text=single?fmtMoney(end.raw*s.quantity,c.currency):`${s.name} ×${s.quantity}  ${fmtMoney(end.raw*s.quantity,c.currency)}`;target.font=`700 ${single?27:17}px "Microsoft YaHei",sans-serif`;const tw=target.measureText(text).width;const bx=clamp(x+14,plot.x+5,W-tw-24);if(Math.abs(labelY-y)>7){target.strokeStyle=color+'aa';target.beginPath();target.moveTo(x,y);target.lineTo(bx,labelY);target.stroke()}rect(target,bx-5,labelY-19,tw+14,38,'#101720e8',8);label(target,text,bx+2,labelY,color,single?27:17)}
  for(let i=0;i<=5;i++){const d=new Date(windowStart+(windowEnd-windowStart)*i/5);label(target,d.toISOString().slice(0,7),plot.x+plot.w*i/5,plot.y+plot.h+31,'#8b96a4',12,'center',false)}
  if(!single){const legendY=portrait?H-130:H-45;items.slice(0,8).forEach((s,i)=>{const column=i%2,row=Math.floor(i/2),x=plot.x+column*(W/2),y=legendY+row*23;rect(target,x,y-5,11,11,s.color,3);label(target,`${s.name} ×${s.quantity}件`,x+18,y,'#c3ced7',13)})}
  const footY=H-35;label(target,'数据来源：'+[...new Set(items.map(s=>s.source))].join(' / '),plot.x,footY,'#6a7581',11,'left',false);if(c.watermark)label(target,'SKIN REVEAL',W-35,footY,'#77838d',12,'right');
  if(items.some(s=>s.source.includes('演示')))label(target,'演示数据 · 非真实历史价',W/2,H-73,'#e4bd5b',13,'center');
  if(seconds>=revealEnd){const alpha=clamp((seconds-revealEnd)/.45,0,1);target.save();target.globalAlpha=alpha*.96;rect(target,plot.x-20,plot.y+plot.h*.14,plot.w+40,plot.h*.72,'#0d131dea',18);target.globalAlpha=alpha;if(single){const last=first.points.at(-1),lastValue=last.raw*first.quantity,returnPct=(lastValue/invest-1)*100;label(target,`当年买入 ${first.quantity} 件 ${first.name}`,W/2,plot.y+plot.h*.26,'#e5e9ef',portrait?24:26,'center');label(target,'买入成本 '+fmtMoney(invest,c.currency),W/2,plot.y+plot.h*.34,'#aebbc5',portrait?21:22,'center',false);label(target,'如今价值',W/2,plot.y+plot.h*.43,'#e5c169',portrait?25:26,'center');label(target,fmtMoney(lastValue,c.currency),W/2,plot.y+plot.h*.54,'#f15a77',portrait?74:80,'center');label(target,(returnPct>=0?'↗ +':'↘ ')+returnPct.toFixed(1)+'% · '+(lastValue/invest).toFixed(2)+'×',W/2,plot.y+plot.h*.65,returnPct>=0?'#8bd6ac':'#f18c9e',portrait?31:32,'center')}else{label(target,'从当年到现在',W/2,plot.y+plot.h*.27,'#e9c56e',31,'center');items.slice(0,7).forEach((s,i)=>{const last=s.points.at(-1),gain=last.raw/s.base,cost=s.base*s.quantity,value=last.raw*s.quantity;label(target,`${s.name} ×${s.quantity}件   ${fmtMoney(cost,c.currency)} → ${fmtMoney(value,c.currency)}  (${gain.toFixed(2)}×)`,W/2,plot.y+plot.h*.36+i*38,gain>=1?'#d8e5e1':'#e49a9a',portrait?17:20,'center')})}target.restore()}
  if(state.hover!==null&&target===ctx&&!state.exporting){const hoverT=windowStart+(windowEnd-windowStart)*state.hover;const hoverX=xx(hoverT);if(hoverX>=plot.x&&hoverX<=plot.x+plot.w){target.setLineDash([4,5]);target.strokeStyle='#e9bf66aa';target.beginPath();target.moveTo(hoverX,plot.y);target.lineTo(hoverX,plot.y+plot.h);target.stroke();target.setLineDash([]);const date=new Date(hoverT).toISOString().slice(0,10),values=items.filter(s=>hoverT>=s.points[0].t).map(s=>`${s.name} ×${s.quantity}件: ${fmtMoney(interpolate(s.points,hoverT).raw*s.quantity,c.currency)}`);$('hoverInfo').textContent=date+' · '+values.join('  |  ')}}
  target.restore();
}
function render(){const data=dataset();$('empty').classList.toggle('hidden',!!data);if(data)draw(ctx,state.elapsed);const intervalLabel=$('interval').selectedOptions[0].textContent;const counts=data?.items.map(s=>s.points.length)||[];$('samplingInfo').textContent=counts.length?`● ${intervalLabel} · ${Math.min(...counts)}${Math.min(...counts)===Math.max(...counts)?'':`–${Math.max(...counts)}`} 点/条`:'● 实时画布渲染';const dur=Number($('duration').value);$('clock').textContent=`${String(Math.floor(state.elapsed/60)).padStart(2,'0')}:${String(Math.floor(state.elapsed%60)).padStart(2,'0')} / 00:${String(dur).padStart(2,'0')}`;$('progress').value=String(Math.round(state.elapsed/dur*1000))}
function tick(ts){if(state.playing){if(!state.lastTick)state.lastTick=ts;state.elapsed+=Math.min((ts-state.lastTick)/1000,.2)*Number($('speed').value);state.lastTick=ts;const dur=Number($('duration').value);if(state.elapsed>=dur){state.elapsed=dur;state.playing=false;$('play').textContent='↺'}render()}requestAnimationFrame(tick)}requestAnimationFrame(tick);
async function importFile(file,name='',sourceCurrency=$('currency').value){const fd=new FormData();fd.append('file',file);fd.append('name',name);fd.append('currency',sourceCurrency);const item=await api('/api/import/csv',{method:'POST',body:fd});state.selected.add(item.id);await reload();return item}
async function loadDemo(){try{for(const [file,name] of [['dragon_lore_demo.csv','龙狙 · 演示'],['howl_demo.csv','咆哮 · 演示']]){const existing=state.series.find(s=>s.name===name&&s.source.includes('演示'));if(existing){state.selected.add(existing.id);continue}const response=await fetch('/samples/'+file);await importFile(new File([await response.blob()],file,{type:'text/csv'}),name,'CNY')}renderList();$('start').value='2016-01-01';$('end').value='2026-01-01';toast('演示数据已加载；请勿将其当成真实历史价');render()}catch(e){toast(e.message)}}
async function exportVideo(){if(state.exporting)return;if(!dataset())return toast('请先选择至少一组价格数据');const format=$('format').value;const health=await api('/api/health');if(format!=='webm'&&!health.ffmpeg)return toast('未找到 ffmpeg，请改导出 WebM');if(!window.MediaRecorder)return toast('当前浏览器不支持视频录制');state.exporting=true;state.playing=false;$('export').disabled=true;$('exportProgress').classList.remove('hidden');$('download').classList.add('hidden');const r=state.ratio,sizes={'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080]},[w,h]=sizes[r],off=document.createElement('canvas');off.width=w;off.height=h;const offctx=off.getContext('2d');const fps=Number($('fps').value),dur=Number($('duration').value);const stream=off.captureStream(fps),mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';const rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6500000}),chunks=[];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const done=new Promise((resolve,reject)=>{rec.onstop=resolve;rec.onerror=reject});rec.start(1000);const t0=performance.now();await new Promise(resolve=>{function frame(){const e=(performance.now()-t0)/1000;draw(offctx,Math.min(dur,e),w,h);const pct=Math.min(100,Math.round(e/dur*100));$('exportPercent').textContent=pct+'%';$('exportBar').style.width=pct+'%';$('exportLabel').textContent='正在录制画布…';if(e<dur)requestAnimationFrame(frame);else resolve()}frame()});rec.stop();await done;stream.getTracks().forEach(x=>x.stop());$('exportLabel').textContent='正在转换 '+format.toUpperCase()+'…';const fd=new FormData();fd.append('file',new Blob(chunks,{type:'video/webm'}),'capture.webm');fd.append('format',format);try{const result=await api('/api/convert',{method:'POST',body:fd});const link=$('download');link.href=result.url;link.download=result.url.split('/').at(-1);link.textContent=`下载 ${format.toUpperCase()} · ${(result.bytes/1024/1024).toFixed(1)} MB ↗`;link.classList.remove('hidden');$('exportLabel').textContent='导出完成';toast('视频已导出')}catch(e){$('exportLabel').textContent='导出失败';toast(e.message)}finally{state.exporting=false;$('export').disabled=false}}
$('chooseCsv').onclick=()=>$('csvFile').click();$('csvFile').onchange=async e=>{const files=[...e.target.files],target=files.length===1?state.importTarget:null;for(const file of files){try{await importFile(file,target?.display||'');toast('已导入 '+(target?.display||file.name))}catch(err){toast(file.name+'：'+err.message)}}if(target){state.importTarget=null;$('targetInfo').classList.add('hidden')}e.target.value=''};
$('loadDemo').onclick=loadDemo;$('jsonToggle').onclick=()=>$('jsonBox').classList.toggle('hidden');$('importJson').onclick=async()=>{try{const item=await post('/api/import/json',{name:$('jsonName').value,phase:$('jsonPhase').value||null,text:$('jsonText').value});state.selected.add(item.id);await reload();toast('官方 API JSON 已导入')}catch(e){toast(e.message)}};
const wearZh={'Factory New':'崭新出厂','Minimal Wear':'略有磨损','Field-Tested':'久经沙场','Well-Worn':'破损不堪','Battle-Scarred':'战痕累累'};
function selectField(values,placeholder,current){const el=document.createElement('select');for(const [value,label] of [['',placeholder],...values]){const o=document.createElement('option');o.value=value;o.textContent=label;el.append(o)}el.value=current||'';return el}
$('resolve').onclick=async()=>{try{
  const matches=await post('/api/match',{text:$('names').value}),list=$('candidates');list.innerHTML='';
  if(!matches.length)return toast('请先输入饰品名称');
  for(const m of matches){
    const row=document.createElement('div');row.className='candidate variant-card';
    const title=document.createElement('strong');title.textContent=m.match?`${m.input} → ${m.match}`:`${m.input} → 未识别`;
    const details=document.createElement('div');details.className='variant-details';
    if(m.error){details.textContent=m.error;row.append(title,details);list.append(row);continue}
    if(!m.match){details.textContent='可按 CSV 文件名导入；不会自动匹配到其他饰品的价格。';row.append(title,details);list.append(row);continue}
    const doppler=m.available_phases.length>0;
    const wear=selectField(m.available_wears.map(v=>[v,`${wearZh[v]}${doppler?(v==='Factory New'?' · 0.00–0.07':' · 0.07–0.08'):''}`]),'选择磨损度',m.wear);
    const phase=m.available_phases.length?selectField(m.available_phases.map(v=>[v,v]),'选择相位（可留空）',m.phase):null;
    const stattrak=document.createElement('label');stattrak.className='variant-check';const check=document.createElement('input');check.type='checkbox';check.checked=m.stattrak;stattrak.append(check,document.createTextNode(' StatTrak™'));
    const action=document.createElement('button');action.className='small-btn';action.textContent='选择此规格';
    const auto=document.createElement('button');auto.className='small-btn auto-read';auto.textContent='自动读取走势图';
    const status=document.createElement('div');status.className='variant-status';
    const source=m.match==='★ Butterfly Knife | Doppler'?document.createElement('a'):null;
    if(source){source.className='variant-source';source.target='_blank';source.rel='noopener noreferrer'}
    const refresh=()=>{const base=check.checked?(m.match.startsWith('★ ')?m.match.replace('★ ','★ StatTrak™ '):`StatTrak™ ${m.match}`):m.match;const hash=`${base}${wear.value?` (${wear.value})`:''}`,p=phase?.value||'';const display=hash+(p?` · ${p}`:'');const existing=state.series.find(s=>s.name===display);status.textContent=`${hash}${p?` · phase: ${p}`:''} · ${existing?'已有本地价格':'暂无本地历史价格'}`;action.disabled=!wear.value||!!(phase&&!p);auto.disabled=action.disabled;if(source){source.href=p==='Ruby'?'https://csgoskins.gg/items/butterfly-knife-doppler-ruby':'https://csgoskins.gg/items/butterfly-knife-doppler';source.textContent=p==='Ruby'?'查看红宝石蝴蝶刀资料 ↗':'查看多普勒蝴蝶刀资料 ↗'}return {hash,p,display,existing}};
    wear.onchange=refresh;if(phase)phase.onchange=refresh;check.onchange=refresh;
    action.onclick=()=>{const selected=refresh();if(selected.existing){state.selected.add(selected.existing.id);renderList();render();toast('已选择本地价格数据');return}state.importTarget=selected;$('targetInfo').textContent=`待导入：${selected.display}。选择一份该规格的 CSV，或在下方粘贴官方 JSON；不会拿普通多普勒的价格代替红宝石。`;$('targetInfo').classList.remove('hidden');$('jsonName').value=selected.hash;$('jsonPhase').value=selected.p;toast('规格已选定，请导入对应历史价格')};
    auto.onclick=async()=>{
      if(document.documentElement.dataset.skinRevealReader!=='ready'){$('readerInfo').classList.remove('hidden');return toast('请先在 Edge 安装本地读取助手并刷新网页')}
      const selected=refresh();auto.disabled=true;status.textContent='正在打开网站并等待历史价…';
      const page=window.open('about:blank','_blank');
      try{if(!page){status.textContent='浏览器阻止了新窗口';return toast('请允许本地网页打开新标签页')}
        const job=await post('/api/page-import/start',{market_hash_name:selected.hash,phase:selected.p||null});page.opener=null;page.location.href=job.url;
        for(let n=0;n<180;n++){await new Promise(resolve=>setTimeout(resolve,1000));const result=await api('/api/page-import/'+job.id);if(result.status==='ready'){state.selected=new Set([result.item_id]);await reload();status.textContent=`${selected.display} · 已导入真实历史价`;toast('网站历史价已导入');return}if(result.status==='error')throw Error(result.error)}
        status.textContent='等候超时：请检查网站安全验证或读取助手';toast('未能读取网页，可改用 CSV/JSON 导入');
      }catch(e){status.textContent='自动读取失败：'+e.message;toast(e.message)}finally{auto.disabled=false}
    };
    details.append(wear);if(phase)details.append(phase);if(doppler)details.append(stattrak);details.append(action,auto);row.append(title,details,status);
    if(source)row.append(source);
    list.append(row);refresh();
  }
}catch(e){toast(e.message)}};
$('savePreset').onclick=async()=>{const title=prompt('预设名称',config().title||'我的走势');if(title===null)return;try{await post('/api/presets',{title,config:config()});await reload();toast('预设已保存')}catch(e){toast(e.message)}};
document.querySelectorAll('[data-ratio]').forEach(b=>b.onclick=()=>setRatio(b.dataset.ratio));
$('play').onclick=()=>{if(state.elapsed>=Number($('duration').value))state.elapsed=0;state.playing=!state.playing;state.lastTick=0;$('play').textContent=state.playing?'Ⅱ':'▶';render()};$('step').onclick=()=>{state.playing=false;state.elapsed=clamp(state.elapsed+Number($('duration').value)/120,0,Number($('duration').value));$('play').textContent='▶';render()};$('progress').oninput=e=>{state.elapsed=Number(e.target.value)/1000*Number($('duration').value);state.lastTick=0;render()};$('png').onclick=()=>{if(!dataset())return toast('画布还没有数据');canvas.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='skin-reveal-frame.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)})};$('export').onclick=()=>exportVideo().catch(e=>{state.exporting=false;$('export').disabled=false;toast(e.message)});
canvas.onmousemove=e=>{const rect=canvas.getBoundingClientRect(),portrait=canvas.height>canvas.width,W=portrait?720:1280,x=(e.clientX-rect.left)/rect.width*W,L=portrait?69:78,R=portrait?80:73;state.hover=clamp((x-L)/(W-L-R),0,1);render()};canvas.onmouseleave=()=>{state.hover=null;$('hoverInfo').textContent='移动鼠标可查看日期与价格';render()};
for(const id of ['start','end','currency','metric','interval','title','normalize','logscale','grid','watermark','duration'])$(id).addEventListener('input',()=>{state.elapsed=clamp(state.elapsed,0,Number($('duration').value));render()});
$('currency').addEventListener('change',render);
$('end').value=new Date().toISOString().slice(0,10);reload().catch(e=>toast(e.message));loadRates();
setTimeout(()=>$('readerInfo').classList.toggle('hidden',document.documentElement.dataset.skinRevealReaderVersion==='1.1'),500);

// Export uses deterministic JPEG frames so background-tab throttling cannot lower the video FPS.
async function exportFrames(){
  if(state.exporting)return;
  if(!dataset())return toast('请先选择至少一组价格数据');
  const format=$('format').value,health=await api('/api/health');
  if(!health.ffmpeg){if(format==='webm')return exportVideo();return toast('未找到 ffmpeg，请改导出 WebM')}
  const fps=Number($('fps').value),duration=Number($('duration').value),total=fps*duration;
  const sizes={'9:16':[1080,1920],'16:9':[1920,1080],'1:1':[1080,1080]};
  const [w,h]=sizes[state.ratio],off=document.createElement('canvas');off.width=w;off.height=h;
  const offctx=off.getContext('2d');
  state.exporting=true;state.playing=false;$('export').disabled=true;
  $('exportProgress').classList.remove('hidden');$('download').classList.add('hidden');
  let job;
  try{
    job=await post('/api/export/start',{format,fps,frames:total});
    const batchSize=12;
    for(let start=0;start<total;start+=batchSize){
      const parts=[];
      for(let i=start;i<Math.min(total,start+batchSize);i++){
        draw(offctx,i/fps,w,h);
        const encoded=off.toDataURL('image/jpeg',.86).split(',')[1];
        const binary=atob(encoded),bytes=new Uint8Array(binary.length);
        for(let j=0;j<binary.length;j++)bytes[j]=binary.charCodeAt(j);
        const length=new Uint8Array(4);
        new DataView(length.buffer).setUint32(0,bytes.length,true);
        parts.push(length,bytes);
      }
      await api(`/api/export/${job.id}/batch?start=${start}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Blob(parts)});
      const pct=Math.round(Math.min(total,start+batchSize)/total*85);
      $('exportPercent').textContent=pct+'%';$('exportBar').style.width=pct+'%';
      $('exportLabel').textContent=`正在逐帧绘制 ${Math.min(total,start+batchSize)}/${total}`;
    }
    $('exportLabel').textContent='正在合成 '+format.toUpperCase()+'…';
    const result=await post(`/api/export/${job.id}/finish`,{});
    const link=$('download');link.href=result.url;link.download=result.url.split('/').at(-1);
    link.textContent=`下载 ${format.toUpperCase()} · ${(result.bytes/1024/1024).toFixed(1)} MB ↗`;
    link.classList.remove('hidden');$('exportLabel').textContent=`导出完成 · ${result.frames} 帧`;
    $('exportPercent').textContent='100%';$('exportBar').style.width='100%';toast('视频已导出');
  }catch(e){$('exportLabel').textContent='导出失败';toast(e.message)}
  finally{state.exporting=false;$('export').disabled=false}
}
$('export').onclick=exportFrames;

// Search the site's live catalog in Edge, then import the exact page the user chose.
function itemSlug(text){return text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
function requestedVariant(query){
  const wears=[['factory-new',/崭新出厂|崭新|factory new|\bfn\b/i],['minimal-wear',/略有磨损|略磨|minimal wear|\bmw\b/i],['field-tested',/久经沙场|久经|field.tested|\bft\b/i],['well-worn',/破损不堪|破损|well.worn|\bww\b/i],['battle-scarred',/战痕累累|战痕|battle.scarred|\bbs\b/i]];
  const wear=wears.find(([,pattern])=>pattern.test(query))?.[0]||'';
  const stattrak=/stattrak|暗金/i.test(query);
  return stattrak?`stattrak-${wear||'factory-new'}`:wear;
}
async function waitJob(kind,id,limit=120){for(let n=0;n<limit;n++){await new Promise(resolve=>setTimeout(resolve,1000));const value=await api(`/api/${kind}/${id}`);if(value.status==='ready')return value;if(value.status==='error')throw Error(value.error)}throw Error('等待网站超时，请查看 Edge 页面是否出现安全检查')}
async function readSiteCandidate(candidate,wear='',existingPage=null){
  const path=wear?candidate.path+'/'+wear:(candidate.default_path||candidate.path);
  const page=existingPage||window.open('about:blank','_blank');
  if(!page)throw Error('请允许打开网站新标签页');
  const name=candidate.name+' · '+path.split('/').at(-1);
  const job=await post('/api/page-import/start',{market_hash_name:name,site_path:path});
  page.location.href=job.url;
  $('searchStatus').textContent='已打开 '+name+'，正在读取历史价格…';
  const result=await waitJob('page-import',job.id,180);
  state.selected=new Set([result.item_id]);$('metric').value='lowest';
  const imported=await api('/api/catalog');const series=imported.series.find(s=>s.id===result.item_id);
  if(series){$('start').value=series.rows[0].date;$('end').value=series.rows.at(-1).date}
  await reload();$('searchStatus').textContent=`已导入 ${name} · ${series?.rows.length||0} 个网站历史点`;
  toast('已从 CSGOSKINS.GG 导入历史价格');
}
function showSiteCandidates(results){
  const list=$('candidates');list.innerHTML='';
  for(const candidate of results.slice(0,15)){
    const row=document.createElement('div');row.className='candidate site-candidate';
    const title=document.createElement('strong');title.textContent=candidate.name;
    const wear=document.createElement('select');
    for(const [value,label] of [['',`官网默认规格 · ${(candidate.default_path||candidate.path).split('/').at(-1)}`],['factory-new','崭新出厂'],['minimal-wear','略有磨损'],['field-tested','久经沙场'],['well-worn','破损不堪'],['battle-scarred','战痕累累'],['stattrak-factory-new','暗金 · 崭新出厂'],['stattrak-minimal-wear','暗金 · 略有磨损'],['stattrak-field-tested','暗金 · 久经沙场'],['stattrak-well-worn','暗金 · 破损不堪'],['stattrak-battle-scarred','暗金 · 战痕累累']]){
      const opt=document.createElement('option');opt.value=value;opt.textContent=label;wear.append(opt)
    }
    wear.value=requestedVariant($('names').value);
    const btn=document.createElement('button');btn.className='small-btn auto-read';btn.textContent='打开网页并读取';
    btn.onclick=async()=>{btn.disabled=true;try{await readSiteCandidate(candidate,wear.value)}catch(e){$('searchStatus').textContent=e.message;toast(e.message)}finally{btn.disabled=false}};
    const link=document.createElement('a');link.href='https://csgoskins.gg'+candidate.path;link.target='_blank';link.rel='noopener noreferrer';link.textContent='官网 ↗';
    row.append(title,wear,btn,link);list.append(row);
  }
}
$('resolve').textContent='联网搜索并读取';
$('resolve').onclick=async()=>{
  const query=$('names').value.trim();if(!query)return toast('请先输入饰品名称');
  if(document.documentElement.dataset.skinRevealReaderVersion!=='1.1'){$('readerInfo').classList.remove('hidden');return toast('请在 Edge 扩展管理页重新加载读取助手，再刷新本页')}
  const button=$('resolve'),status=$('searchStatus');button.disabled=true;status.textContent='正在搜索 CSGOSKINS.GG 饰品目录…';$('candidates').innerHTML='';
  const page=window.open('about:blank','_blank');
  try{
    if(!page)throw Error('请允许打开网站新标签页');
    const search=await post('/api/site-search/start',{query});page.location.href=search.url;
    const response=await waitJob('site-search',search.id,120);const results=response.results;
    if(!results.length){status.textContent='官网没有找到结果。试试更多英文关键词或较短名称。';return}
    const exact=results.find(x=>itemSlug(x.name)===itemSlug(search.terms));
    if(exact){status.textContent='找到官网完整匹配，正在打开饰品页…';await readSiteCandidate(exact,requestedVariant(query),page)}
    else{showSiteCandidates(results);status.textContent=`官网找到 ${results.length} 个候选，请选具体饰品；不会用相似饰品的价格代替。`}
  }catch(e){status.textContent='联网搜索失败：'+e.message;toast(e.message)}finally{button.disabled=false}
};
