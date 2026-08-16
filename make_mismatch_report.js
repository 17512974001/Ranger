/* 停靠记录与线路几何不一致清单
   对每条方向记录，检查每个停靠站的坐标与线路几何的距离；超过阈值即列入待核实清单，
   并给出"同一合并站内离几何最近的平台"作为建议平台。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataDir = path.join(__dirname, 'data');
const outDir = path.join(__dirname, 'output', 'network');
fs.mkdirSync(outDir, { recursive: true });

function load(varName, file) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(dataDir, file), 'utf-8'), s, { filename: file });
  return s.window[varName];
}
function routeNumOf(cn) {
  const m = String(cn || '').match(/^([^（(]+)/);
  return m ? m[1].trim() : String(cn || '');
}

const BUS_ROUTES = load('BUS_ROUTES', 'bus_routes.js');
const BUS_ROUTE_STOPS = load('BUS_ROUTE_STOPS', 'bus_route_stops.js');
const BUS_STOPS = load('BUS_STOPS', 'bus_stops.js');
const busStopById = {};
BUS_STOPS.features.forEach(function (f) { busStopById[f.properties.stop_id] = f; });

const STOP_NAME_FIXES = {
  '广州火车': '广州火车站', '从化客运': '从化客运站', '天河客运': '天河客运站',
  '顺德一中实验学校': '广东顺德文德学校', '番禺宝墨园': '宝墨园总站', '宝墨园': '宝墨园总站'
};
function fixedName(n) { return STOP_NAME_FIXES[n] || String(n || ''); }
function isGenericStop(name) { return /^临时站|^招呼站/.test(name); }

// 站名规范化（与 make_network_analysis.js 完整口径一致）
const rawSet = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) { rawSet[st[1]] = true; });
});
function stripSubMarkers(s) {
  s = s.replace(/^公共汽车BRT/, '').replace(/^公共汽车/, '');
  s = s.replace(/^BRT/, '').replace(/\(BRT\)$/, '');
  s = s.replace(/(?:[NS]\d+)(?:子站)?$/, '');
  s = s.replace(/\d+号分站$/, '');
  s = s.replace(/分站$/, '');
  s = s.replace(/[（(]分站[）)]$/, '');
  return s;
}
function digitBaseName(s) {
  const m = s.match(/^(.*?)(\d+)$/);
  if (!m || !m[1]) { return null; }
  const base = m[1];
  if (/[（(]/.test(base)) { return base; }
  const cands = [base, base.replace(/站$/, ''), base + '站'];
  for (const c of cands) { if (rawSet[c]) { return c; } }
  return base;
}
function segLenM(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
// 括号别名（与 make_network_analysis.js 一致）
const nameCoords = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
    if (!nameCoords[st[1]] && busStopById[st[2]]) { nameCoords[st[1]] = busStopById[st[2]].geometry.coordinates; }
  });
});
BUS_STOPS.features.forEach(function (f) {
  if (!nameCoords[f.properties.name_cn]) { nameCoords[f.properties.name_cn] = f.geometry.coordinates; }
});
const aliasGroups = {};
Object.keys(nameCoords).forEach(function (n) {
  if (isGenericStop(n)) { return; }
  const pb = n.replace(/\d+$/, '').replace(/[（(][^（）()]*[）)]$/, '').replace(/站$/, '');
  if (!pb) { return; }
  (aliasGroups[pb] = aliasGroups[pb] || []).push(n);
});
const stationAlias = {};
Object.keys(aliasGroups).forEach(function (pb) {
  const members = aliasGroups[pb];
  if (members.length < 2) { return; }
  const isDir = function (n) { return /[（(](停?[东南西北]行|上行|下行)[）)]\d*$/.test(n); };
  const plain = members.filter(function (n) { return !/[（(]/.test(n) && !/\d$/.test(n); });
  const bracketed = members.filter(function (n) { return /[（(]/.test(n) && !isDir(n); });
  if (!plain.length || !bracketed.length) { return; }
  const alias = {};
  bracketed.forEach(function (b) {
    const bc = nameCoords[b]; if (!bc) { return; }
    plain.forEach(function (p) {
      const pc = nameCoords[p]; if (!pc) { return; }
      const d = segLenM(pc, bc);
      if (d <= 300 && (!alias[p] || alias[p].d > d)) { alias[p] = { b: b, d: d }; }
    });
  });
  Object.keys(alias).forEach(function (p) { stationAlias[p] = alias[p].b; });
});
function resolveName(n) { return stationAlias[n] || n; }
function normStopName(name) {
  let s = stripSubMarkers(fixedName(String(name || '')));
  let db = digitBaseName(s);
  if (db) { s = db; }
  s = resolveName(s);
  s = stripSubMarkers(s);
  const db2 = digitBaseName(s);
  if (db2) { s = db2; }
  s = s.replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, '');
  s = s.replace(/(?<![A-Za-z])[A-Za-z]站$/, '');
  return s.replace(/站$/, '').trim();
}
// 同一合并站的平台ID集合（不含通用站名）
const nameToIds = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
    if (isGenericStop(st[1])) { return; }
    const n = normStopName(st[1]);
    (nameToIds[n] = nameToIds[n] || new Set()).add(st[2]);
  });
});

function distToLine(p, coords) {
  const sx = Math.cos(p[1] * Math.PI / 180) || 1;
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
    if (d < best) { best = d; }
  }
  return Math.round(best);
}

const rows = [];
Object.keys(BUS_ROUTE_STOPS).forEach(function (cn) {
  const feat = BUS_ROUTES.features.find(function (f) { return f.properties.route_cn === cn; });
  if (!feat || feat.geometry.type !== 'LineString') { return; }
  const coords = feat.geometry.coordinates;
  (BUS_ROUTE_STOPS[cn] || []).forEach(function (st, idx) {
    const f = busStopById[st[2]];
    if (!f) { return; }
    const d = distToLine(f.geometry.coordinates, coords);
    if (d < 150) { return; }
    let sug = '';
    let sugD = '';
    if (!isGenericStop(st[1])) {
      const ids = nameToIds[normStopName(st[1])] || [];
      let bestId = null, bestD = Infinity;
      ids.forEach(function (id) {
        const ff = busStopById[id];
        if (!ff) { return; }
        const dd = distToLine(ff.geometry.coordinates, coords);
        if (dd < bestD) { bestD = dd; bestId = id; }
      });
      if (bestId && bestD + 30 < d) {
        sug = bestId;
        sugD = String(bestD);
      }
    }
    const stopArr = BUS_ROUTE_STOPS[cn];
    const isTerm = idx === 0 || idx === stopArr.length - 1;
    const isTotal = /总站/.test(st[1]);
    const tier = d >= 1000 ? '>=1000m' : (d >= 300 ? '300-1000m' : '150-300m');
    let hint = '';
    if (d >= 1000) { hint = '整线几何异常（花81/944 类），先查线路走向'; }
    else if (sug && Number(sugD) <= 50) { hint = '高置信度：同站平台距线路 ≤50m，可按自动修复标准改记录平台'; }
    else if (isTerm) { hint = '首末站偏差：总站平台多在站场内，几何不延伸进去属正常，大概率无需改'; }
    else if (sug) { hint = '有建议但平台仍较远（50-200m，低置信度）：建议平台 + 实况核实'; }
    else { hint = '中途站无建议：需对照实况/线路核实'; }
    rows.push({
      num: routeNumOf(cn),
      dir: cn,
      stop: st[1],
      id: st[2],
      dist: d,
      sug: sug,
      sugD: sugD,
      isTerm: isTerm ? '是' : '否',
      isTotal: isTotal ? '是' : '否',
      tier: tier,
      hint: hint
    });
  });
});
rows.sort(function (a, b) { return b.dist - a.dist; });

function csvVal(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const lines = [['线路号', '方向记录', '站点', '站点ID', '与几何距离(m)', '建议平台ID', '建议平台距离(m)', '是否首末站', '站名含总站', '偏差档位', '核对提示']
  .join(',')].concat(rows.map(function (r) {
    return [r.num, r.dir, r.stop, r.id, r.dist, r.sug, r.sugD, r.isTerm, r.isTotal, r.tier, r.hint].map(csvVal).join(',');
  }));
fs.writeFileSync(path.join(outDir, '停靠记录几何不一致清单.csv'), '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
console.log('不一致条目(>=150m):', rows.length, '| 含建议平台的:', rows.filter(r => r.sug).length);
rows.slice(0, 8).forEach(function (r) {
  console.log(r.num, r.stop, r.id, r.dist + 'm', r.sug ? '→ 建议' + r.sug + '(' + r.sugD + 'm)' : '');
});
