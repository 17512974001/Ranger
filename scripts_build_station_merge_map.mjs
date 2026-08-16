// 生成站名合并表（分类1 写法差异，仅距离≤1000m 的对）
// 映射用真实站名：变体原始名 → 规范原始名
// 产物：data/station_merge_map.js + output/network/站名合并表_分类1.csv
import fs from 'node:fs';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT_DIR = `${ROOT}/output/network`;
const BSS = JSON.parse(fs.readFileSync(`${ROOT}/data/bus_stops.js`, 'utf-8').replace(/^window\.BUS_STOPS = /, '').replace(/;\s*$/, '')).features;
const byId = new Map();
for (const f of BSS) byId.set(f.properties.stop_id, f);

function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

const rows = fs.readFileSync(`${OUT_DIR}/分站合并核对_分类1_写法差异.csv`, 'utf-8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map((l) => {
    const c = [];
    let s = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { s += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { c.push(s); s = ''; }
      else s += ch;
    }
    c.push(s);
    return c;
  });

const pairs = new Map();
for (const r of rows) {
  const cand = r[0].split('  [')[0]; // 去掉 " [车来了名]" 后缀
  const names = cand.split(' ↔ ').map((x) => x.trim()).filter(Boolean);
  const ids = (r[1] || '').split(' / ').filter(Boolean);
  const key = [...names].sort().join('|');
  let maxD = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = byId.get(ids[i]), b = byId.get(ids[j]);
      if (a && b) maxD = Math.max(maxD, distM(a.geometry.coordinates, b.geometry.coordinates));
    }
  }
  if (!pairs.has(key)) pairs.set(key, { names, ids, maxD });
}

function canonicalScore(name) {
  let s = 0;
  if (name.includes('总站')) s += 2;
  if (name.includes('(') || name.includes('（')) s += 1;
  if (/[（(](停?[东南西北]行|上行|下行)[）)]/.test(name)) s -= 2; // 方向后缀不适合当规范名
  if (/站$/.test(name)) s -= 0.5;
  return s;
}

const mergeMap = {};
const report = [];
const excluded = [];
for (const [key, p] of pairs) {
  const d = Math.round(p.maxD);
  // 收集本组涉及的原始站名
  const rawNames = [];
  for (const id of p.ids) {
    const f = byId.get(id);
    if (f && !rawNames.includes(f.properties.name_cn)) rawNames.push(f.properties.name_cn);
  }
  if (d > 1000 || rawNames.length < 2) {
    excluded.push([p.names.join(' ↔ '), d, rawNames.join(' / ')]);
    continue;
  }
  const canonical = rawNames.slice().sort((a, b) => canonicalScore(b) - canonicalScore(a) || a.length - b.length)[0];
  report.push([p.names.join(' ↔ '), d, rawNames.join(' / '), canonical]);
  for (const n of rawNames) {
    if (n !== canonical && !mergeMap[n]) mergeMap[n] = canonical;
  }
}

fs.writeFileSync(`${ROOT}/data/station_merge_map.js`, 'window.STATION_MERGE_MAP = ' + JSON.stringify(mergeMap) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/station_merge_map.js`, fs.readFileSync(`${ROOT}/data/station_merge_map.js`, 'utf-8'), 'utf-8');

const csv = [
  ['站名组', '组内最大距离m', '涉及原始站名', '规范站名'].join(','),
  ...report.map((r) => r.map((v) => (/,/.test(String(v)) ? `"${v}"` : v)).join(',')),
].join('\r\n');
fs.writeFileSync(`${OUT_DIR}/站名合并表_分类1.csv`, '\uFEFF' + csv + '\r\n', 'utf-8');

console.log(`分类1 去重后 ${pairs.size} 对`);
console.log(`生成映射 ${Object.keys(mergeMap).length} 条（${report.length} 对 ≤1000m）`);
console.log(`排除 ${excluded.length} 对（>1000m 或无法取值）`);
console.log('\n排除清单：');
excluded.sort((a, b) => b[1] - a[1]).forEach((e) => console.log(`  ${e[1]}m | ${e[0]}`));
console.log('\n合并表样例：');
Object.entries(mergeMap).slice(0, 25).forEach(([k, v]) => console.log(`  ${k} → ${v}`));
