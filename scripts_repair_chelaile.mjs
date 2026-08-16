// 修复 chelaile_raw：校验 manifest 与文件一致性，重抓缺失/错位的线路
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
const RAW_DIR = `${ROOT}/data/chelaile_raw`;
const MANIFEST = `${RAW_DIR}/_manifest.jsonl`;

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
function normalizeKey(raw) {
  return raw
    .replace(/路(班车|短线|快线|高峰线|区间|旅游专线)?$/, '')
    .replace(/班车$/, '')
    .replace(/旅游专线$/, '')
    .trim();
}

// 1) 校验
const manifest = fs.readFileSync(MANIFEST, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
const bad = [];
for (const m of manifest) {
  const fp = `${RAW_DIR}/${m.idx}.json`;
  if (!fs.existsSync(fp)) { bad.push(m.base); continue; }
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    if (j.base !== m.base) bad.push(m.base);
  } catch { bad.push(m.base); }
}
console.log('校验完成，错位/缺失线路:', bad.length, bad.slice(0, 20).join(', '));

// 2) 重抓
let newIdx = Math.max(...manifest.map((m) => m.idx), 0) + 1;
for (const base of bad) {
  const rec = { base, searchedAt: new Date().toISOString(), keys: base.split('/').map(normalizeKey).filter(Boolean), foundLines: [], status: 'missing' };
  try {
    for (const key of rec.keys) {
      const s = await search(key);
      const rawLines = s?.result?.lines || [];
      const exact = rawLines.filter((l) => l.name === key || l.name === `${key}路`);
      const lines = exact.length ? exact : rawLines.filter((l) => l.name.includes(key) || key.includes(l.name));
      if (lines.length) {
        rec.foundLines.push(...lines.map((l) => ({ name: l.name, lineId: l.lineId, direction: l.direction, startSn: l.startSn, endSn: l.endSn, isSubway: l.isSubway })));
        rec.status = 'found';
        break;
      }
    }
    if (rec.status === 'found') {
      rec.details = {};
      for (const ln of rec.foundLines) {
        if (ln.isSubway) continue;
        try {
          const d = await lineDetail(ln.lineId);
          rec.details[ln.lineId] = {
            line: d.line ? { lineId: d.line.lineId, name: d.line.name, direction: d.line.direction, startSn: d.line.startSn, endSn: d.line.endSn, stationsNum: d.line.stationsNum } : null,
            stations: (d.stations || []).map((st) => ({ order: st.order, sId: st.sId, sn: st.sn, wgsLat: st.wgsLat, wgsLng: st.wgsLng, physicalStId: st.physicalStId, namesakeStId: st.namesakeStId })),
          };
        } catch { /* skip */ }
      }
    }
  } catch (e) {
    rec.status = 'error';
    rec.error = e.message;
  }
  fs.writeFileSync(`${RAW_DIR}/${newIdx}.json`, JSON.stringify(rec), 'utf-8');
  fs.appendFileSync(MANIFEST, JSON.stringify({ idx: newIdx, base, status: rec.status, keys: rec.keys }) + '\r\n', 'utf-8');
  console.log(`重抓 ${base} -> ${newIdx}.json [${rec.status}]`);
  newIdx++;
}
console.log('修复完成');
