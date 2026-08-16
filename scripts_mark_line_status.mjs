// 给问题线路打状态标记 + 生成汇总表
// 未收录（316）→ 疑似停运（待核对）；同名站点差异大（12）→ 疑似调整（待核对）
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
const BUS_ROUTES = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');

// 读取状态核对
const rows = fs.readFileSync(`${OUT_DIR}/线路状态核对_车来了.csv`, 'utf-8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)
  .map((l) => {
    const c = [];
    let s = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { s += '"'; i++; } else q = !q; }
      else if (ch === ',' && !q) { c.push(s); s = ''; }
      else s += ch;
    }
    c.push(s);
    return c;
  });

const missing = new Set();   // 未收录
const adjusted = new Set();  // 疑似调整
for (const r of rows) {
  if (r[0] && r[6] === '车来了未收录（可能停运/改名/未收录）') missing.add(r[0]);
  if (r[0] && r[6] === '同名但站点差异大（疑似线路调整）') adjusted.add(r[0]);
}

// 应用标记
const routesNew = JSON.parse(JSON.stringify(BUS_ROUTES));
let marked = 0;
for (const f of routesNew.features) {
  const p = f.properties;
  const base = String(p.route_cn).split('(')[0];
  let note = null, label = null;
  if (missing.has(base)) {
    note = '车来了未收录（可能停运/改名）';
    label = '疑似停运（待核对）';
  } else if (adjusted.has(base)) {
    note = '与车来了站点差异大（同名不同走向）';
    label = '疑似调整（待核对）';
  }
  if (note) {
    // 已停运的保留原状态，仅加说明；运营中的改为疑似标记
    if (!/停运|停用/.test(p.status_label || '')) {
      p.status_label = label;
    }
    p.status_note = note;
    marked++;
  }
}

function writeJs(file, obj) {
  fs.writeFileSync(file, 'window.BUS_ROUTES = ' + JSON.stringify(obj) + ';\n', 'utf-8');
}
writeJs(`${ROOT}/data/bus_routes.js`, routesNew);
writeJs(`${ROOT}/transit_site/data/bus_routes.js`, routesNew);

// 汇总表
const csv = [
  ['线路', '方向记录数', '本地起讫', '首班', '末班', '运营公司', '状态分类', '车来了起讫', '备注'].join(','),
  ...rows.filter((r) => r[0] && (missing.has(r[0]) || adjusted.has(r[0])))
    .map((r) => {
      const note = missing.has(r[0])
        ? '车来了未收录（可能停运/改名，待人工核对）'
        : '同名但站点差异大，疑似改线（待人工核对）';
      return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], note].map((v) => (/,/.test(String(v)) ? `"${v}"` : v)).join(',');
    }),
].join('\r\n');
fs.writeFileSync(`${OUT_DIR}/线路问题汇总_待核对.csv`, '\uFEFF' + csv + '\r\n', 'utf-8');

console.log(`已标记 ${marked} 条方向记录；未收录 ${missing.size} 条线路，疑似调整 ${adjusted.size} 条线路`);
console.log('汇总表已生成：output/network/线路问题汇总_待核对.csv');
