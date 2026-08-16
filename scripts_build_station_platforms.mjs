// 构建「分站平台层」：每个平台(BV) → 分站名/所属站/车来了①②③编号/坐标/按方向经停线路
// 并用「同方向共站=不同站、≤100m=同站」等规则做一致性校验
// 产物：data/station_platforms.js + output/network/分站平台层.csv
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT_DIR = `${ROOT}/output/network`;

function loadJsGlobal(file, globalName) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), s, { filename: file });
  return s.window[globalName];
}
const BUS_STOPS = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const LIB = JSON.parse(fs.readFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, 'utf-8'));

// 当前站身份（分站规范化字典）
const stationOf = {}; // BV -> {stationId, stationName}
for (const l of fs.readFileSync(`${OUT_DIR}/分站规范化字典.csv`, 'utf-8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)) {
  const c = l.split(',');
  if (c.length >= 4) stationOf[c[3]] = { stationId: c[1], stationName: c[0] };
}

// 车来了编号（按本地ID聚合 chName）
const chInfo = {}; // BV -> {names:Set}
for (const cn of Object.keys(LIB)) {
  for (const s of LIB[cn].stops) {
    if (!s[3] || !s[2]) continue;
    (chInfo[s[2]] = chInfo[s[2]] || { names: new Set() }).names.add(s[3]);
  }
}
const CN_NUM = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10 };
function numOf(name) {
  const m = String(name || '').match(/([①-⑩]|\d+)$/);
  if (!m) return null;
  return CN_NUM[m[1]] != null ? CN_NUM[m[1]] : parseInt(m[1], 10);
}

// 经停线路（按方向记录）
const linesOf = {}; // BV -> {base -> Set(dirLabel)}
const dirLabel = {};
{
  let ai = 0;
  for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
    const base = cn.split('(')[0];
    if (dirLabel[base] === undefined) dirLabel[base] = ai++;
  }
}
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const base = cn.split('(')[0];
  for (const st of BUS_ROUTE_STOPS[cn]) {
    (linesOf[st[2]] = linesOf[st[2]] || {})[base] = (linesOf[st[2]][base] || new Set()).add(dirLabel[base] % 2 === 0 ? 'A' : 'B');
  }
}

// 组装
const platforms = [];
for (const f of BUS_STOPS.features) {
  const id = f.properties.stop_id;
  const name = f.properties.name_cn;
  const st = stationOf[id] || { stationId: name, stationName: name };
  const chNames = chInfo[id] ? [...chInfo[id].names] : [];
  // 编号：优先车来了编号名，其次本地名后缀
  const numbered = chNames.find((n) => numOf(n) != null) || name;
  const platformNo = numOf(numbered);
  const lines = {};
  for (const [base, dirs] of Object.entries(linesOf[id] || {})) {
    lines[base] = [...dirs].sort();
  }
  platforms.push({
    id,
    name,
    stationId: st.stationId,
    stationName: st.stationName,
    chName: chNames.length ? chNames[0] : '',
    platformNo,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    lines,
  });
}
platforms.sort((a, b) => a.stationId.localeCompare(b.stationId, 'zh-CN') || a.id.localeCompare(b.id));

