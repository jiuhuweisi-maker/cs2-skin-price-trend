const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', 'steam_mp9.json'), 'utf8'));
console.log('first 25:', JSON.stringify(j.prices.slice(0, 25), null, 0));
const jan22 = j.prices.filter(x => x[0].includes('Jan') && x[0].includes('2022'));
console.log('\nJan 2022 count', jan22.length);
console.log(JSON.stringify(jan22));
