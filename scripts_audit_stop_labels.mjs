// 全网排查：站名标签选择逻辑（按方向标签）是否会产生丢失/无几何/空位置
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function makeEl(id) {
  const handlers = {}; const classes = new Set();
  return { id: id || '', _innerHTML: '', _text: '', value: '', checked: false, handlers,
    classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); }, toggle(c, f) { if (f === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (f) { classes.add(c); } else { classes.delete(c); } return classes.has(c); } },
    addEventListener(t, fn) { handlers[t] = fn; }, appendChild() {}, contains() { return false; },
    getAttribute(n) { return this['_attr_' + n] || ''; }, setAttribute(n, v) { this['_attr_' + n] = v; },
    set innerHTML(v) { this._innerHTML = v; }, get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; } };
}
const els = {}; const createdEls = []; const tabEls = []; const bodyEls = []; const radioEls = [];
['search', 'layers', 'about'].forEach(function (name) { const tb = makeEl('tab-' + name); tb.setAttribute('data-tab', name); tabEls.push(tb); const bd = makeEl('body-' + name); bd.id = 'tab-' + name; bodyEls.push(bd); });
['gaode', 'gaode_img', 'carto', 'osm'].forEach(function (v, i) { const r = makeEl('radio-' + v); r.value = v; r.checked = i === 0; r.setAttribute('name', 'basemap'); radioEls.push(r); });
const document = { querySelector(sel) { if (!els[sel]) { els[sel] = makeEl(sel); } return els[sel]; }, querySelectorAll(sel) { if (sel === '.tab') return tabEls; if (sel === '.tab-body') return bodyEls; if (sel === 'input[name="basemap"]') return radioEls; return []; }, createElement() { const el = makeEl('li'); createdEls.push(el); return el; }, addEventListener() {} };
const geoJSONLayers = []; let clusterMarkerCount = 0;
function makeLayer() { return { _adds: [], addTo() { return this; }, addData(d) { this._adds.push(d); return this; }, clearLayers() { this._adds = []; return this; }, getBounds() { return { isValid() { return true; } }; }, setStyle() { return this; }, on() { return this; } }; }
const L = { map() { return { setView() { return this; }, addLayer() { return this; }, removeLayer() { return this; }, fitBounds() { return this; }, getZoom() { return 13; }, on() { return this; } }; }, tileLayer() { return { addTo() { return this; } }; }, geoJSON(d) { const l = makeLayer(); l._initial = d || null; geoJSONLayers.push(l); return l; }, markerClusterGroup() { return { addLayer() { clusterMarkerCount += 1; return this; }, addTo() { return this; } }; }, circleMarker() { return { bindTooltip() { return this; }, on() { return this; }, addTo() { return this; } }; }, layerGroup() { return { _adds: [], addLayer(l) { this._adds.push(l); return this; }, clearLayers() { this._adds = []; return this; }, addTo() { return this; } }; }, latLngBounds() { return { extend() {}, isValid() { return true; } }; } };
const sandbox = { window: {}, document, L, console }; sandbox.window = sandbox; sandbox.__APP_DEBUG__ = true; vm.createContext(sandbox);
const dataDir = path.join(__dirname, 'transit_site', 'data');
fs.readdirSync(dataDir).filter(f => f.endsWith('.js')).forEach(f => vm.runInContext(fs.readFileSync(path.join(dataDir, f), 'utf-8'), sandbox, { filename: f }));
vm.runInContext(fs.readFileSync(path.join(__dirname, 'transit_site', 'app.js'), 'utf-8'), sandbox, { filename: 'app.js' });

const STOPS = sandbox.BUS_ROUTE_STOPS;
const ROUTES = sandbox.BUS_ROUTES.features;
const geomOf = {};
ROUTES.forEach(f => { if (f.geometry.type === 'LineString') geomOf[f.properties.route_cn] = f.geometry.coordinates; });

// dir 标签：与 app.dirOf 一致（按名称排序，索引 0→A,1→B）
function dirsOf(base) {
  const cns = Object.keys(STOPS).filter(k => k.split('(')[0] === base).sort();
  return cns.map((cn, i) => ({ dir: i % 2 ? 'B' : 'A', cn, stops: STOPS[cn] }));
}

const issues = [];
let totalLabels = 0, totalLines = 0, lineWithIssue = 0;
const bases = [...new Set(Object.keys(STOPS).map(k => k.split('(')[0]))];
for (const base of bases) {
  const dirs = dirsOf(base);
  const stopDirs = {};
  dirs.forEach(d => d.stops.forEach(st => {
    const dn = sandbox.__APP_DEBUG__.normDisplay(st[1]);
    const rec = stopDirs[dn] || (stopDirs[dn] = { name: dn, stopId: st[2], dirs: [] });
    if (rec.dirs.indexOf(d.dir) < 0) { rec.dirs.push(d.dir); }
    rec.stops = rec.stops || {};
    rec.stops[d.dir] = st;
  }));
  let lineIssue = false;
  for (const dn of Object.keys(stopDirs)) {
    const info = stopDirs[dn];
    totalLabels++;
    const want = info.dirs.indexOf('A') >= 0 ? 'A' : (info.dirs.indexOf('B') >= 0 ? 'B' : dirs[0].dir);
    let d = null;
    for (let di = 0; di < dirs.length; di++) { if (dirs[di].dir === want) { d = dirs[di]; break; } }
    if (!d) { issues.push([base, dn, '无方向记录']); lineIssue = true; continue; }
    let st = (info.stops && info.stops[d.dir]) || null;
    if (!st) { st = (info.stops && info.stops[dirs[0].dir]) || null; }
    if (!st) { issues.push([base, dn, '无停靠记录']); lineIssue = true; continue; }
    const g = geomOf[d.cn];
    if (!g) { issues.push([base, dn, '无几何']); lineIssue = true; continue; }
    const pos = sandbox.__APP_DEBUG__.bestPos(g, st[1], st[2], d.cn);
    if (!pos) { issues.push([base, dn, '位置为空']); lineIssue = true; continue; }
  }
  totalLines++;
  if (lineIssue) lineWithIssue++;
}

fs.writeFileSync(`${__dirname}/output/network/站名标签排查.csv`, '\uFEFF' + ['线路', '站名', '问题'].join(',') + '\r\n' + issues.map(r => r.join(',')).join('\r\n') + '\r\n', 'utf-8');
console.log(`线路数 ${totalLines}，标签数 ${totalLabels}，有问题的线路 ${lineWithIssue}，问题标签 ${issues.length}`);
issues.slice(0, 30).forEach(i => console.log('  ' + i.join(' | ')));
