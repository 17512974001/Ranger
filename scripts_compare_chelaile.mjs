// 对比脚本：车来了(chelaile) 线路上下行站点坐标 vs 本地数据
// 用法: node scripts_compare_chelaile.mjs <线路名，如 566> [附加线路名...]
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const OUT = `${ROOT}/output/network/chelaile_test`;
fs.mkdirSync(OUT, { recursive: true });

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
        try {
          resolve({ body: decompress(Buffer.concat(chunks), res.headers['content-encoding']).toString('utf-8') });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}
async function request(url, params) {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  return parseEnvelope((await rawGet(u)).body);
}

function loadJsGlobal(file, globalName) {
  const code = fs.readFileSync(file, 'utf8');
  const fn = new Function('window', `${code}\n;return window.${globalName};`);
  return fn({});
}

// 本地数据
const routeStops = loadJsGlobal(`${ROOT}/data/bus_route_stops.js`, 'BUS_ROUTE_STOPS');
const stopGeo = loadJsGlobal(`${ROOT}/data/bus_stops.js`, 'BUS_STOPS');
const stopById = new Map();
for (const f of stopGeo.features) {
  stopById.set(f.properties.stop_id, {
    name: f.properties.name_cn,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  });
}

function localRouteKeys(name) {
  const prefix = name.endsWith('路') ? name : `${name}路`;
  const keys = Object.keys(routeStops).filter((k) => {
    const base = k.split('(')[0];
    return base === prefix;
  });
  return keys;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchLineDetail(cityId, lineId) {
  return request(`${BASE_URL}/bus/line!encryptedLineDetail.action`, {
    ...DEFAULT_PARAMS, cityId, localCityId: cityId, lineId,
    lat: '', lng: '', geo_lat: '', geo_lng: '',
  });
}

const lines = process.argv.slice(2);
const cityId = '040';

if (process.argv[2] === '--coverage') {
  const names = process.argv.slice(3);
  for (const name of names) {
    try {
      const s = await request(`${BASE_URL}/bus/query!nSearch.action`, {
        ...DEFAULT_PARAMS, cityId, localCityId: cityId, key: name, supportPhyStn: 'true',
      });
      const allLines = s?.result?.lines || [];
      console.log(`${name}: ${allLines.length ? allLines.map((l) => `${l.name}(${l.startSn}→${l.endSn})`).join(' | ') : '未找到'}`);
    } catch (e) {
      console.log(`${name}: 错误 ${e.message}`);
    }
  }
  process.exit(0);
}

for (const name of lines) {
  console.log(`\n========== ${name} ==========`);
  const localKeys = localRouteKeys(name);
  console.log('[本地] 方向记录:', localKeys.length);
  for (const k of localKeys) {
    const stops = routeStops[k];
    const list = stops.map(([order, sn, id]) => ({ order, sn, id, ...(stopById.get(id) || {}) }));
    console.log(`  ${k} (${stops.length}站)`);
    for (const s of list) {
      const mark = /云埔工业区|林和西/.test(s.sn) ? '  <== 关注' : '';
      console.log(`    ${String(s.order).padStart(2)} ${s.sn}  ${s.id}  ${s.lat?.toFixed(6)},${s.lng?.toFixed(6)}${mark}`);
    }
  }

  // 车来了
  try {
    const s = await request(`${BASE_URL}/bus/query!nSearch.action`, {
      ...DEFAULT_PARAMS, cityId, localCityId: cityId, key: name, supportPhyStn: 'true',
    });
    const allLines = s?.result?.lines || [];
    if (!allLines.length) {
      console.log('[车来了] 搜索无线路结果');
      continue;
    }
    console.log('[车来了] 搜索返回线路:', allLines.map((l) => `${l.name}(${l.startSn}→${l.endSn})`).join(' | '));
    const found = allLines.filter(
      (l) => String(l.name) === String(name) || String(l.name) === `${name}路`,
    );
    if (!found.length) {
      console.log('[车来了] 未找到该线路');
      continue;
    }
    for (const ln of found) {
      const d = await fetchLineDetail(cityId, ln.lineId);
      fs.writeFileSync(`${OUT}/${name}_dir${ln.direction}.json`, JSON.stringify(d, null, 2));
      const stations = (d.stations || []).map((st) => ({
        order: st.order, sn: st.sn, sId: st.sId,
        physicalStId: st.physicalStId, namesakeStId: st.namesakeStId,
        wgsLat: st.wgsLat, wgsLng: st.wgsLng,
      }));
      console.log(`[车来了] ${ln.name} dir=${ln.direction} ${ln.startSn} → ${ln.endSn} (${d.line?.stationsNum}站)`);
      for (const st of stations) {
        const mark = /云埔工业区|林和西/.test(st.sn) ? '  <== 关注' : '';
        console.log(`    ${String(st.order).padStart(2)} ${st.sn}  ${st.sId}  ${st.wgsLat?.toFixed(6)},${st.wgsLng?.toFixed(6)}${mark}`);
      }
    }
  } catch (e) {
    console.log('[车来了] 错误:', e.message);
  }
}

// 交叉对比：本地与车来了在“关注站”的坐标差
console.log('\n========== 关注站坐标对比 ==========');
for (const name of lines) {
  for (const k of localRouteKeys(name)) {
    const stops = routeStops[k];
    for (const [order, sn, id] of stops) {
      if (!/云埔工业区|林和西/.test(sn)) continue;
      const loc = stopById.get(id);
      const files = fs.readdirSync(OUT).filter((f) => f.startsWith(`${name}_dir`) && f.endsWith('.json'));
      for (const f of files) {
        const d = JSON.parse(fs.readFileSync(`${OUT}/${f}`, 'utf8'));
        const st = (d.stations || []).find((x) => x.sn === sn);
        if (st && loc) {
          const dist = haversine(loc.lat, loc.lng, st.wgsLat, st.wgsLng).toFixed(0);
          console.log(`${k} | ${sn} 本地(${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}) vs 车来了dir${f.match(/dir(\d)/)[1]}(${st.wgsLat.toFixed(6)},${st.wgsLng.toFixed(6)}) 差${dist}m`);
        }
      }
    }
  }
}