fs.writeFileSync(`${ROOT}/data/station_platforms.js`, 'window.STATION_PLATFORMS = ' + JSON.stringify(platforms) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/station_platforms.js`, fs.readFileSync(`${ROOT}/data/station_platforms.js`, 'utf-8'), 'utf-8');

// CSV
const rows = platforms.map((p) => [p.stationName, p.stationId, p.name, p.id, p.platformNo || '', p.chName, p.lng.toFixed(6), p.lat.toFixed(6), Object.keys(p.lines).join('、')]);
fs.writeFileSync(`${OUT_DIR}/分站平台层.csv`, '\uFEFF' + ['所属站', '站组ID', '分站名', '平台ID', '分站编号', '车来了分站', '经度', '纬度', '经停线路'].join(',') + '\r\n' + rows.map((r) => r.map((v) => (/,/.test(String(v)) ? `"${v}"` : v)).join(',')).join('\r\n') + '\r\n', 'utf-8');

// 一致性校验：同方向共站的平台必须不同站；≤100m 的同族平台应同站
function normKey(n) {
  return String(n || '').replace(/公共汽车|BRT/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[①-⑩]/g, '').replace(/\d+$/g, '').replace(/(停?[东南西北]行|上行|下行)$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '').replace(/\s+/g, '').trim();
}
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
const byId = new Map(platforms.map((p) => [p.id, p]));
const dirRecs = Object.keys(BUS_ROUTE_STOPS).map((cn) => BUS_ROUTE_STOPS[cn].map((s) => s[2]));
let sameDirSplit = 0, sameDirSameStation = 0, nearSplit = 0, nearSameStation = 0;
const samples = { sameDirSameStation: [], nearSplit: [] };
const sameDirList = [];
const nearList = [];
const seen = new Set();
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const arr = BUS_ROUTE_STOPS[cn];
  const inner = cn.slice(cn.indexOf('(') + 1, cn.lastIndexOf(')'));
  const i = inner.indexOf('--');
  const sTerm = i > 0 ? inner.slice(0, i) : inner;
  const eTerm = i > 0 ? inner.slice(i + 2) : inner;
  const isLoop = sTerm === eTerm;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i][2], b = arr[j][2];
      if (a === b || seen.has(`${a}|${b}`)) continue;
      seen.add(`${a}|${b}`);
      const pa = byId.get(a), pb = byId.get(b);
      if (!pa || !pb) continue;
      if (pa.name === pb.name) continue; // 环线/掉头同站重复，不算
      if (isLoop) continue; // 环线绕圈会自然经过同一站两个方向平台
      const dAb = Math.round(Math.sqrt(((pa.lng - pb.lng) * 111320 * Math.cos((pa.lat * Math.PI) / 180)) ** 2 + ((pa.lat - pb.lat) * 111320) ** 2));
      if (pa.stationId === pb.stationId && dAb > 150) {
        sameDirSameStation++;
        sameDirList.push([pa.stationName, pa.name, pb.name, `${dAb}m`, a, b]);
        if (samples.sameDirSameStation.length < 10) samples.sameDirSameStation.push(`${pa.name}[${a}] ↔ ${pb.name}[${b}]`);
      } else {
        sameDirSplit++;
      }
    }
  }
}
// 近距（≤100m）且同族应同站
const fams = {};
for (const p of platforms) {
  const k = normKey(p.name);
  if (!k) continue;
  (fams[k] = fams[k] || []).push(p);
}
for (const members of Object.values(fams)) {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      if (a.id === b.id || a.stationId === b.stationId) continue;
      const d = distM([a.lng, a.lat], [b.lng, b.lat]);
      if (d <= 100) {
        if (/^临时站|^招呼站/.test(a.name) || /^临时站|^招呼站/.test(b.name)) continue; // 通用站名按ID区分
        const aTerm = /总站|总$/.test(a.name.replace(/[（(].*?[）)]/g, ''));
        const bTerm = /总站|总$/.test(b.name.replace(/[（(].*?[）)]/g, ''));
        if (aTerm !== bTerm) continue; // 总站 vs 非总站，按规则不合并
        nearSplit++;
        nearList.push([a.stationName, a.name, b.name, Math.round(d), a.id, b.id]);
        if (samples.nearSplit.length < 10) samples.nearSplit.push(`${a.name} ↔ ${b.name} ${Math.round(d)}m`);
      }
    }
  }
}
fs.writeFileSync(`${OUT_DIR}/分站平台层_应拆(同方向共站).csv`, '\uFEFF' + ['所属站', '平台A', '平台B', '距离m', 'ID-A', 'ID-B'].join(',') + '\r\n' + sameDirList.map((r) => r.join(',')).join('\r\n') + '\r\n', 'utf-8');
fs.writeFileSync(`${OUT_DIR}/分站平台层_应并(≤100m同族).csv`, '\uFEFF' + ['所属站', '平台A', '平台B', '距离m', 'ID-A', 'ID-B'].join(',') + '\r\n' + nearList.map((r) => r.join(',')).join('\r\n') + '\r\n', 'utf-8');

console.log(`平台总数：${platforms.length}；所属站数：${new Set(platforms.map((p) => p.stationId)).size}`);
console.log(`带车来了编号的平台：${platforms.filter((p) => p.platformNo != null).length}`);
console.log(`校验：同方向共站且同站的平台对 ${sameDirSameStation}（应分开却同站）`);
samples.sameDirSameStation.forEach((s) => console.log('  ⚠ ' + s));
console.log(`校验：≤100m 同族但不同站的平台对 ${nearSplit}`);
samples.nearSplit.forEach((s) => console.log('  ⚠ ' + s));
