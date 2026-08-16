/* Functional smoke test for app.js with mocked DOM + Leaflet (run with node). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  const handlers = {};
  const classes = new Set();
  return {
    id: id || '',
    _innerHTML: '',
    _text: '',
    value: '',
    checked: false,
    handlers,
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      contains(c) { return classes.has(c); },
      toggle(c, force) {
        if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); }
        else if (force) { classes.add(c); } else { classes.delete(c); }
        return classes.has(c);
      }
    },
    addEventListener(type, fn) { handlers[type] = fn; },
    appendChild() {},
    contains() { return false; },
    getAttribute(name) { return this['_attr_' + name] || ''; },
    setAttribute(name, v) { this['_attr_' + name] = v; },
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text; }
  };
}

const els = {};
const createdEls = [];
const tabEls = [];
const bodyEls = [];
const radioEls = [];

['search', 'layers', 'about'].forEach(function (name) {
  const tb = makeEl('tab-' + name);
  tb.setAttribute('data-tab', name);
  tabEls.push(tb);
  const bd = makeEl('body-' + name);
  bd.id = 'tab-' + name;
  bodyEls.push(bd);
});
['gaode', 'gaode_img', 'carto', 'osm'].forEach(function (v, i) {
  const r = makeEl('radio-' + v);
  r.value = v;
  r.checked = i === 0;
  r.setAttribute('name', 'basemap');
  radioEls.push(r);
});

const document = {
  querySelector(sel) {
    if (!els[sel]) { els[sel] = makeEl(sel); }
    return els[sel];
  },
  querySelectorAll(sel) {
    if (sel === '.tab') { return tabEls; }
    if (sel === '.tab-body') { return bodyEls; }
    if (sel === 'input[name="basemap"]') { return radioEls; }
    return [];
  },
  createElement() {
    const el = makeEl('li');
    createdEls.push(el);
    return el;
  },
  addEventListener() {}
};

const geoJSONLayers = [];
let clusterMarkerCount = 0;
function makeLayer() {
  const layer = {
    _adds: [],
    addTo() { return this; },
    addData(data) { this._adds.push(data); return this; },
    clearLayers() { this._adds = []; return this; },
    getBounds() { return { isValid() { return true; } }; },
    setStyle() { return this; },
    on() { return this; }
  };
  return layer;
}
function makeTileLayer() {
  return {
    addTo() { return this; },
    remove() { return this; }
  };
}

const L = {
  map() {
    return {
      setView() { return this; },
      addLayer() { return this; },
      removeLayer() { return this; },
      fitBounds() { return this; },
      getZoom() { return 11; },
      on() { return this; }
    };
  },
  tileLayer() { return makeTileLayer(); },
  geoJSON(data) {
    const l = makeLayer();
    l._initial = data || null;
    geoJSONLayers.push(l);
    return l;
  },
  markerClusterGroup() {
    return {
      addLayer() { clusterMarkerCount += 1; return this; },
      addTo() { return this; }
    };
  },
  circleMarker() {
    return { bindTooltip() { return this; }, on() { return this; }, addTo() { return this; } };
  },
  layerGroup() {
    return { addLayer() { return this; }, clearLayers() { return this; }, addTo() { return this; } };
  },
  latLngBounds() { return { extend() {}, isValid() { return true; } }; }
};

const sandbox = { window: {}, document, L, console };
sandbox.window = sandbox;
sandbox.__APP_DEBUG__ = true;
vm.createContext(sandbox);

const dataDir = path.join(__dirname, 'data');
fs.readdirSync(dataDir).filter(f => f.endsWith('.js')).forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(dataDir, f), 'utf-8'), sandbox, { filename: f });
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf-8'), sandbox, { filename: 'app.js' });

function fire(el, type) {
  if (el && el.handlers && el.handlers[type]) { el.handlers[type]({ target: el }); }
}

console.log('stats text:', els['#stats'].textContent);
console.log('legend html length:', els['#legend'].innerHTML.length);

// ---- layer data correctness (regression: cache must not mix datasets) ----
const first = geoJSONLayers.slice(0, 5);
const assertFeats = (layer, n, type, check) => {
  const data = layer._initial;
  if (!data || data.length !== n) { throw new Error('layer feature count mismatch: ' + n); }
  if (!data.every(f => f.geometry.type === type)) { throw new Error('layer geometry type mismatch: ' + type); }
  if (check && !data.every(check)) { throw new Error('layer feature check failed'); }
};
assertFeats(first[0], 70, 'LineString', f => (f.properties.route_cn || '').indexOf('线') >= 0);
assertFeats(first[1], 409, 'Point', f => !!f.properties.stop_id);
assertFeats(first[2], sandbox.BUS_ROUTES.features.length, 'LineString', f => !!f.properties.route_cn);
assertFeats(first[3], sandbox.BUS_ROUTES.features.filter(function (f) { return /^B\d/.test((f.properties.route_cn || '').split('(')[0]); }).length, 'LineString', f => /^B\d/.test(f.properties.route_cn));
console.log('layer data correctness OK (metro routes/stops, bus routes, BRT)');
console.log('bus stop cluster markers:', clusterMarkerCount, '(expect ' + sandbox.BUS_STOPS.features.length + ')');
if (clusterMarkerCount !== sandbox.BUS_STOPS.features.length) { throw new Error('bus stop cluster marker count mismatch'); }

// ---- tab switching ----
fire(tabEls[1], 'click'); // 图层
if (!bodyEls[1].classList.contains('active')) { throw new Error('tab layers not activated'); }
fire(tabEls[2], 'click'); // 说明
if (!bodyEls[2].classList.contains('active')) { throw new Error('tab about not activated'); }
if (bodyEls[0].classList.contains('active')) { throw new Error('tab search should be inactive'); }
console.log('tab switching OK');

// ---- panel collapse / expand ----
const pt = els['#panel-toggle'];
if (!pt) { throw new Error('panel toggle button missing'); }
pt.handlers.click();
if (!els['body'].classList.contains('panel-collapsed')) {
  throw new Error('panel should collapse on toggle');
}
if (pt.textContent !== '☰') { throw new Error('toggle icon should switch to ☰'); }
pt.handlers.click();
if (els['body'].classList.contains('panel-collapsed')) {
  throw new Error('panel should expand on second toggle');
}
console.log('panel collapse/expand OK');

// ---- basemap switching ----
sandbox.__APP_DEBUG__.setBasemap('carto');
if (sandbox.__APP_DEBUG__.getSpace() !== 'wgs84') { throw new Error('space not switched to wgs84'); }
sandbox.__APP_DEBUG__.setBasemap('gaode');
if (sandbox.__APP_DEBUG__.getSpace() !== 'gcj02') { throw new Error('space not switched to gcj02'); }
console.log('basemap switching OK (wgs84 <-> gcj02)');

// ---- route search ----
const routeInput = els['#route-search'];
routeInput.value = '527';
fire(routeInput, 'input');
const created = createdEls.filter(e => e._innerHTML && e._innerHTML.indexOf('527路') >= 0);
if (!created.length) { throw new Error('route suggestion for 527 not rendered'); }
const li = makeEl('li');
li._innerHTML = '527路';
li.handlers.click = function () {};
console.log('route suggestion rendered:', created.length, 'item(s)');

// ---- search ranking (single-digit routes) ----
['1', '2', '3', '4', '7', '8', '9'].forEach(function (d) {
  const cand = sandbox.__APP_DEBUG__.routeCandidates(d);
  if (!cand.length || cand[0].num !== d + '路') {
    throw new Error('search "' + d + '" should rank ' + d + '路 first, got ' + (cand[0] && cand[0].num));
  }
});
console.log('search single-digit ranking OK');

// ---- pinyin search ----
const ycdHit = sandbox.__APP_DEBUG__.stopCandidates('ycd');
if (!ycdHit.some(function (o) { return o.name.indexOf('员村东') >= 0; })) {
  throw new Error('pinyin ycd should find 员村东');
}
const mhcHit = sandbox.__APP_DEBUG__.stopCandidates('mhc');
if (!mhcHit.some(function (o) { return o.name.indexOf('梅花村') >= 0; })) {
  throw new Error('pinyin mhc should find 梅花村');
}
console.log('pinyin search OK (ycd→员村东, mhc→梅花村)');

// ---- stop sub-station merge in search & detail ----
const ycCand = sandbox.__APP_DEBUG__.stopCandidates('员村东');
if (!ycCand.some(function (o) { return o.name === '员村东'; })) {
  throw new Error('search 员村东 should prefer canonical 员村东');
}
if (ycCand.some(function (o) { return o.name === '员村东2'; })) {
  throw new Error('search should not list 员村东2 separately');
}
const expUnion = new Set([
  ...(sandbox.STOP_ROUTES['BV09291509'] || []),
  ...(sandbox.STOP_ROUTES['BV09243513'] || [])
]);
sandbox.__APP_DEBUG__.selectBusStop('BV09291509', '员村东2');
const htmlYc = els['#info'].innerHTML;
const mCnt = htmlYc.match(/经过线路（(\d+)）/);
if (!mCnt || Number(mCnt[1]) !== expUnion.size) {
  throw new Error('stop detail should show merged routes, got ' + (mCnt && mCnt[1]) + ' vs ' + expUnion.size);
}
console.log('stop sub-station merge OK (search + detail, ' + expUnion.size + ' routes)');

// ---- parenthetical variants merge by proximity ----
if (sandbox.__APP_DEBUG__.normDisplay('华侨医院') !== '华侨医院(潭村)') {
  throw new Error('华侨医院 should merge to 华侨医院(潭村), got ' + sandbox.__APP_DEBUG__.normDisplay('华侨医院'));
}
if (sandbox.__APP_DEBUG__.normDisplay('开泰大道(开达路口)') !== '开泰大道(开达路口)') {
  throw new Error('开泰大道(开达路口) should stay separate');
}
if (sandbox.__APP_DEBUG__.normDisplay('开泰大道(科丰路口)') !== '开泰大道(科丰路口)') {
  throw new Error('开泰大道(科丰路口) should stay separate');
}
console.log('parenthetical variant merge OK (华侨医院/潭村 merged, 开泰大道路口 separated)');

// ---- direction suffix merge (松北) ----
if (sandbox.__APP_DEBUG__.normStop('松北(北行)') !== '松北' || sandbox.__APP_DEBUG__.normStop('松北(停北行)') !== '松北') {
  throw new Error('direction suffix should merge to plain name');
}
const b3Key = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) {
  return k.startsWith('B3路(') &&
    sandbox.BUS_ROUTE_STOPS[k].some(function (st) { return st[1] === '松北(北行)'; }) &&
    sandbox.BUS_ROUTE_STOPS[k].some(function (st) { return st[1] === '松北(南行)'; });
});
if (!b3Key) { throw new Error('B3 direction with both 松北 platforms missing'); }
const b3Stops = sandbox.__APP_DEBUG__.displayStops(sandbox.BUS_ROUTE_STOPS[b3Key]);
if (!b3Stops.some(function (st) { return st[1] === '松北(北行)'; }) ||
    !b3Stops.some(function (st) { return st[1] === '松北(南行)'; })) {
  throw new Error('route stop list should keep direction suffix info');
}
console.log('direction suffix merge OK (analysis merges, display keeps brackets)');

// ---- 中山纪念堂 bracket disambiguation ----
if (sandbox.__APP_DEBUG__.normDisplay('中山纪念堂') !== '中山纪念堂(市总工会)') {
  throw new Error('中山纪念堂 should display as 中山纪念堂(市总工会), got ' + sandbox.__APP_DEBUG__.normDisplay('中山纪念堂'));
}
if (sandbox.__APP_DEBUG__.normDisplay('中山纪念堂(连新路)') !== '中山纪念堂(连新路)') {
  throw new Error('中山纪念堂(连新路) should stay separate');
}
console.log('中山纪念堂 bracket disambiguation OK');

// ---- 同号不同线（佛山655 / 广州655） ----
const kFs655 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('655路(三达路'); });
const kGz655 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('655路(良田保税'); });
if (!kFs655 || !kGz655) { throw new Error('655 佛山/广州记录缺失'); }
const n655 = sandbox.__APP_DEBUG__.numKeys('655路');
if (n655.length !== 2) { throw new Error('655路 should have 2 route identities, got ' + n655.length); }
if (sandbox.__APP_DEBUG__.routeKeyOf(kFs655) === sandbox.__APP_DEBUG__.routeKeyOf(kGz655)) {
  throw new Error('佛山655 and 广州655 should be different route keys');
}
const c655 = sandbox.__APP_DEBUG__.routeCandidates('655');
if (c655.length < 2) { throw new Error('search 655 should list multiple routes'); }
if (!c655.some(function (o) { return (o.label || '').indexOf('三达路') >= 0; }) ||
    !c655.some(function (o) { return (o.label || '').indexOf('良田保税') >= 0; })) {
  throw new Error('search 655 labels should disambiguate 佛山/广州');
}
console.log('route identity OK (佛山655 / 广州655 separated)');

// ---- 截断站名修复 + 通用站名 + 线路别名 ----
if (sandbox.__APP_DEBUG__.normDisplay('广州火车') !== '广州火车站') {
  throw new Error('广州火车 should be fixed to 广州火车站');
}
const gzCand = sandbox.__APP_DEBUG__.stopCandidates('广州火车站');
if (!gzCand.some(function (o) { return o.name === '广州火车站'; })) {
  throw new Error('search 广州火车站 should find the metro stop');
}
if ((sandbox.__APP_DEBUG__.normIds('临时站1') || []).length !== 0) {
  throw new Error('generic stops should not be aggregated by name');
}
const kC13 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('从13路('); });
const kCh13 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('从化13路('); });
if (!kC13 || !kCh13) { throw new Error('从13/从化13 records missing'); }
if (sandbox.__APP_DEBUG__.routeKeyOf(kC13) !== sandbox.__APP_DEBUG__.routeKeyOf(kCh13)) {
  throw new Error('从13路 should be aliased to 从化13路');
}
console.log('truncation fix + generic split + route alias OK');

// ---- 首末站 / 双向箭头 / 时间冒号 ----
if (sandbox.__APP_DEBUG__.fmtTime('0520') !== '05:20' || sandbox.__APP_DEBUG__.fmtTime('520') !== '05:20') {
  throw new Error('time formatter should add colons');
}
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
const htmlKv = els['#info'].innerHTML;
if (htmlKv.indexOf('首末站') < 0) { throw new Error('起讫 should be renamed 首末站'); }
if (htmlKv.indexOf('⇄') < 0) { throw new Error('terminals should use bidirectional arrow'); }
console.log('route detail 首末站/双向箭头/时间冒号 OK');

// ---- selection flows via debug hook ----
sandbox.__APP_DEBUG__.selectRouteByNum('527路', 'bus');
if (els['#info'].innerHTML.indexOf('527路') < 0) { throw new Error('route panel missing 527'); }
const lastLayer = geoJSONLayers[geoJSONLayers.length - 1];
const lastAdd = lastLayer._adds[lastLayer._adds.length - 1];
if (!lastAdd || lastAdd.length !== 2) { throw new Error('highlight should contain 2 features for 527'); }
if (!lastAdd.every(f => (f.properties.route_cn || '').startsWith('527路'))) {
  throw new Error('highlight contains wrong features');
}
console.log('route highlight content OK (2 features, 527路)');
sandbox.__APP_DEBUG__.selectBusStop('BV10016241', '梅花村');
if (els['#info'].innerHTML.indexOf('B5路') < 0) { throw new Error('bus stop panel missing B5'); }
const metroFeat = sandbox.METRO_STOPS.features.find(f => f.properties.name_cn === '体育西路');
sandbox.__APP_DEBUG__.selectMetro(metroFeat.properties.stop_id, '体育西路');
const infoHtml = els['#info'].innerHTML;
if (infoHtml.indexOf('地铁1号线') < 0) { throw new Error('metro panel missing lines'); }
if (infoHtml.indexOf('天河城站') < 0) { throw new Error('metro panel missing feeder'); }
console.log('route/stop/metro selection OK');

// ---- colinearity (BRT only for now) ----
sandbox.__APP_DEBUG__.selectRouteByNum('B1路', 'bus');
if (els['#info'].innerHTML.indexOf('共线排行') < 0) {
  throw new Error('BRT route panel missing colinearity card');
}
els['#card-co-head'].handlers.click();
const coHtml = els['#co-box'].innerHTML;
if ((coHtml.match(/co-row/g) || []).length < 1) { throw new Error('colinearity rows missing'); }
els['#card-co-head'].handlers.click();
if (els['#card-co-body'].classList.contains('open')) { throw new Error('colinearity card should collapse on second click'); }
console.log('BRT colinearity card OK');

const b1Key = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('B1路('); });
if (!b1Key) { throw new Error('B1 route stops missing'); }
const coRes = sandbox.__APP_DEBUG__.colinearity(b1Key);
if (!coRes.list.length) { throw new Error('B1 has no colinear routes'); }
console.log('B1 colinearity top:', coRes.list.slice(0, 5).map(function (r) {
  return r.num + '×' + r.count;
}).join(', '));

// ---- all-route colinearity (527) ----
sandbox.__APP_DEBUG__.selectRouteByNum('527路', 'bus');
if (els['#info'].innerHTML.indexOf('共线排行') < 0) {
  throw new Error('all bus routes should show colinearity card now');
}
const r527ColinearityKey = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('527路('); });
const co527 = sandbox.__APP_DEBUG__.colinearity(r527ColinearityKey);
if (!co527.list.length) { throw new Error('527 has no colinear routes'); }
console.log('all-route colinearity OK (527 top: ' + co527.list[0].num + ' ×' + co527.list[0].count + ')');

// ---- colinearity name-based fallback (夜48 × B25) ----
const y48Key = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('夜48路('); });
if (!y48Key) { throw new Error('夜48 route missing'); }
const co48 = sandbox.__APP_DEBUG__.colinearity(y48Key);
const b25 = co48.list.find(function (x) { return x.num === 'B25路'; });
if (!b25 || b25.count < 10) {
  throw new Error('夜48×B25 should be >=10 after name matching, got ' + (b25 ? b25.count : 0));
}
if (b25.stopNames.indexOf('华景新城') < 0 || !b25.stopNames.some(function (n) { return n.indexOf('广师大') >= 0; })) {
  throw new Error('夜48×B25 should include 华景新城/广师大, got ' + b25.stopNames.join(','));
}
console.log('colinearity name-fallback OK (夜48×B25 = ' + b25.count + ')');

// ---- digit sub-station merge (员村四横路口 / 员村四横路口2) ----
if (sandbox.__APP_DEBUG__.normStop('员村四横路口2') !== '员村四横路口') {
  throw new Error('digit sub-station should merge to base name');
}
const mergedIds = sandbox.__APP_DEBUG__.normIds('员村四横路口');
if (mergedIds.indexOf('BV11688540') < 0 || mergedIds.indexOf('BV09302573') < 0) {
  throw new Error('merged station index should contain both platform IDs, got ' + mergedIds.join(','));
}
console.log('digit sub-station merge OK (员村四横路口 + 员村四横路口2 -> ' + mergedIds.length + ' IDs)');

// ---- 同名站距离聚类：跨区同名站必须拆开（南村 天河/番禺/南沙/花都） ----
const nanTianhe = ['BV09316713', 'BV11688567']; // 天河 南村1 / 南村
const nanAll = ['BV09316713', 'BV11688567', 'BV09398775', 'BV09277458', 'BV11688568'];
const nanUnion = function (ids) {
  const s = new Set();
  ids.forEach(function (id) { (sandbox.STOP_ROUTES[id] || []).forEach(function (r) { s.add(r); }); });
  return s;
};
const nanCntLocal = nanUnion(nanTianhe).size;
const nanCntFar = nanUnion(nanAll).size;
sandbox.__APP_DEBUG__.selectBusStop('BV11688567', '南村');
const mNan = els['#info'].innerHTML.match(/经过线路（(\d+)）/);
if (!mNan || Number(mNan[1]) !== nanCntLocal || (nanCntFar > nanCntLocal && Number(mNan[1]) === nanCntFar)) {
  throw new Error('南村 same-name far merge not split: local=' + nanCntLocal + ' far=' + nanCntFar + ' shown=' + (mNan ? mNan[1] : '?'));
}
console.log('同名站距离聚类 OK (南村 天河/番禺/南沙/花都 已拆开)');

// ---- colinearity dedupe for same-direction sub-stations (46路) ----
const r46Key = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) {
  return k.startsWith('46路(') &&
    sandbox.BUS_ROUTE_STOPS[k].some(function (st) { return st[1] === '云台花园1'; }) &&
    sandbox.BUS_ROUTE_STOPS[k].some(function (st) { return st[1] === '云台花园2'; });
});
if (!r46Key) { throw new Error('46路 direction with both 云台花园1/2 missing'); }
const co46 = sandbox.__APP_DEBUG__.colinearity(r46Key);
const raw46 = sandbox.BUS_ROUTE_STOPS[r46Key].length;
if (co46.stops >= raw46) {
  throw new Error('46路 colinearity should dedupe merged stations (' + co46.stops + '/' + raw46 + ')');
}
console.log('colinearity sub-station dedupe OK (46路 ' + co46.stops + '/' + raw46 + ' 站)');

// ---- BRT platform variant normalization ----
if (sandbox.__APP_DEBUG__.normDisplay('BRT岗顶N1') !== '岗顶') {
  throw new Error('BRT岗顶N1 should display as 岗顶');
}
if (sandbox.__APP_DEBUG__.normDisplay('棠东站S1子站(BRT)') !== '棠东') {
  throw new Error('棠东站S1子站(BRT) should display as 棠东');
}
if (!sandbox.__APP_DEBUG__.isBrt('BV09361651', 'BRT岗顶N1')) {
  throw new Error('BRT岗顶N1 should get BRT badge');
}
if (!sandbox.__APP_DEBUG__.isBrt('BV09375068', '棠东站S1子站(BRT)')) {
  throw new Error('棠东站S1子站(BRT) should get BRT badge');
}
console.log('BRT platform variant normalization OK');

// ---- hairpin smoothing (增城88路) ----
const f88 = sandbox.BUS_ROUTES.features.find(function (f) { return f.properties.route_cn === '增城88路(塘口村--新山吓村)'; });
if (!f88) { throw new Error('增城88路 missing'); }
const sc = sandbox.__APP_DEBUG__.smoothCoords(f88.geometry.coordinates);
if (sc.length <= f88.geometry.coordinates.length) {
  throw new Error('smoothing should add arc points, got ' + sc.length + ' vs ' + f88.geometry.coordinates.length);
}
console.log('hairpin smoothing OK (' + f88.geometry.coordinates.length + ' -> ' + sc.length + ' vertices)');

// ---- stop platform selection (363 林和西路) ----
const f363a = sandbox.BUS_ROUTES.features.find(function (f) {
  return f.properties.route_cn === '363路(广州火车东站总站--穗港码头总站)';
});
if (!f363a) { throw new Error('363 A direction missing'); }
const picked = sandbox.__APP_DEBUG__.pickPlatform(f363a.geometry.coordinates, '林和西路', 'BV11688381');
if (picked !== 'BV09383025') {
  throw new Error('should pick the platform on the route line (林和西路2), got ' + picked);
}
console.log('stop platform selection OK (363 林和西路 -> 林和西路2)');

// ---- station platform auxiliary data ----
const plats = sandbox.__APP_DEBUG__.getPlatforms('林和西路');
if (!plats.some(function (p) { return p.id === 'BV09383025'; }) ||
    !plats.some(function (p) { return p.id === 'BV11688381'; })) {
  throw new Error('林和西路 platforms should include both variants');
}
const plats2 = sandbox.__APP_DEBUG__.getPlatforms('华侨医院');
if (!plats2.some(function (p) { return p.id === 'BV10539406'; })) {
  throw new Error('华侨医院 platforms should include 华侨医院(潭村)');
}
sandbox.__APP_DEBUG__.selectBusStop('BV11688381', '林和西路');
if (els['#info'].innerHTML.indexOf('平台（') < 0) {
  throw new Error('stop detail should show platform info');
}
console.log('station platform auxiliary data OK');

// ---- B11 colinearity compare + row jump + route back ----
const b11Key = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('B11路('); });
if (!b11Key) { throw new Error('B11 route stops missing'); }
const b11Co = sandbox.__APP_DEBUG__.colinearity(b11Key);
if (!b11Co.list.length) { throw new Error('B11 has no colinear routes'); }
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
els['#card-co-head'].handlers.click();
const cmpNum = b11Co.list[0].num;
const cmpKey = b11Co.list[0].key;
const cmpBtn = makeEl('co-compare-test');
cmpBtn.setAttribute('data-compare', cmpKey);
els['#co-box'].handlers.click({ target: cmpBtn });
if (sandbox.__APP_DEBUG__.getCompare() !== cmpKey) {
  throw new Error('compare should activate via button');
}
els['#co-box'].handlers.click({ target: cmpBtn });
if (sandbox.__APP_DEBUG__.getCompare() !== null) {
  throw new Error('compare should clear on second click');
}
const rowEl = makeEl('co-row-test');
rowEl.setAttribute('data-key', cmpKey);
els['#co-box'].handlers.click({ target: rowEl });
if (els['#info'].innerHTML.indexOf(cmpNum) < 0) {
  throw new Error('row click should jump to route (' + cmpNum + ')');
}
if (els['#info'].innerHTML.indexOf('返回 B11路') < 0) {
  throw new Error('route panel should have back button to B11路');
}
els['#route-back-btn'].handlers.click();
if (els['#info'].innerHTML.indexOf('B11路(') < 0) {
  throw new Error('back should return to B11');
}
const ovChk = els['#stop-overlay'];
if (!ovChk) { throw new Error('stop overlay toggle missing'); }
ovChk.checked = true;
ovChk.handlers.change();
if (!sandbox.__APP_DEBUG__.getOverlay() || sandbox.__APP_DEBUG__.getOverlayCount() < 1) {
  throw new Error('stop overlay should be on for the current route');
}
ovChk.checked = false;
ovChk.handlers.change();
if (sandbox.__APP_DEBUG__.getOverlayCount() !== 0) {
  throw new Error('stop overlay should clear when toggle off');
}
console.log('B11 compare + row jump + route back OK (' + cmpNum + ')');

// ---- direction shading (B11 A/B) ----
const b11Dirs = Object.keys(sandbox.BUS_ROUTE_STOPS).filter(function (k) { return k.startsWith('B11路('); });
if (b11Dirs.length < 2) { throw new Error('B11 should have 2 direction records'); }
const d0 = sandbox.__APP_DEBUG__.getDir(b11Dirs[0]);
const d1 = sandbox.__APP_DEBUG__.getDir(b11Dirs[1]);
if (!d0 || !d1 || d0 === d1) { throw new Error('B11 directions should be marked A/B'); }
console.log('B11 direction shading OK (' + d0 + '/' + d1 + ')');

// ---- back button (stop -> route) ----
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
const stopF = sandbox.BUS_STOPS.features.find(function (x) { return x.properties.stop_id === 'BV10389050'; });
if (!stopF) { throw new Error('test stop missing'); }
sandbox.__APP_DEBUG__.selectBusStop(stopF.properties.stop_id, stopF.properties.name_cn);
if (els['#info'].innerHTML.indexOf('返回 B11路') < 0) {
  throw new Error('back button missing in bus stop panel');
}
els['#back-btn'].handlers.click();
if (els['#info'].innerHTML.indexOf('B11路(') < 0) {
  throw new Error('back should return to B11 route panel');
}
sandbox.__APP_DEBUG__.selectRouteByNum('地铁1号线', 'metro');
const metroStopF = sandbox.METRO_STOPS.features.find(function (x) { return x.properties.name_cn === '体育西路'; });
if (!metroStopF) { throw new Error('metro test stop missing'); }
sandbox.__APP_DEBUG__.selectMetro(metroStopF.properties.stop_id, '体育西路');
if (els['#info'].innerHTML.indexOf('返回 地铁1号线') < 0) {
  throw new Error('back button missing in metro stop panel');
}
els['#back-btn'].handlers.click();
if (els['#info'].innerHTML.indexOf('地铁1号线') < 0) {
  throw new Error('back should return to metro route panel');
}
console.log('back button OK (bus stop / metro stop -> route)');

// ---- route stops split by direction (218) ----
sandbox.__APP_DEBUG__.selectRouteByNum('218路', 'bus');
const html218 = els['#info'].innerHTML;
if (html218.indexOf('A方向') < 0 || html218.indexOf('B方向') < 0) {
  throw new Error('218 should show both direction stop sections');
}
if (html218.indexOf('天河东路') < 0) {
  throw new Error('218 reverse direction stop 天河东路 missing');
}
if (html218.indexOf('>员村东2</button>') >= 0) {
  throw new Error('218 should merge 员村东2 into 员村东 in display');
}
if (html218.indexOf('>员村东<') < 0) {
  throw new Error('218 should show merged 员村东');
}
const chips218 = (html218.match(/class="chip"/g) || []).length;
const expect218 = Object.keys(sandbox.BUS_ROUTE_STOPS)
  .filter(function (k) { return k.startsWith('218路('); })
  .reduce(function (sum, k) { return sum + sandbox.__APP_DEBUG__.displayStops(sandbox.BUS_ROUTE_STOPS[k]).length; }, 0);
if (chips218 !== expect218) {
  throw new Error('218 chip count mismatch: ' + chips218 + ' vs ' + expect218);
}
console.log('218 route stops split by direction OK (' + expect218 + ' chips)');

// ---- loop repeated stops kept (996) ----
const k996 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('996路('); });
if (!k996) { throw new Error('996 loop missing'); }
const ds996 = sandbox.__APP_DEBUG__.displayStops(sandbox.BUS_ROUTE_STOPS[k996], k996);
if (ds996.length !== sandbox.BUS_ROUTE_STOPS[k996].length) {
  throw new Error('996 loop should keep all stops (' + ds996.length + ' vs ' + sandbox.BUS_ROUTE_STOPS[k996].length + ')');
}
const cnt996 = ds996.filter(function (st) { return st[1] === '水秀二路' || st[1] === '芳村车管所'; }).length;
if (cnt996 !== 4) { throw new Error('996 loop should keep repeated stops, got ' + cnt996); }
console.log('loop repeated stops OK (996 keeps ' + ds996.length + ' stops)');

// ---- 括号站名环线（290路等）也应保留回程站 ----
const k290 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.startsWith('290路('); });
if (!k290) { throw new Error('290 loop missing'); }
const ds290 = sandbox.__APP_DEBUG__.displayStops(sandbox.BUS_ROUTE_STOPS[k290], k290);
if (ds290.length < 20) {
  // 旧逻辑（非环线去重）只剩 16 站；括号站名环线应保留回程站（27 站，其中 1 站为分站名连续重复被去）
  throw new Error('290 loop should keep return-leg stops, got ' + ds290.length);
}
console.log('parenthesized-termini loop OK (290 keeps ' + ds290.length + ' stops)');

// ---- 站名更名：顺德一中实验学校 → 广东顺德文德学校（旧名可搜索） ----
if (sandbox.__APP_DEBUG__.normDisplay('顺德一中实验学校') !== '广东顺德文德学校') {
  throw new Error('顺德一中实验学校 should display as 广东顺德文德学校');
}
const schoolIdsNew = (sandbox.__APP_DEBUG__.normIds('广东顺德文德学校') || []).slice().sort();
const schoolIdsOld = (sandbox.__APP_DEBUG__.normIds('顺德一中实验学校') || []).slice().sort();
if (schoolIdsNew.length < 2 || schoolIdsNew.join() !== schoolIdsOld.join()) {
  throw new Error('school rename stops should merge, got ' + schoolIdsNew.join() + ' vs ' + schoolIdsOld.join());
}
if (!sandbox.__APP_DEBUG__.stopCandidates('顺德一中实验学校').some(function (o) {
  return (o.label || '').indexOf('广东顺德文德学校') >= 0;
})) {
  throw new Error('old school name should be searchable');
}
console.log('school rename OK (顺德一中实验学校 -> 广东顺德文德学校)');

// ---- 站字+括号变体：东风东路站 与 东风东路(广东工大) 是同一站 ----
const dfIds = (sandbox.__APP_DEBUG__.normIds('东风东路站') || []).slice().sort();
if (sandbox.__APP_DEBUG__.normDisplay('东风东路站') !== '东风东路(广东工大)' || dfIds.length < 2) {
  throw new Error('东风东路站 should merge into 东风东路(广东工大), got ' + sandbox.__APP_DEBUG__.normDisplay('东风东路站') + ' / ' + dfIds.join());
}
const k204a = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.indexOf('204路') === 0 && k.indexOf('东风东路') < 0 && /总站--/.test(k); });
const k204b = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.indexOf('204路') === 0 && k !== k204a; });
if (!k204a || !k204b) { throw new Error('204 records missing'); }
const hit204 = function (k) {
  return (sandbox.BUS_ROUTE_STOPS[k] || []).some(function (st) {
    return (sandbox.__APP_DEBUG__.normIds(st[1]) || []).some(function (id) { return dfIds.indexOf(id) >= 0; });
  });
};
if (!hit204(k204a) || !hit204(k204b)) {
  throw new Error('204 A/B should both stop at 东风东路(广东工大)');
}
console.log('bracket+站字 merge OK (东风东路站 -> 东风东路(广东工大), 204 A/B unified)');

// ---- 方向后缀平台不误伤纯名（804 同和；792 环线后缀仍保留） ----
sandbox.__APP_DEBUG__.selectRouteByNum('804路', 'bus');
const html804 = els['#info'].innerHTML;
if (html804.indexOf('>同和(停北行)<') >= 0 || html804.indexOf('>同和(停北行)<span') >= 0) {
  throw new Error('804 should display 同和 without direction suffix');
}
const cnt804 = (html804.match(/>同和<span/g) || []).length;
if (cnt804 < 2) { throw new Error('804 both directions should show 同和, got ' + cnt804); }
sandbox.__APP_DEBUG__.selectRouteByNum('792路环线', 'bus');
const html792 = els['#info'].innerHTML;
if (html792.indexOf('>同和(停北行)<') >= 0 || html792.indexOf('>同和(南行)<') >= 0) {
  throw new Error('792 loop should not show direction suffix');
}
const cnt792 = (html792.match(/>同和</g) || []).length;
if (cnt792 < 2) { throw new Error('792 loop should show 同和 twice, got ' + cnt792); }
sandbox.__APP_DEBUG__.selectRouteByNum('188路', 'bus');
const html188 = els['#info'].innerHTML;
if (html188.indexOf('>广医二院(停东行)<') >= 0 || html188.indexOf('>广医二院(西行)<') >= 0) {
  throw new Error('188 loop should not show direction suffix');
}
if ((html188.match(/>广医二院</g) || []).length < 1) {
  throw new Error('188 loop should show 广医二院');
}
sandbox.__APP_DEBUG__.selectRouteByNum('B3路', 'bus');
const htmlB3 = els['#info'].innerHTML;
if (htmlB3.indexOf('>松北(北行)<') < 0 || htmlB3.indexOf('>松北(南行)<') < 0) {
  throw new Error('B3 (non-loop) should keep 松北(北行)/(南行) suffixes');
}
console.log('loop direction-suffix stripped OK (188/792 纯名, B3 保留后缀)');

// ---- 公共汽车/BRT 站牌前缀：B20 两方向统一为 中山大道东圃站 ----
sandbox.__APP_DEBUG__.selectRouteByNum('B20路', 'bus');
const htmlB20 = els['#info'].innerHTML;
if (htmlB20.indexOf('>公共汽车') >= 0) {
  throw new Error('B20 should not show 公共汽车 prefix');
}
const cntB20 = (htmlB20.match(/>中山大道东圃站<span/g) || []).length;
if (cntB20 < 2) { throw new Error('B20 both directions should show 中山大道东圃站, got ' + cntB20); }
const dongpuIds = sandbox.__APP_DEBUG__.normIds('公共汽车BRT中山大道东圃站') || [];
if (dongpuIds.length < 4) { throw new Error('中山大道东圃站 variants should merge, got ' + dongpuIds.length + ' platforms'); }
console.log('站牌前缀归一 OK (B20 → 中山大道东圃站, ' + dongpuIds.length + ' platforms)');

// ---- 字母分站 + 总站写法归一 ----
const yajuIds = sandbox.__APP_DEBUG__.normIds('雅居乐花园A站') || [];
if (yajuIds.indexOf('BV10254206') < 0) {
  throw new Error('雅居乐花园A站 should merge with 雅居乐花园');
}
if (sandbox.__APP_DEBUG__.normDisplay('番禺宝墨园') !== '宝墨园总站') {
  throw new Error('番禺宝墨园 should display as 宝墨园总站');
}
const baomoA = (sandbox.__APP_DEBUG__.normIds('宝墨园') || []).slice().sort();
const baomoB = (sandbox.__APP_DEBUG__.normIds('宝墨园总站') || []).slice().sort();
if (baomoA.join() !== baomoB.join()) {
  throw new Error('宝墨园 variants should merge into 宝墨园总站');
}
if (sandbox.__APP_DEBUG__.normIds('中国软件CBD站') && sandbox.__APP_DEBUG__.normIds('中国软件CBD站').length) {
  const cbd = sandbox.__APP_DEBUG__.normStop('中国软件CBD站');
  if (cbd === '中国软件CB') { throw new Error('中国软件CBD站 should not lose the D'); }
}
console.log('字母分站/总站写法归一 OK (雅居乐花园A站、宝墨园总站)');

// ---- 佛314路(周六)去程重复站已清理 ----
const kF314 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k === '佛314路(周六)(宝墨园总站--顺德客运总站)'; });
if (!kF314) { throw new Error('佛314(周六) record missing'); }
const seenF314 = {};
var dupF314 = false;
sandbox.BUS_ROUTE_STOPS[kF314].forEach(function (st) {
  if (seenF314[st[2]]) { dupF314 = true; }
  seenF314[st[2]] = true;
});
if (dupF314 || sandbox.BUS_ROUTE_STOPS[kF314].length !== 32) {
  throw new Error('佛314(周六) should have 32 unique stops, got ' + sandbox.BUS_ROUTE_STOPS[kF314].length);
}
console.log('佛314(周六) duplicate cleanup OK (32 stops)');

// ---- 车来了方向分站坐标：566 南行 云埔工业区 应使用车来了南行站台 ----
const k566a = Object.keys(sandbox.BUS_ROUTE_STOPS).find(function (k) { return k.indexOf('566路(永和总站') === 0; });
const st566 = sandbox.BUS_ROUTE_STOPS[k566a].find(function (s) { return s[1] === '云埔工业区'; });
const feat566 = sandbox.BUS_ROUTES.features.find(function (f) { return f.properties.route_cn === k566a; });
const pos566 = sandbox.__APP_DEBUG__.bestPos(feat566.geometry.coordinates, st566[1], st566[2], k566a);
if (!pos566 || !pos566.derived || Math.abs(pos566.coords[0] - 113.519566) > 0.0005 || Math.abs(pos566.coords[1] - 23.149766) > 0.0005) {
  throw new Error('566 南行 云埔工业区 should use chelaile southbound platform, got ' + (pos566 ? pos566.coords.join(',') : 'null'));
}
console.log('车来了方向分站 OK (566 云埔工业区南行 → ' + pos566.coords[0].toFixed(5) + ',' + pos566.coords[1].toFixed(5) + ')');

// ---- stop marking (BRT/metro) + LED mode (B11) ----
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
const htmlB11 = els['#info'].innerHTML;
if (htmlB11.indexOf('stop-badge brt') < 0) { throw new Error('BRT badge missing for B11'); }
if (htmlB11.indexOf('stop-badge metro') < 0) { throw new Error('metro badge missing for B11'); }
if (htmlB11.indexOf('background:#e6a817') < 0) { throw new Error('metro line color mapping failed (21号线)'); }
const brtStopAny = sandbox.BUS_STOPS.features.find(function (x) { return sandbox.__APP_DEBUG__.isBrtStop(x.properties.stop_id); });
if (!brtStopAny) { throw new Error('no BRT station id found'); }
sandbox.__APP_DEBUG__.setStopMode('led');
const ledHtml = els['#stop-section'].innerHTML;
if (ledHtml.indexOf('led-panel') < 0) { throw new Error('LED mode not rendered'); }
if ((ledHtml.match(/class="led-station"/g) || []).length < 30) { throw new Error('LED stations missing'); }
sandbox.__APP_DEBUG__.setStopMode('chips');
if (els['#stop-section'].innerHTML.indexOf('led-panel') >= 0) { throw new Error('LED mode should revert to chips'); }
console.log('B11 stop marking (BRT/metro) + LED mode OK');

// ---- LED details + colored metro badges + dir filter ----
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
sandbox.__APP_DEBUG__.setStopMode('led');
const ledHtml2 = els['#stop-section'].innerHTML;
if (ledHtml2.indexOf('led-arrow') >= 0) { throw new Error('LED should not contain arrows'); }
if (ledHtml2.indexOf('led-badge-stack') < 0) { throw new Error('LED badge stack missing'); }
if (ledHtml2.indexOf('background:#') < 0) { throw new Error('LED metro badges should be line-colored'); }
const near11 = sandbox.__APP_DEBUG__.metroNear('BV10017755');
if (!near11.length || !(near11[0].lines || []).length) { throw new Error('metro feeder line info missing'); }
sandbox.__APP_DEBUG__.setStopMode('chips');
sandbox.__APP_DEBUG__.selectRouteByNum('218路', 'bus');
sandbox.__APP_DEBUG__.setStopMode('led');
if (els['#stop-section'].innerHTML.indexOf('（潭村）') < 0) { throw new Error('LED paren stop should keep brackets'); }
sandbox.__APP_DEBUG__.setStopMode('chips');
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
sandbox.__APP_DEBUG__.setDirFilter(false, true);
const fHtml = els['#stop-section'].innerHTML;
if (fHtml.indexOf('停靠站点 · A方向（') >= 0 || fHtml.indexOf('停靠站点 · B方向（') < 0) {
  throw new Error('dir filter should hide A direction section');
}
const hDirs = sandbox.__APP_DEBUG__.getHighlightDirs();
if (hDirs.join(',') !== 'B') { throw new Error('highlight should only contain B, got ' + hDirs.join(',')); }
sandbox.__APP_DEBUG__.setDirFilter(true, true);
console.log('LED details + colored metro badges + dir filter OK');

// ---- stop name labels on map ----
sandbox.__APP_DEBUG__.selectRouteByNum('B11路', 'bus');
const lblChk = els['#stop-labels'];
if (!lblChk) { throw new Error('stop label toggle missing'); }
const ovChk2 = els['#stop-overlay'];
ovChk2.checked = true;
ovChk2.handlers.change();
lblChk.checked = true;
lblChk.handlers.change();
const lblInfo = sandbox.__APP_DEBUG__.getLabels();
if (lblInfo.total < 20) { throw new Error('label count too low: ' + lblInfo.total); }
if (lblInfo.black < 1) { throw new Error('both-direction black labels missing'); }
lblChk.checked = false;
lblChk.handlers.change();
if (sandbox.__APP_DEBUG__.getLabels().total !== 0) { throw new Error('labels should clear when toggled off'); }
console.log('stop name labels OK (' + lblInfo.total + ' labels, ' + lblInfo.black + ' black)');

// ---- data sanity ----
const r527 = Object.keys(sandbox.BUS_ROUTE_STOPS).find(k => k.startsWith('527路(广州白云站'));
if (!r527 || sandbox.BUS_ROUTE_STOPS[r527].length < 30) { throw new Error('527 route stops missing'); }
if (!(sandbox.STOP_ROUTES['BV10016241'] || []).includes('B5路')) { throw new Error('stop_routes missing B5'); }
console.log('route-stop data keys OK; 527 stops:', sandbox.BUS_ROUTE_STOPS[r527].length);

// ---- basemap param (OSM entry) ----
function runApp(locationSearch) {
  const s = { window: {}, document, L, console, location: { search: locationSearch } };
  s.window = s;
  s.__APP_DEBUG__ = true;
  vm.createContext(s);
  fs.readdirSync(dataDir).filter(f => f.endsWith('.js')).forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(dataDir, f), 'utf-8'), s, { filename: f });
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf-8'), s, { filename: 'app.js' });
  return s;
}
const s2 = runApp('?basemap=osm');
if (s2.__APP_DEBUG__.getBasemap() !== 'osm') { throw new Error('osm param not applied'); }
if (s2.__APP_DEBUG__.getSpace() !== 'wgs84') { throw new Error('osm should use wgs84 space'); }
console.log('OSM entry (?basemap=osm) OK');

console.log('SMOKE TEST PASSED');
