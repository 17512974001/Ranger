/* 全网公交线网共线/重复度/走廊分析 + 分站规范化字典导出
   口径与网站 app.js 完全一致：分站合并为站（含数字分站、BRT平台、方向后缀、括号变体）。 */
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

// 站名修正 / 通用站名 / 线路别名（与 app.js 一致）
const STOP_NAME_FIXES = {
  '广州火车': '广州火车站',
  '从化客运': '从化客运站',
  '天河客运': '天河客运站',
  '顺德一中实验学校': '广东顺德文德学校', // 学校更名，同一站点
  '番禺宝墨园': '宝墨园总站', // 同一总站的不同写法
  '宝墨园': '宝墨园总站'
};
function fixedName(n) { return STOP_NAME_FIXES[n] || String(n || ''); }
function isGenericStop(name) { return /^临时站|^招呼站/.test(name); }
const ROUTE_ALIASES = {
  '从13路': '从化13路',
  '佛里07路': '里07路'
};

const BUS_STOPS = load('BUS_STOPS', 'bus_stops.js');
const BUS_ROUTE_STOPS = load('BUS_ROUTE_STOPS', 'bus_route_stops.js');
const busStopById = {};
BUS_STOPS.features.forEach(function (f) {
  busStopById[f.properties.stop_id] = f;
});

// ---------- 线路身份（同号不同线：佛山655 与 广州655，按起讫坐标聚类） ----------
function terminiParts(cn) {
  // 取最后一个 '--' 所在的括号块（站名本身可含括号，如 金沙洲(涛乐街)总站）
  const s = String(cn || '').trim();
  const lastSep = s.lastIndexOf('--');
  if (lastSep < 0 || !/[）)]$/.test(s)) { return null; }
  const stack = [];
  const blocks = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '（') { stack.push(i); }
    else if (ch === ')' || ch === '）') {
      if (stack.length) { blocks.push([stack.pop(), i]); }
    }
  }
  let best = null;
  blocks.forEach(function (b) {
    if (b[0] < lastSep && lastSep < b[1]) {
      if (!best || b[0] < best[0]) { best = b; }
    }
  });
  if (!best) { return null; }
  const parts = s.slice(best[0] + 1, best[1]).split('--');
  if (parts.length !== 2) { return null; }
  return [parts[0].trim(), parts[1].trim()];
}
const terminusCoords = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
    if (!terminusCoords[st[1]] && busStopById[st[2]]) {
      terminusCoords[st[1]] = busStopById[st[2]].geometry.coordinates;
    }
  });
});
const routeKeyCache = {};
(function () {
  const byNum = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    const num = routeNumOf(k);
    (byNum[num] = byNum[num] || []).push(k);
  });
  Object.keys(byNum).forEach(function (num) {
    num = ROUTE_ALIASES[num] || num;
    const cns = byNum[num];
    const n = cns.length;
    const parent = [];
    for (let i = 0; i < n; i++) { parent.push(i); }
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const ta = terminiParts(cns[a]);
        const tb = terminiParts(cns[b]);
        if (!ta || !tb) { parent[find(a)] = find(b); continue; }
        let link = false;
        for (let ia = 0; ia < 2 && !link; ia++) {
          for (let ib = 0; ib < 2; ib++) {
            const ca = terminusCoords[ta[ia]];
            const cb = terminusCoords[tb[ib]];
            if (ca && cb && segLenM(ca, cb) <= 300) { link = true; break; }
          }
        }
        if (link) {
          const ra = find(a), rb = find(b);
          if (ra !== rb) { parent[ra] = rb; }
        }
      }
    }
    const comps = {};
    for (let k2 = 0; k2 < n; k2++) {
      const root = find(k2);
      (comps[root] = comps[root] || []).push(cns[k2]);
    }
    const compList = Object.keys(comps).sort(function (x, y) {
      return comps[x][0] < comps[y][0] ? -1 : (comps[x][0] > comps[y][0] ? 1 : 0);
    });
    compList.forEach(function (root, idx) {
      comps[root].forEach(function (cn) { routeKeyCache[cn] = num + '#' + idx; });
    });
  });
})();
function routeKeyOf(cn) {
  return routeKeyCache[cn] || ((ROUTE_ALIASES[routeNumOf(cn)] || routeNumOf(cn)) + '#0');
}
function keyNumOf(key) { const i = key.indexOf('#'); return i > 0 ? key.slice(0, i) : key; }
const busKeyToCns = {};
const busNumToKeys = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (cn) {
  const key = routeKeyOf(cn);
  (busKeyToCns[key] = busKeyToCns[key] || []).push(cn);
  const num = keyNumOf(key);
  if (busNumToKeys[num] === undefined) { busNumToKeys[num] = []; }
  if (busNumToKeys[num].indexOf(key) < 0) { busNumToKeys[num].push(key); }
});
function keyLabel(key) {
  const num = keyNumOf(key);
  const cns = busKeyToCns[key] || [];
  if (!cns.length || (busNumToKeys[num] || []).length <= 1) { return num; }
  const t = terminiParts(cns[0]) || [];
  return num + '（' + (t[0] || '') + ' ⇄ ' + (t[1] || '') + '）';
}

