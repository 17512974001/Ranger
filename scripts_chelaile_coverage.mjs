// 覆盖率检查：候选换台/补台清单涉及线路 在车来了中的可查比例
import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = 'D:/haowanyouxi/Canton/CPTOND-2025/Guangzhou';
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
      headers: REQUEST_HEADERS, timeout: 20000,
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
async function search(key) {
  const params = { ...DEFAULT_PARAMS, cityId: '040', localCityId: '040', key, supportPhyStn: 'true' };
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(`${BASE_URL}/bus/query!nSearch.action`);
  u.search = new URLSearchParams(signed).toString();
  const data = parseEnvelope(await rawGet(u));
  return data?.result?.lines || [];
}

function normalizeKey(raw) {
  return raw
    .replace(/路(班车|短线|快线|高峰线|区间)?$/, '')
    .replace(/班车$/, '')
    .trim();
}

function collectLineNames() {
  const set = new Set();
  const addCsv = (file, col) => {
    if (!fs.existsSync(file)) return;
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    for (const ln of lines.slice(1)) {
      const cells = ln.split(',');
      const val = cells[col] || '';
      const names = col === 0 ? [val] : val.split(/[、]/);
      for (const n of names) if (n.trim()) set.add(n.trim());
    }
  };
  addCsv(`${ROOT}/output/network/派生方向站台候选_换台.csv`, 0);
  addCsv(`${ROOT}/output/network/派生方向站台候选_补台.csv`, 10); // 涉及线路
  return [...set];
}

const names = collectLineNames();
console.log(`涉及线路去重后共 ${names.length} 条，开始逐一检索…`);
const found = [];
const missing = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < names.length; i++) {
  const raw = names[i];
  const key = normalizeKey(raw);
  try {
    const lines = await search(key);
    const hit = lines.filter((l) => {
      const n = String(l.name || '');
      return n === key || n === `${key}路` || n.includes(key) || key.includes(n);
    });
    if (hit.length) found.push(raw);
    else missing.push(raw);
  } catch (e) {
    missing.push(`${raw}(错误:${e.message})`);
  }
  if ((i + 1) % 30 === 0) console.log(`  进度 ${i + 1}/${names.length}`);
  await sleep(120);
}

console.log(`\n可查到: ${found.length} (${((found.length / names.length) * 100).toFixed(1)}%)`);
console.log(`查不到: ${missing.length}`);
if (missing.length) {
  console.log('查不到清单:');
  for (const m of missing) console.log('  -', m);
}
