// 全网同族站名排查：用「同方向共站 + 坐标距离 + 共线」判定应分开/应合并/待甄别
// 产物：output/network/同族站名排查报告.csv、_名字ID不一致.csv
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
const byId = new Map();
for (const f of BUS_STOPS.features) byId.set(f.properties.stop_id, f);

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
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}

// ---------- 1) 名字-ID 不一致检查 ----------
const namesOfId = {}; // id -> Set(names)
const dirStopIds = {}; // cn -> [stopIds]
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  dirStopIds[cn] = BUS_ROUTE_STOPS[cn].map((st) => st[2]);
  for (const st of BUS_ROUTE_STOPS[cn]) {
    (namesOfId[st[2]] = namesOfId[st[2]] || new Set()).add(st[1]);
  }
}
const mismatchRows = [];
for (const [id, names] of Object.entries(namesOfId)) {
  if (names.size >= 2) {
    mismatchRows.push([id, [...names].join(' / '), byId.get(id)?.properties.name_cn || '']);
  }
}
mismatchRows.sort((a, b) => b[1].length - a[1].length);
fs.writeFileSync(`${OUT_DIR}/同族站名排查_名字ID不一致.csv`, '\uFEFF' + ['站点ID', '记录中出现过的站名', 'bus_stops站名'].join(',') + '\r\n' + mismatchRows.map((r) => r.join(',')).join('\r\n') + '\r\n', 'utf-8');

// ---------- 2) 同族站名配对排查 ----------
// 家族: normKey -> [{id, name, coord, lines:Set}]
const families = {};
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const base = cn.split('(')[0];
  const stops = BUS_ROUTE_STOPS[cn];
  stops.forEach((st, i) => {
    if (/^临时站|^招呼站/.test(st[1])) return;
    const f = byId.get(st[2]);
    if (!f) return;
    const nk = normKey(st[1]);
    if (!nk) return;
    const fam = (families[nk] = families[nk] || new Map());
    let rec = fam.get(st[2]);
    if (!rec) {
      rec = { id: st[2], name: f.properties.name_cn, coord: f.geometry.coordinates, lines: new Set() };
      fam.set(st[2], rec);
    }
    rec.lines.add(base);
  });
}

// 同方向是否同时停靠两站
function sameDirectionPair(a, b) {
  for (const cn of Object.keys(dirStopIds)) {
    const arr = dirStopIds[cn];
    const ia = arr.indexOf(a), ib = arr.indexOf(b);
    if (ia >= 0 && ib >= 0 && ia !== ib) return true;
  }
  return false;
}

const report = [];
for (const [nk, fam] of Object.entries(families)) {
  const members = [...fam.values()];
  if (members.length < 2) continue;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      const d = Math.round(distM(a.coord, b.coord));
      if (d > 1200) continue; // 太远且无同方向共站的一律不同站，不进报告
      const shared = a.id === b.id ? a.lines : [...a.lines].filter((l) => b.lines.has(l)).length;
      const sharedDir = a.id === b.id ? false : sameDirectionPair(a.id, b.id);
      let verdict;
      if (a.id === b.id) continue; // 同一平台
      if (sharedDir) verdict = '应分开(同方向共站)';
      else if (d <= 300) verdict = '应合并(近距离)';
      else if (d > 1000) verdict = '应分开(远距离无共站)';
      else verdict = '待甄别';
      report.push({
        family: nk, nameA: a.name, nameB: b.name,
        dist: d, sharedDir: sharedDir ? '是' : '', sharedLines: shared,
        verdict,
        idA: a.id, idB: b.id,
      });
    }
  }
}
report.sort((a, b) => {
  const ord = { '应分开(同方向共站)': 0, '应分开(远距离无共站)': 1, '待甄别': 2, '应合并(近距离)': 3 };
  return (ord[a.verdict] - ord[b.verdict]) || b.dist - a.dist;
});
fs.writeFileSync(
  `${OUT_DIR}/同族站名排查报告.csv`,
  '\uFEFF' + ['家族', '站A', '站B', '距离m', '同方向共站', '共线数', '判定', 'ID-A', 'ID-B'].join(',') + '\r\n' +
  report.map((r) => [r.family, r.nameA, r.nameB, r.dist, r.sharedDir, r.sharedLines, r.verdict, r.idA, r.idB].join(',')).join('\r\n') + '\r\n',
  'utf-8',
);

const count = report.reduce((o, r) => { o[r.verdict] = (o[r.verdict] || 0) + 1; return o; }, {});
console.log('名字-ID 不一致站点数:', mismatchRows.length);
console.log(JSON.stringify(count, null, 2));
console.log('\n应分开(同方向共站) 前20：');
report.filter((r) => r.verdict === '应分开(同方向共站)').slice(0, 20).forEach((r) => {
  console.log(`  ${r.family} | ${r.nameA} ↔ ${r.nameB} | ${r.dist}m | 共线${r.sharedLines}`);
});
console.log('\n待甄别 前20：');
report.filter((r) => r.verdict === '待甄别').slice(0, 20).forEach((r) => {
  console.log(`  ${r.family} | ${r.nameA} ↔ ${r.nameB} | ${r.dist}m | 共线${r.sharedLines}`);
});