// ---------- 站名规范化（与 app.js 同步） ----------
const rawStopNameSet = {};
Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
  (BUS_ROUTE_STOPS[k] || []).forEach(function (st) { rawStopNameSet[st[1]] = true; });
});

function segLenM(a, b) {
  const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

const stationAlias = {};
function resolveName(n) { return stationAlias[n] || n; }
function buildStationAlias() {
  const nameCoords = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
      if (!nameCoords[st[1]] && busStopById[st[2]]) {
        nameCoords[st[1]] = busStopById[st[2]].geometry.coordinates;
      }
    });
  });
  BUS_STOPS.features.forEach(function (f) {
    if (!nameCoords[f.properties.name_cn]) { nameCoords[f.properties.name_cn] = f.geometry.coordinates; }
  });
  const groups = {};
  Object.keys(nameCoords).forEach(function (n) {
    if (isGenericStop(n)) { return; }
    // 先去掉数字后缀、括号块、末尾"站"字，再分组（东风东路站 与 东风东路(广东工大) 应同组）
    const pb = n.replace(/\d+$/, '').replace(/[（(][^（）()]*[）)]$/, '').replace(/站$/, '');
    if (!pb) { return; }
    (groups[pb] = groups[pb] || []).push(n);
  });
  Object.keys(groups).forEach(function (pb) {
    const members = groups[pb];
    if (members.length < 2) { return; }
    const isDir = function (n) { return /[（(](停?[东南西北]行|上行|下行)[）)]\d*$/.test(n); };
    const plain = members.filter(function (n) { return !/[（(]/.test(n) && !/\d$/.test(n); });
    const bracketed = members.filter(function (n) { return /[（(]/.test(n) && !isDir(n); });
    if (!plain.length || !bracketed.length) { return; }
    const alias = {};
    bracketed.forEach(function (b) {
      const bc = nameCoords[b];
      if (!bc) { return; }
      plain.forEach(function (p) {
        const pc = nameCoords[p];
        if (!pc) { return; }
        const d = segLenM(pc, bc);
        if (d <= 300 && (!alias[p] || alias[p].d > d)) { alias[p] = { b: b, d: d }; }
      });
    });
    Object.keys(alias).forEach(function (p) { stationAlias[p] = alias[p].b; });
  });
}
buildStationAlias();

function stripSubMarkers(s) {
  s = s.replace(/^公共汽车BRT/, '').replace(/^公共汽车/, ''); // 站牌前缀（公共汽车BRT中山大道东圃站 → 中山大道东圃站）
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
  const noZhan = base.replace(/站$/, '');
  const cands = [base, noZhan, base + '站'];
  for (let i = 0; i < cands.length; i++) {
    if (rawStopNameSet[cands[i]]) { return cands[i]; }
  }
  return base;
}
function normStopName(name) {
  // 先去数字分站、再套括号别名，让数字分站继承纯名的站归属（中山纪念堂4 → 中山纪念堂(市总工会)）
  let s = stripSubMarkers(fixedName(name));
  let db = digitBaseName(s);
  if (db) { s = db; }
  s = resolveName(s);
  s = stripSubMarkers(s);
  const db2 = digitBaseName(s);
  if (db2) { s = db2; }
  s = s.replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, '');
  s = s.replace(/(?<![A-Za-z])[A-Za-z]站$/, ''); // 分站字母（雅居乐花园A站→雅居乐花园；中国软件CBD站不拆）
  return s.replace(/站$/, '').trim();
}
function displayStopName(name) {
  let s = stripSubMarkers(resolveName(fixedName(name)));
  const db = digitBaseName(s);
  if (db) { s = db; }
  const m2 = s.match(/^(.*)站$/);
  if (m2 && m2[1] && rawStopNameSet[m2[1]]) { s = m2[1]; }
  return s;
}

