// 用车来了最新走向更新已确认改线的线路（停靠表 + 线路几何 + 元数据）
// 备份旧数据至 output/network/backup_20260816_route_updates/
import fs from 'node:fs';
import vm from 'node:vm';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;
const OUT_DIR = `${ROOT}/output/network`;
const BK_DIR = `${OUT_DIR}/backup_20260816_route_updates`;
fs.mkdirSync(BK_DIR, { recursive: true });

// ---------- 车来了客户端 ----------
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
async function lineRoute(lineId) {
  return apiGet(`${BASE_URL}/bus/line!lineRoute.action`, {
    ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', lineId,
  });
}
async function lineDetailFresh(lineId) {
  return apiGet(`${BASE_URL}/bus/line!encryptedLineDetail.action`, {
    ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', lineId,
    lat: '', lng: '', geo_lat: '', geo_lng: '',
  });
}

// ---------- 数据加载 ----------
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
const FIXES = JSON.parse(fs.readFileSync(`${ROOT}/data/chelaile_platform_fixes.js`, 'utf-8')
  .replace(/^window\.CHELAILE_PLATFORM_FIXES = /, '').replace(/;\s*$/, ''));

const rawByBase = new Map();
for (const f of fs.readdirSync(RAW_DIR)) {
  if (!f.endsWith('.json')) continue;
  try {
    const r = JSON.parse(fs.readFileSync(`${RAW_DIR}/${f}`, 'utf-8'));
    rawByBase.set(r.base, r);
  } catch { /* skip */ }
}

// ---------- 站名工具 ----------
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
function distM(a, b) {
  const lat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  return Math.sqrt(((b[0] - a[0]) * 111320 * Math.cos(lat)) ** 2 + ((b[1] - a[1]) * 111320) ** 2);
}
function polyLen(coords) {
  let s = 0;
  for (let i = 0; i < coords.length - 1; i++) s += distM(coords[i], coords[i + 1]);
  return s / 1000;
}
function nearestOnLineDist(p, coords) {
  const sx = Math.cos((p[1] * Math.PI) / 180) || 1;
  const px = p[0] * sx, py = p[1];
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * sx, ay = coords[i][1];
    const bx = coords[i + 1][0] * sx, by = coords[i + 1][1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.sqrt(((px - cx) / sx) ** 2 + (py - cy) ** 2) * 111320;
    if (d < best) best = d;
  }
  return best;
}

// 待核实/排除名单（复合线路名、车来了数据可疑）
const EXCLUDE = new Set([
  '37路/南37路', '40路/南40路', '番92路/番92路',
  '从901路', '从902路', '从907路', '从911路',
  '增城16路', '增城53路', '番63路', '番155路',
]);

