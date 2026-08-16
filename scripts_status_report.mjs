// 线路状态核对报告：本地线路 vs 车来了
// 产物：output/network/线路状态核对_车来了.csv、_疑似调整.csv
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
const BUS_ROUTES = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');
const LIB = JSON.parse(fs.readFileSync(`${OUT_DIR}/chelaile_direction_stops.json`, 'utf-8'));

const routeMeta = {};
for (const f of BUS_ROUTES.features) {
  routeMeta[f.properties.route_cn] = f.properties;
}

const rawByBase = new Map();
for (const f of fs.readdirSync(RAW_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const r = JSON.parse(fs.readFileSync(`${RAW_DIR}/${f}`, 'utf-8'));
    rawByBase.set(r.base, r);
  } catch { /* skip */ }
}

const byBase = new Map();
for (const cn of Object.keys(BUS_ROUTE_STOPS)) {
  const base = cn.split('(')[0];
  const list = byBase.get(base) || [];
  list.push(cn);
  byBase.set(base, list);
}

function parseTermini(cn) {
  const open = cn.indexOf('(');
  const close = cn.lastIndexOf(')');
  if (open < 0 || close < open) return ['', ''];
  const inner = cn.slice(open + 1, close);
  const i = inner.indexOf('--');
  if (i < 0) return [inner, ''];
  return [inner.slice(0, i), inner.slice(i + 2)];
}

const rows = [];
const adjusted = [];
for (const [base, cns] of byBase) {
  const raw = rawByBase.get(base);
  const localTermini = cns.map(parseTermini);
  const meta = routeMeta[cns[0]];
  const firstTime = meta?.start_time ? `${meta.start_time.slice(0, 2)}:${meta.start_time.slice(2)}` : '';
  const lastTime = meta?.end_time ? `${meta.end_time.slice(0, 2)}:${meta.end_time.slice(2)}` : '';
  const baseInfo = {
    线路: base,
    方向记录数: cns.length,
    本地起讫: [...new Set(localTermini.map((t) => t[0] && t[1] ? `${t[0]} ⇄ ${t[1]}` : t[0] || t[1] || ''))].join(' / '),
    首班: firstTime,
    末班: lastTime,
    运营公司: meta?.company_cn || '',
  };
  if (!raw || raw.status !== 'found' || !raw.foundLines?.length) {
    rows.push({ ...baseInfo, 状态分类: '车来了未收录（可能停运/改名/未收录）', 车来了起讫: '' });
    continue;
  }
  const chTermini = [...new Set(raw.foundLines.map((l) => `${l.startSn} ⇄ ${l.endSn}`))].join(' / ');
  const matchedDirs = cns.filter((cn) => LIB[cn] && LIB[cn].stops.some((s) => s[3] != null));
  if (matchedDirs.length === 0) {
    rows.push({ ...baseInfo, 状态分类: '同名但站点差异大（疑似线路调整）', 车来了起讫: chTermini });
    adjusted.push({ ...baseInfo, 状态分类: '疑似线路调整', 车来了起讫: chTermini });
    continue;
  }
  rows.push({ ...baseInfo, 状态分类: '可核对（方向记录已匹配）', 车来了起讫: chTermini });
}

function csvVal(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, header, data) {
  fs.writeFileSync(file, '\uFEFF' + [header.join(','), ...data.map((r) => header.map((h) => csvVal(r[h])).join(','))].join('\r\n') + '\r\n', 'utf-8');
}

const header = ['线路', '方向记录数', '本地起讫', '首班', '末班', '运营公司', '状态分类', '车来了起讫'];
const order = { '可核对（方向记录已匹配）': 0, '同名但站点差异大（疑似线路调整）': 1, '车来了未收录（可能停运/改名/未收录）': 2 };
rows.sort((a, b) => (order[a.状态分类] - order[b.状态分类]) || a.线路.localeCompare(b.线路, 'zh-CN'));
writeCsv(`${OUT_DIR}/线路状态核对_车来了.csv`, header, rows);
writeCsv(`${OUT_DIR}/线路状态核对_疑似调整.csv`, header, adjusted);

const count = rows.reduce((o, r) => { o[r.状态分类] = (o[r.状态分类] || 0) + 1; return o; }, {});
console.log(JSON.stringify(count, null, 2));
console.log('疑似调整线路:');
adjusted.slice(0, 30).forEach((r) => console.log('  -', r.线路, '|', r.车来了起讫));
