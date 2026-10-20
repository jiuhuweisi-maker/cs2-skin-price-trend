// Steam 社区市场 pricehistory -> 日 -> 月 聚合
// 口径：
//   日价格 = 当日所有观测点的算术平均（Steam 近年为小时级采样，同日多点）
//   月价格 = 该月所有有数据日的日价格的**中位数**（抗单笔异常成交，如 2023-10 出现的 67 元）
//   月均价 = 该月所有有数据日的日价格的算术平均（仅作参考列）
// 币种：账户结算币种 CNY（¥），与 BUFF 同币种
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const START = '2022-01-20';

const items = [
  { key: 'bfly', file: 'steam_bfly.json', name: '★ 蝴蝶刀 | 伽玛多普勒 (崭新出厂)', short: '蝴蝶刀·伽玛多普勒' },
  { key: 'mp9', file: 'steam_mp9.json', name: 'MP9 | 星使 (崭新出厂)', short: 'MP9·星使' },
];

function parseDate(s) {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):/.exec(s);
  if (!m) return null;
  const mo = MONTHS[m[1]];
  if (mo === undefined) return null;
  const d = new Date(Date.UTC(Number(m[3]), mo, Number(m[2])));
  return { day: d.toISOString().slice(0, 10), hour: Number(m[4]) };
}

const rows = [];
const meta = [];

for (const it of items) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', it.file), 'utf8'));

  // 1) 按日聚合
  const byDay = new Map();
  for (const [ds, price, vol] of raw.prices) {
    const p = parseDate(ds);
    if (!p) continue;
    if (p.day < START) continue;
    const cur = byDay.get(p.day) || { sum: 0, n: 0, vol: 0, last: null, lastHour: -1 };
    cur.sum += Number(price);
    cur.n += 1;
    cur.vol += Number(vol);
    if (p.hour >= cur.lastHour) { cur.lastHour = p.hour; cur.last = Number(price); }
    byDay.set(p.day, cur);
  }
  const days = [...byDay.entries()]
    .map(([day, v]) => ({ day, price: v.sum / v.n, last: v.last, vol: v.vol, n: v.n }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  // 2) 按月聚合（月价格 = 日均价的中位数）
  const byMonth = new Map();
  for (const d of days) {
    const ym = d.day.slice(0, 7);
    const cur = byMonth.get(ym) || { prices: [], sum: 0, n: 0, vol: 0 };
    cur.prices.push(d.price);
    cur.sum += d.price; cur.n += 1; cur.vol += d.vol;
    byMonth.set(ym, cur);
  }
  const median = (arr) => {
    const a = [...arr].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  for (const [ym, v] of [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    // 异常值过滤：以当月日中位数为基准，剔除 <50% 或 >200% 的日（错标/混入其他款式）
    const med = median(v.prices);
    const kept = v.prices.filter(x => x >= med * 0.5 && x <= med * 2);
    const dropped = v.prices.length - kept.length;
    const price = kept.reduce((a, b) => a + b, 0) / kept.length;
    rows.push({
      date: `${ym}-01`, month: ym, item: it.key, name: it.name,
      price: Number(price.toFixed(2)),
      month_avg: Number((v.sum / v.n).toFixed(2)),
      volume: v.vol, days: v.n, dropped_days: dropped,
    });
  }

  // 缺口月份（2022-01 至 2026-10 之间无数据的月）
  const have = new Set(byMonth.keys());
  const missing = [];
  let y = 2022, m = 1;
  while (y < 2026 || (y === 2026 && m <= 10)) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    if (!have.has(ym)) missing.push(ym);
    m++; if (m > 12) { m = 1; y++; }
  }

  meta.push({
    key: it.key, name: it.name,
    raw_points: raw.prices.length,
    day_points: days.length,
    first_day: days[0].day, last_day: days[days.length - 1].day,
    months: byMonth.size,
    missing_months: missing,
    start_day_price: Number(days[0].price.toFixed(2)),
    end_day_price: Number(days[days.length - 1].price.toFixed(2)),
  });
}

const header = 'date,month,item,name,price_cny,month_avg_cny,volume,days_with_data,dropped_days\n';
const body = rows
  .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.item < b.item ? -1 : 1))
  .map(r => `${r.date},${r.month},${r.item},"${r.name}",${r.price},${r.month_avg},${r.volume},${r.days},${r.dropped_days}`)
  .join('\n');

const OUT = path.join(ROOT, 'data');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'monthly_steam.csv'), header + body + '\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'monthly_steam.meta.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  source: 'steamcommunity.com /market/pricehistory?appid=730 (currency CNY)',
  range: { from: START, to: '2026-10-19' },
  method: '日=当日观测点均值；月=当月最后一个有数据日的日价格；月均价=当月日均价均值',
  items: meta,
}, null, 2), 'utf8');

console.log(JSON.stringify(meta, null, 2));
console.log('rows=' + rows.length);
