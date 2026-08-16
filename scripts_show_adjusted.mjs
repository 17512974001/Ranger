// 输出疑似调整线路的详细对比（临时查看用）
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;

function loadJsGlobal(file, globalName) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), s, { filename: file });
  return s.window[globalName];
}

const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const rawByBase = new Map();
for (const f of fs.readdirSync(RAW_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const r = JSON.parse(fs.readFileSync(`${RAW_DIR}/${f}`, 'utf-8'));
    rawByBase.set(r.base, r);
  } catch { /* skip */ }
}

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
function parseTermini(cn) {
  const open = cn.indexOf('(');
  const close = cn.lastIndexOf(')');
  if (open < 0 || close < open) return ['', ''];
  const inner = cn.slice(open + 1, close);
  const i = inner.indexOf('--');
  if (i < 0) return [inner, ''];
  return [inner.slice(0, i), inner.slice(i + 2)];
}

const rows = fs.readFileSync(`${ROOT}/output/network/线路状态核对_疑似调整.csv`, 'utf-8')
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

const out = [];
for (const r of rows) {
  const [line, dirCount, localTermini, firstTime, lastTime, company, status, chTermini] = r;
  const cns = Object.keys(BUS_ROUTE_STOPS).filter((k) => k.split('(')[0] === line);
  const localCounts = cns.map((k) => BUS_ROUTE_STOPS[k].length);
  const raw = rawByBase.get(line);
  const chDirs = raw?.details ? Object.values(raw.details).filter((d) => d?.stations?.length) : [];
  const chCounts = chDirs.map((d) => d.stations.length);
  let bestOverlap = 0;
  for (const cn of cns) {
    const a = BUS_ROUTE_STOPS[cn].map((st) => st[1]);
    for (const d of chDirs) {
      const o = seqOverlap(a, d.stations.map((st) => st.sn));
      if (o > bestOverlap) bestOverlap = o;
    }
  }
  const localTerm = localTermini.split(' / ')[0];
  const chTerm = chTermini.split(' / ')[0];
  const localEnds = localTerm.split(' ⇄ ').map((s) => normName(s)).filter(Boolean);
  const chEnds = chTerm.split(' ⇄ ').map((s) => normName(s)).filter(Boolean);
  const sameEnds = localEnds.length && chEnds.length && localEnds.join() === chEnds.join();
  const oneEndSame = localEnds.some((e) => chEnds.includes(e));
  let kind = '起讫全变';
  if (sameEnds) kind = '起讫相同';
  else if (oneEndSame) kind = '一端相同';
  out.push({
    line,
    kind,
    overlapPct: Math.round(bestOverlap * 100),
    localCounts: `${Math.min(...localCounts)}-${Math.max(...localCounts)}`,
    chCounts: chCounts.length ? `${Math.min(...chCounts)}-${Math.max(...chCounts)}` : '无',
    localTerm,
    chTerm,
  });
}

const order = { '起讫全变': 0, '一端相同': 1, '起讫相同': 2 };
out.sort((a, b) => (order[a.kind] - order[b.kind]) || a.overlapPct - b.overlapPct);

// 同时写一份对比 CSV 供查阅
function csvVal(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const header = ['线路', '类型', '站点重叠', '本地站数', '车来了站数', '本地起讫', '车来了起讫'];
const keys = ['line', 'kind', 'overlapPct', 'localCounts', 'chCounts', 'localTerm', 'chTerm'];
const lines = [header.join(','), ...out.map((o) => keys.map((k) => csvVal(o[k])).join(','))];
fs.writeFileSync(`${ROOT}/output/network/线路调整对比_车来了.csv`, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');

console.log(['线路', '类型', '站点重叠', '本地站数', '车来了站数', '本地起讫', '车来了起讫'].join('\t'));
for (const o of out) {
  console.log([o.line, o.kind, `${o.overlapPct}%`, o.localCounts, o.chCounts, o.localTerm, o.chTerm].join('\t'));
}
