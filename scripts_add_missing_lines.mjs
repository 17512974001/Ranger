// 补充源数据缺失的线路（110路、113路）：从车来了抓取并加入线网
// 用法: node scripts_add_missing_lines.mjs 110 113
import fs from 'node:fs';
import vm from 'node:vm';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;

const BASE_DOMAIN = 'https://web.chelaile.net.cn';
const BASE_URL = `${BASE_DOMAIN}/api`;
const SIGN_SALT = 'qwihrnbtmj';
const AES_KEY = 'FF32AE65FBFD19414EAAFF6291A54B42';
const DEFAULT_PARAMS = {
  s: 'h5', wxs: 'wx_app', sign: '1', h5RealData: '1', v: '3.11.28',
  src: 'weixinapp_cx', ctm_mp: 'mp_wx', vc: '2', favoriteGray: '1',
  gpstype: 'wgs', geo_type: 'wgs', scene: '1256',
};
const REQUEST_HEADERS = {
  Host: 'web.chelaile.net.cn', Connection: 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254160a) XWEB/18055',
  xweb_xhr: '1', 'Content-Type': 'text', Accept: '*/*',
  'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  Referer: 'https://servicewechat.com/wx71d589ea01ce3321/814/page-frame.html',
  'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'zh-CN,zh;q=0.9',
};
function cryptoSign(params) {
  const str = Object.entries(params).map(([k, v]) => `"${k}"="${v}"`).join('&') + SIGN_SALT;
  return crypto.createHash('md5').update(str).digest('hex');
}
function decryptResult(ciphertext) {
  const key = Buffer.from(AES_KEY, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  let out = decipher.update(ciphertext, 'base64', 'utf8');
  out += decipher.final('utf8');
  return out;
}
function parseEnvelope(raw) {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) throw new Error('not JSON');
  let depth = 0, jsonEnd = jsonStart;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') depth--;
    if (depth === 0) { jsonEnd = i + 1; break; }
  }
  const envelope = JSON.parse(raw.substring(jsonStart, jsonEnd));
  const data = envelope.jsonr?.data;
  if (!data) throw new Error('missing jsonr.data');
  if (data.encryptResult) return JSON.parse(decryptResult(data.encryptResult));
  return data;
}
function decompress(buf, encoding) {
  if (encoding === 'br') return zlib.brotliDecompressSync(buf);
  if (encoding === 'gzip') return zlib.gunzipSync(buf);
  if (encoding === 'deflate') return zlib.inflateSync(buf);
  return buf;
}
function rawGet(url) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname, port: u.port || 443,
      path: u.pathname + (u.search || ''), method: 'GET',
      headers: REQUEST_HEADERS, timeout: 25000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(decompress(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf-8')); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
async function apiGet(url, params, attempt = 1) {
  try {
    const signed = { ...params, cryptoSign: cryptoSign(params) };
    const u = new URL(url);
    u.search = new URLSearchParams(signed).toString();
    return parseEnvelope(await rawGet(u));
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 700 * attempt));
      return apiGet(url, params, attempt + 1);
    }
    throw e;
  }
}
async function search(key) {
  return apiGet(`${BASE_URL}/bus/query!nSearch.action`, {
    ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', key, supportPhyStn: 'true',
  });
}
async function lineDetail(lineId) {
  return apiGet(`${BASE_URL}/bus/line!encryptedLineDetail.action`, {
    ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', lineId,
    lat: '', lng: '', geo_lat: '', geo_lng: '',
  });
}
async function lineRoute(lineId) {
  return apiGet(`${BASE_URL}/bus/line!lineRoute.action`, {
    ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', lineId,
  });
}

function loadJsGlobal(file, globalName) {
  const s = { window: {} };
  s.window = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, 'utf-8'), s, { filename: file });
  return s.window[globalName];
}
const BUS_ROUTE_STOPS = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const BUS_STOPS_OBJ = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const BUS_ROUTES = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');

function normKey(n) {
  return String(n || '')
    .replace(/公共汽车/g, '')
    .replace(/BRT/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, '')
    .replace(/\d+$/g, '')
    .replace(/(停东行|停西行|停南行|停北行|东行|西行|南行|北行)$/g, '')
    .replace(/(总站|首末站|站|分站)$/g, '')
    .replace(/\s+/g, '')
    .trim();
}
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
function polyLen(coords) {
  let s = 0;
  for (let i = 0; i < coords.length - 1; i++) s += distM(coords[i], coords[i + 1]);
  return s / 1000;
}

