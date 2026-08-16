// 全网方向分台修正（按编号映射）：车来了分站编号 ①/②/③ → 本地同名 N 号分站
// 用法：node scripts_apply_chelaile_platforms.mjs [--apply] [--limit N]
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT_DIR = `${ROOT}/output/network`;
const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

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

const CN_NUM = { '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5, '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10 };
function normName(n) {
  return String(n || '')
    .replace(/公共汽车/g, '')
    .replace(/BRT/g, '')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/\d+$/g, '')
    .replace(/(停?[东南西北]行|上行|下行)$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '')
    .replace(/\s+/g, '')
    .trim();
}
// 保留括号内容的匹配键（统一括号宽度，去掉 ①②③/数字/方向后缀/尾缀）
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
// 取站名末尾的分站编号（数字或①-⑩），无则 null
function platformNum(name) {
  const s = String(name || '').replace(/[（(][^（）()]*[）)]/g, '');
  const m = s.match(/([①-⑩]|\d+)$/);
  if (!m) return null;
  const v = m[1];
  return CN_NUM[v] != null ? CN_NUM[v] : parseInt(v, 10);
}
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

// 站族索引：normName -> [{id, name, num, coord}]
const familyIndex = {};
for (const f of BUS_STOPS_OBJ.features) {
  const n = normKey(f.properties.name_cn);
  if (!n) continue;
  (familyIndex[n] = familyIndex[n] || []).push({
    id: f.properties.stop_id,
    name: f.properties.name_cn,
    num: platformNum(f.properties.name_cn),
    coord: f.geometry.coordinates,
  });
}

const changes = [];
let checked = 0;
for (const cn of Object.keys(LIB)) {
  if (checked >= LIMIT) break;
  const stops = LIB[cn].stops || [];
  for (const s of stops) {
    // s: [order, localName, localId, chName, lng, lat, sId, physicalStId, namesakeStId, matchDist]
    if (!s[3]) continue;
    const chNum = platformNum(s[3]);
    if (chNum == null) continue; // 车来了无编号，不动
    const localName = s[1], localId = s[2];
    const nLocal = normKey(localName);
    const nCh = normKey(s[3]);
    if (!nLocal || nLocal !== nCh) continue; // 同名同族
    if (/^临时站|^招呼站/.test(localName)) continue;
    const cur = stopById.get(localId);
    if (!cur) continue;
    const cands = (familyIndex[nLocal] || []).filter((c) => c.num === chNum);
    if (!cands.length) continue;
    const chCoord = [s[4], s[5]];
    let best = null, bestD = Infinity;
    for (const c of cands) {
      const d = distM(c.coord, chCoord);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (!best || best.id === localId) continue;
    checked++;
    const curDist = distM(cur.geometry.coordinates, chCoord);
    changes.push({
      cn, order: s[0], localName, localId, curDist: Math.round(curDist),
      targetName: best.name, targetId: best.id, bestD: Math.round(bestD),
      chName: s[3], outlier: bestD > 300,
    });
  }
}

console.log(`按编号映射：${changes.length} 处方向停靠需要换分站`);
console.log(`其中目标平台距车来了坐标>300m（异常待查）：${changes.filter((c) => c.outlier).length} 处`);
const byStation = {};
for (const c of changes) {
  const key = normName(c.localName);
  (byStation[key] = byStation[key] || []).push(c);
}
const top = Object.entries(byStation).sort((a, b) => b[1].length - a[1].length).slice(0, 15);
console.log('涉及最多站点（前15）：');
top.forEach(([k, v]) => console.log(`  ${k}: ${v.length} 处`));
console.log('样例（前15）：');
changes.slice(0, 15).forEach((c) => {
  console.log(`  ${c.cn} | ${c.localName}[${c.localId}] -> ${c.targetName}[${c.targetId}]（车来了${c.chName}${c.outlier ? ' ⚠远' : ''}）`);
});
if (changes.some((c) => c.outlier)) {
  console.log('\n异常（>300m）样例：');
  changes.filter((c) => c.outlier).slice(0, 10).forEach((c) => {
    console.log(`  ${c.cn} | ${c.localName} -> ${c.targetName} | 车来了${c.chName} 距${c.bestD}m`);
  });
}

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
  fs.writeFileSync(file, `window.${name} = ` + JSON.stringify(obj) + ';\n', 'utf-8');
}
for (const sub of ['', 'transit_site/']) {
  writeJs(`${ROOT}/${sub}data/bus_route_stops.js`, 'BUS_ROUTE_STOPS', routeStopsNew);
  writeJs(`${ROOT}/${sub}data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
}

// 报告
const report = [['方向记录', '序号', '站名', '原分站ID', '新分站', '新分站ID', '车来了分站', '目标距(m)', '异常']];
changes.forEach((c) => report.push([c.cn, c.order, c.localName, c.localId, c.targetName, c.targetId, c.chName, c.bestD, c.outlier ? '是' : '']));
fs.writeFileSync(`${OUT_DIR}/方向分台修正_车来了.csv`, '\uFEFF' + report.map((r) => r.map((v) => (/,/.test(String(v)) ? `"${v}"` : v)).join(',')).join('\r\n') + '\r\n', 'utf-8');

// 校验
const check = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const ids = new Set(stopById.keys());
let bad = 0;
for (const k of Object.keys(check)) for (const st of check[k]) if (!ids.has(st[2])) bad++;
console.log(`\n应用完成：${applied} 处，坏站点引用 ${bad}，方向记录 ${Object.keys(check).length}`);
