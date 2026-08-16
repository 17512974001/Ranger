// 为指定线路号抓取车来了原始数据并存入 chelaile_raw（用于补线后管线一致）
// 用法: node scripts_fetch_lines_raw.mjs 110 113
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;
const MANIFEST = `${RAW_DIR}/_manifest.jsonl`;
fs.mkdirSync(RAW_DIR, { recursive: true });

const BASE_URL = 'https://web.chelaile.net.cn/api';
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
  let depth = 0, jsonEnd = jsonStart;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') depth--;
    if (depth === 0) { jsonEnd = i + 1; break; }
  }
  const envelope = JSON.parse(raw.substring(jsonStart, jsonEnd));
  const data = envelope.jsonr?.data;
  if (data?.encryptResult) return JSON.parse(decryptResult(data.encryptResult));
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
async function apiGet(url, params) {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  return parseEnvelope(await rawGet(u));
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

const manifest = fs.readFileSync(MANIFEST, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
let nextIdx = Math.max(...manifest.map((m) => m.idx), 0) + 1;

for (const key of process.argv.slice(2)) {
  const base = `${key}路`;
  if (manifest.some((m) => m.base === base)) { console.log(`${base} 已有缓存，跳过`); continue; }
  const s = await search(key);
  const lines = (s?.result?.lines || []).filter((l) => l.name === key || l.name === `${key}路`);
  const rec = { base, keys: [key], status: lines.length ? 'found' : 'missing', foundLines: [], details: {} };
  for (const ln of lines) {
    if (ln.isSubway) continue;
    const d = await lineDetail(ln.lineId);
    rec.foundLines.push({ name: ln.name, lineId: ln.lineId, direction: ln.direction, startSn: ln.startSn, endSn: ln.endSn, isSubway: ln.isSubway });
    rec.details[ln.lineId] = {
      line: d.line ? { lineId: d.line.lineId, name: d.line.name, direction: d.line.direction, startSn: d.line.startSn, endSn: d.line.endSn, stationsNum: d.line.stationsNum, firstTime: d.line.firstTime, lastTime: d.line.lastTime, price: d.line.price } : null,
      stations: (d.stations || []).map((st) => ({ order: st.order, sId: st.sId, sn: st.sn, wgsLat: st.wgsLat, wgsLng: st.wgsLng, physicalStId: st.physicalStId, namesakeStId: st.namesakeStId })),
    };
  }
  fs.writeFileSync(`${RAW_DIR}/${nextIdx}.json`, JSON.stringify(rec), 'utf-8');
  fs.appendFileSync(MANIFEST, JSON.stringify({ idx: nextIdx, base, status: rec.status, keys: rec.keys }) + '\r\n', 'utf-8');
  console.log(`${base} -> ${nextIdx}.json [${rec.status}]`);
  nextIdx++;
}
