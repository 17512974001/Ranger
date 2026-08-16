// 修复跨族名字-ID 错配（16条记录，来自换台跨站族/换台未改名）
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
const stopById = new Map();
for (const f of BUS_STOPS_OBJ.features) stopById.set(f.properties.stop_id, f);

const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));

// [方向记录, 序号(1-based), 站名(须匹配), 新站名|null, 新ID|null]
const fixes = [
  ['339路(地铁鱼珠站总站--萝岗香雪总站)', 16, '开泰大道(新阳路口)', null, 'BV11466898'],
  ['569路(沿河路总站--萝岗香雪总站)', 3, '东晖路', null, 'BV10703778'],
  ['569路(萝岗香雪总站--沿河路总站)', 31, '东晖路', null, 'BV10703778'],
  ['夜13路(梅东路总站--天河儿童公园北门总站)', 2, '锦城花园', '锦城花园总站(东风东)', null],
  ['花18路(中建映花悦府--新和村)', 13, '花都广场', '花都广场(区政府)', null],
  ['花18路(新和村--中建映花悦府)', 6, '花都广场', '花都广场(区政府)', null],
  ['花85路(天湖峰境总站--广州北站总站)', 36, '花都广场', '花都广场(区政府)', null],
  ['花39路短线(万科城--风神花园)', 6, '果岭18站', '果岭18', null],
];

let applied = 0;
for (const [cn, order, expectName, newName, newId] of fixes) {
  const arr = routeStopsNew[cn];
  if (!arr) { console.log(`缺失方向记录: ${cn}`); continue; }
  const st = arr[order - 1];
  if (!st || st[1] !== expectName) {
    console.log(`记录不符(跳过): ${cn} 序号${order} 实际=${st ? `${st[1]}[${st[2]}]` : '无'}`);
    continue;
  }
  if (newId) {
    if (!stopById.has(newId)) { console.log(`ID不存在(跳过): ${cn} ${newId}`); continue; }
    st[2] = newId;
  }
  if (newName) {
    st[1] = newName;
  }
  console.log(`已修: ${cn} 序号${order} → ${st[1]}[${st[2]}]`);
  applied++;
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

// 校验：跨族错配应清零（长途番禺宝安的历史空ID除外）
function normKey(n) {
  return String(n || '').replace(/公共汽车|BRT/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[①-⑩]/g, '').replace(/\d+$/g, '').replace(/(停?[东南西北]行|上行|下行)$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '').replace(/\s+/g, '').trim();
}
const check = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
let harmful = 0;
for (const cn of Object.keys(check)) {
  for (const st of check[cn]) {
    const f = stopById.get(st[2]);
    if (!f) continue;
    const nk1 = normKey(st[1]), nk2 = normKey(f.properties.name_cn);
    if (nk1 && nk2 && nk1 !== nk2) {
      if (st[2] === '[]') continue;
      harmful++;
      console.log(`仍错配: ${cn} | ${st[1]}[${st[2]}] 平台名=${f.properties.name_cn}`);
    }
  }
}
console.log(`\n应用 ${applied} 条；跨族错配剩余 ${harmful} 条`);
