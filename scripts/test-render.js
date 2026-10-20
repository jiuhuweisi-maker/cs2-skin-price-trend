// 快速自检：渲染 4 个时间点，检查画布像素分布，确认图表确实画出来了
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const PORT = 8898;

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const t = await (await fetch(`http://127.0.0.1:9333/json/new?http://127.0.0.1:${PORT}/index.html`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pend.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 30000);
  });
  const ev = async (expr, aw = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: aw });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 2500));
  console.log('ready', await ev('window.__ready === true'));

  for (const p of [0.02, 0.35, 0.7, 0.97]) {
    await ev(`window.__renderAt(${p})`);
    const stats = await ev(`(() => {
      const c = document.getElementById('cv');
      const g = c.getContext('2d').getImageData(0,0,1920,1080).data;
      let green=0, pink=0, nonbg=0, textish=0;
      for (let i=0;i<g.length;i+=4){
        const r=g[i],gg=g[i+1],b=g[i+2];
        if (r>20||gg>20||b>20) nonbg++;
        if (gg>140 && r<120 && b>90 && b<200) green++;
        if (r>180 && gg<130 && b>100) pink++;
      }
      return {nonbg, green, pink};
    })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
    const f = path.join(ROOT, 'frames', `preview_${String(p).replace('.', '_')}.png`);
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('t=' + p, JSON.stringify(stats), 'png=' + fs.statSync(f).size);
  }
  server.close();
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
