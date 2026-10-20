// csgoskins.gg 原始 priceHistory -> 月度 CSV
// 原始格式：[ "YYYY-MM-DD", 价格(美分), 挂单数?, ? ]
// 币种：站点原始为 USD，站点切到 CNY 时按固定汇率 currency.value 折算（本站就是这么显示的）
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'cs_raw.json'), 'utf8'));
const RATE = RAW.currency.value;          // 6.6911975959802
const START = '2022-01-20';

const items = [
  { key: 'bfly', name: '★ 蝴蝶刀 | 伽玛多普勒 (崭新出厂)', short: '蝴蝶刀 · 伽玛多普勒', kind: '匕首' },
  { key: 'mp9', name: 'MP9 | 星使 (崭新出厂)', short: 'MP9 · 星使', kind: '微型冲锋枪' },
];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const rows = [];
const meta = [];

for (const it of items) {
  const raw = RAW.items[it.key];
  const daily = raw.prices
    .map(([d, cents, listings, x]) => ({ d, usd: cents / 100, listings, x }))
    .filter(o => o.d >= START)
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  const byMonth = new Map();
  for (const o of daily) {
    const ym = o.d.slice(0, 7);
    const cur = byMonth.get(ym) || { usd: [], lastDay: '', lastUsd: 0 };
    cur.usd.push(o.usd);
    if (o.d >= cur.lastDay) { cur.lastDay = o.d; cur.lastUsd = o.usd; }
    byMonth.set(ym, cur);
  }

  for (const [ym, v] of [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const med = median(v.usd);
    const kept = v.usd.filter(x => x >= med * 0.5 && x <= med * 2);
    const usd = kept.reduce((a, b) => a + b, 0) / kept.length;
    rows.push({
      month: ym, item: it.key, name: it.name,
      usd: Number(usd.toFixed(2)),
      cny: Number((usd * RATE).toFixed(2)),
      last_day: v.lastDay,
      last_usd: Number(v.lastUsd.toFixed(2)),
      last_cny: Number((v.lastUsd * RATE).toFixed(2)),
      days: v.usd.length,
      dropped: v.usd.length - kept.length,
    });
  }

  const have = new Set(byMonth.keys());
  const missing = [];
  let y = 2022, m = 1;
  while (y < 2026 || (y === 2026 && m <= 10)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (!have.has(ym)) missing.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }

  meta.push({
    key: it.key, name: it.name, kind: it.kind,
    url: raw.url, raw_points: raw.n,
    first_raw: raw.first[0], last_raw: raw.last[0],
    daily_points: daily.length,
    months: byMonth.size, missing_months: missing,
    first_usd: Number(daily[0].usd.toFixed(2)), first_cny: Number((daily[0].usd * RATE).toFixed(2)),
    last_usd: Number(daily[daily.length - 1].usd.toFixed(2)),
    last_cny: Number((daily[daily.length - 1].usd * RATE).toFixed(2)),
  });
}

const header = 'month,item,name,price_cny,price_usd,last_day_price_cny,last_day_price_usd,days_with_data,dropped_days\n';
const body = rows
  .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.item < b.item ? -1 : 1))
  .map(r => `${r.month},${r.item},"${r.name}",${r.cny},${r.usd},${r.last_cny},${r.last_usd},${r.days},${r.dropped}`)
  .join('\n');

const OUT = path.join(ROOT, 'data');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'monthly_cs.csv'), header + body + '\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'monthly_cs.meta.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'csgoskins.gg /items/<item>/factory-new 内嵌 priceHistory',
  currency: { native: 'USD', display: 'CNY', rate: RATE, note: '站点按固定汇率折算，非历史汇率' },
  range: { from: START, to: '2026-10-20' },
  method: '日价=当日站点价；月价=当月日均价，先按月中位数剔除 <50% 或 >200% 的异常值再取均值',
  items: meta,
}, null, 2), 'utf8');

console.log(JSON.stringify({ rate: RATE, items: meta }, null, 2));
console.log('rows=' + rows.length);