// ---------- 距离感知的同名站聚类（与 app.js 口径一致：基名 + ≤1000m） ----------
const CLUSTER_DIST = 1000;
const stopClusterId = {};
const clusterKeyToIds = {};
const baseClusters = {};
(function buildStopClusters() {
  const groups = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
      if (isGenericStop(st[1])) { return; }
      const f = busStopById[st[2]];
      if (!f) { return; }
      const n = normStopName(st[1]);
      (groups[n] = groups[n] || {})[st[2]] = f.geometry.coordinates;
    });
  });
  Object.keys(groups).forEach(function (base) {
    const ids = Object.keys(groups[base]);
    const coords = ids.map(function (id) { return groups[base][id]; });
    if (ids.length === 1) {
      clusterKeyToIds[base] = ids;
      (baseClusters[base] = baseClusters[base] || []).push(base);
      stopClusterId[ids[0]] = base;
      return;
    }
    const parent = ids.map(function (_, i) { return i; });
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) { parent[rb] = ra; } }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (segLenM(coords[i], coords[j]) <= CLUSTER_DIST) { union(i, j); }
      }
    }
    const comp = {};
    ids.forEach(function (id, i) { const r = find(i); (comp[r] = comp[r] || []).push(id); });
    const comps = Object.keys(comp).map(function (r) { return comp[r]; });
    comps.forEach(function (memberIds, ci) {
      const key = comps.length === 1 ? base : base + '#' + (ci + 1);
      clusterKeyToIds[key] = memberIds;
      (baseClusters[base] = baseClusters[base] || []).push(key);
      memberIds.forEach(function (id) { stopClusterId[id] = key; });
    });
  });
})();

// ---------- 站点/平台基础数据 ----------
const stationMeta = new Map(); // key -> {name, coords, routes:Set}
const stationPlatforms = new Map(); // key -> [{name,id,lng,lat}]
const routeStations = new Map(); // num -> Set(key)
const routeSeqByDir = []; // {num, cn, seq:[keys]}

function stKey(st) {
  return isGenericStop(st[1]) ? ('G:' + st[2]) : (stopClusterId[st[2]] || normStopName(st[1]));
}
function ensureStation(key, st) {
  let m = stationMeta.get(key);
  if (!m) {
    // 站点级规范名不带方向后缀（广医二院(停东行) → 广医二院）；方向后缀仅用于线路停靠列表展示
    m = { name: displayStopName(st[1]).replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, ''), coords: null, routes: new Set() };
    stationMeta.set(key, m);
  }
  const f = busStopById[st[2]];
  if (f && !m.coords) { m.coords = f.geometry.coordinates; }
  return m;
}

