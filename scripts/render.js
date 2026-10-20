// 逐帧渲染：CDP 截图 -> PNG 序列 -> ffmpeg 合成 MP4
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const FRAMES = path.join(ROOT, 'frames');
const DIST = path.join(ROOT, 'dist');
const PORT = 8899;
const FPS = 30;
const DURATION = 90;          // 秒
const CDP_PORT = process.env.CDP_PORT || 9333;

fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });
// 只清理预览图，保留已渲染帧以便断点续传
for (const f of fs.readdirSync(FRAMES)) {
  if (f.startsWith('preview_')) fs.unlinkSync(path.join(FRAMES, f));
}

// ---- 静态服务器 ----
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const p = path.join(WEB, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ---- 极简 CDP 客户端 ----
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

(async () => {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log('server on', PORT);

  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?http://127.0.0.1:${PORT}/index.html`, { method: 'PUT' })).json();
  const cdp = new CDP(t.webSocketDebuggerUrl);
  await cdp.connect();

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await new Promise(r => setTimeout(r, 2500));

  // 等待数据就绪
  for (let i = 0; i < 40; i++) {
    const ok = await cdp.eval('window.__ready === true');
    if (ok) break;
    await new Promise(r => setTimeout(r, 300));
  }
  console.log('ready =', await cdp.eval('window.__ready === true'));

  const total = FPS * DURATION;
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < total; i++) {
    const file = path.join(FRAMES, `f${String(i).padStart(5, '0')}.png`);
    // 断点续传：已存在的帧直接跳过
    if (fs.existsSync(file) && fs.statSync(file).size > 2000) { done++; continue; }

    const p = i / (total - 1);
    await cdp.eval(`window.__renderAt(${p})`);

    let shot = null;
    for (let attempt = 0; attempt < 4 && !shot; attempt++) {
      try {
        shot = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
          captureBeyondViewport: false,
          fromSurface: true,
        });
      } catch (e) {
        console.log(`frame ${i} attempt ${attempt + 1} failed: ${e.message}`);
        await new Promise(r => setTimeout(r, 1500));
        if (attempt >= 1) {
          // 重载页面，恢复渲染上下文
          try {
            await cdp.send('Page.reload', { ignoreCache: false });
            await new Promise(r => setTimeout(r, 2500));
            for (let k = 0; k < 40; k++) {
              if (await cdp.eval('window.__ready === true')) break;
              await new Promise(r => setTimeout(r, 300));
            }
            await cdp.eval(`window.__renderAt(${p})`);
          } catch (e2) { console.log('reload failed', e2.message); }
        }
      }
    }
    if (!shot) throw new Error('screenshot failed at frame ' + i);

    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    done++;
    if (i % 150 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${i}/${total}  ${el.toFixed(1)}s  eta ${((total - i) * el / (done || 1)).toFixed(0)}s`);
    }
  }
  cdp.close();
  server.close();
  console.log('frames done in', ((Date.now() - t0) / 1000).toFixed(1), 's');

  // ffmpeg
  const ff = 'ffmpeg';
  const args = [
    '-y', '-framerate', String(FPS),
    '-i', path.join(FRAMES, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    path.join(DIST, 'trend.mp4'),
  ];
  console.log('ffmpeg...');
  execFileSync(ff, args, { stdio: 'inherit' });
  console.log('done ->', path.join(DIST, 'trend.mp4'));
  process.exit(0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
