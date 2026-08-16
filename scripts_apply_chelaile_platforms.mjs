// 全网方向分台修正（按车来了坐标）：每个方向停靠点 → 同一站族内距车来了坐标最近的平台
// 用法：node scripts_apply_chelaile_platforms.mjs [--apply]
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT_DIR = `${ROOT}/output/network`;
const APPLY = process.argv.includes('--apply');

function loadJsGlobal(file, globalName) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), s, { filename: file });
  return s.window[globalName];
}
const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const BUS_STOPS_OBJ = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const LIB = JSON.parse(fs.readFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, 'utf-8'));

const stopById = new Map();
for (const f of BUS_STOPS_OBJ.features) stopById.set(f.properties.stop_id, f);

function normKey(n) {
  return String(n || '')
    .replace(/公共汽车/g, '')
    .replace(/BRT/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/\d+$/g, '')
    .replace(/(停?[东南西北]行|上行|下行)$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '')
    .replace(/\s+/g, '')
    .trim();
}
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

// 站族索引：normKey -> [{id, name, coord}]
const familyIndex = {};
for (const f of BUS_STOPS_OBJ.features) {
  const n = normKey(f.properties.name_cn);
  if (!n) continue;
  (familyIndex[n] = familyIndex[n] || []).push({
    id: f.properties.stop_id,
    name: f.properties.name_cn,
    coord: f.geometry.coordinates,
  });
}

const MIN_IMPROVE = 50;   // 距离改善至少 50m 才换
const MAX_NEW_DIST = 300; // 目标平台距车来了坐标不超过 300m（过滤匹配异常）

const changes = [];
for (const cn of Object.keys(LIB)) {
  const stops = LIB[cn].stops || [];
  for (const s of stops) {
    // s: [order, localName, localId, chName, lng, lat, sId, physicalStId, namesakeStId, matchDist]
    if (!s[3] || s[4] == null) continue;
    const localName = s[1], localId = s[2];
    const nLocal = normKey(localName);
    const nCh = normKey(s[3]);
    if (!nLocal || nLocal !== nCh) continue; // 仅同名同族（保留括号内容，避免跨站误换）
    if (/^临时站|^招呼站/.test(localName)) continue;
    const cur = stopById.get(localId);
    if (!cur) continue;
    const chCoord = [s[4], s[5]];
    const curDist = distM(cur.geometry.coordinates, chCoord);
    const cands = familyIndex[nLocal] || [];
    let best = null, bestD = Infinity;
    for (const c of cands) {
      const d = distM(c.coord, chCoord);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best || best.id === localId) continue;
    const improve = curDist - bestD;
    if (improve >= MIN_IMPROVE && bestD <= MAX_NEW_DIST) {
      changes.push({
        cn, order: s[0], localName, localId, curDist: Math.round(curDist),
        targetName: best.name, targetId: best.id, bestD: Math.round(bestD),
        chName: s[3], improve: Math.round(improve),
      });
    }
  }
}

console.log(`按车来了坐标：${changes.length} 处方向停靠需要换平台`);
const byStation = {};
for (const c of changes) {
  const key = normKey(c.localName);
  (byStation[key] = byStation[key] || []).push(c);
}
console.log('涉及最多站点（前15）：');
Object.entries(byStation).sort((a, b) => b[1].length - a[1].length).slice(0, 15).forEach(([k, v]) => console.log(`  ${k}: ${v.length} 处`));
console.log('国防大厦相关：');
changes.filter((c) => /国防大厦/.test(c.localName)).forEach((c) => {
  console.log(`  ${c.cn} | ${c.localName}[${c.localId}] 距车来了${c.curDist}m -> ${c.targetName}[${c.targetId}] ${c.bestD}m`);
});

if (!APPLY) {
  console.log('\n（预演模式：未修改数据。加 --apply 执行修正）');
  process.exit(0);
}

// ---------- 应用 ----------
fs.mkdirSync(`${OUT_DIR}/backup_20260816_platform_fix`, { recursive: true });
for (const f of ['bus_route_stops.js', 'bus_stops.js', 'stop_routes.js', 'network_graph.js']) {
  fs.copyFileSync(`${ROOT}/data/${f}`, `${OUT_DIR}/backup_20260816_platform_fix/${f}`);
}

const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));
const changeSet = new Set();
for (const c of changes) changeSet.add(`${c.cn}|${c.order}`);
let applied = 0;
for (const cn of Object.keys(routeStopsNew)) {
  const arr = routeStopsNew[cn];
  arr.forEach((st, i) => {
    if (!changeSet.has(`${cn}|${i + 1}`)) return;
    const c = changes.find((x) => x.cn === cn && x.order === i + 1);
    if (!c) return;
    st[2] = c.targetId;
    applied++;
  });
}

// 重建 stop_routes
const stopRoutesNew = {};
for (const cn of Object.keys(routeStopsNew)) {
  const base = cn.split('(')[0];
  for (const st of routeStopsNew[cn]) {
    (stopRoutesNew[st[2]] = stopRoutesNew[st[2]] || new Set()).add(base);
  }
}
const stopRoutesOut = {};
for (const k of Object.keys(stopRoutesNew)) stopRoutesOut[k] = [...stopRoutesNew[k]].sort();

function writeJs(file, name, obj) {
  const content = `window.${name} = ` + JSON.stringify(obj) + ';\n';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { fs.writeFileSync(file, content, 'utf-8'); return; }
    catch (e) { if (attempt === 6) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
  }
}
for (const sub of ['', 'transit_site/']) {
  writeJs(`${ROOT}/${sub}data/bus_route_stops.js`, 'BUS_ROUTE_STOPS', routeStopsNew);
  writeJs(`${ROOT}/${sub}data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
}

const report = [['方向记录', '序号', '站名', '原分站ID', '原距(m)', '新分站', '新分站ID', '新距(m)', '改善(m)', '车来了分站']];
changes.forEach((c) => report.push([c.cn, c.order, c.localName, c.localId, c.curDist, c.targetName, c.targetId, c.bestD, c.improve, c.chName]));
const csvContent = '\uFEFF' + report.map((r) => r.map((v) => (/,/.test(String(v)) ? `"${v}"` : v)).join(',')).join('\r\n') + '\r\n';
for (let attempt = 1; attempt <= 6; attempt++) {
  try { fs.writeFileSync(`${OUT_DIR}/方向分台修正_车来了.csv`, csvContent, 'utf-8'); break; }
  catch (e) { if (attempt === 6) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500); }
}

const check = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const ids = new Set(stopById.keys());
let bad = 0;
for (const k of Object.keys(check)) for (const st of check[k]) if (!ids.has(st[2])) bad++;
console.log(`\n应用完成：${applied} 处，坏站点引用 ${bad}，方向记录 ${Object.keys(check).length}`);