Object.keys(BUS_ROUTE_STOPS).forEach(function (cn) {
  const rkey = routeKeyOf(cn);
  const seq = [];
  (BUS_ROUTE_STOPS[cn] || []).forEach(function (st) {
    const skey = stKey(st);
    const m = ensureStation(skey, st);
    m.routes.add(rkey);
    let rs = routeStations.get(rkey);
    if (!rs) { rs = new Set(); routeStations.set(rkey, rs); }
    rs.add(skey);
    if (seq[seq.length - 1] !== skey) { seq.push(skey); }
    // 平台字典
    const f = busStopById[st[2]];
    if (f) {
      let pl = stationPlatforms.get(skey);
      if (!pl) { pl = []; stationPlatforms.set(skey, pl); }
      if (!pl.some(function (p) { return p.id === st[2]; })) {
        pl.push({ name: st[1], id: st[2], lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
      }
    }
  });
  routeSeqByDir.push({ key: rkey, cn: cn, seq: seq });
});

// ---------- 站点密度 ----------
const stationDensity = [];
stationMeta.forEach(function (m, key) {
  stationDensity.push({ key: key, name: m.name, routes: m.routes.size });
});
stationDensity.sort(function (a, b) { return b.routes - a.routes || (a.name < b.name ? -1 : 1); });

// ---------- 线路两两共线 ----------
const pairCount = new Map();
stationMeta.forEach(function (m) {
  const arr = Array.from(m.routes).sort();
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const key = arr[i] + '|' + arr[j];
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  }
});
const pairList = Array.from(pairCount.entries()).map(function (e) {
  const [a, b] = e[0].split('|');
  return { a: a, b: b, overlap: e[1] };
}).sort(function (x, y) { return y.overlap - x.overlap || (x.a < y.a ? -1 : 1); });

// ---------- 线路重复度指标 ----------
const routeMetrics = [];
routeStations.forEach(function (stations, key) {
  const total = stations.size;
  let shared = 0;
  const comp = new Map();
  stations.forEach(function (sk) {
    const m = stationMeta.get(sk);
    m.routes.forEach(function (other) {
      if (other !== key) { comp.set(other, (comp.get(other) || 0) + 1); }
    });
  });
  // shared = 与至少一条其他线路共站的站数
  stations.forEach(function (sk) {
    const m = stationMeta.get(sk);
    if (m.routes.size > 1) { shared++; }
  });
  const top = Array.from(comp.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
  routeMetrics.push({
    num: keyLabel(key),
    total: total,
    shared: shared,
    ratio: total ? Math.round(shared / total * 1000) / 10 : 0,
    maxOverlap: top.length ? top[0][1] : 0,
    top: top
  });
});
routeMetrics.sort(function (a, b) { return b.ratio - a.ratio || b.maxOverlap - a.maxOverlap; });

// ---------- 高重复走廊（连续站段，每站线路数 >= T） ----------
const CORRIDOR_T = 10;
const corridors = new Map(); // sorted-key -> {keys, names, densities, len, max, min}
routeSeqByDir.forEach(function (r) {
  const seq = r.seq;
  let run = [];
  function flush() {
    if (run.length < 3) { run = []; return; }
    const keys = run.slice();
    const sortKey = keys.slice().sort().join('|');
    const dens = keys.map(function (k) { return stationMeta.get(k).routes.size; });
    const names = keys.map(function (k) { return stationMeta.get(k).name; });
    const len = keys.length;
    const max = Math.max.apply(null, dens);
    const min = Math.min.apply(null, dens);
    const prev = corridors.get(sortKey);
    if (!prev || prev.len < len || (prev.len === len && prev.max < max)) {
      corridors.set(sortKey, { keys: keys, names: names, dens: dens, len: len, max: max, min: min });
    }
    run = [];
  }
  seq.forEach(function (key) {
    if (stationMeta.get(key).routes.size >= CORRIDOR_T) { run.push(key); }
    else { flush(); }
  });
  flush();
});
const corridorList = Array.from(corridors.values()).sort(function (a, b) { return b.max - a.max || b.len - a.len; });

// ---------- 写 CSV（UTF-8 BOM，Excel 友好） ----------
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')].concat(rows.map(function (r) {
    return r.map(function (v) {
      const s = String(v == null ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }));
  fs.writeFileSync(path.join(outDir, file), '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

writeCsv('线路重复度指标.csv',
  ['线路号', '总站数', '与其他线路共线站数', '共线占比(%)', '最大单线重叠站数', '共线对手Top10(线路号:重叠站数)'],
  routeMetrics.map(function (m) {
    return [m.num, m.total, m.shared, m.ratio, m.maxOverlap,
      m.top.map(function (t) { return keyLabel(t[0]) + ':' + t[1]; }).join('; ')];
  }));

const pairOut = pairList.filter(function (p) { return p.overlap >= 5; });
writeCsv('共线线路对.csv',
  ['线路A', '线路B', '重叠站数'],
  pairOut.map(function (p) { return [keyLabel(p.a), keyLabel(p.b), p.overlap]; }));

writeCsv('高密度站点.csv',
  ['站点名', '经停线路数'],
  stationDensity.map(function (d) { return [d.name, d.routes]; }));

writeCsv('高重复走廊.csv',
  ['走廊站数', '最高经停线路数', '最低经停线路数', '走廊站点(按序, 括号内为该站经停线路数)'],
  corridorList.map(function (c) {
    return [c.len, c.max, c.min,
      c.names.map(function (n, i) { return n + '(' + c.dens[i] + ')'; }).join(' → ')];
  }));

writeCsv('分站规范化字典.csv',
  ['合并站名', '站组ID', '原始分站名', '站点ID', '经度', '纬度'],
  (function () {
    const rows = [];
    stationPlatforms.forEach(function (pl, key) {
      const name = stationMeta.get(key).name;
      pl.forEach(function (p) {
        rows.push([name, key, p.name, p.id, p.lng, p.lat]);
      });
    });
    rows.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0); });
    return rows;
  })());

