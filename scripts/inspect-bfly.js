const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'steam_bfly.json'), 'utf8'));
const p = j.prices;

const vals = p.map(x => x[1]);
const uniq = new Map();
for (const v of vals) uniq.set(v, (uniq.get(v) || 0) + 1);
console.log('total points', p.length, 'distinct price values', uniq.size);
const top = [...uniq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('most repeated values:', JSON.stringify(top));

console.log('\n--- entries around 2023-10 ---');
console.log(JSON.stringify(p.filter(x => x[0].includes('Oct 2023')).slice(0, 20)));

console.log('\n--- last 12 entries ---');
console.log(JSON.stringify(p.slice(-12)));

console.log('\n--- first 12 entries ---');
console.log(JSON.stringify(p.slice(0, 12)));
