const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['steam_bfly.json', 'steam_mp9.json']) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', f), 'utf8'));
  const p = j.prices;
  console.log('===', f, 'n=', p.length, 'success=', j.success, 'prefix=', j.price_prefix);
  console.log('first3', JSON.stringify(p.slice(0, 3)));
  console.log('last3', JSON.stringify(p.slice(-3)));
  const dd = p.map(x => x[0].split(' ').slice(0, 3).join(' '));
  console.log('unique day labels', new Set(dd).size);
  // 找出重复日期
  const cnt = {};
  for (const d of dd) cnt[d] = (cnt[d] || 0) + 1;
  const dups = Object.entries(cnt).filter(([, c]) => c > 1).slice(0, 5);
  console.log('sample duplicate days', JSON.stringify(dups));
  // 2022-01-20 附近
  const idx = p.findIndex(x => x[0].startsWith('Jan 20 2022'));
  console.log('idx of Jan 20 2022 =', idx, idx >= 0 ? JSON.stringify(p.slice(idx, idx + 3)) : '');
}