// ---------- summary JSON（供报告使用） ----------
const summary = {
  counts: {
    routes: routeStations.size,
    dirs: routeSeqByDir.length,
    stations: stationMeta.size,
    rawStops: BUS_STOPS.features.length,
    pairs: pairOut.length
  },
  topPairs: pairList.slice(0, 50).map(function (p) {
    return { a: keyLabel(p.a), b: keyLabel(p.b), overlap: p.overlap };
  }),
  topStations: stationDensity.slice(0, 50).map(function (d) { return { name: d.name, routes: d.routes }; }),
  topCorridors: corridorList.slice(0, 30).map(function (c) {
    return { len: c.len, max: c.max, min: c.min, names: c.names };
  }),
  redundancy: {
    avgRatio: routeMetrics.length ? Math.round(routeMetrics.reduce(function (s, m) { return s + m.ratio; }, 0) / routeMetrics.length * 10) / 10 : 0,
    maxRatio: routeMetrics.length ? routeMetrics[0].ratio : 0,
    minRatio: routeMetrics.length ? routeMetrics[routeMetrics.length - 1].ratio : 0,
    sharedAll: routeMetrics.filter(function (m) { return m.ratio >= 100; }).length,
    noneShared: routeMetrics.filter(function (m) { return m.ratio === 0; }).length,
    avgOverlapTop: routeMetrics.length ? Math.round(routeMetrics.reduce(function (s, m) { return s + m.maxOverlap; }, 0) / routeMetrics.length * 10) / 10 : 0
  }
};
fs.writeFileSync(path.join(outDir, 'analysis_summary.json'), JSON.stringify(summary, null, 2), 'utf-8');

console.log('线路数:', routeStations.size,
  '| 方向记录:', routeSeqByDir.length,
  '| 合并站数:', stationMeta.size,
  '| 共线对(>=5站):', pairOut.length,
  '| 走廊(>=10线/站):', corridorList.length,
  '| 输出目录:', outDir);
