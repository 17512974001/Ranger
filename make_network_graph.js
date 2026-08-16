/* 由原始分站数据生成整张公交线网图（data/network_graph.js）
   节点 = 分站（站点ID），边 = 每条方向记录中相邻两站的乘车连接。
   未来如需做分站级分析/显示，可直接加载 window.NETWORK 使用。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dataDir = path.join(__dirname, 'data');

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

const stops = load('BUS_STOPS', 'bus_stops.js');
const coordById = {};
stops.features.forEach(function (f) {
  coordById[f.properties.stop_id] = f.geometry.coordinates;
});
const routeStops = load('BUS_ROUTE_STOPS', 'bus_route_stops.js');

// 线路别名（改名/重复录入的同一线路）
const ROUTE_ALIASES = {
  '从13路': '从化13路',
  '佛里07路': '里07路'
};

// 站名修正（截断/更名），作用于站点合并与线网图（与 app.js 一致）
const STOP_NAME_FIXES = {
  '广州火车': '广州火车站',
  '从化客运': '从化客运站',
  '天河客运': '天河客运站',
  '顺德一中实验学校': '广东顺德文德学校', // 学校更名，同一站点
  '番禺宝墨园': '宝墨园总站', // 同一总站的不同写法
  '宝墨园': '宝墨园总站'
};
function fixedName(n) { return STOP_NAME_FIXES[n] || String(n || ''); }

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
Object.keys(routeStops).forEach(function (k) {
  (routeStops[k] || []).forEach(function (st) {
    if (!terminusCoords[st[1]] && coordById[st[2]]) {
      terminusCoords[st[1]] = coordById[st[2]];
    }
  });
});
const routeKeyCache = {};
(function () {
  const byNum = {};
  Object.keys(routeStops).forEach(function (k) {
    const num = ROUTE_ALIASES[routeNumOf(k)] || routeNumOf(k);
    (byNum[num] = byNum[num] || []).push(k);
  });
  Object.keys(byNum).forEach(function (num) {
    const cns = byNum[num];
    const n = cns.length;
    const parent = [];
    for (let i = 0; i < n; i++) { parent.push(i); }
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function distM(a, b) {
      const lat = (a[1] + b[1]) / 2 * Math.PI / 180;
      return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
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
            if (ca && cb && distM(ca, cb) <= 300) { link = true; break; }
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
const keysOrder = [];
const firstCns = {};
const keyIdx = {};
function keyIdxOf(cn) {
  const key = routeKeyOf(cn);
  if (keyIdx[key] === undefined) {
    keyIdx[key] = keysOrder.length;
    keysOrder.push(key);
    firstCns[key] = cn;
  }
  return keyIdx[key];
}

const nodeIndex = {};
const nodes = [];
const dirs = [];

function nodeIdx(id, name) {
  if (nodeIndex[id] !== undefined) { return nodeIndex[id]; }
  const c = coordById[id] || null;
  nodeIndex[id] = nodes.length;
  nodes.push([id, name, c ? c[0] : null, c ? c[1] : null]);
  return nodeIndex[id];
}

const routes = [];
const edges = [];
Object.keys(routeStops).forEach(function (cn) {
  const nIdx = keyIdxOf(cn);
  const dIdx = dirs.length;
  dirs.push(cn);
  const seq = routeStops[cn].map(function (st) { return nodeIdx(st[2], fixedName(st[1])); });
  routes.push([nIdx, dIdx, seq]);
  for (let i = 0; i < seq.length - 1; i++) {
    edges.push([seq[i], seq[i + 1], nIdx, dIdx]);
  }
});

const out = 'window.NETWORK = ' + JSON.stringify({
  nodes: nodes,
  nodeIndex: nodeIndex,
  keys: keysOrder,
  keyLabels: keysOrder.map(function (key) {
    const num = keyNumOf(key);
    const sameNum = keysOrder.filter(function (k) { return keyNumOf(k) === num; }).length;
    if (sameNum <= 1) { return num; }
    const t = terminiParts(firstCns[key]) || [];
    return num + '（' + (t[0] || '') + ' ⇄ ' + (t[1] || '') + '）';
  }),
  dirs: dirs,
  routes: routes,
  edges: edges
}) + ';\n';
fs.writeFileSync(path.join(dataDir, 'network_graph.js'), out, 'utf-8');
console.log('节点(分站):', nodes.length,
  '| 方向记录:', dirs.length,
  '| 方向序列:', routes.length,
  '| 乘车边:', edges.length,
  '| 线路身份:', keysOrder.length,
  '| 文件大小:', (out.length / 1024 / 1024).toFixed(2) + 'MB');
