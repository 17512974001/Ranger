/* 从高德开放平台 Web服务 API 抓取公交车站 POI
   用途：为"缺方向站台"的站点补外部坐标（方向站台数据）。
   依赖：系统临时目录下的 amap_key.txt（高德 Web服务 Key，不入库）。
   用法：node make_amap_platform_fetch.js
   产物：output/network/amap_poi_raw.json（站名 -> POI 列表缓存） */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const keyFile = path.join(process.env.TEMP || '.', 'amap_key.txt');
const key = fs.readFileSync(keyFile, 'utf-8').trim();
const stations = JSON.parse(fs.readFileSync('_need_stations.json', 'utf-8'));
const outDir = path.join(__dirname, 'output', 'network');
fs.mkdirSync(outDir, { recursive: true });

const rawFile = path.join(outDir, 'amap_poi_raw.json');
const cache = fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile, 'utf-8')) : {};

function query(name) {
  const url = 'https://restapi.amap.com/v3/place/text?key=' + key +
    '&keywords=' + encodeURIComponent(name) +
    '&types=150700&offset=25&page=1&extensions=base';
  const out = execFileSync('curl.exe', ['-s', '-m', '20', '--connect-timeout', '15', url], {
    encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024
  });
  const j = JSON.parse(out);
  if (j.status === '1' && Array.isArray(j.pois)) {
    return j.pois.map(function (p) {
      return { name: p.name, id: p.id, type: p.typecode, loc: p.location, addr: p.address || '', city: p.cityname || '' };
    });
  }
  return { error: j.info || 'no result', status: j.status };
}

(async function () {
  let done = 0, found = 0, missing = 0;
  for (const name of stations) {
    if (cache[name] !== undefined) { done++; continue; }
    try {
      cache[name] = query(name);
    } catch (e) {
      cache[name] = { error: String(e).slice(0, 200) };
    }
    done++;
    if (Array.isArray(cache[name]) && cache[name].length) { found++; }
    else { missing++; }
    if (done % 20 === 0 || done === stations.length) {
      console.log('进度 ' + done + '/' + stations.length);
    }
    await new Promise(function (res) { setTimeout(res, 300); });
  }
  fs.writeFileSync(rawFile, JSON.stringify(cache, null, 1), 'utf-8');
  console.log('完成：站名 ' + stations.length + ' 个，本次新增有结果 ' + found + '，无结果 ' + missing);
})();