const busStopsNew = JSON.parse(JSON.stringify(BUS_STOPS_OBJ));
let newStationCounter = 1;
function mapStation(st) {
  const nk = normKey(st.sn);
  let best = null, bestD = Infinity;
  for (const f of busStopsNew.features) {
    if (normKey(f.properties.name_cn) !== nk) continue;
    const d = distM(f.geometry.coordinates, [st.wgsLng, st.wgsLat]);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (best && bestD <= 300) return { name: best.properties.name_cn, id: best.properties.stop_id };
  best = null; bestD = Infinity;
  for (const f of busStopsNew.features) {
    const d = distM(f.geometry.coordinates, [st.wgsLng, st.wgsLat]);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (best && bestD <= 300) return { name: best.properties.name_cn, id: best.properties.stop_id };
  const id = `CL${200000 + newStationCounter++}`;
  busStopsNew.features.push({
    type: 'Feature',
    properties: { stop_id: id, name_cn: st.sn, name_en: '', num_routes: 0, city_cn: '广州', source: 'chelaile' },
    geometry: { type: 'Point', coordinates: [st.wgsLng, st.wgsLat] },
  });
  return { name: st.sn, id };
}

const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));
const routesNew = JSON.parse(JSON.stringify(BUS_ROUTES));
const report = [];

for (const key of process.argv.slice(2)) {
  const base = `${key}路`;
  if (Object.keys(routeStopsNew).some((k) => k.split('(')[0] === base)) {
    report.push(`${base}\t已存在，跳过`);
    continue;
  }
  const s = await search(key);
  const lines = (s?.result?.lines || []).filter((l) => l.name === key || l.name === `${key}路`);
  if (!lines.length) { report.push(`${base}\t车来了未找到`); continue; }
  const newKeys = [];
  for (const ln of lines) {
    if (ln.isSubway) continue;
    const d = await lineDetail(ln.lineId);
    if (!d?.stations?.length) continue;
    const mapped = d.stations.map((st) => ({ st, ...mapStation(st) }));
    const sName = mapped[0].name;
    const eName = mapped[mapped.length - 1].name;
    const newKey = `${base}(${sName}--${eName})`;
    if (newKeys.includes(newKey)) continue;
    const stops = mapped.map((m, i) => [i + 1, m.name, m.id]);
    newKeys.push(newKey);
    routeStopsNew[newKey] = stops;
    let geom = null;
    try {
      const rt = await lineRoute(ln.lineId);
      if (rt?.route?.length >= 2) geom = rt.route.map((p) => [p.lng, p.lat]);
    } catch { /* fallback */ }
    if (!geom) {
      geom = mapped.map((m) => [m.st.wgsLng, m.st.wgsLat]);
      if (sName === eName && mapped.length > 2) geom.push(geom[0]);
    }
    routesNew.features.push({
      type: 'Feature',
      properties: {
        route_cn: newKey, route_en: '', route_type: '普通公交', route_type_en: 'Regular buses',
        company_cn: '', s_stop_cn: sName, e_stop_cn: eName,
        distance_km: Math.round(polyLen(geom) * 100) / 100,
        length_km: Math.round(polyLen(geom) * 100) / 100,
        total_stop: stops.length,
        start_time: (d.line?.firstTime || '').replace(':', ''),
        end_time: (d.line?.lastTime || '').replace(':', ''),
        loop: sName === eName ? '1' : '0',
        status: '1', status_label: '运营',
        basic_prc: (d.line?.price || '').match(/\d+(\.\d+)?/)?.[0] || '',
        total_prc: (d.line?.price || '').match(/\d+(\.\d+)?/)?.[0] || '',
        city_cn: '广州',
      },
      geometry: { type: 'LineString', coordinates: geom },
    });
  }
  report.push(`${base}\t新增 ${newKeys.map((k) => `${k}(${routeStopsNew[k].length}站)`).join(' / ')}`);
}

// 重建 stop_routes
const stopRoutesNew = {};
for (const cn of Object.keys(routeStopsNew)) {
  const base = cn.split('(')[0];
  for (const st of routeStopsNew[cn]) {
    (stopRoutesNew[st[2]] = stopRoutesNew[st[2]] || new Set()).add(base);
  }
}
const stopRoutesOut = {};
for (const k of Object.keys(stopRoutesNew)) stopRoutesOut[k] = [...stopRoutesNew[k]].sort();

function writeJs(file, name, obj) {
  fs.writeFileSync(file, `window.${name} = ` + JSON.stringify(obj) + ';\n', 'utf-8');
}
for (const sub of ['', 'transit_site/']) {
  writeJs(`${ROOT}/${sub}data/bus_route_stops.js`, 'BUS_ROUTE_STOPS', routeStopsNew);
  writeJs(`${ROOT}/${sub}data/bus_routes.js`, 'BUS_ROUTES', routesNew);
  writeJs(`${ROOT}/${sub}data/bus_stops.js`, 'BUS_STOPS', busStopsNew);
  writeJs(`${ROOT}/${sub}data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
}
fs.writeFileSync(`${ROOT}/output/network/线路补充_车来了.csv`, '\uFEFF' + report.join('\r\n'), 'utf-8');
console.log(report.join('\n'));
console.log('新增站点数：', newStationCounter - 1);
