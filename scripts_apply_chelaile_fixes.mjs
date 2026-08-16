// 用车来了方向分站坐标库修复：
// 1) 换台：确认剩余换台候选（车来了坐标+方向几何双确认）
// 2) 补台：用车来了坐标更新派生平台层
// 3) 显示修正层：所有"本地平台距车来了坐标>100m"的方向停靠点生成 data/chelaile_platform_fixes.js
// 产物：更新 data/bus_route_stops.js、data/derived_platforms.js、data/chelaile_platform_fixes.js + 报告 CSV
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

const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const BUS_STOPS = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const BUS_ROUTES = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');
const DERIVED = loadJsGlobal(`${ROOT}/data/derived_platforms.js`, 'DERIVED_PLATFORMS');
const LIB = JSON.parse(fs.readFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, 'utf-8'));

const stopById = new Map();
for (const f of BUS_STOPS.features) stopById.set(f.properties.stop_id, f);
const lineGeom = new Map();
for (const f of BUS_ROUTES.features) {
  if (f.geometry.type === 'LineString') lineGeom.set(f.properties.route_cn, f.geometry.coordinates);
}

function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
function nearestOnLineDist(p, coords) {
  const sx = Math.cos((p[1] * Math.PI) / 180) || 1;
  const px = p[0] * sx, py = p[1];
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * sx, ay = coords[i][1];
    const bx = coords[i + 1][0] * sx, by = coords[i + 1][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.sqrt(((px - cx) / sx) ** 2 + (py - cy) ** 2) * 111320;
    if (d < best) best = d;
  }
  return best;
}
function nameCore(n) {
  let s = String(n || '').replace(/^公共汽车/, '').replace(/^BRT/, '');
  s = s.replace(/[（(][^（）()]*[）)]$/, '').replace(/\d+$/, '');
  s = s.replace(/(总站|首末站|站|分站)$/, '');
  return s.trim();
}
function sameFamily(a, b) {
  const ca = nameCore(a), cb = nameCore(b);
  if (!ca || !cb) return false;
  if (ca === cb || ca.includes(cb) || cb.includes(ca)) return true;
  let i = 0;
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
  return i >= 2;
}
function csvVal(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, rows) {
  fs.writeFileSync(file, '\uFEFF' + [header.join(','), ...rows.map((r) => r.map(csvVal).join(','))].join('\r\n') + '\r\n', 'utf-8');
}
function parseCsvLine(l) {
  const cells = [];
  let curS = '', inQ = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') {
      if (inQ && l[i + 1] === '"') { curS += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { cells.push(curS); curS = ''; }
    else curS += ch;
  }
  cells.push(curS);
  return cells;
}

// ============ 1) 换台 ============
const swapRows = fs.readFileSync(`${OUT_DIR}/派生方向站台候选_换台.csv`, 'utf-8')
  .trim().split(/\r?\n/).slice(1)
  .map(parseCsvLine)
  .filter((c) => c.length >= 9);
const swapReport = [];
let swapApplied = 0, swapSkipped = 0;
const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));

