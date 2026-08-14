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
    clearLayers() { return this; },
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
assertFeats(first[2], 2612, 'LineString', f => !!f.properties.route_cn);
assertFeats(first[3], 69, 'LineString', f => /^B\d/.test(f.properties.route_cn));
console.log('layer data correctness OK (metro routes/stops, bus routes, BRT)');
console.log('bus stop cluster markers:', clusterMarkerCount, '(expect 10143)');
if (clusterMarkerCount !== 10143) { throw new Error('bus stop cluster marker count mismatch'); }

// ---- tab switching ----
fire(tabEls[1], 'click'); // 图层
if (!bodyEls[1].classList.contains('active')) { throw new Error('tab layers not activated'); }
fire(tabEls[2], 'click'); // 说明
if (!bodyEls[2].classList.contains('active')) { throw new Error('tab about not activated'); }
if (bodyEls[0].classList.contains('active')) { throw new Error('tab search should be inactive'); }
console.log('tab switching OK');

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