// ---------- 确认待更新线路 ----------
const compare = fs.readFileSync(`${OUT_DIR}/线路调整对比_车来了.csv`, 'utf-8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(',')[0]);
const lines = compare.filter((n) => n && !EXCLUDE.has(n));
console.log(`确认更新 ${lines.length} 条线路：`);
console.log(lines.join('、'));

// ---------- 备份 ----------
for (const f of ['bus_route_stops.js', 'bus_routes.js', 'bus_stops.js', 'stop_routes.js', 'network_graph.js']) {
  fs.copyFileSync(`${ROOT}/data/${f}`, `${BK_DIR}/${f}`);
}
fs.writeFileSync(`${BK_DIR}/更新线路清单.txt`, lines.join('\r\n'), 'utf-8');

// ---------- 站点映射 ----------
const busStopsNew = JSON.parse(JSON.stringify(BUS_STOPS_OBJ));
let newStationCounter = 1;
function mapStation(st) {
  const n = normName(st.sn);
  let best = null, bestD = Infinity;
  for (const f of busStopsNew.features) {
    const fn = normName(f.properties.name_cn);
    const d = distM(f.geometry.coordinates, [st.wgsLng, st.wgsLat]);
    if (fn === n && d < bestD) { bestD = d; best = f; }
  }
  if (best && bestD <= 300) {
    return { name: best.properties.name_cn, id: best.properties.stop_id };
  }
  // 无同名，找最近站
  best = null; bestD = Infinity;
  for (const f of busStopsNew.features) {
    const d = distM(f.geometry.coordinates, [st.wgsLng, st.wgsLat]);
    if (d < bestD) { bestD = d; best = f; }
  }
  if (best && bestD <= 300) {
    return { name: best.properties.name_cn, id: best.properties.stop_id };
  }
  // 新建站点
  const id = `CL${100000 + newStationCounter++}`;
  busStopsNew.features.push({
    type: 'Feature',
    properties: { stop_id: id, name_cn: st.sn, name_en: '', num_routes: 0, city_cn: '广州', source: 'chelaile' },
    geometry: { type: 'Point', coordinates: [st.wgsLng, st.wgsLat] },
  });
  return { name: st.sn, id };
}

// ---------- 执行更新 ----------
const routeStopsNew = JSON.parse(JSON.stringify(BUS_ROUTE_STOPS));
const routesNew = JSON.parse(JSON.stringify(BUS_ROUTES));
const report = [];
let totalReplaced = 0;
const stopByIdMap = new Map(busStopsNew.features.map((f) => [f.properties.stop_id, f.geometry.coordinates]));

for (const line of lines) {
  const raw = rawByBase.get(line);
  if (!raw || raw.status !== 'found' || !raw.details) { report.push(`${line}\t跳过\t无车来了详情`); continue; }
  const chDirs = Object.values(raw.details).filter((d) => d?.stations?.length >= 2);
  if (!chDirs.length) { report.push(`${line}\t跳过\t车来了站点为空`); continue; }

  const oldKeys = Object.keys(routeStopsNew).filter((k) => k.split('(')[0] === line);
  const newKeys = [];
  const newRoutes = [];

  for (const d of chDirs) {
    const lineId = d.line?.lineId || Object.keys(raw.details).find((k) => raw.details[k] === d);
    let detail = d;
    try {
      const fresh = await lineDetailFresh(lineId);
      if (fresh?.stations?.length >= 2) {
        detail = {
          line: fresh.line ? {
            lineId: fresh.line.lineId, name: fresh.line.name, direction: fresh.line.direction,
            startSn: fresh.line.startSn, endSn: fresh.line.endSn, stationsNum: fresh.line.stationsNum,
            firstTime: fresh.line.firstTime, lastTime: fresh.line.lastTime, price: fresh.line.price,
          } : d.line,
          stations: fresh.stations.map((st) => ({ sn: st.sn, wgsLat: st.wgsLat, wgsLng: st.wgsLng })),
        };
      }
    } catch { /* 用原始数据兜底 */ }
    const mapped = detail.stations.map((st) => ({ st, ...mapStation(st) }));
    const sName = mapped[0].name;
    const eName = mapped[mapped.length - 1].name;
    const newKey = `${line}(${sName}--${eName})`;
    if (newKeys.includes(newKey)) continue;
    const stops = mapped.map((m, i) => [i + 1, m.name, m.id]);
    newKeys.push(newKey);
    routeStopsNew[newKey] = stops;

    // 几何：优先车来了轨迹，失败则用站点坐标连线
    let geom = null;
    try {
      const rt = await lineRoute(lineId);
      if (rt?.route?.length >= 2) geom = rt.route.map((p) => [p.lng, p.lat]);
    } catch { /* fallback */ }
    if (!geom) {
      geom = mapped.map((m) => [m.st.wgsLng, m.st.wgsLat]);
      // 环线/掉头折返时补一个回到起点的点，让折线闭合
      if (sName === eName && mapped.length > 2) geom.push(geom[0]);
    }
    // 映射站台离新走向较远的，加入显示修正层（用真实车来了坐标）
    if (!FIXES[newKey]) FIXES[newKey] = [];
    for (const m of mapped) {
      const bvCoord = stopByIdMap.get(m.id);
      if (!bvCoord || bvCoord[0] === m.st.wgsLng) continue; // 新建站或坐标一致
      if (nearestOnLineDist(bvCoord, geom) > 100) {
        FIXES[newKey].push([m.name, m.st.wgsLng, m.st.wgsLat]);
      }
    }
    if (!FIXES[newKey].length) delete FIXES[newKey];

    const firstTime = (detail.line?.firstTime || '').replace(':', '');
    const lastTime = (detail.line?.lastTime || '').replace(':', '');
    const price = (detail.line?.price || '').match(/\d+(\.\d+)?/)?.[0] || '';
    const oldFeature = oldKeys.map((k) => routesNew.features.find((f) => f.properties.route_cn === k)).find(Boolean);
    newRoutes.push({
      type: 'Feature',
      properties: {
        ...(oldFeature?.properties || {}),
        route_cn: newKey,
        s_stop_cn: sName,
        e_stop_cn: eName,
        distance_km: Math.round(polyLen(geom) * 100) / 100,
        length_km: Math.round(polyLen(geom) * 100) / 100,
        total_stop: stops.length,
        start_time: firstTime || oldFeature?.properties?.start_time || '',
        end_time: lastTime || oldFeature?.properties?.end_time || '',
        loop: sName === eName ? '1' : '0',
        status: '1',
        status_label: '运营',
        basic_prc: price || oldFeature?.properties?.basic_prc || '',
        total_prc: price || oldFeature?.properties?.total_prc || '',
      },
      geometry: { type: 'LineString', coordinates: geom },
    });
  }

  for (const k of oldKeys) {
    if (!newKeys.includes(k)) delete routeStopsNew[k];
  }
  routesNew.features = routesNew.features.filter((f) => !oldKeys.includes(f.properties.route_cn) || newKeys.includes(f.properties.route_cn));
  routesNew.features.push(...newRoutes);
  const oldInfo = oldKeys.map((k) => `${k}(${routeStopsNew[k]?.length ?? BUS_ROUTE_STOPS[k]?.length}站)`).join(' / ');
  report.push(`${line}\t${oldInfo}\t→\t${newKeys.map((k) => `${k}(${routeStopsNew[k].length}站)`).join(' / ')}`);
  totalReplaced += oldKeys.length;
}

// ---------- 清理失效的显示修正层 ----------
for (const k of Object.keys(FIXES)) {
  if (!routeStopsNew[k]) delete FIXES[k];
}

// ---------- 重建 stop_routes ----------
const stopRoutesNew = {};
for (const cn of Object.keys(routeStopsNew)) {
  const base = cn.split('(')[0];
  for (const st of routeStopsNew[cn]) {
    (stopRoutesNew[st[2]] = stopRoutesNew[st[2]] || new Set()).add(base);
  }
}
const stopRoutesOut = {};
for (const k of Object.keys(stopRoutesNew)) stopRoutesOut[k] = [...stopRoutesNew[k]].sort();

// ---------- 写回 ----------
function writeJs(file, name, obj) {
  fs.writeFileSync(file, `window.${name} = ` + JSON.stringify(obj) + ';\n', 'utf-8');
}
writeJs(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS', routeStopsNew);
writeJs(`${ROOT}/transit_site/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS', routeStopsNew);
writeJs(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES', routesNew);
writeJs(`${ROOT}/transit_site/data/bus_routes.js`, 'BUS_ROUTES', routesNew);
writeJs(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS', busStopsNew);
writeJs(`${ROOT}/transit_site/data/bus_stops.js`, 'BUS_STOPS', busStopsNew);
writeJs(`${ROOT}/data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
writeJs(`${ROOT}/transit_site/data/stop_routes.js`, 'STOP_ROUTES', stopRoutesOut);
writeJs(`${ROOT}/data/chelaile_platform_fixes.js`, 'CHELAILE_PLATFORM_FIXES', FIXES);
writeJs(`${ROOT}/transit_site/data/chelaile_platform_fixes.js`, 'CHELAILE_PLATFORM_FIXES', FIXES);

// ---------- 报告与校验 ----------
fs.writeFileSync(`${OUT_DIR}/线路更新_车来了.csv`, '\uFEFF' + ['线路', '旧记录', '新记录'].join(',') + '\r\n' + report.map((r) => r.replace(/\t/g, ',')).join('\r\n') + '\r\n', 'utf-8');
console.log(`\n更新完成：处理 ${totalReplaced} 个旧方向记录`);
console.log('新增站点数：', newStationCounter - 1);
console.log('线路更新明细（前25条）：');
report.slice(0, 25).forEach((r) => console.log('  ' + r));

// 校验
const checkStops = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const checkRoutes = loadJsGlobal(`${ROOT}/data/bus_routes.js`, 'BUS_ROUTES');
const checkStations = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const ids = new Set(checkStations.features.map((f) => f.properties.stop_id));
let badRef = 0, dupKey = 0;
const seen = new Set();
for (const k of Object.keys(checkStops)) {
  if (seen.has(k)) dupKey++;
  seen.add(k);
  for (const st of checkStops[k]) if (!ids.has(st[2])) badRef++;
}
const routeKeys = new Set(checkRoutes.features.map((f) => f.properties.route_cn));
console.log(`校验：方向记录 ${Object.keys(checkStops).length}，坏站点引用 ${badRef}，重复键 ${dupKey}，线路几何 ${checkRoutes.features.length}（缺失几何 ${Object.keys(checkStops).filter((k) => !routeKeys.has(k)).length}）`);
