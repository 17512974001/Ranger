/* 方向分台候选扫描 v2
   - 换台候选：逐方向记录校验。记录平台距本方向几何 >=100m，且同族平台距本方向几何 <=50m 才建议换台。
     防止复刻 263 路林和西问题（一条线的几何可能同时贴多个同族平台，不能按站点级聚类换台）。
   - 补台候选：站点级远侧汇聚点（多方向、散布小、汇聚点 100m 内无平台），派生缺失的方向站台。
   产物：output/network/派生方向站台候选_换台.csv、_补台.csv */
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

const BUS_STOPS = load('BUS_STOPS', 'bus_stops.js').features;
const BUS_ROUTE_STOPS = load('BUS_ROUTE_STOPS', 'bus_route_stops.js');
const BUS_ROUTES = load('BUS_ROUTES', 'bus_routes.js').features;

const byId = {};
BUS_STOPS.forEach(function (f) { byId[f.properties.stop_id] = f; });
const lineCache = {};
BUS_ROUTES.forEach(function (f) { if (f.geometry.type === 'LineString') { lineCache[f.properties.route_cn] = f.geometry.coordinates; } });

function distM(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
function nearestOnLine(p, coords) {
  const sx = Math.cos(p[1] * Math.PI / 180) || 1;
  const px = p[0] * sx, py = p[1];
  let best = Infinity, bestPt = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * sx, ay = coords[i][1];
    const bx = coords[i + 1][0] * sx, by = coords[i + 1][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.sqrt(((px - cx) / sx) ** 2 + (py - cy) ** 2) * 111320;
    if (d < best) { best = d; bestPt = [cx / sx, cy]; }
  }
  return { dist: best, pt: bestPt };
}
function isGeneric(name) { return /^临时站|^招呼站/.test(name); }
function nameCore(n) {
  let s = String(n || '').replace(/^公共汽车/, '').replace(/^BRT/, '');
  s = s.replace(/[（(][^（）()]*[）)]$/, '').replace(/\d+$/, '');
  s = s.replace(/(总站|首末站|站|分站)$/, '');
  return s.trim();
}
function sameFamily(a, b) {
  const ca = nameCore(a), cb = nameCore(b);
  if (!ca || !cb) { return false; }
  if (ca === cb || ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0) { return true; }
  let i = 0;
  while (i < ca.length && i < cb.length && ca[i] === cb[i]) { i++; }
  return i >= 2;
}
function routeNumOf(cn) {
  const m = String(cn || '').match(/^([^（(]+)/);
  return m ? m[1].trim() : String(cn || '');
}
function csvVal(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ---------- 换台候选（逐方向记录） ----------
const swapRows = [];
Object.keys(BUS_ROUTE_STOPS).forEach(function (cn) {
  const coords = lineCache[cn];
  if (!coords) { return; }
  const stopArr = BUS_ROUTE_STOPS[cn] || [];
  stopArr.forEach(function (st, idx) {
    if (isGeneric(st[1])) { return; }
    const rec = byId[st[2]];
    if (!rec) { return; }
    // 首末站偏差多为终点站几何未延伸进站场，交给显示层吸附，不做换台
    if (idx === 0 || idx === stopArr.length - 1) { return; }
    const d0 = nearestOnLine(rec.geometry.coordinates, coords).dist;
    // 100–300m 才可能是"平台错位"；超过 300m 多为线路几何坏点，不换台
    if (d0 < 100 || d0 >= 300) { return; }
    let best = null;
    BUS_STOPS.forEach(function (f) {
      if (f.properties.stop_id === st[2] || isGeneric(f.properties.name_cn)) { return; }
      if (!sameFamily(st[1], f.properties.name_cn)) { return; }
      const d = nearestOnLine(f.geometry.coordinates, coords).dist;
      if (d <= 50 && (!best || d < best.d)) {
        best = { name: f.properties.name_cn, id: f.properties.stop_id, d: d };
      }
    });
    if (best) {
      swapRows.push({
        cn: cn, num: routeNumOf(cn),
        station: st[1], recId: st[2], recD: Math.round(d0),
        target: best.name, targetId: best.id, targetD: Math.round(best.d)
        , targetTerminal: /总站|首末站/.test(best.name) ? '总站' : '普通'
      });
    }
  });
});
swapRows.sort(function (a, b) { return (a.targetD - b.targetD) || (b.recD - a.recD); });

// ---------- 补台候选（站点级远侧汇聚点） ----------
const stopDirs = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (cn) {
  const coords = lineCache[cn];
  if (!coords) { return; }
  (BUS_ROUTE_STOPS[cn] || []).forEach(function (st) {
    const f = byId[st[2]];
    if (!f) { return; }
    const n = nearestOnLine(f.geometry.coordinates, coords);
    (stopDirs[st[2]] = stopDirs[st[2]] || []).push({ cn: cn, dist: n.dist, pt: n.pt });
  });
});
const addRows = [];
Object.keys(stopDirs).forEach(function (sid) {
  const dirs = stopDirs[sid];
  const platF = byId[sid];
  if (!platF || isGeneric(platF.properties.name_cn)) { return; }
  const plat = platF.geometry.coordinates;
  const near = dirs.filter(function (d) { return d.dist <= 100; });
  const far = dirs.filter(function (d) { return d.dist > 100; });
  if (!near.length || far.length < 2) { return; }
  const clusters = [];
  far.forEach(function (d) {
    let bestC = -1, bestD = Infinity;
    clusters.forEach(function (c, i) {
      const d0 = distM(c.cent, d.pt);
      if (d0 < bestD) { bestD = d0; bestC = i; }
    });
    if (bestC >= 0 && bestD <= 120) {
      clusters[bestC].pts.push(d.pt);
      clusters[bestC].dirs.push(d.cn);
    } else {
      clusters.push({ pts: [d.pt], dirs: [d.cn], cent: d.pt.slice() });
    }
    clusters.forEach(function (c) {
      c.cent = [
        c.pts.reduce(function (s, p) { return s + p[0]; }, 0) / c.pts.length,
        c.pts.reduce(function (s, p) { return s + p[1]; }, 0) / c.pts.length
      ];
    });
  });
  clusters.forEach(function (c) {
    if (c.dirs.length < 2) { return; }
    let spread = 0;
    for (let i = 0; i < c.pts.length; i++) {
      for (let j = i + 1; j < c.pts.length; j++) {
        const d = distM(c.pts[i], c.pts[j]);
        if (d > spread) { spread = d; }
      }
    }
    if (spread > 150) { return; }
    const cent = c.cent;
    const farDist = Math.round(distM(plat, cent));
    // 汇聚点 100m 内是否已有任何平台（有则不补台）
    let nName = '', nD = Infinity;
    BUS_STOPS.forEach(function (f) {
      const d = distM(f.geometry.coordinates, cent);
      if (d < nD) { nD = d; nName = f.properties.name_cn; }
    });
    nD = Math.round(nD);
    if (nD <= 100) { return; } // 已有平台，交给换台逻辑
    let conf = '低';
    if (c.dirs.length >= 3 && spread <= 80) { conf = '高'; }
    else if (c.dirs.length >= 2 && spread <= 120) { conf = '中'; }
    const routeNums = Array.from(new Set(c.dirs.map(routeNumOf)));
    addRows.push({
      conf: conf,
      station: platF.properties.name_cn, platId: sid,
      dirCount: c.dirs.length, spread: Math.round(spread),
      farDist: farDist, centLng: cent[0].toFixed(6), centLat: cent[1].toFixed(6),
      nearName: nName, nearD: nD,
      routes: routeNums.join('、')
    });
  });
});
addRows.sort(function (a, b) {
  const ord = { '高': 0, '中': 1, '低': 2 };
  return (ord[a.conf] - ord[b.conf]) || (b.dirCount - a.dirCount);
});

// ---------- 输出 ----------
const swapHeader = ['线路', '方向记录', '站名', '记录平台ID', '记录距几何(m)', '建议平台名', '建议平台ID', '建议距几何(m)', '建议平台类型'].join(',');
const swapLines = [swapHeader].concat(swapRows.map(function (r) {
  return [r.num, r.cn, r.station, r.recId, r.recD, r.target, r.targetId, r.targetD, r.targetTerminal].map(csvVal).join(',');
})).join('\r\n');
fs.writeFileSync(path.join(outDir, '派生方向站台候选_换台.csv'), '\uFEFF' + swapLines + '\r\n', 'utf-8');

const addHeader = ['置信度', '站名', '记录平台ID', '远侧方向数', '散布(m)', '距平台(m)', '汇聚点经度', '汇聚点纬度', '邻近平台', '邻近距离(m)', '涉及线路'].join(',');
const addLines = [addHeader].concat(addRows.map(function (r) {
  return [r.conf, r.station, r.platId, r.dirCount, r.spread, r.farDist, r.centLng, r.centLat, r.nearName, r.nearD, r.routes].map(csvVal).join(',');
})).join('\r\n');
fs.writeFileSync(path.join(outDir, '派生方向站台候选_补台.csv'), '\uFEFF' + addLines + '\r\n', 'utf-8');

console.log('换台候选(逐方向): ' + swapRows.length + ' 条');
console.log('补台候选(站点级): ' + addRows.length + ' 条');
console.log('补台置信度: ' + JSON.stringify(addRows.reduce(function (o, r) { o[r.conf] = (o[r.conf] || 0) + 1; return o; }, {})));
console.log('');
console.log('== 换台 高置信样例（建议平台距本方向几何 ≤15m）==');
const tight = swapRows.filter(function (r) { return r.targetD <= 15; });
tight.slice(0, 15).forEach(function (r) {
  console.log('  ' + r.num + ' | ' + r.station + ' 记录' + r.recD + 'm → ' + r.target + ' ' + r.targetD + 'm [' + r.targetTerminal + ']');
});
