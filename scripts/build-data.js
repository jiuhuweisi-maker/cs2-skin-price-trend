// 把 BUFF 原始 price_history 转成按月聚合的 CSV
// 口径：每月取该月最后一个「有数据」的自然日的在售最低价
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data');
const items = [
  { id: 871747, key: 'butterfly', name: '★ 蝴蝶刀 | 伽玛多普勒 (崭新出厂)', short: '蝴蝶刀·伽玛多普勒' },
  { id: 887008, key: 'mp9', name: 'MP9 | 星使 (崭新出厂)', short: 'MP9·星使' },
];

const tz = 8 * 3600 * 1000;
function fmt(ms) {
  const d = new Date(ms + tz);
  return d.toISOString().slice(0, 10);
}

const rows = [];
const meta = [];

for (const it of items) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'out', `raw_${it.id}.json`), 'utf8'));
  const ph = raw.data.price_history;
  const byMonth = new Map();
  for (const [ms, price] of ph) {
    const d = fmt(ms);
    const ym = d.slice(0, 7);
    const prev = byMonth.get(ym);
    if (!prev || d > prev.date) byMonth.set(ym, { date: d, price: Number(price), ts: ms });
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [ym, v] of months) {
    rows.push({ date: v.date, month: ym, item: it.key, name: it.name, price: v.price, ts: v.ts });
  }
  meta.push({
    id: it.id,
    key: it.key,
    name: it.name,
    raw_points: ph.length,
    first_raw: fmt(ph[0][0]),
    last_raw: fmt(ph[ph.length - 1][0]),
    months: months.length,
  });
}

const header = 'date,month,item,name,price_cny,ts_ms\n';
const body = rows
  .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.item < b.item ? -1 : 1))
  .map(r => `${r.date},${r.month},${r.item},"${r.name}",${r.price},${r.ts}`)
  .join('\n');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'monthly_buff.csv'), header + body + '\n', 'utf8');
fs.writeFileSync(
  path.join(OUT, 'monthly_buff.meta.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), source: 'buff.163.com /api/market/goods/price_history (days=365)', items: meta }, null, 2),
  'utf8'
);

console.log(JSON.stringify(meta, null, 2));
console.log('rows=' + rows.length);
