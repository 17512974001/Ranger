/* 疑似重复/变体线路排查
   条件：不同线路号、起讫相近(<=300m)、停靠重叠 >= 较短线的 80%。
   分类：疑似改名（可考虑合并）/ 正线-变体（不合并）/ 跨区或同走廊（不合并）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataDir = path.join(__dirname, 'data');
const outDir = path.join(__dirname, 'output', 'network');
fs.mkdirSync(outDir, { recursive: true });

function load(varName, file) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(dataDir, file), 'utf-8'), s, { filename: file });
  return s.window[varName];
}
function routeNumOf(cn) {
  const m = String(cn || '').match(/^([^（(]+)/);
  return m ? m[1].trim() : String(cn || '');
}
function terminiParts(cn) {
  const m = String(cn || '').match(/[（(]([^（）()]*--[^（）()]*)[）)]$/);
  if (!m) { return null; }
  const p = m[1].split('--');
  return p.length === 2 ? [p[0].trim(), p[1].trim()] : null;
}

const BUS_ROUTE_STOPS = load('BUS_ROUTE_STOPS', 'bus_route_stops.js');
const BUS_STOPS = load('BUS_STOPS', 'bus_stops.js');
const busStopById = {};
BUS_STOPS.features.forEach(function (f) { busStopById[f.properties.stop_id] = f; });

// 起讫坐标
const termCoord = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
    if (!termCoord[st[1]] && busStopById[st[2]]) { termCoord[st[1]] = busStopById[st[2]].geometry.coordinates; }
  });
});
function distM(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
function sameTerm(t1, t2) {
  if (!t1 || !t2) { return false; }
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const c1 = termCoord[t1[i]];
      const c2 = termCoord[t2[j]];
      if (c1 && c2 && distM(c1, c2) <= 300) { return true; }
    }
  }
  return false;
}

// 每组 (num, termini) 的站点ID集合
const routeStopsByNumTerm = new Map();
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  const num = routeNumOf(k);
  const t = terminiParts(k);
  if (!t) { return; }
  const key = num + '|' + t.slice().sort().join('|');
  if (!routeStopsByNumTerm.has(key)) { routeStopsByNumTerm.set(key, new Set()); }
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) { routeStopsByNumTerm.get(key).add(st[2]); });
});

// 变体标记 / 地理前缀
const VARIANT_MARKER = /快线|短线|长线|支线|环线|班车|快车|直达|区间|高峰|上午|下午|夜班|内环|外环|专线|A线|B线|夜/;
const GEO_PREFIX = ['从化', '佛山', '南沙', '番禺', '增城', '花都', '白云', '天河', '黄埔', '海珠', '越秀', '荔湾', '萝岗', '从', '佛', '广', '里'];
function stripGeo(num) {
  // 贪心去掉尽可能多的地理前缀（如 佛里07路 -> 里07路 -> 07路），
  // 避免 "佛" 先命中导致 "佛里07路" 与 "里07路" 归一后不一致。
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of GEO_PREFIX) {
      if (num.startsWith(p)) {
        num = num.slice(p.length);
        changed = true;
      }
    }
  }
  return num;
}

const entries = Array.from(routeStopsByNumTerm.entries());
const rows = [];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const [k1, set1] = entries[i];
    const [k2, set2] = entries[j];
    const [n1] = k1.split('|');
    const [n2] = k2.split('|');
    if (n1 === n2) { continue; }
    const t1 = k1.split('|').slice(1).join('|');
    const t2 = k2.split('|').slice(1).join('|');
    if (!sameTerm(t1.split('|'), t2.split('|'))) { continue; }
    const inter = [...set1].filter(function (x) { return set2.has(x); }).length;
    const min = Math.min(set1.size, set2.size);
    if (!min || inter / min < 0.8) { continue; }
    const hasMarker = VARIANT_MARKER.test(n1) || VARIANT_MARKER.test(n2);
    const sameBase = stripGeo(n1) === stripGeo(n2);
    let cat;
    if (hasMarker) { cat = '正线-变体（不合并）'; }
    else if (sameBase) { cat = '疑似改名（可考虑合并）'; }
    else { cat = '跨区或同走廊（不合并）'; }
    rows.push({
      a: n1, b: n2,
      inter: inter, min: min,
      ratio: Math.round(inter / min * 100),
      term: t1 + ' ⇄ ' + t2,
      cat: cat
    });
  }
}
rows.sort(function (x, y) { return y.ratio - x.ratio || y.inter - x.inter; });

function csv(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const lines = [['线路A', '线路B', '重叠站数', '较短线站数', '重叠%', '起讫', '分类']].concat(
  rows.map(function (r) { return [r.a, r.b, r.inter, r.min, r.ratio, r.term, r.cat].map(csv).join(','); })
);
fs.writeFileSync(path.join(outDir, '疑似重复与变体线路.csv'), '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');

const groups = {};
rows.forEach(function (r) { groups[r.cat] = (groups[r.cat] || 0) + 1; });
console.log('总计:', rows.length, JSON.stringify(groups));
console.log('\n=== 疑似改名（可考虑合并） ===');
rows.filter(function (r) { return r.cat.indexOf('疑似改名') >= 0; }).forEach(function (r) {
  console.log(r.a, '×', r.b, r.inter + '/' + r.min, '(' + r.ratio + '%)', r.term);
});
console.log('\n=== 正线-变体（不合并）样例 ===');
rows.filter(function (r) { return r.cat.indexOf('正线-变体') >= 0; }).slice(0, 15).forEach(function (r) {
  console.log(r.a, '×', r.b, r.inter + '/' + r.min, '(' + r.ratio + '%)');
});
