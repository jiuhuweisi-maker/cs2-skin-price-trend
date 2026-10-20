// data/monthly_cs.csv -> web/chart.json
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const csv = fs.readFileSync(path.join(ROOT, 'data', 'monthly_cs.csv'), 'utf8').trim().split(/\r?\n/);
const head = csv.shift().split(',');
const idx = Object.fromEntries(head.map((h, i) => [h, i]));

function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'monthly_cs.meta.json'), 'utf8'));
const kindOf = Object.fromEntries(META.items.map(m => [m.key, m.kind]));

const items = {
  bfly: { key: 'bfly', name: '★ 蝴蝶刀 | 伽玛多普勒 (崭新出厂)', short: '蝴蝶刀 · 伽玛多普勒', kind: '匕首', color: '#35E0A1', points: [] },
  mp9: { key: 'mp9', name: 'MP9 | 星使 (崭新出厂)', short: 'MP9 · 星使', kind: '微型冲锋枪', color: '#FF5C8A', points: [] },
};

for (const line of csv) {
  const f = parseLine(line);
  const k = f[idx.item];
  if (!items[k]) continue;
  items[k].points.push({ m: f[idx.month], p: Number(f[idx.price_cny]), u: Number(f[idx.price_usd]) });
}
for (const k in items) items[k].points.sort((a, b) => (a.m < b.m ? -1 : 1));

const months = [...new Set(Object.values(items).flatMap(x => x.points.map(p => p.m)))].sort();

const payload = {
  generated_at: new Date().toISOString(),
  source: 'csgoskins.gg',
  source_note: '多市场最低价（Factory New），站内按固定汇率折算人民币',
  rate: META.currency.rate,
  months,
  items: Object.values(items).map(x => ({
    key: x.key, name: x.name, short: x.short, kind: kindOf[x.key] || x.kind, color: x.color,
    points: months.map(m => {
      const hit = x.points.find(p => p.m === m);
      return hit ? hit.p : null;
    }),
  })),
};

fs.writeFileSync(path.join(ROOT, 'web', 'chart.json'), JSON.stringify(payload), 'utf8');
console.log('months', months.length, months[0], '->', months[months.length - 1]);
for (const it of payload.items) {
  const vals = it.points.filter(v => v !== null);
  console.log(it.key, it.kind, 'nulls:', it.points.length - vals.length, 'first', vals[0], 'last', vals[vals.length - 1],
    'chg', (((vals[vals.length - 1] / vals[0]) - 1) * 100).toFixed(1) + '%');
}