for (const r of swapRows) {
  const [num, cn, station, recId, recD, targetName, targetId, targetD, targetType] = r;
  // 已应用过（当前记录已是建议平台）→ 跳过
  const cur = routeStopsNew[cn]?.find((s) => s[1] === station);
  if (!cur) { swapReport.push([num, cn, station, recId, 'skip', '方向记录中无此站']); swapSkipped++; continue; }
  if (cur[2] === targetId) { swapReport.push([num, cn, station, recId, 'skip', '已应用']); swapSkipped++; continue; }
  // 车来了坐标
  const lib = LIB[cn];
  const hit = lib?.stops?.find((s) => s[1] === station && s[4] != null);
  if (!hit) { swapReport.push([num, cn, station, recId, 'skip', '车来了无此站数据']); swapSkipped++; continue; }
  const chCoord = [hit[4], hit[5]];
  const recCoord = stopById.get(recId)?.geometry.coordinates;
  if (!recCoord) { swapReport.push([num, cn, station, recId, 'skip', '无原平台坐标']); swapSkipped++; continue; }
  const distRecCh = distM(recCoord, chCoord);
  if (distRecCh < 100) { swapReport.push([num, cn, station, recId, 'skip', `车来了坐标距原平台仅${Math.round(distRecCh)}m，无需换台`]); swapSkipped++; continue; }
  // 找距车来了坐标最近且同族的本地平台
  let best = null, bestD = Infinity;
  for (const f of BUS_STOPS.features) {
    if (f.properties.stop_id === recId) continue;
    if (!sameFamily(station, f.properties.name_cn)) continue;
    const d = distM(chCoord, f.geometry.coordinates);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (!best || bestD > 80) { swapReport.push([num, cn, station, recId, 'skip', `无同族平台距车来了坐标≤80m(最近${best ? Math.round(bestD) : '无'})`]); swapSkipped++; continue; }
  // 方向几何双确认
  const geom = lineGeom.get(cn);
  if (!geom) { swapReport.push([num, cn, station, recId, 'skip', '无线路几何']); swapSkipped++; continue; }
  const dNew = nearestOnLineDist(best.geometry.coordinates, geom);
  const dOld = nearestOnLineDist(recCoord, geom);
  if (dNew > 60 || dOld < 100) {
    swapReport.push([num, cn, station, recId, 'skip', `几何不符(新平台${Math.round(dNew)}m/原平台${Math.round(dOld)}m)`]);
    swapSkipped++;
    continue;
  }
  cur[2] = best.properties.stop_id;
  swapReport.push([num, cn, station, recId, 'applied', `${best.properties.name_cn}(${Math.round(bestD)}m,距几何${Math.round(dNew)}m)`]);
  swapApplied++;
}

writeCsv(`${OUT_DIR}/chelaile_换台修复.csv`,
  ['线路', '方向记录', '站名', '原平台ID', '状态', '说明'],
  swapReport);
console.log(`换台：应用 ${swapApplied}，跳过 ${swapSkipped}`);

// ============ 2) 补台：用车来了坐标更新派生平台 ============
const addRows = fs.readFileSync(`${OUT_DIR}/派生方向站台候选_补台.csv`, 'utf-8')
  .trim().split(/\r?\n/).slice(1)
  .map(parseCsvLine)
  .filter((c) => c.length >= 11);
const derivedReport = [];
const derivedNew = JSON.parse(JSON.stringify(DERIVED));

for (const r of addRows) {
  const [conf, station, platId, dirCount, spread, farDist, centLng, centLat, nearName, nearD, routes] = r;
  const routeNames = routes.split('、').map((s) => s.trim()).filter(Boolean);
  // 收集该站所有车来了坐标（来自涉及的线路方向）
  const coords = new Map(); // key lng,lat -> count
  const perDir = [];
  for (const nm of routeNames) {
    const base = nm.split('(')[0];
    for (const cn of Object.keys(LIB)) {
      if (!cn.startsWith(base + '(')) continue;
      const hit = LIB[cn].stops.find((s) => s[1] === station && s[4] != null);
      if (hit) {
        const key = `${hit[4].toFixed(6)},${hit[5].toFixed(6)}`;
        coords.set(key, (coords.get(key) || 0) + 1);
        perDir.push({ cn, lng: hit[4], lat: hit[5] });
      }
    }
  }
  if (!coords.size) { derivedReport.push([station, platId, 'skip', '车来了无此站坐标']); continue; }
  const platCoord = stopById.get(platId)?.geometry.coordinates;
  // 取"距原平台最远"的坐标簇（即缺失方向）
  let bestCoord = null, bestDist = -1;
  for (const [key, cnt] of coords) {
    const [lng, lat] = key.split(',').map(Number);
    const d = platCoord ? distM(platCoord, [lng, lat]) : 0;
    if (d > bestDist) { bestDist = d; bestCoord = { lng, lat, cnt }; }
  }
  if (platCoord && bestDist < 100) { derivedReport.push([station, platId, 'skip', `车来了坐标距原平台${Math.round(bestDist)}m，无需派生`]); continue; }
  const entry = derivedNew.find((p) => p.station === station);
  if (entry) {
    entry.lng = bestCoord.lng;
    entry.lat = bestCoord.lat;
    entry.chSource = 'chelaile';
    entry.chRoutes = routes;
    derivedReport.push([station, platId, 'updated', `车来了(${bestCoord.lng},${bestCoord.lat}) 来源${bestCoord.cnt}个方向`]);
  } else {
    derivedNew.push({ station, name: station, lng: bestCoord.lng, lat: bestCoord.lat, conf: '车来了', chSource: 'chelaile', chRoutes: routes });
    derivedReport.push([station, platId, 'added', `新增车来了派生点(${bestCoord.lng},${bestCoord.lat})`]);
  }
}
writeCsv(`${OUT_DIR}/chelaile_补台更新.csv`, ['站名', '原平台ID', '状态', '说明'], derivedReport);

// ============ 3) 显示修正层：所有本地平台距车来了坐标>100m 的方向停靠点 ============
const fixes = {};
let fixCount = 0;
for (const cn of Object.keys(LIB)) {
  const stops = LIB[cn].stops || [];
  const items = [];
  for (const s of stops) {
    if (s[4] == null) continue;
    const recCoord = stopById.get(s[2])?.geometry.coordinates;
    if (!recCoord) continue;
    const d = distM(recCoord, [s[4], s[5]]);
    if (d > 100) {
      items.push([s[1], s[4], s[5]]);
      fixCount++;
    }
  }
  if (items.length) fixes[cn] = items;
}
fs.writeFileSync(
  `${ROOT}/data/chelaile_platform_fixes.js`,
  'window.CHELAILE_PLATFORM_FIXES = ' + JSON.stringify(fixes) + ';\n',
  'utf-8',
);
console.log(`显示修正层：${Object.keys(fixes).length} 个方向记录，${fixCount} 个停靠点`);

// ============ 4) 写回数据 ============
fs.writeFileSync(`${ROOT}/data/bus_route_stops.js`, 'window.BUS_ROUTE_STOPS = ' + JSON.stringify(routeStopsNew) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/bus_route_stops.js`, 'window.BUS_ROUTE_STOPS = ' + JSON.stringify(routeStopsNew) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/data/derived_platforms.js`, 'window.DERIVED_PLATFORMS = ' + JSON.stringify(derivedNew) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/derived_platforms.js`, 'window.DERIVED_PLATFORMS = ' + JSON.stringify(derivedNew) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/data/chelaile_platform_fixes.js`, 'window.CHELAILE_PLATFORM_FIXES = ' + JSON.stringify(fixes) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/chelaile_platform_fixes.js`, 'window.CHELAILE_PLATFORM_FIXES = ' + JSON.stringify(fixes) + ';\n', 'utf-8');

// 重建 stop_routes（站点ID -> 途经线路基数名）
const stopRoutesNew = {};
for (const cn of Object.keys(routeStopsNew)) {
  const base = cn.split('(')[0];
  for (const st of routeStopsNew[cn]) {
    (stopRoutesNew[st[2]] = stopRoutesNew[st[2]] || new Set()).add(base);
  }
}
const stopRoutesOut = {};
for (const k of Object.keys(stopRoutesNew)) {
  stopRoutesOut[k] = [...stopRoutesNew[k]].sort();
}
fs.writeFileSync(`${ROOT}/data/stop_routes.js`, 'window.STOP_ROUTES = ' + JSON.stringify(stopRoutesOut) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/stop_routes.js`, 'window.STOP_ROUTES = ' + JSON.stringify(stopRoutesOut) + ';\n', 'utf-8');

// ============ 5) 校验：重载数据确保无结构破坏 ============
const check = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const keys1 = Object.keys(check), keys2 = Object.keys(BUS_ROUTE_STOPS);
const sameKeys = keys1.length === keys2.length && keys1.every((k, i) => k === keys2[i]);
const totalStops1 = keys1.reduce((s, k) => s + check[k].length, 0);
const totalStops2 = Object.keys(BUS_ROUTE_STOPS).reduce((s, k) => s + BUS_ROUTE_STOPS[k].length, 0);
console.log(`校验：方向记录 ${keys1.length}/${keys2.length}（键一致=${sameKeys}），停靠数 ${totalStops1}/${totalStops2}`);
console.log('完成');
