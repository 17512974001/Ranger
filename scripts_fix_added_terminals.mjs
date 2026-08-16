// 修正补充线路的终点站问题：
// 102 广钢新城(崇文二路)总站、107 花城广场西总站、110 西坑① 新建站台；
// 114 终点统一为 罗冲围总站(松南路)；可重复运行
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';

function loadJsGlobal(file, globalName) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), s, { filename: file });
  return s.window[globalName];
}
const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const BUS_STOPS_OBJ = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const BUS_ROUTES = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');

// ---------- 新建站台 ----------
const busStopsNew = JSON.parse(JSON.stringify(BUS_STOPS_OBJ));
function addStation(id, name, lng, lat) {
  if (busStopsNew.features.some((f) => f.properties.stop_id === id)) return;
  busStopsNew.features.push({
    type: 'Feature',
    properties: { stop_id: id, name_cn: name, name_en: '', num_routes: 0, city_cn: '广州', source: 'chelaile' },
    geometry: { type: 'Point', coordinates: [lng, lat] },
  });
}
addStation('CL100015', '广钢新城(崇文二路)总站', 113.240456, 23.075206);
addStation('CL100016', '花城广场西总站', 113.315896, 23.122836);
addStation('CL100017', '西坑①', 113.299166, 23.157116);
addStation('CL100018', '棠安路总站①', 113.252176, 23.190316);
addStation('CL100019', '棠安路总站②', 113.252266, 23.189616);

// ---------- 停靠表修正 ----------
const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));
function renameKey(oldKey, newKey) {
  if (routeStopsNew[oldKey] !== undefined) {
    routeStopsNew[newKey] = routeStopsNew[oldKey];
    delete routeStopsNew[oldKey];
  }
}
function setStop(cn, idx, name, id) {
  const arr = routeStopsNew[cn];
  const i = idx < 0 ? (arr ? arr.length + idx : -1) : idx;
  if (!arr || !arr[i]) throw new Error(`stop not found: ${cn}[${idx}]`);
  arr[i][1] = name;
  arr[i][2] = id;
}

// 102：终点 → 广钢新城(崇文二路)总站
renameKey('102路(东山总站--崇文二路(荔勤北路口))', '102路(东山总站--广钢新城(崇文二路)总站)');
renameKey('102路(崇文二路(荔勤北路口)--东山总站)', '102路(广钢新城(崇文二路)总站--东山总站)');
setStop('102路(东山总站--广钢新城(崇文二路)总站)', -1, '广钢新城(崇文二路)总站', 'CL100015');
setStop('102路(广钢新城(崇文二路)总站--东山总站)', 0, '广钢新城(崇文二路)总站', 'CL100015');

// 107：终点 → 花城广场西总站
renameKey('107路(华成路口--中山八路总站)', '107路(花城广场西总站--中山八路总站)');
renameKey('107路(中山八路总站--华成路口)', '107路(中山八路总站--花城广场西总站)');
setStop('107路(花城广场西总站--中山八路总站)', 0, '花城广场西总站', 'CL100016');
setStop('107路(中山八路总站--花城广场西总站)', -1, '花城广场西总站', 'CL100016');

// 114：终点统一为 罗冲围总站(松南路)
renameKey('114路(罗冲围(松南)总站--南田路)', '114路(罗冲围总站(松南路)--南田路)');
setStop('114路(罗冲围总站(松南路)--南田路)', 0, '罗冲围总站(松南路)', 'BV10016552');

// 110：反向第18站 西坑(益民服装城) 重复 → 应为独立的 西坑①
setStop('110路(文化公园总站--天平架总站)', 17, '西坑①', 'CL100017');

// 105：终点 → 棠安路总站②
renameKey('105路(黄沙总站--棠安路站)', '105路(黄沙总站--棠安路总站②)');
renameKey('105路(棠安路站--黄沙总站)', '105路(棠安路总站②--黄沙总站)');
setStop('105路(黄沙总站--棠安路总站②)', -1, '棠安路总站②', 'CL100019');
setStop('105路(棠安路总站②--黄沙总站)', 0, '棠安路总站②', 'CL100019');

// 113：终点 → 棠安路总站①
renameKey('113路(南田路--棠安路站)', '113路(南田路--棠安路总站①)');
renameKey('113路(棠安路站--南田路)', '113路(棠安路总站①--南田路)');
setStop('113路(南田路--棠安路总站①)', -1, '棠安路总站①', 'CL100018');
setStop('113路(棠安路总站①--南田路)', 0, '棠安路总站①', 'CL100018');

// ---------- 线路几何/元数据 ----------
const routesNew = JSON.parse(JSON.stringify(BUS_ROUTES));
for (const f of routesNew.features) {
  const oldCn = f.properties.route_cn;
  let newCn = null;
  if (oldCn === '102路(东山总站--崇文二路(荔勤北路口))') newCn = '102路(东山总站--广钢新城(崇文二路)总站)';
  else if (oldCn === '102路(崇文二路(荔勤北路口)--东山总站)') newCn = '102路(广钢新城(崇文二路)总站--东山总站)';
  else if (oldCn === '107路(华成路口--中山八路总站)') newCn = '107路(花城广场西总站--中山八路总站)';
  else if (oldCn === '107路(中山八路总站--华成路口)') newCn = '107路(中山八路总站--花城广场西总站)';
  else if (oldCn === '114路(罗冲围(松南)总站--南田路)') newCn = '114路(罗冲围总站(松南路)--南田路)';
  else if (oldCn === '105路(黄沙总站--棠安路站)') newCn = '105路(黄沙总站--棠安路总站②)';
  else if (oldCn === '105路(棠安路站--黄沙总站)') newCn = '105路(棠安路总站②--黄沙总站)';
  else if (oldCn === '113路(南田路--棠安路站)') newCn = '113路(南田路--棠安路总站①)';
  else if (oldCn === '113路(棠安路站--南田路)') newCn = '113路(棠安路总站①--南田路)';
  if (newCn) {
    f.properties.route_cn = newCn;
    const t = newCn.slice(newCn.indexOf('(') + 1, newCn.lastIndexOf(')')).split('--');
    f.properties.s_stop_cn = t[0];
    f.properties.e_stop_cn = t[1];
  }
}

// ---------- 重建 stop_routes ----------
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
  writeJs(`${ROOT}/${sub}data/bus_routes.js`, 'BUS_ROUTES', routesNew);
  writeJs(`${ROOT}/${sub}data/bus_stops.js`, 'BUS_STOPS', busStopsNew);
  writeJs(`${ROOT}/${sub}data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
}

// 校验
const check = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
for (const k of ['102路(东山总站--广钢新城(崇文二路)总站)', '102路(广钢新城(崇文二路)总站--东山总站)', '107路(花城广场西总站--中山八路总站)', '107路(中山八路总站--花城广场西总站)', '114路(罗冲围总站(松南路)--南田路)']) {
  if (!check[k]) throw new Error(`missing ${k}`);
}
const dup = {};
for (const k of Object.keys(check)) {
  const ids = check[k].map((s) => s[2]);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) (dup[k] = dup[k] || []).push(id); });
}
console.log('重复站ID残留:', JSON.stringify(dup));
console.log('方向记录数:', Object.keys(check).length);
console.log('完成');
