// 构建「方向分站坐标库」：本地方向记录 ↔ 车来了上下行站点表匹配
// 产物：data/chelaile_direction_stops.js（全量）、output/network/chelaile_direction_stops.json、_匹配统计.csv
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;
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
const stopById = new Map();
for (const f of BUS_STOPS.features) {
  stopById.set(f.properties.stop_id, f.geometry.coordinates);
}

// ---------- 站名规范化（对比用，尽量宽松） ----------
function normName(n) {
  return String(n || '')
    .replace(/公共汽车/g, '')
    .replace(/BRT/g, '')
    .replace(/[（(][^（）()]*[）)]/g, '')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/\d+$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function seqOverlap(a, b) {
  const setB = new Set(b.map(normName));
  let hit = 0;
  for (const n of a) if (setB.has(normName(n))) hit++;
  return hit / Math.max(1, a.length);
}

// ---------- 读取抓取结果 ----------
const raws = [];
if (fs.existsSync(RAW_DIR)) {
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (!f.endsWith('.json')) continue;
    try { raws.push(JSON.parse(fs.readFileSync(`${RAW_DIR}/${f}`, 'utf-8'))); } catch { /* skip */ }
  }
}
const rawByBase = new Map();
for (const r of raws) rawByBase.set(r.base, r);

// ---------- 匹配 ----------
const library = {};       // cn -> {dir, chStart, chEnd, stops:[[order, localName, localId, chName, lng, lat, sId, physicalStId],...]}
const stats = { totalDirs: 0, matchedDirs: 0, noChDirs: 0, matchedStops: 0, totalStops: 0 };
const noChList = [];

for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const base = cn.split('(')[0];
  stats.totalDirs++;
  stats.totalStops += BUS_ROUTE_STOPS[cn].length;
  const raw = rawByBase.get(base);
  if (!raw || raw.status !== 'found' || !raw.details) {
    stats.noChDirs++;
    noChList.push({ cn, reason: raw?.status || '未抓取' });
    continue;
  }
  const localNames = BUS_ROUTE_STOPS[cn].map((st) => st[1]);
  // 找匹配的车来了方向
  const chDirs = Object.values(raw.details);
  if (!chDirs.length) {
    stats.noChDirs++;
    noChList.push({ cn, reason: '无详情' });
    continue;
  }
  let best = null, bestScore = 0;
  for (const d of chDirs) {
    if (!d?.stations?.length) continue;
    const chNames = d.stations.map((st) => st.sn);
    const score = seqOverlap(localNames, chNames);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  if (!best || bestScore < 0.6) {
    stats.noChDirs++;
    noChList.push({ cn, reason: `无匹配(最高${(bestScore * 100).toFixed(0)}%)` });
    continue;
  }
  stats.matchedDirs++;
  const chStops = best.stations;
  const stops = BUS_ROUTE_STOPS[cn].map(([order, localName, localId], i) => {
    const n = normName(localName);
    let hit = null, bestD = Infinity;
    for (const cs of chStops) {
      if (normName(cs.sn) !== n) continue;
      const dd = Math.abs(cs.order - order);
      if (dd < bestD) { bestD = dd; hit = cs; }
    }
    if (hit) stats.matchedStops++;
    return hit
      ? [order, localName, localId, hit.sn, hit.wgsLng, hit.wgsLat, hit.sId, hit.physicalStId]
      : [order, localName, localId, null, null, null, null, null];
  });
  library[cn] = {
    dir: best.line?.direction,
    chStart: best.line?.startSn,
    chEnd: best.line?.endSn,
    stationsNum: best.line?.stationsNum,
    stops,
  };
}

// ---------- 输出 ----------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, JSON.stringify(library), 'utf-8');
fs.writeFileSync(
  `${ROOT}/data/chelaile_direction_stops.js`,
  'window.CHELAILE_DIRECTION_STOPS = ' + JSON.stringify(library) + ';\n',
  'utf-8',
);

// 匹配统计 CSV
const rows = [`方向记录,匹配状态,原因/车来了方向`];
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const lib = library[cn];
  if (lib) {
    const matched = lib.stops.filter((s) => s[3] != null).length;
    rows.push(`${cn},已匹配,${matched}/${lib.stops.length}`);
  } else {
    const miss = noChList.find((m) => m.cn === cn);
    rows.push(`${cn},未匹配,${miss?.reason || ''}`);
  }
}
fs.writeFileSync(`${OUT_DIR}/chelaile_匹配统计.csv`, '\uFEFF' + rows.join('\r\n'), 'utf-8');

const stopMatchedPct = stats.totalStops ? ((stats.matchedStops / stats.totalStops) * 100).toFixed(1) : 0;
console.log(JSON.stringify({ ...stats, stopMatchedPct }, null, 2));
console.log('未匹配方向记录示例:');
noChList.slice(0, 30).forEach((m) => console.log('  -', m.cn, '|', m.reason));
