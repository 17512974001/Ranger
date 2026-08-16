// 合并表复核：用「行经线路 + 坐标」排查误伤
// 规则：
//  1) 同一方向记录同时含两个站名 → 必为两站，排除
//  2) 距离 >300m 且无共同经停线路 → 排除（缺佐证）
//  3) 其余保留
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
const STOP_ROUTES = loadJsGlobal(`${ROOT}/data/stop_routes.js`, 'STOP_ROUTES');
const BSS = JSON.parse(fs.readFileSync(`${ROOT}/data/bus_stops.js`, 'utf-8').replace(/^window\.BUS_STOPS = /, '').replace(/;\s*$/, '')).features;
const byId = new Map();
for (const f of BSS) byId.set(f.properties.stop_id, f);
const idsByName = {};
for (const f of BSS) (idsByName[f.properties.name_cn] = idsByName[f.properties.name_cn] || []).push(f.properties.stop_id);

function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

const MAP = JSON.parse(fs.readFileSync(`${ROOT}/data/station_merge_map.js`, 'utf-8').replace(/^window\.STATION_MERGE_MAP = /, '').replace(/;\s*$/, ''));

// 方向记录站名集合（用于"同方向并列"检查）
const dirNames = Object.keys(BUS_ROUTE_STOPS).map((cn) => new Set(BUS_ROUTE_STOPS[cn].map((st) => st[1])));

const keep = {};
const drop = [];
for (const [variant, canonical] of Object.entries(MAP)) {
  const vIds = idsByName[variant] || [];
  const cIds = idsByName[canonical] || [];
  if (!vIds.length || !cIds.length) { drop.push({ variant, canonical, reason: '无站点记录' }); continue; }
  // 距离
  let minD = Infinity, maxD = 0;
  for (const a of vIds) {
    const fa = byId.get(a);
    if (!fa) continue;
    for (const b of cIds) {
      const fb = byId.get(b);
      if (!fb) continue;
      const d = distM(fa.geometry.coordinates, fb.geometry.coordinates);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
  }
  // 同方向并列
  const conflict = dirNames.some((s) => s.has(variant) && s.has(canonical));
  if (conflict) { drop.push({ variant, canonical, dist: Math.round(minD), reason: '同方向并列出现（必为两站）' }); continue; }
  // 共同经停线路
  const vRoutes = new Set();
  vIds.forEach((id) => (STOP_ROUTES[id] || []).forEach((r) => vRoutes.add(r)));
  const cRoutes = new Set();
  cIds.forEach((id) => (STOP_ROUTES[id] || []).forEach((r) => cRoutes.add(r)));
  const overlap = [...vRoutes].filter((r) => cRoutes.has(r));
  if (minD > 300 && overlap.length === 0) {
    drop.push({ variant, canonical, dist: Math.round(minD), reason: `距离${Math.round(minD)}m且无共同线路` });
    continue;
  }
  keep[variant] = canonical;
}

fs.writeFileSync(`${ROOT}/data/station_merge_map.js`, 'window.STATION_MERGE_MAP = ' + JSON.stringify(keep) + ';\n', 'utf-8');
fs.writeFileSync(`${ROOT}/transit_site/data/station_merge_map.js`, fs.readFileSync(`${ROOT}/data/station_merge_map.js`, 'utf-8'), 'utf-8');

console.log(`保留 ${Object.keys(keep).length} 条，剔除 ${drop.length} 条`);
console.log('\n剔除清单：');
drop.sort((a, b) => (b.dist || 0) - (a.dist || 0)).forEach((d) => console.log(`  ${d.variant} ↔ ${d.canonical} [${d.dist != null ? d.dist + 'm' : ''}] ${d.reason}`));
console.log('\n保留样例：');
Object.entries(keep).slice(0, 15).forEach(([k, v]) => console.log(`  ${k} → ${v}`));
