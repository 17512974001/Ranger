// 严格复核车来了抓取结果：精确线路名匹配，纠正此前"包含匹配"造成的污染
// 产物：更新 data/chelaile_raw/*.json 与 _manifest.jsonl
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
const CONCURRENCY = 4;

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
async function apiGet(url, params, attempt = 1) {
  try {
    const signed = { ...params, cryptoSign: cryptoSign(params) };
    const u = new URL(url);
    u.search = new URLSearchParams(signed).toString();
    return parseEnvelope(await rawGet(u));
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 600 * attempt));
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

function normalizeKey(raw) {
  return raw
    .replace(/路(班车|短线|快线|高峰线|区间|旅游专线)?$/, '')
    .replace(/班车$/, '')
    .replace(/旅游专线$/, '')
    .trim();
}
// 严格匹配：仅允许"线路号 + 可选服务后缀"，不允许把 18 匹配到 B18/花18/地铁18
function strictMatch(lines, key) {
  const suffix = '(?:路|短线|快线|班车|区间|旅游专线|高峰线|支线)?';
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${suffix}$`);
  return lines.filter((l) => re.test(String(l.name || '')));
}

const manifestLines = fs.readFileSync(MANIFEST, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
// 按 base 去重，取最后一个条目对应的文件
const byBase = new Map();
for (const m of manifestLines) byBase.set(m.base, m);
const bases = [...byBase.keys()];
console.log(`待复核 ${bases.length} 条线路…`);

let cursor = 0;
const result = { found: 0, missing: 0, refetched: 0 };

async function worker() {
  while (cursor < bases.length) {
    const base = bases[cursor++];
    const m = byBase.get(base);
    const fp = `${RAW_DIR}/${m.idx}.json`;
    const rec = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf-8')) : { base, keys: base.split('/').map(normalizeKey).filter(Boolean) };
    try {
      let matched = [];
      for (const key of rec.keys) {
        const s = await search(key);
        const lines = strictMatch(s?.result?.lines || [], key);
        if (lines.length) {
          const seen = new Set(matched.map((l) => l.lineId));
          for (const l of lines) {
            if (seen.has(l.lineId)) continue;
            seen.add(l.lineId);
            matched.push({ name: l.name, lineId: l.lineId, direction: l.direction, startSn: l.startSn, endSn: l.endSn, isSubway: l.isSubway });
          }
        }
      }
      if (matched.length) {
        const oldIds = new Set((rec.foundLines || []).map((l) => l.lineId));
        const newIds = new Set(matched.map((l) => l.lineId));
        const needRefetch = [...newIds].some((id) => !oldIds.has(id) || !rec.details?.[id]?.stations?.length);
        rec.status = 'found';
        rec.foundLines = matched;
        if (needRefetch) {
          rec.details = rec.details || {};
          for (const ln of matched) {
            if (ln.isSubway) continue;
            try {
              const d = await lineDetail(ln.lineId);
              rec.details[ln.lineId] = {
                line: d.line ? { lineId: d.line.lineId, name: d.line.name, direction: d.line.direction, startSn: d.line.startSn, endSn: d.line.endSn, stationsNum: d.line.stationsNum } : null,
                stations: (d.stations || []).map((st) => ({ order: st.order, sId: st.sId, sn: st.sn, wgsLat: st.wgsLat, wgsLng: st.wgsLng, physicalStId: st.physicalStId, namesakeStId: st.namesakeStId })),
              };
            } catch { /* skip */ }
          }
          result.refetched++;
        }
        result.found++;
      } else {
        rec.status = 'missing';
        delete rec.foundLines;
        delete rec.details;
        delete rec.error;
        result.missing++;
      }
      delete rec.searchedAt;
      fs.writeFileSync(fp, JSON.stringify(rec), 'utf-8');
    } catch (e) {
      rec.status = 'error';
      rec.error = e.message;
      fs.writeFileSync(fp, JSON.stringify(rec), 'utf-8');
    }
    if (cursor % 200 === 0) {
      console.log(`  进度 ${cursor}/${bases.length} 找到 ${result.found} 缺失 ${result.missing} 重抓详情 ${result.refetched}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// 重写清单（去重后的最新状态）
const outLines = [];
for (const base of bases) {
  const m = byBase.get(base);
  const fp = `${RAW_DIR}/${m.idx}.json`;
  const rec = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  outLines.push(JSON.stringify({ idx: m.idx, base, status: rec.status, keys: rec.keys || [] }));
}
fs.writeFileSync(MANIFEST, outLines.join('\r\n') + '\r\n', 'utf-8');
console.log(`\n复核完成：找到 ${result.found}，缺失 ${result.missing}，重抓详情 ${result.refetched}`);
