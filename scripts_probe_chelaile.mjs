// 临时探测脚本：车来了(chelaile)公开接口 —— 验证能否拿到广州线路上下行站点+坐标
import https from 'node:https';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const BASE_DOMAIN = 'https://web.chelaile.net.cn';
const BASE_URL = `${BASE_DOMAIN}/api`;
const SIGN_SALT = 'qwihrnbtmj';
const AES_KEY = 'FF32AE65FBFD19414EAAFF6291A54B42';

const DEFAULT_PARAMS = {
  s: 'h5',
  wxs: 'wx_app',
  sign: '1',
  h5RealData: '1',
  v: '3.11.28',
  src: 'weixinapp_cx',
  ctm_mp: 'mp_wx',
  vc: '2',
  favoriteGray: '1',
  gpstype: 'wgs',
  geo_type: 'wgs',
  scene: '1256',
};

const REQUEST_HEADERS = {
  Host: 'web.chelaile.net.cn',
  Connection: 'keep-alive',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) UnifiedPCWindowsWechat(0xf254160a) XWEB/18055',
  xweb_xhr: '1',
  'Content-Type': 'text',
  Accept: '*/*',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: 'https://servicewechat.com/wx71d589ea01ce3321/814/page-frame.html',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

function cryptoSign(params) {
  const str =
    Object.entries(params)
      .map(([k, v]) => `"${k}"="${v}"`)
      .join('&') + SIGN_SALT;
  return crypto.createHash('md5').update(str).digest('hex');
}

function decryptResult(ciphertext) {
  const key = Buffer.from(AES_KEY, 'utf8');
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function parseEnvelope(raw) {
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) throw new Error('Upstream response is not JSON');
  let depth = 0;
  let jsonEnd = jsonStart;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === '{') depth++;
    else if (raw[i] === '}') depth--;
    if (depth === 0) {
      jsonEnd = i + 1;
      break;
    }
  }
  const envelope = JSON.parse(raw.substring(jsonStart, jsonEnd));
  const data = envelope.jsonr?.data;
  if (!data) throw new Error('Upstream response missing jsonr.data');
  if (data.encryptResult) {
    return JSON.parse(decryptResult(data.encryptResult));
  }
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
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + (u.search || ''),
        method: 'GET',
        headers: REQUEST_HEADERS,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const decompressed = decompress(
              Buffer.concat(chunks),
              res.headers['content-encoding'],
            );
            resolve({ body: decompressed.toString('utf-8'), status: res.statusCode });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function request(url, params) {
  const signed = { ...params, cryptoSign: cryptoSign(params) };
  const u = new URL(url);
  u.search = new URLSearchParams(signed).toString();
  const { body } = await rawGet(u);
  return parseEnvelope(body);
}

const cityId = process.argv[2] || '257';
const kw = process.argv[3] || '566';

// 1) 城市列表（明文，不需签名），确认广州 cityId
try {
  const u = new URL(`${BASE_DOMAIN}/wwd/ncitylist`);
  u.search = new URLSearchParams(DEFAULT_PARAMS).toString();
  const r = await rawGet(u);
  const parsed = JSON.parse(r.body);
  const data = parsed.data;
  console.log('[cities raw]', JSON.stringify(parsed).slice(0, 1200));
  const arr = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? Object.values(data).find((v) => Array.isArray(v)) || []
      : [];
  const hit = arr.filter((c) => String(c.cityName || c.name || '').includes('广州'));
  console.log('[cities hit]', JSON.stringify(hit));
  console.log('[cities total]', arr.length);
  console.log('[cityId used]', cityId);
} catch (e) {
  console.log('[cities error]', e.message);
}

// 2) 搜索线路
try {
  const s = await request(`${BASE_URL}/bus/query!nSearch.action`, {
    ...DEFAULT_PARAMS,
    cityId,
    localCityId: cityId,
    key: kw,
    supportPhyStn: 'true',
  });
  console.log(`[search ${kw}]`, JSON.stringify(s).slice(0, 6000));
  const lines = s?.result?.lines || [];
  for (const ln of lines) {
    const detail = await request(`${BASE_URL}/bus/line!encryptedLineDetail.action`, {
      ...DEFAULT_PARAMS,
      cityId,
      localCityId: cityId,
      lineId: ln.lineId,
      lat: '',
      lng: '',
      geo_lat: '',
      geo_lng: '',
    });
    console.log(
      `[line ${ln.name} dir=${ln.direction} id=${ln.lineId}]`,
      JSON.stringify(detail).slice(0, 12000),
    );
  }
} catch (e) {
  console.log('[search error]', e.message);
}
