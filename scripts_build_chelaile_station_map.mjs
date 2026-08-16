// 车来了物理站台对照表 + 分站合并差异核对
// 产物（output/network/）：
//  车来了物理站台对照表.csv      每个 BV 站 → 车来了物理站台/同名站组
//  车来了同名站组字典.csv         namesakeStId → 组内站名
//  分站合并核对_应合并.csv         同一物理站台被拆到不同合并站的
//  分站合并核对_待甄别.csv         同一合并站跨多个同名站组的
import fs from 'node:fs';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT_DIR = `${ROOT}/output/network`;

const LIB = JSON.parse(fs.readFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, 'utf-8'));
const dict = {};
for (const l of fs.readFileSync(`${OUT_DIR}/分站规范化字典.csv`, 'utf-8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)) {
  const c = l.split(',');
  if (c.length >= 3) dict[c[2]] = { merged: c[0], raw: c[1] };
}

function csvVal(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  fs.writeFileSync(file, '\uFEFF' + [header.join(','), ...rows.map((r) => r.map(csvVal).join(','))].join('\r\n') + '\r\n', 'utf-8');
}

// ---------- 1) 对照表 ----------
const mapRows = [];
const seen = new Set();
for (const cn of Object.keys(LIB)) {
  for (const s of LIB[cn].stops) {
    if (!s[2] || s[3] == null) continue;
    const key = `${s[2]}|${s[7] || ''}|${s[8] || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mapRows.push([
      s[2], s[1], dict[s[2]]?.merged || s[1], s[3], s[7] || '', s[8] || '',
      s[4] != null ? s[4].toFixed(6) : '', s[5] != null ? s[5].toFixed(6) : '',
      s[9] != null ? s[9] : '',
    ]);
  }
}
writeCsv(`${OUT_DIR}/车来了物理站台对照表.csv`,
  ['本地站点ID', '本地站名', '合并站名', '车来了站名', 'physicalStId', 'namesakeStId', '经度', '纬度', '匹配距离m'],
  mapRows);

// ---------- 2) 同名站组字典 ----------
const nameGroups = new Map(); // namesakeStId -> {names:Set, mergedStations:Set, bvs:Set}
for (const r of mapRows) {
  if (!r[5]) continue;
  const g = nameGroups.get(r[5]) || { names: new Set(), merged: new Set(), bvs: new Set() };
  g.names.add(r[3]);
  g.merged.add(r[2]);
  g.bvs.add(r[0]);
  nameGroups.set(r[5], g);
}
function baseOf(n) {
  return String(n || '')
    .replace(/公共汽车/g, '')
    .replace(/BRT/g, '')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/\d+$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '')
    .trim();
}
const nameRows = [...nameGroups.entries()]
  .map(([id, g]) => [id, [...g.names].join(' / '), [...g.merged].join(' / '), g.bvs.size, g.names.size, g.merged.size])
  .sort((a, b) => b[3] - a[3]);
writeCsv(`${OUT_DIR}/车来了同名站组字典.csv`,
  ['namesakeStId', '组内车来了站名', '涉及合并站', 'BV站数', '站名变体数', '合并站数'],
  nameRows);

// ---------- 3) 同一物理站台被拆到不同合并站（应合并） ----------
const phyGroups = new Map(); // physicalStId -> {merged:Set, bvs:Set, chNames:Set}
for (const r of mapRows) {
  if (!r[4]) continue;
  const g = phyGroups.get(r[4]) || { merged: new Set(), bvs: new Set(), chNames: new Set() };
  g.merged.add(r[2]);
  g.bvs.add(r[0]);
  g.chNames.add(r[3]);
  phyGroups.set(r[4], g);
}
const mergeRows = [...phyGroups.entries()]
  .filter(([, g]) => g.merged.size >= 2)
  .map(([id, g]) => [id, [...g.merged].join(' / '), [...g.bvs].join(' / '), [...g.chNames].join(' / '), g.bvs.size])
  .sort((a, b) => b[4] - a[4]);
writeCsv(`${OUT_DIR}/分站合并核对_应合并.csv`,
  ['physicalStId', '涉及合并站', 'BV站点ID', '车来了站名', 'BV站数'],
  mergeRows);

// ---------- 4) 同一合并站跨多个同名站组（待甄别） ----------
const stationGroups = new Map(); // 合并站名 -> {nameGroups:Map, bvs:Set, lngs:Set, lats:Set}
for (const r of mapRows) {
  const g = stationGroups.get(r[2]) || { nameGroups: new Map(), bvs: new Set(), lngs: new Set(), lats: new Set() };
  g.bvs.add(r[0]);
  if (r[6]) g.lngs.add(Number(r[6]));
  if (r[7]) g.lats.add(Number(r[7]));
  if (r[5]) {
    const ng = g.nameGroups.get(r[5]) || { names: new Set() };
    ng.names.add(r[3]);
    g.nameGroups.set(r[5], ng);
  }
  stationGroups.set(r[2], g);
}
const reviewRows = [];
for (const [station, g] of stationGroups) {
  if (g.nameGroups.size < 2) continue;
  const ngList = [...g.nameGroups.entries()].map(([id, ng]) => `${[...ng.names].join('|')}(${id.slice(0, 8)})`);
  const allNames = [...g.nameGroups.values()].flatMap((ng) => [...ng.names]);
  const bases = new Set(allNames.map(baseOf));
  const lngs = [...g.lngs].sort((a, b) => a - b);
  const lats = [...g.lats].sort((a, b) => a - b);
  const spanLng = lngs.length > 1 ? (lngs[lngs.length - 1] - lngs[0]) * 111320 * Math.cos((23.13 * Math.PI) / 180) : 0;
  const spanLat = lats.length > 1 ? (lats[lats.length - 1] - lats[0]) * 111320 : 0;
  const span = Math.round(Math.sqrt(spanLng * spanLng + spanLat * spanLat));
  const verdict = (bases.size > 1 || span > 300) ? '需核对' : '疑似正常(同基名分站)';
  reviewRows.push([
    station, g.bvs.size, g.nameGroups.size, verdict, span,
    bases.size > 1 ? [...bases].join(' / ') : '',
    ngList.join(' || '), [...g.bvs].join(' / '),
  ]);
}
reviewRows.sort((a, b) => (a[3] === '需核对' ? 0 : 1) - (b[3] === '需核对' ? 0 : 1) || b[1] - a[1]);
writeCsv(`${OUT_DIR}/分站合并核对_待甄别.csv`,
  ['合并站名', 'BV站数', '同名站组数', '判断', '坐标跨度m', '不同基名', '各同名组站名', 'BV站点ID'],
  reviewRows);

// ---------- 汇总 ----------
console.log(`对照表行数：${mapRows.length}`);
console.log(`同名站组数：${nameRows.length}；物理站台数：${phyGroups.size}`);
console.log(`应合并（同物理站台跨合并站）：${mergeRows.length} 组`);
console.log(`待甄别（同合并站跨同名站组）：${reviewRows.length} 组（需核对 ${reviewRows.filter((r) => r[3] === '需核对').length}）`);
console.log('\n== 应合并 Top10 ==');
mergeRows.slice(0, 10).forEach((r) => console.log('  ', r[0].slice(0, 8), '|', r[1]));
console.log('\n== 待甄别-需核对 Top15 ==');
reviewRows.filter((r) => r[3] === '需核对').slice(0, 15).forEach((r) => console.log('  ', r[0], '| BV数', r[1], '|', r[5]));
