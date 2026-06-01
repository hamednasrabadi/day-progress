import fs from 'node:fs';
import path from 'node:path';

const deps = Object.keys(JSON.parse(fs.readFileSync('package.json', 'utf8')).dependencies);
const dirs = ['app', 'components', 'lib', 'store', 'hooks', 'constants'];
let src = '';
function walk(d) {
  if (!fs.existsSync(d)) return;
  for (const f of fs.readdirSync(d)) {
    const fp = path.join(d, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) walk(fp);
    else if (/\.(ts|tsx|js|jsx)$/.test(f)) src += fs.readFileSync(fp, 'utf8') + '\n';
  }
}
dirs.forEach(walk);
for (const f of ['app.json', 'babel.config.js', 'metro.config.js', 'index.js', 'App.js']) {
  if (fs.existsSync(f)) src += fs.readFileSync(f, 'utf8') + '\n';
}

const used = [];
const notFound = [];
for (const dep of deps) {
  // import from 'dep' | 'dep/sub' | require('dep') | plugin "dep"
  const esc = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('["\'(/]' + esc + '(["\'/]|$)', 'm');
  (re.test(src) ? used : notFound).push(dep);
}
console.log('NOT referenced in source/app.json (' + notFound.length + '):');
notFound.forEach((d) => console.log('  -', d));
