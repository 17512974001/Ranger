/* global L, BUS_ROUTES, BUS_STOPS, METRO_ROUTES, METRO_STOPS,
   BUS_ROUTE_STOPS, STOP_ROUTES, METRO_ROUTE_STOPS, METRO_STOP_ROUTES, METRO_FEEDERS */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var fmt = function (v) { return (v === null || v === undefined || v === '') ? '—' : v; };
  var fmtTime = function (t) {
    var s = String(t == null ? '' : t).trim();
    if (/^\d{3,4}$/.test(s)) {
      while (s.length < 4) { s = '0' + s; }
      return s.slice(0, 2) + ':' + s.slice(2);
    }
    return s;
  };
  // 站名修正（截断/错字），作用于显示与检索
  var STOP_NAME_FIXES = {
    '广州火车': '广州火车站',
    '从化客运': '从化客运站',
    '天河客运': '天河客运站',
    '顺德一中实验学校': '广东顺德文德学校', // 学校更名，同一站点
    '番禺宝墨园': '宝墨园总站', // 同一总站的不同写法
    '宝墨园': '宝墨园总站'
  };
  function fixedName(n) {
    return STOP_NAME_FIXES[n] || String(n || '');
  }
  // 通用站名（临时站/招呼站）：同名不代表同站，须按站点ID区分
  function isGenericStop(name) {
    return /^临时站|^招呼站/.test(name);
  }
  // 线路别名（改名/重复录入的同一线路）
  var ROUTE_ALIASES = {
    '从13路': '从化13路',
    '佛里07路': '里07路'
  };

  var routeNumOf = function (cn) {
    var m = String(cn || '').match(/^([^（(]+)/);
    return m ? m[1].trim() : String(cn || '');
  };
  var metroBase = function (cn) {
    var m = String(cn || '').match(/^(地铁\d+号线|APM线|广佛线|海珠有轨电车1号线|黄埔有轨电车1号线)/);
    return m ? m[1] : String(cn || '');
  };

  // ---------- WGS84 -> GCJ02 ----------
  var PI = Math.PI;
  var A = 6378245.0;
  var EE = 0.00669342162296594323;
  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }
  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }
  function transformLng(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }
  function wgs2gcj(lng, lat) {
    if (outOfChina(lng, lat)) { return [lng, lat]; }
    var dLat = transformLat(lng - 105.0, lat - 35.0);
    var dLng = transformLng(lng - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI);
    return [lng + dLng, lat + dLat];
  }

  // ---------- data indexes ----------
  var busFeatures = BUS_ROUTES.features;
  var metroFeatures = METRO_ROUTES.features;
  var busCns = new Set(busFeatures.map(function (f) { return f.properties.route_cn; }));
  var metroCns = new Set(metroFeatures.map(function (f) { return f.properties.route_cn; }));
  var busNumToCns = {};
  var metroNumToCns = {};
  busFeatures.forEach(function (f) {
    var n = routeNumOf(f.properties.route_cn);
    (busNumToCns[n] = busNumToCns[n] || []).push(f.properties.route_cn);
  });
  metroFeatures.forEach(function (f) {
    var n = routeNumOf(f.properties.route_cn);
    (metroNumToCns[n] = metroNumToCns[n] || []).push(f.properties.route_cn);
  });
  var metroStopById = {};
  METRO_STOPS.features.forEach(function (f) { metroStopById[f.properties.stop_id] = f; });
  var busStopById = {};
  BUS_STOPS.features.forEach(function (f) { busStopById[f.properties.stop_id] = f; });

  // ---------- 线路身份（同号不同线：佛山655 与 广州655 等，按起讫坐标聚类） ----------
  function terminiParts(cn) {
    // 取最后一个 '--' 所在的括号块（站名本身可含括号，如 金沙洲(涛乐街)总站）
    var s = String(cn || '').trim();
    var lastSep = s.lastIndexOf('--');
    if (lastSep < 0 || !/[）)]$/.test(s)) { return null; }
    var stack = [];
    var blocks = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '(' || ch === '（') { stack.push(i); }
      else if (ch === ')' || ch === '）') {
        if (stack.length) { blocks.push([stack.pop(), i]); }
      }
    }
    var best = null;
    blocks.forEach(function (b) {
      if (b[0] < lastSep && lastSep < b[1]) {
        if (!best || b[0] < best[0]) { best = b; }
      }
    });
    if (!best) { return null; }
    var parts = s.slice(best[0] + 1, best[1]).split('--');
    if (parts.length !== 2) { return null; }
    return [parts[0].trim(), parts[1].trim()];
  }
  var terminusCoords = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
      if (!terminusCoords[st[1]] && busStopById[st[2]]) {
        terminusCoords[st[1]] = busStopById[st[2]].geometry.coordinates;
      }
    });
  });
  var routeKeyCache = {};
  (function () {
    var byNum = {};
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      var num = ROUTE_ALIASES[routeNumOf(k)] || routeNumOf(k);
      (byNum[num] = byNum[num] || []).push(k);
    });
    Object.keys(byNum).forEach(function (num) {
      var cns = byNum[num];
      var n = cns.length;
      var parent = [];
      for (var i = 0; i < n; i++) { parent.push(i); }
      function find(x) {
        while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
      }
      for (var a = 0; a < n; a++) {
        for (var b = a + 1; b < n; b++) {
          var ta = terminiParts(cns[a]);
          var tb = terminiParts(cns[b]);
          if (!ta || !tb) { parent[find(a)] = find(b); continue; }
          var link = false;
          for (var ia = 0; ia < 2 && !link; ia++) {
            for (var ib = 0; ib < 2; ib++) {
              var ca = terminusCoords[ta[ia]];
              var cb = terminusCoords[tb[ib]];
              if (ca && cb && segLenM(ca, cb) <= 300) { link = true; break; }
            }
          }
          if (link) {
            var ra = find(a);
            var rb = find(b);
            if (ra !== rb) { parent[ra] = rb; }
          }
        }
      }
      var comps = {};
      for (var k2 = 0; k2 < n; k2++) {
        var root = find(k2);
        (comps[root] = comps[root] || []).push(cns[k2]);
      }
      var compList = Object.keys(comps).sort(function (x, y) {
        return comps[x][0] < comps[y][0] ? -1 : (comps[x][0] > comps[y][0] ? 1 : 0);
      });
      compList.forEach(function (root, idx) {
        comps[root].forEach(function (cn) { routeKeyCache[cn] = num + '#' + idx; });
      });
    });
  })();
  function routeKeyOf(cn) {
    return routeKeyCache[cn] || ((ROUTE_ALIASES[routeNumOf(cn)] || routeNumOf(cn)) + '#0');
  }
  function keyNumOf(key) {
    var i = key.indexOf('#');
    return i > 0 ? key.slice(0, i) : key;
  }
  var busKeyToCns = {};
  var busNumToKeys = {};
  busFeatures.forEach(function (f) {
    var key = routeKeyOf(f.properties.route_cn);
    (busKeyToCns[key] = busKeyToCns[key] || []).push(f.properties.route_cn);
    var num = keyNumOf(key);
    if (busNumToKeys[num] === undefined) { busNumToKeys[num] = []; }
    if (busNumToKeys[num].indexOf(key) < 0) { busNumToKeys[num].push(key); }
  });
  function keyLabel(key) {
    var num = keyNumOf(key);
    var cns = busKeyToCns[key] || [];
    if (!cns.length || (busNumToKeys[num] || []).length <= 1) { return num; }
    var t = terminiParts(cns[0]) || [];
    return num + '（' + (t[0] || '') + ' ⇄ ' + (t[1] || '') + '）';
  }
  var stopRouteKeys = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    var key = routeKeyOf(k);
    (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
      (stopRouteKeys[st[2]] = stopRouteKeys[st[2]] || {})[key] = true;
    });
  });

  // ---------- stop marking indexes (BRT 站 + 地铁接驳站) ----------
  var brtStationIds = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    if (/^B1路[（(]/.test(k)) {
      (BUS_ROUTE_STOPS[k] || []).forEach(function (s) {
        if (s[1].indexOf('鹿鸣山') < 0) { brtStationIds[s[2]] = true; }
      });
    }
  });
  var busStopMetro = {};
  Object.keys(METRO_FEEDERS || {}).forEach(function (mId) {
    var mName = metroStopById[mId] ? metroStopById[mId].properties.name_cn : '';
    var lines = METRO_STOP_ROUTES[mId] || [];
    (METRO_FEEDERS[mId].bus_stops || []).forEach(function (b) {
      (busStopMetro[b[0]] = busStopMetro[b[0]] || []).push({ name: mName, dist: b[2], lines: lines });
    });
  });

  // 规范化站名 -> 站点ID 集合（同一站名不同ID / 数字分站 视为同一站）
  var rawStopNameSet = {};
  Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
    (BUS_ROUTE_STOPS[k] || []).forEach(function (st) { rawStopNameSet[st[1]] = true; });
  });

  // ---------- 括号变体站名合并（按坐标距离辨别） ----------
  var stationAlias = {};
  function resolveName(name) {
    return stationAlias[name] || name;
  }
  function buildStationAlias() {
    var nameCoords = {};
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
        if (!nameCoords[st[1]] && busStopById[st[2]]) {
          nameCoords[st[1]] = busStopById[st[2]].geometry.coordinates;
        }
      });
    });
    BUS_STOPS.features.forEach(function (f) {
      if (!nameCoords[f.properties.name_cn]) {
        nameCoords[f.properties.name_cn] = f.geometry.coordinates;
      }
    });
    var groups = {};
    Object.keys(nameCoords).forEach(function (n) {
      if (isGenericStop(n)) { return; }
      // 先去掉数字后缀、括号块、末尾"站"字，再分组（东风东路站 与 东风东路(广东工大) 应同组）
      var pb = n.replace(/\d+$/, '').replace(/[（(][^（）()]*[）)]$/, '').replace(/站$/, '');
      if (!pb) { return; }
      (groups[pb] = groups[pb] || []).push(n);
    });
    Object.keys(groups).forEach(function (pb) {
      var members = groups[pb];
      if (members.length < 2) { return; }
      function isDir(n) {
        // 方向后缀后可带数字分站（如 同和(停北行)2），仍视为方向后缀，不做纯名→括号别名
        return /[（(](停?[东南西北]行|上行|下行)[）)]\d*$/.test(n);
      }
      var plain = members.filter(function (n) { return !/[（(]/.test(n) && !/\d$/.test(n); });
      var bracketed = members.filter(function (n) { return /[（(]/.test(n) && !isDir(n); });
      if (!plain.length || !bracketed.length) { return; }
      var alias = {};
      bracketed.forEach(function (b) {
        var bc = nameCoords[b];
        if (!bc) { return; }
        plain.forEach(function (p) {
          var pc = nameCoords[p];
          if (!pc) { return; }
          var d = segLenM(pc, bc);
          if (d <= 300 && (!alias[p] || alias[p].d > d)) {
            alias[p] = { b: b, d: d };
          }
        });
      });
      Object.keys(alias).forEach(function (p) { stationAlias[p] = alias[p].b; });
    });
  }
  buildStationAlias();

  function stripSubMarkers(s) {
    s = s.replace(/^公共汽车BRT/, '').replace(/^公共汽车/, ''); // 站牌前缀（公共汽车BRT中山大道东圃站 → 中山大道东圃站）
    s = s.replace(/^BRT/, '').replace(/\(BRT\)$/, '');
    s = s.replace(/(?:[NS]\d+)(?:子站)?$/, '');
    s = s.replace(/\d+号分站$/, '');
    s = s.replace(/分站$/, '');
    s = s.replace(/[（(]分站[）)]$/, '');
    return s;
  }
  function digitBaseName(s) {
    var m = s.match(/^(.*?)(\d+)$/);
    if (!m || !m[1]) { return null; }
    var base = m[1];
    if (/[（(]/.test(base)) { return base; }
    var noZhan = base.replace(/站$/, '');
    var cands = [base, noZhan, base + '站'];
    for (var i = 0; i < cands.length; i++) {
      if (rawStopNameSet[cands[i]]) { return cands[i]; }
    }
    return base;
  }
  function normStopName(name) {
    // 先去数字分站、再套括号别名，让数字分站继承纯名的站归属（中山纪念堂4 → 中山纪念堂(市总工会)）
    var s = fixedName(name);
    s = (window.STATION_MERGE_MAP || {})[s] || s; // 站名写法差异合并表（分类1）
    s = stripSubMarkers(s);
    var db = digitBaseName(s);
    if (db) { s = db; }
    s = resolveName(s);
    s = stripSubMarkers(s);
    var db2 = digitBaseName(s);
    if (db2) { s = db2; }
    s = s.replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, '');
    s = s.replace(/(?<![A-Za-z])[A-Za-z]站$/, ''); // 分站字母（雅居乐花园A站→雅居乐花园；中国软件CBD站不拆）
    return s.replace(/站$/, '').trim();
  }
  function displayStopName(name, cn) {
    var s = stripSubMarkers(resolveName(fixedName(name)));
    var db = digitBaseName(s);
    if (db) { s = db; }
    var m2 = s.match(/^(.*)站$/);
    if (m2 && m2[1] && rawStopNameSet[m2[1]]) { s = m2[1]; }
    // 环线（如 188/792）绕圈会自然经过两个方向平台，停靠列表不显示 停北行/南行 后缀；
    // 仅非环线（如 B3 松北）一个方向同时停双平台时才保留后缀
    if (cn && isLoopDir(cn)) { s = s.replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, ''); }
    return s;
  }
  function searchStopName(n) {
    return displayStopName(n).replace(/[（(](停?[东南西北]行|上行|下行)[）)]$/, '');
  }
  function isLoopDir(cn) {
    var t = terminiParts(cn);
    return !!t && t[0] === t[1];
  }

  function displayStops(stops, cn) {
    var out = [];
    var seen = {};
    var last = null;
    (stops || []).forEach(function (st) {
      var dn = displayStopName(st[1], cn);
      if (isLoopDir(cn) || isGenericStop(st[1])) {
        if (last === dn) { return; } // 环线只去连续重复，保留绕行再次停靠的站
        last = dn;
      } else {
        if (seen[dn]) { return; }
        seen[dn] = true;
      }
      out.push(st);
    });
    return out;
  }
  // ---------- 距离感知的同名站聚类（同一规范基名 + 坐标 ≤1000m 才视为同一站） ----------
  var CLUSTER_DIST = 1000;
  var stopClusterId = {};
  var clusterKeyToIds = {};
  var baseClusters = {};
  function buildStopClusters() {
    var groups = {};
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
        if (isGenericStop(st[1])) { return; }
        var f = busStopById[st[2]];
        if (!f) { return; }
        var n = normStopName(st[1]);
        (groups[n] = groups[n] || {})[st[2]] = f.geometry.coordinates;
      });
    });
    Object.keys(groups).forEach(function (base) {
      var ids = Object.keys(groups[base]);
      var coords = ids.map(function (id) { return groups[base][id]; });
      if (ids.length === 1) {
        clusterKeyToIds[base] = ids;
        (baseClusters[base] = baseClusters[base] || []).push(base);
        stopClusterId[ids[0]] = base;
        return;
      }
      // 并查集：≤1000m 相连的站归为同一站
      var parent = ids.map(function (_, i) { return i; });
      function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
      function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) { parent[rb] = ra; } }
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          if (segLenM(coords[i], coords[j]) <= CLUSTER_DIST) { union(i, j); }
        }
      }
      var comp = {};
      ids.forEach(function (id, i) { var r = find(i); (comp[r] = comp[r] || []).push(id); });
      var comps = Object.keys(comp).map(function (r) { return comp[r]; });
      comps.forEach(function (memberIds, ci) {
        var key = comps.length === 1 ? base : base + '#' + (ci + 1);
        clusterKeyToIds[key] = memberIds;
        (baseClusters[base] = baseClusters[base] || []).push(key);
        memberIds.forEach(function (id) { stopClusterId[id] = key; });
      });
    });
  }
  buildStopClusters();
  // 给定停靠记录（站点ID + 站名），返回其所属"站"的全部平台ID
  function stationStopIds(stopId, name) {
    if (isGenericStop(name)) { return [stopId]; }
    var k = stopClusterId[stopId];
    return k ? (clusterKeyToIds[k] || [stopId]) : [stopId];
  }
  // 按规范名取全部同基名簇（调试/搜索用，展示聚合结果）
  function stationStopIdsByBase(name) {
    var out = [];
    (baseClusters[normStopName(name)] || []).forEach(function (k) {
      (clusterKeyToIds[k] || []).forEach(function (id) {
        if (out.indexOf(id) < 0) { out.push(id); }
      });
    });
    return out;
  }
  // 派生方向站台（远侧线路几何汇聚点，用于数据缺失的方向停靠点显示）
  var derivedByNorm = {};
  (window.DERIVED_PLATFORMS || []).forEach(function (p) {
    var k = normStopName(p.station);
    (derivedByNorm[k] = derivedByNorm[k] || []).push(p);
  });
  // 车来了方向分站坐标（按"方向记录 + 站名"精确修正停靠点位置）
  var chelaileFixes = window.CHELAILE_PLATFORM_FIXES || {};

  function isBrtStop(stopId, name) {
    if (brtStationIds[stopId]) { return true; }
    return stationStopIds(stopId, name).some(function (oid) { return brtStationIds[oid]; });
  }

  // ---------- 平台坐标附属数据（合并站 -> 分站明细，为将来分站级显示预留） ----------
  var stationPlatforms = {};
  var platformRecById = {};
  var CN_NUMS = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  function platformLabel(p) {
    if (p.platformNo == null) { return p.name; }
    var base = String(p.name).replace(/\d+$/, '').replace(/[①-⑩]$/, '');
    return base + (CN_NUMS[p.platformNo] || String(p.platformNo));
  }
  function buildStationPlatforms() {
    stationPlatforms = {};
    platformRecById = {};
    var src = window.STATION_PLATFORMS;
    if (src && src.length) {
      src.forEach(function (p) {
        var rec = { name: p.name, id: p.id, lng: p.lng, lat: p.lat, platformNo: p.platformNo, chName: p.chName || '', stationName: p.stationName };
        platformRecById[p.id] = rec;
        var arr = stationPlatforms[p.stationName] || (stationPlatforms[p.stationName] = []);
        if (!arr.some(function (x) { return x.id === p.id; })) { arr.push(rec); }
      });
      return;
    }
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
        var key = isGenericStop(st[1]) ? ('G:' + st[2]) : displayStopName(st[1]);
        var f = busStopById[st[2]];
        if (!f) { return; }
        var arr = stationPlatforms[key] || (stationPlatforms[key] = []);
        var exists = arr.some(function (p) { return p.id === st[2]; });
        if (!exists) {
          arr.push({
            name: st[1],
            id: st[2],
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1]
          });
        }
      });
    });
  }
  buildStationPlatforms();
  // 懒加载数据（station_platforms 等）加载完成后重建平台索引
  window.__ON_DEFERRED_DATA__ = function () { buildStationPlatforms(); };

  // ---------- transit navigation (研究级换乘) ----------
  var navStations = new Map();
  var stopIdToNav = new Map();
  var navLineStops = {};
  var navWalkAdj = new Map();
  var navFromId = null;
  var navToId = null;
  var navLayer = null;
  var navStopLayer = null;
  var navLabelLayer = null;
  var navLabelsOn = false;
  var navPlanCurrent = null;
  var navMarkedStations = [];
  var navLabelCount = 0;
  var NAV_COLORS = ['#059669', '#2563eb', '#f59e0b'];

  function navDistM(c1, c2) {
    var dLat = (c2[1] - c1[1]) * 111320;
    var dLng = (c2[0] - c1[0]) * 111320 * Math.cos(c1[1] * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  }

  function buildNavGraph() {
    navStations.clear();
    stopIdToNav.clear();
    navLineStops = {};
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      var num = routeNumOf(k);
      (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
        var key = normStopName(st[1]);
        var stn = navStations.get(key);
        if (!stn) {
          stn = { name: st[1], ids: {}, routes: {}, coords: null };
          navStations.set(key, stn);
        }
        stn.ids[st[2]] = true;
        stn.routes[num] = true;
        if (!stn.coords && busStopById[st[2]]) {
          stn.coords = busStopById[st[2]].geometry.coordinates;
        }
        stopIdToNav.set(st[2], key);
      });
    });
    Object.keys(BUS_ROUTE_STOPS).forEach(function (k) {
      var num = routeNumOf(k);
      if (navLineStops[num] !== undefined) { return; }
      var seq = [];
      (BUS_ROUTE_STOPS[k] || []).forEach(function (st) {
        var key = normStopName(st[1]);
        if (seq[seq.length - 1] !== key) { seq.push(key); }
      });
      navLineStops[num] = seq;
    });
    var CELL = 0.0035;
    var grid = {};
    navStations.forEach(function (stn, key) {
      if (!stn.coords) { return; }
      var gk = Math.floor(stn.coords[0] / CELL) + ',' + Math.floor(stn.coords[1] / CELL);
      (grid[gk] = grid[gk] || []).push(key);
    });
    navWalkAdj = new Map();
    navStations.forEach(function (stn, key) {
      if (!stn.coords) { return; }
      var gx = Math.floor(stn.coords[0] / CELL);
      var gy = Math.floor(stn.coords[1] / CELL);
      var adj = [];
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var arr = grid[(gx + dx) + ',' + (gy + dy)];
          if (!arr) { continue; }
          arr.forEach(function (k2) {
            if (k2 === key) { return; }
            var c2 = navStations.get(k2).coords;
            if (c2 && navDistM(stn.coords, c2) <= 300) { adj.push(k2); }
          });
        }
      }
      navWalkAdj.set(key, adj);
    });
  }

  function planRoute(fromStopId, toStopId) {
    var start = stopIdToNav.get(fromStopId);
    var end = stopIdToNav.get(toStopId);
    if (!start || !end) { return []; }
    if (start === end) {
      return [{ rides: 0, transfers: 0, totalStops: 0, walkMeters: 0,
        steps: [{ type: 'start', to: start }, { type: 'end', to: end }] }];
    }
    var best = new Map();
    best.set(start, { rides: 0, prev: null, line: null, board: null, stops: 0, walk: 0 });
    var levels = [[start]];
    var plans = [];
    for (var r = 1; r <= 3; r++) {
      var cur = levels[r - 1];
      var next = [];
      var nextBest = new Map();
      cur.forEach(function (key) {
        var stn = navStations.get(key);
        Object.keys(stn.routes).forEach(function (line) {
          var seq = navLineStops[line];
          var idx = seq.indexOf(key);
          if (idx < 0) { return; }
          for (var k = 0; k < seq.length; k++) {
            if (k === idx) { continue; }
            var dest = seq[k];
            var stops = Math.abs(k - idx);
            if (best.has(dest) && best.get(dest).rides <= r) { continue; }
            if (nextBest.has(dest) && nextBest.get(dest).stops <= stops) { continue; }
            nextBest.set(dest, { rides: r, prev: key, line: line, board: key, stops: stops, walk: 0 });
            next.push(dest);
          }
        });
        (navWalkAdj.get(key) || []).forEach(function (dest) {
          if (best.has(dest) && best.get(dest).rides <= r) { return; }
          if (nextBest.has(dest) && nextBest.get(dest).stops <= 0) { return; }
          nextBest.set(dest, { rides: r, prev: key, line: null, board: null, stops: 0, walk: 1 });
          next.push(dest);
        });
      });
      nextBest.forEach(function (v, k) {
        if (!best.has(k) || best.get(k).rides > v.rides) { best.set(k, v); }
      });
      levels.push(next);
      if (best.has(end) && best.get(end).rides <= r) {
        plans.push(buildPlan(end, best));
      }
    }
    var seen = {};
    return plans.filter(function (p) {
      var sig = JSON.stringify(p.steps.map(function (s) { return (s.line || '') + '|' + (s.board || '') + '|' + s.to + '|' + (s.walk ? 1 : 0); }));
      if (seen[sig]) { return false; }
      seen[sig] = true;
      return true;
    }).slice(0, 5);
  }

  function buildPlan(end, best) {
    var steps = [];
    var cur = end;
    var totalStops = 0;
    var walkMeters = 0;
    while (best.has(cur) && best.get(cur).prev) {
      var b = best.get(cur);
      if (b.walk) {
        var c1 = navStations.get(b.prev).coords;
        var c2 = navStations.get(cur).coords;
        var m = (c1 && c2) ? Math.round(navDistM(c1, c2)) : 0;
        walkMeters += m;
        steps.unshift({ type: 'walk', from: b.prev, to: cur, meters: m });
      } else {
        totalStops += b.stops;
        steps.unshift({ type: 'ride', line: b.line, board: b.board, to: cur, stops: b.stops });
      }
      cur = b.prev;
    }
    steps.unshift({ type: 'start', to: cur });
    var rides = steps.filter(function (s) { return s.type === 'ride'; }).length;
    return {
      rides: rides,
      transfers: Math.max(0, rides - 1),
      totalStops: totalStops,
      walkMeters: walkMeters,
      steps: steps
    };
  }

  function clearNav() {
    if (navLayer) { navLayer.clearLayers(); }
    if (navStopLayer) { navStopLayer.clearLayers(); }
    if (navLabelLayer) { navLabelLayer.clearLayers(); }
    navPlanCurrent = null;
    navMarkedStations = [];
    navLabelCount = 0;
  }

  function nearestVertexIndex(coords, coord) {
    var best = 0;
    var bestD = Infinity;
    var scale = Math.cos(coord[1] * Math.PI / 180);
    for (var i = 0; i < coords.length; i++) {
      var dx = (coords[i][0] - coord[0]) * scale;
      var dy = coords[i][1] - coord[1];
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function clipLineSegment(feat, boardKey, alightKey) {
    var b = navStations.get(boardKey);
    var a = navStations.get(alightKey);
    var coords = feat.geometry.coordinates;
    if (!b || !a) { return coords; }
    var ib = nearestVertexIndex(coords, b.coords);
    var ia = nearestVertexIndex(coords, a.coords);
    var lo = Math.min(ib, ia);
    var hi = Math.max(ib, ia);
    var seg = coords.slice(lo, hi + 1);
    if (ib > ia) { seg.reverse(); }
    return seg;
  }

  function drawNavPlan(plan) {
    if (!navLayer || !navStopLayer) { return; }
    clearNav();
    navPlanCurrent = plan;
    navMarkedStations = [];
    var bounds = L.latLngBounds([]);
    var rideIndex = 0;
    var marked = {};
    function markStation(key, big) {
      if (!key || marked[key]) { return; }
      marked[key] = true;
      navMarkedStations.push({ key: key, big: !!big });
      var stn = navStations.get(key);
      if (!stn || !stn.coords) { return; }
      var c = toMapCoords(stn.coords[0], stn.coords[1]);
      var m = L.circleMarker([c[1], c[0]], {
        radius: big ? 7 : 3.5,
        color: big ? '#0f172a' : '#065f46',
        weight: big ? 2 : 1,
        fillColor: big ? '#059669' : '#34d399',
        fillOpacity: 0.9
      });
      m.bindTooltip(displayStopName(stn.name), { direction: 'top', offset: [0, -5] });
      navStopLayer.addLayer(m);
      bounds.extend([c[1], c[0]]);
    }
    plan.steps.forEach(function (st) {
      if (st.type === 'ride') {
        var color = NAV_COLORS[rideIndex % NAV_COLORS.length];
        rideIndex += 1;
        var seq = navLineStops[st.line] || [];
        var iB = seq.indexOf(st.board);
        var iA = seq.indexOf(st.to);
        var lo = Math.min(iB, iA);
        var hi = Math.max(iB, iA);
        for (var k = lo; k <= hi; k++) {
          markStation(seq[k], k === iB || k === iA);
        }
        var f0 = null;
        for (var fi = 0; fi < busFeatures.length; fi++) {
          if (routeNumOf(busFeatures[fi].properties.route_cn) === st.line) { f0 = busFeatures[fi]; break; }
        }
        if (f0 && f0.geometry.type === 'LineString' && iB >= 0 && iA >= 0 && iB !== iA) {
          var seg = clipLineSegment(f0, st.board, st.to);
          if (seg.length > 1) {
            var feat = { type: 'Feature', properties: { navColor: color }, geometry: { type: 'LineString', coordinates: seg } };
            navLayer.addData(featsInSpace([feat], currentSpace));
            seg.forEach(function (c) {
              var m = toMapCoords(c[0], c[1]);
              bounds.extend([m[1], m[0]]);
            });
          }
        }
      }
    });
    plan.steps.forEach(function (st) {
      if (st.type === 'walk') { markStation(st.from); markStation(st.to); }
      if (st.type === 'start') { markStation(st.to, true); }
      if (st.type === 'end') { markStation(st.to, true); }
    });
    if (bounds.isValid()) { map.fitBounds(bounds, { padding: [45, 45] }); }
    updateNavLabels();
  }

  function updateNavLabels() {
    navLabelCount = 0;
    if (!navLabelLayer) { return; }
    navLabelLayer.clearLayers();
    if (!navLabelsOn || !navPlanCurrent) { return; }
    navMarkedStations.forEach(function (ms) {
      var stn = navStations.get(ms.key);
      if (!stn || !stn.coords) { return; }
      var c = toMapCoords(stn.coords[0], stn.coords[1]);
      var tip = L.circleMarker([c[1], c[0]], { radius: 0, interactive: false });
      tip.bindTooltip('<span style="color:#111827">' + esc(displayStopName(stn.name)) + '</span>', {
        permanent: true, direction: 'top', offset: [0, -8], className: 'stop-label', interactive: false
      });
      navLabelLayer.addLayer(tip);
      navLabelCount += 1;
    });
  }

  // ---------- direction index (同一线路的两个方向用相近两色区分) ----------
  var dirOf = {};
  function buildDirIndex(feats) {
    var byNum = {};
    feats.forEach(function (f) {
      var n = routeNumOf(f.properties.route_cn);
      (byNum[n] = byNum[n] || []).push(f.properties.route_cn);
    });
    Object.keys(byNum).forEach(function (n) {
      var cns = byNum[n].slice().sort();
      if (cns.length > 1) {
        cns.forEach(function (cn, i) { dirOf[cn] = (i % 2) ? 'B' : 'A'; });
      }
    });
  }
  buildDirIndex(busFeatures);
  buildDirIndex(metroFeatures);

  function dirColor(routeCn, baseA, baseB) {
    return dirOf[routeCn] === 'B' ? baseB : baseA;
  }

  // ---------- basemaps ----------
  var BASEMAPS = {
    gaode: {
      name: '高德街道（默认，快）',
      url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
      subdomains: '1234', maxZoom: 18, space: 'gcj02',
      attribution: '&copy; 高德地图'
    },
    gaode_img: {
      name: '高德影像',
      url: 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
      subdomains: '1234', maxZoom: 18, space: 'gcj02',
      attribution: '&copy; 高德地图'
    },
    carto: {
      name: '浅色底图',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      subdomains: 'abcd', maxZoom: 19, space: 'wgs84',
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    },
    osm: {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      subdomains: 'abc', maxZoom: 19, space: 'wgs84',
      attribution: '&copy; OpenStreetMap contributors'
    }
  };

  var METRO_COLORS = {
    '地铁1号线': '#f7b500', '地铁2号线': '#0057b7', '地铁3号线': '#f5821f',
    '地铁4号线': '#00a651', '地铁5号线': '#e2231a', '地铁6号线': '#80276c',
    '地铁7号线': '#00a0a0', '地铁8号线': '#0085c3', '地铁9号线': '#7ac143',
    '地铁10号线': '#c9a86a', '地铁11号线': '#b08cc4', '地铁12号线': '#8e7cc3',
    '地铁13号线': '#ff6f00', '地铁14号线': '#00b0b9', '地铁18号线': '#0033a0',
    '地铁21号线': '#e6a817', '地铁22号线': '#6c2c84',
    'APM线': '#333333', '广佛线': '#c8a2c8',
    '海珠有轨电车1号线': '#78be20', '黄埔有轨电车1号线': '#78be20'
  };

  // ---------- map ----------
  var map = L.map('map', { zoomControl: true }).setView([23.13, 113.32], 11);
  var initialBasemapKey = (function () {
    var qs = (window.location && window.location.search) || '';
    var m = qs.match(/basemap=([^&]+)/);
    if (m && BASEMAPS[m[1]]) { return m[1]; }
    try {
      var saved = localStorage.getItem('gz_basemap');
      if (saved && BASEMAPS[saved]) { return saved; }
    } catch (e) { /* 无 localStorage 时忽略 */ }
    if (window.__DEFAULT_BASEMAP__ && BASEMAPS[window.__DEFAULT_BASEMAP__]) {
      return window.__DEFAULT_BASEMAP__;
    }
    return 'carto';
  })();
  var currentSpace = BASEMAPS[initialBasemapKey].space;
  var currentBasemap = initialBasemapKey;
  var tileLayer = null;
  function setTileLayer(key) {
    var bm = BASEMAPS[key];
    if (!bm) { return; }
    currentBasemap = key;
    try { localStorage.setItem('gz_basemap', key); } catch (e) { /* 忽略 */ }
    if (tileLayer) { map.removeLayer(tileLayer); }
    tileLayer = L.tileLayer(bm.url, {
      subdomains: bm.subdomains,
      maxZoom: bm.maxZoom,
      attribution: bm.attribution
    });
    tileLayer.addTo(map);
    if (bm.space !== currentSpace) {
      currentSpace = bm.space;
      rebuildDataLayers();
      clearSelection();
    }
  }

  // ---------- layer state ----------
  var layerState = {
    metroRoutes: false, metroStops: false, busStops: false, busRoutes: false, brtOnly: false
  };
  var metroRoutesLayer = null;
  var metroStopsLayer = null;
  var busStopsCluster = null;
  var busRoutesLayer = null;
  var brtLayer = null;
  var highlight = null;
  var stopHighlight = null;
  var compareLayer = null;
  var compareNum = null;
  var overlayOn = false;
  var overlayStopCount = 0;
  var stopLabelsOn = false;
  var stopLabelLayer = null;
  var labelCount = 0;
  var labelBlackCount = 0;
  var panelRouteDirs = [];
  var stopDisplayMode = 'chips';
  var dirFilter = { A: true, B: true };
  var panelRouteFeats = [];
  var routeStopsLayer = null;
  var currentPanel = null;
  var backStack = [];

  // ---------- coordinate-space helpers ----------
  function toMapCoords(lng, lat) {
    if (currentSpace === 'gcj02') {
      var g = wgs2gcj(lng, lat);
      return [g[0], g[1]];
    }
    return [lng, lat];
  }
  var fcCache = {};
  function transformFeats(feats, space) {
    if (space !== 'gcj02') { return feats; }
    return feats.map(function (f) {
      var geom = f.geometry;
      if (geom.type === 'Point') {
        var g = wgs2gcj(geom.coordinates[0], geom.coordinates[1]);
        return { type: f.type, properties: f.properties, geometry: { type: 'Point', coordinates: g } };
      }
      if (geom.type === 'LineString') {
        return {
          type: f.type, properties: f.properties,
          geometry: {
            type: 'LineString',
            coordinates: geom.coordinates.map(function (c) { return wgs2gcj(c[0], c[1]); })
          }
        };
      }
      return f;
    });
  }
  function featsInSpace(feats, space, cacheKey) {
    if (cacheKey) {
      fcCache[space] = fcCache[space] || {};
      if (fcCache[space][cacheKey]) { return fcCache[space][cacheKey]; }
    }
    var out = transformFeats(feats, space);
    if (cacheKey) { fcCache[space][cacheKey] = out; }
    return out;
  }

  // ---------- layer builders ----------
  function buildMetroRoutes(space) {
    return L.geoJSON(featsInSpace(metroFeatures, space, 'metroRoutes'), {
      style: function (f) {
        var p = f.properties;
        var op = p.op_status === '运营';
        return {
          color: op ? (METRO_COLORS[metroBase(p.route_cn)] || '#94a3b8') : '#cbd5e1',
          weight: op ? 4 : 2.5,
          opacity: op ? 0.92 : 0.6,
          dashArray: op ? null : '6 5'
        };
      },
      onEachFeature: function (f, layer) {
        layer.on('click', function () { selectRoute(f.properties.route_cn); });
      }
    });
  }
  function buildMetroStops(space) {
    return L.geoJSON(featsInSpace(METRO_STOPS.features, space, 'metroStops'), {
      pointToLayer: function (f, latlng) {
        var n = f.properties.num_lines || 1;
        var r = n >= 6 ? 6.5 : n >= 4 ? 5.5 : 4.5;
        return L.circleMarker(latlng, {
          radius: r, color: '#0f172a', weight: 1.4,
          fillColor: '#334155', fillOpacity: 0.9
        });
      },
      onEachFeature: function (f, layer) {
        layer.bindTooltip(f.properties.name_cn, { direction: 'top', offset: [0, -6] });
        layer.on('click', function () { selectMetro(f.properties.stop_id, f.properties.name_cn); });
      }
    });
  }
  function buildBusStopsCluster(space) {
    var cluster = L.markerClusterGroup({
      maxClusterRadius: 55,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true
    });
    featsInSpace(BUS_STOPS.features, space, 'busStops').forEach(function (f) {
      var c = f.geometry.coordinates;
      var p = f.properties;
      var m = L.circleMarker([c[1], c[0]], {
        radius: 3.5, color: '#6d28d9', weight: 1,
        fillColor: '#a78bfa', fillOpacity: 0.9
      });
      m.bindTooltip(p.name_cn, { direction: 'top', offset: [0, -4] });
      m.on('click', function () { selectBusStop(p.stop_id, p.name_cn); });
      cluster.addLayer(m);
    });
    return cluster;
  }
  function busRouteStyle(f) {
    var p = f.properties;
    var brt = /^B\d/.test(routeNumOf(p.route_cn));
    var active = p.status_label === '运营';
    return {
      color: brt ? dirColor(p.route_cn, '#2563eb', '#38bdf8') : (active ? '#9aa1ab' : '#d1d5db'),
      weight: brt ? 2.8 : 1.6,
      opacity: brt ? 0.95 : (active ? 0.6 : 0.45),
      dashArray: active ? null : '4 4'
    };
  }

  // ---------- 掉头折返平滑（仅用于显示） ----------
  function segLenM(a, b) {
    var lat = (a[1] + b[1]) / 2 * Math.PI / 180;
    var dy = (b[1] - a[1]) * 111320;
    var dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
    return Math.sqrt(dx * dx + dy * dy);
  }

  function turnAngleDeg(a, b, c) {
    var sx = Math.cos(b[1] * Math.PI / 180) || 1;
    var b1 = Math.atan2((b[0] - a[0]) * sx, b[1] - a[1]);
    var b2 = Math.atan2((c[0] - b[0]) * sx, c[1] - b[1]);
    var d = Math.abs(b1 - b2);
    if (d > Math.PI) { d = 2 * Math.PI - d; }
    return d * 180 / Math.PI;
  }

  function uturnPoints(a, b, r) {
    var lat = b[1] * Math.PI / 180;
    var sx = Math.cos(lat) || 1;
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx * sx * sx + dy * dy) || 1;
    var ux = dx * sx / len;
    var uy = dy / len;
    var px = -uy;
    var py = ux;
    function off(du, dp) {
      return [
        b[0] + (ux * du + px * dp) * r / (111320 * sx),
        b[1] + (uy * du + py * dp) * r / 111320
      ];
    }
    return [off(1, 0), off(1, 1), off(0, 1)];
  }

  function perpOffsetVec(a, b, meters) {
    var lat = b[1] * Math.PI / 180;
    var sx = Math.cos(lat) || 1;
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx * sx * sx + dy * dy) || 1;
    var px = -dy / len;
    var py = dx / len;
    return [px * meters / (111320 * sx), py * meters / 111320];
  }

  function smoothRouteCoords(coords) {
    var N = coords.length;
    if (N < 4) { return coords.slice(); }
    var out = [];
    var off = [0, 0];
    var offUntil = -1;
    var i = 0;
    while (i < N) {
      if (offUntil >= i) {
        out.push([coords[i][0] + off[0], coords[i][1] + off[1]]);
        i++;
        continue;
      }
      off = [0, 0];
      if (i > 0 && i < N - 1) {
        var ang = turnAngleDeg(coords[i - 1], coords[i], coords[i + 1]);
        if (ang >= 150) {
          var l1 = segLenM(coords[i - 1], coords[i]);
          var l2 = segLenM(coords[i], coords[i + 1]);
          var r = Math.min(18, l1 / 4, l2 / 4);
          if (r >= 6) {
            uturnPoints(coords[i - 1], coords[i], r).forEach(function (p) { out.push(p); });
            off = perpOffsetVec(coords[i - 1], coords[i], r);
            var j = i + 1;
            while (j < N) {
              var m = 2 * i - j;
              if (m < 0 || segLenM(coords[j], coords[m]) > 250) { break; }
              j++;
            }
            offUntil = j - 1;
            i++;
            continue;
          }
        }
      }
      out.push(coords[i]);
      i++;
    }
    return out;
  }

  function smoothFeats(feats) {
    return feats.map(function (f) {
      if (f.geometry.type === 'LineString') {
        return {
          type: f.type,
          properties: f.properties,
          geometry: { type: 'LineString', coordinates: smoothRouteCoords(f.geometry.coordinates) }
        };
      }
      return f;
    });
  }

  function buildBusRoutes(space, feats, cacheKey) {
    return L.geoJSON(smoothFeats(featsInSpace(feats, space, cacheKey)), {
      style: busRouteStyle,
      onEachFeature: function (f, layer) {
        layer.on('click', function () { selectRoute(f.properties.route_cn); });
      }
    });
  }

  var brtSource = busFeatures.filter(function (f) {
    return /^B\d/.test(routeNumOf(f.properties.route_cn));
  });

  function rebuildDataLayers() {
    var remove = function (l) { if (l) { try { map.removeLayer(l); } catch (e) {} } };
    remove(metroRoutesLayer);
    remove(metroStopsLayer);
    remove(busStopsCluster);
    remove(busRoutesLayer);
    remove(brtLayer);
    remove(highlight);
    remove(stopHighlight);
    remove(compareLayer);
    remove(routeStopsLayer);
    remove(navLayer);
    remove(navStopLayer);
    remove(navLabelLayer);

    metroRoutesLayer = buildMetroRoutes(currentSpace);
    metroStopsLayer = buildMetroStops(currentSpace);
    busStopsCluster = buildBusStopsCluster(currentSpace);
    busRoutesLayer = buildBusRoutes(currentSpace, busFeatures, 'busRoutes');
    brtLayer = buildBusRoutes(currentSpace, brtSource, 'brt');
    compareLayer = L.geoJSON(null, {
      style: function (f) {
        return { color: dirColor(f.properties.route_cn, '#7c3aed', '#a78bfa'), weight: 5, opacity: 0.9 };
      }
    });
    compareNum = null;
    navLayer = L.geoJSON(null, {
      style: function (f) {
        return { color: (f.properties && f.properties.navColor) || '#059669', weight: 4, opacity: 0.9 };
      }
    });
    navStopLayer = L.layerGroup();
    navLabelLayer = L.layerGroup();
    highlight = L.geoJSON(null, {
      style: function (f) {
        return { color: dirColor(f.properties.route_cn, '#e11d48', '#fb7185'), weight: 6, opacity: 0.95 };
      }
    });
    stopHighlight = L.layerGroup();
    routeStopsLayer = L.layerGroup();
    stopLabelLayer = L.layerGroup();

    if (layerState.metroRoutes) { map.addLayer(metroRoutesLayer); }
    if (layerState.metroStops) { map.addLayer(metroStopsLayer); }
    if (layerState.busStops) { map.addLayer(busStopsCluster); }
    if (layerState.busRoutes) { map.addLayer(layerState.brtOnly ? brtLayer : busRoutesLayer); }
    map.addLayer(compareLayer);
    map.addLayer(navLayer);
    map.addLayer(navStopLayer);
    map.addLayer(navLabelLayer);
    map.addLayer(highlight);
    map.addLayer(stopHighlight);
    map.addLayer(routeStopsLayer);
    map.addLayer(stopLabelLayer);
    updateStopOverlay();
  }

  // ---------- selection ----------
  function clearSelection() {
    if (highlight) { highlight.clearLayers(); }
    if (stopHighlight) { stopHighlight.clearLayers(); }
    if (compareLayer) { compareLayer.clearLayers(); }
    compareNum = null;
    overlayOn = false;
    overlayStopCount = 0;
    stopLabelsOn = false;
    labelCount = 0;
    labelBlackCount = 0;
    panelRouteDirs = [];
    dirFilter = { A: true, B: true };
    panelRouteFeats = [];
    if (routeStopsLayer) { routeStopsLayer.clearLayers(); }
    if (stopLabelLayer) { stopLabelLayer.clearLayers(); }
    currentPanel = null;
    backStack = [];
    $('#info').innerHTML = '<div class="empty">点击地图上的线路或站点查看详情，或用上方搜索。</div>';
  }

  function fitFeatures(feats) {
    if (!feats.length) { return; }
    var bounds = L.latLngBounds([]);
    feats.forEach(function (f) {
      if (f.geometry.type === 'Point') {
        var c1 = toMapCoords(f.geometry.coordinates[0], f.geometry.coordinates[1]);
        bounds.extend([c1[1], c1[0]]);
      } else if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach(function (c) {
          var m = toMapCoords(c[0], c[1]);
          bounds.extend([m[1], m[0]]);
        });
      }
    });
    if (bounds.isValid()) { map.fitBounds(bounds, { padding: [45, 45] }); }
  }

  function selectRoute(routeCn) {
    backStack = [];
    var isMetro = metroCns.has(routeCn);
    var feats = (isMetro ? metroFeatures : busFeatures).filter(function (f) {
      return f.properties.route_cn === routeCn;
    });
    highlight.clearLayers();
    highlight.addData(smoothFeats(featsInSpace(feats, currentSpace)));
    fitFeatures(feats);
    renderRoutePanel(routeCn, isMetro, feats);
  }

  function selectRouteByKey(key, network, keepBack) {
    if (!keepBack) { backStack = []; }
    if (network === 'metro') {
      var mcns = metroNumToCns[key] || [];
      if (!mcns.length) { return; }
      selectRoute(mcns[0]);
      return;
    }
    var cns = busKeyToCns[key] || [];
    if (!cns.length) { return; }
    var feats = busFeatures.filter(function (f) { return cns.indexOf(f.properties.route_cn) >= 0; });
    highlight.clearLayers();
    highlight.addData(smoothFeats(featsInSpace(feats, currentSpace)));
    fitFeatures(feats);
    renderRoutePanel(cns[0], false, feats);
  }

  function selectRouteByNum(num, network, keepBack) {
    if (network === 'metro') {
      var mcns = metroNumToCns[num] || [];
      if (!mcns.length) { return; }
      if (!keepBack) { backStack = []; }
      selectRoute(mcns[0]);
      return;
    }
    var keys = busNumToKeys[num] || [];
    if (!keys.length) { return; }
    selectRouteByKey(keys[0], 'bus', keepBack);
  }

  function goBackEntry(entry) {
    if (!entry) { return; }
    if (entry.key) { selectRouteByKey(entry.key, entry.net, true); }
    else { selectRouteByNum(entry.num, entry.net, true); }
  }
  function backEntryLabel(entry) {
    return entry && entry.key ? keyLabel(entry.key) : (entry && entry.num ? entry.num : '');
  }

  function selectBusStop(stopId, name) {
    var f = busStopById[stopId];
    if (!f) { return; }
    if (currentPanel && currentPanel.type === 'route') {
      var entry = { net: currentPanel.isMetro ? 'metro' : 'bus' };
      if (currentPanel.isMetro) { entry.num = routeNumOf(currentPanel.routeCn); }
      else { entry.key = routeKeyOf(currentPanel.routeCn); }
      backStack.push(entry);
    }
    currentPanel = { type: 'stop' };
    stopHighlight.clearLayers();
    var c = toMapCoords(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    L.circleMarker([c[1], c[0]], {
      radius: 9, color: '#e11d48', weight: 2, fillColor: '#e11d48', fillOpacity: 0.35
    }).addTo(stopHighlight);
    map.setView([c[1], c[0]], Math.max(map.getZoom(), 15));
    var routeSet = {};
    var routes = [];
    var dn = displayStopName(name);
    stationStopIds(stopId, name).forEach(function (id) {
      (STOP_ROUTES[id] || []).forEach(function (r) {
        if (!routeSet[r]) { routeSet[r] = true; routes.push(r); }
      });
    });
    var plat = platformRecById[stopId]
      ? (stationPlatforms[platformRecById[stopId].stationName] || [])
      : (stationPlatforms[dn] || []);
    var platLine = plat.length > 1
      ? '<div class="co-hint">平台（' + plat.length + '）：' + plat.map(function (p) { return esc(platformLabel(p)); }).join('、') + '</div>'
      : '';
    var backBtn = backStack.length
      ? '<button class="btn ghost back-btn" id="back-btn">← 返回 ' + esc(backEntryLabel(backStack[backStack.length - 1])) + '</button>'
      : '';
    var html = backBtn + '<h3>' + esc(fixedName(name)) + '（公交站）</h3>' +
      '<dl class="kv"><dt>服务线路</dt><dd>' + fmt(routes.length) + ' 条</dd></dl>' +
      '<div class="section-title">经过线路（' + routes.length + '）</div>' +
      '<div class="chips">' +
      routes.map(function (n) {
        return '<button class="chip" data-num="' + esc(n) + '" data-net="bus">' + esc(n) + '</button>';
      }).join('') +
      '</div>' + platLine;
    $('#info').innerHTML = html;
    bindChips();
    var backBtnEl = $('#back-btn');
    if (backBtnEl) {
      backBtnEl.addEventListener('click', function () {
        goBackEntry(backStack.pop());
      });
    }
  }

  function selectMetro(stopId, name) {
    var f = metroStopById[stopId];
    if (!f) { return; }
    if (currentPanel && currentPanel.type === 'route') {
      var entry = { net: currentPanel.isMetro ? 'metro' : 'bus' };
      if (currentPanel.isMetro) { entry.num = routeNumOf(currentPanel.routeCn); }
      else { entry.key = routeKeyOf(currentPanel.routeCn); }
      backStack.push(entry);
    }
    currentPanel = { type: 'stop' };
    var c = toMapCoords(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    stopHighlight.clearLayers();
    L.circleMarker([c[1], c[0]], {
      radius: 10, color: '#e11d48', weight: 2, fillColor: '#e11d48', fillOpacity: 0.3
    }).addTo(stopHighlight);
    map.setView([c[1], c[0]], Math.max(map.getZoom(), 14));

    var lines = METRO_STOP_ROUTES[stopId] || [];
    var feeder = METRO_FEEDERS[stopId];
    var backBtn = backStack.length
      ? '<button class="btn ghost back-btn" id="back-btn">← 返回 ' + esc(backEntryLabel(backStack[backStack.length - 1])) + '</button>'
      : '';
    var html = backBtn + '<h3>' + esc(fixedName(name)) + '（地铁站）</h3>' +
      '<dl class="kv"><dt>停靠线路</dt><dd>' + fmt(f.properties.num_lines) + ' 条</dd></dl>' +
      '<div class="section-title">停靠线路（' + lines.length + '）</div>' +
      '<div class="chips">' +
      lines.map(function (n) {
        return '<button class="chip metro" data-num="' + esc(n) + '" data-net="metro">' + esc(n) + '</button>';
      }).join('') +
      '</div>';
    if (feeder && feeder.bus_stops.length) {
      html += '<div class="section-title">300 米内公交接驳（' + feeder.bus_stops.length + '）</div>' +
        '<ul class="feed">' +
        feeder.bus_stops.map(function (b) {
          return '<li data-stop="' + esc(b[0]) + '" data-name="' + esc(b[1]) + '">' +
            esc(b[1]) + ' <span class="dist">' + b[2] + ' m · ' + b[3] + ' 条线路</span></li>';
        }).join('') +
        '</ul>';
    } else {
      html += '<div class="section-title">300 米内公交接驳</div><div class="empty">未找到</div>';
    }
    $('#info').innerHTML = html;
    bindChips();
    var backBtnEl = $('#back-btn');
    if (backBtnEl) {
      backBtnEl.addEventListener('click', function () {
        goBackEntry(backStack.pop());
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.feed li'), function (li) {
      li.addEventListener('click', function () {
        selectBusStop(li.getAttribute('data-stop'), li.getAttribute('data-name'));
      });
    });
  }

  function bindChips() {
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (ch) {
      ch.addEventListener('click', function () {
        selectRouteByNum(ch.getAttribute('data-num'), ch.getAttribute('data-net'));
      });
    });
  }

  // ---------- colinearity ----------
  var COLINEARITY_ALL_ROUTES = true; // 对所有公交线路开放共线排行

  function computeColinearity(routeCn) {
    var seenStop = {};
    var stops = (BUS_ROUTE_STOPS[routeCn] || []).filter(function (s) {
      if (isGenericStop(s[1])) { return true; } // 通用站名按站点ID计，不按名去重
      var n = normStopName(s[1]);
      if (seenStop[n]) { return false; }
      seenStop[n] = true;
      return true;
    });
    if (!stops.length) { return { stops: 0, list: [] }; }
    var selfKey = routeKeyOf(routeCn);
    var map = {};
    stops.forEach(function (s) {
      var stopName = s[1];
      var stopId = s[2];
      var seen = {};
      var ids = stationStopIds(stopId, stopName);
      ids.forEach(function (id) {
        var keys = stopRouteKeys[id] || {};
        Object.keys(keys).forEach(function (key) {
          if (key === selfKey || seen[key]) { return; }
          seen[key] = true;
          var rec = map[key] || (map[key] = { key: key, num: keyNumOf(key), count: 0, stopNames: [] });
          rec.count += 1;
          if (rec.stopNames.indexOf(stopName) < 0) { rec.stopNames.push(stopName); }
        });
      });
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) {
      if (b.count !== a.count) { return b.count - a.count; }
      return a.num < b.num ? -1 : (a.num > b.num ? 1 : 0);
    });
    return { stops: stops.length, list: list.slice(0, 30) };
  }

  function renderColinearity(routeCn, res) {
    if (!res.list.length) {
      return '<div class="section-title">共线排行</div>' +
        '<div class="empty">未找到共线线路。</div>';
    }
    var selfNum = keyLabel(routeKeyOf(routeCn));
    var rows = res.list.map(function (r, i) {
      var fullNames = busKeyToCns[r.key] || [];
      var lbl = keyLabel(r.key);
      var isBrt = /^B\d/.test(r.num);
      var names = fullNames.length
        ? fullNames.map(function (f) { return '<div class="co-name">' + esc(f) + '</div>'; }).join('')
        : '<div class="co-name">' + esc(lbl) + '</div>';
      var stopsText = r.stopNames.slice(0, 8).join('、');
      if (r.stopNames.length > 8) { stopsText += ' 等 ' + r.stopNames.length + ' 站'; }
      return '<li class="co-row' + (isBrt ? ' brt' : '') + '" data-key="' + esc(r.key) + '">' +
        '<div class="co-rank">' + (i + 1) + '</div>' +
        '<div class="co-main">' +
          '<div class="co-head"><span class="co-num">' + esc(lbl) +
            (isBrt ? '<span class="co-badge">BRT</span>' : '') + '</span>' +
            '<span class="co-count">' + r.count + ' 站</span>' +
            '<button class="co-compare" data-compare="' + esc(r.key) + '">对比</button></div>' +
          names +
          '<div class="co-stops">' + esc(stopsText) + '</div>' +
        '</div></li>';
    }).join('');
    return '<div class="section-title">' + esc(selfNum) + ' 共线排行（' + res.list.length + ' 条）</div>' +
      '<ul class="co-list">' + rows + '</ul>' +
      '<div class="co-hint">点击线路查看详情；点"对比"可在地图上叠加其走向（紫色），再次点击取消。' +
      '按当前方向站点统计，同一站名（含数字分站，如 XX 与 XX2）视为同一站；共线线路按线路号合并（含双向）。</div>';
  }

  function toggleCompare(key) {
    var cmpCns = busKeyToCns[key] || [];
    var cmpFeats = busFeatures.filter(function (f) { return cmpCns.indexOf(f.properties.route_cn) >= 0; });
    if (compareNum === key) {
      compareLayer.clearLayers();
      compareNum = null;
    } else if (cmpFeats.length) {
      compareLayer.clearLayers();
      compareLayer.addData(smoothFeats(featsInSpace(cmpFeats, currentSpace)));
      compareNum = key;
      fitFeatures((panelRouteFeats || []).concat(cmpFeats));
    }
    Array.prototype.forEach.call(document.querySelectorAll('#co-box .co-row'), function (row) {
      row.classList.toggle('comparing', row.getAttribute('data-key') === compareNum);
    });
    updateStopOverlay();
  }

  function routeStopsByDir(key) {
    var out = [];
    (busKeyToCns[key] || []).forEach(function (cn) {
      var stops = BUS_ROUTE_STOPS[cn] || [];
      if (stops.length) { out.push({ dir: dirOf[cn] || 'A', cn: cn, stops: stops }); }
    });
    return out;
  }

  function dupIdsOf(dirs) {
    var counts = {};
    dirs.forEach(function (d) {
      d.stops.forEach(function (st) { counts[st[2]] = (counts[st[2]] || 0) + 1; });
    });
    return counts;
  }

  function segDistM(p, a, b) {
    var lngScale = Math.cos(p[1] * Math.PI / 180) || 1;
    var ax = a[0] * lngScale, ay = a[1];
    var bx = b[0] * lngScale, by = b[1];
    var px = p[0] * lngScale, py = p[1];
    var dx = bx - ax, dy = by - ay;
    var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    var dLng = (px - cx) / lngScale;
    var dLat = py - cy;
    return Math.sqrt(dLng * dLng + dLat * dLat) * 111320;
  }

  function perpOffset(routeCn, stopId, meters) {
    var feat = null;
    for (var i = 0; i < busFeatures.length; i++) {
      if (busFeatures[i].properties.route_cn === routeCn) { feat = busFeatures[i]; break; }
    }
    var stop = busStopById[stopId];
    if (!feat || !stop || feat.geometry.type !== 'LineString') { return [0, 0]; }
    var coords = feat.geometry.coordinates;
    var p = stop.geometry.coordinates;
    var best = null;
    var bestD = Infinity;
    for (var j = 0; j < coords.length - 1; j++) {
      var d = segDistM(p, coords[j], coords[j + 1]);
      if (d < bestD) { bestD = d; best = { a: coords[j], b: coords[j + 1] }; }
    }
    if (!best) { return [0, 0]; }
    var dx = best.b[0] - best.a[0];
    var dy = best.b[1] - best.a[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) { return [0, 0]; }
    var latRad = p[1] * Math.PI / 180;
    var mPerLng = 111320 * Math.cos(latRad);
    if (!mPerLng) { mPerLng = 1; }
    return [-dy / len * meters / mPerLng, dx / len * meters / 111320];
  }

  function pointToLineDist2(coords, p) {
    var lat = p[1] * Math.PI / 180;
    var sx = Math.cos(lat) || 1;
    var px = p[0] * sx;
    var py = p[1];
    var bestD = Infinity;
    for (var i = 0; i < coords.length - 1; i++) {
      var ax = coords[i][0] * sx;
      var ay = coords[i][1];
      var bx = coords[i + 1][0] * sx;
      var by = coords[i + 1][1];
      var dx = bx - ax;
      var dy = by - ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var cx = ax + t * dx;
      var cy = ay + t * dy;
      var d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d2 < bestD) { bestD = d2; }
    }
    return bestD;
  }

  function bestPlatformId(geomCoords, name, fallbackId) {
    if (!geomCoords) { return fallbackId; }
    var ids = stationStopIds(fallbackId, name);
    var bestId = fallbackId;
    var bestD = Infinity;
    ids.forEach(function (id) {
      var ff = busStopById[id];
      if (!ff) { return; }
      var d2 = pointToLineDist2(geomCoords, ff.geometry.coordinates);
      if (d2 < bestD) { bestD = d2; bestId = id; }
    });
    return bestId;
  }

  // 站点标记吸附到线路几何的最近点（300m 内，超出则保持原坐标）
  function snapToLine(p, coords) {
    if (!coords || !coords.length) { return p; }
    var sx = Math.cos(p[1] * Math.PI / 180) || 1;
    var px = p[0] * sx, py = p[1];
    var bestD = Infinity, bestPt = null;
    for (var i = 0; i < coords.length - 1; i++) {
      var ax = coords[i][0] * sx, ay = coords[i][1];
      var bx = coords[i + 1][0] * sx, by = coords[i + 1][1];
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var cx = ax + t * dx, cy = ay + t * dy;
      var d = Math.sqrt(((px - cx) / sx) * ((px - cx) / sx) + (py - cy) * (py - cy)) * 111320;
      if (d < bestD) { bestD = d; bestPt = [cx / sx, cy]; }
    }
    return (bestPt && bestD <= 300) ? bestPt : p;
  }

  // 站点标记位置：优先站内距线路最近的平台；若最近平台仍 >100m，
  // 且该站有派生方向站台（远侧汇聚点），则用派生点（数据缺失方向的显示兜底）
  function bestStopPos(geomCoords, name, fallbackId, dirKey) {
    var pos = null, bestD2 = Infinity;
    // 优先用记录自身的平台（方向分台修正后记录即正确平台；仅当自身平台
    // 距几何>100m（数据偏差）时才在站族内就近吸附/用修正层）
    var own = busStopById[fallbackId];
    if (own && geomCoords) {
      var ownD2 = pointToLineDist2(geomCoords, own.geometry.coordinates);
      if (Math.sqrt(ownD2) * 111320 <= 100) {
        return { coords: snapToLine(own.geometry.coordinates, geomCoords), derived: false };
      }
    }
    var ids = stationStopIds(fallbackId, name);
    ids.forEach(function (id) {
      var ff = busStopById[id];
      if (!ff) { return; }
      var d2 = pointToLineDist2(geomCoords, ff.geometry.coordinates);
      if (d2 < bestD2) { bestD2 = d2; pos = ff.geometry.coordinates; }
    });
    // pointToLineDist2 返回缩放度平方，换算为米
    var bestM = Math.sqrt(bestD2) * 111320;
    if (bestM > 100 && geomCoords) {
      // ① 车来了方向分站坐标（优先，最接近真实站台）
      if (dirKey && chelaileFixes[dirKey]) {
        var n = normStopName(name);
        for (var fi = 0; fi < chelaileFixes[dirKey].length; fi++) {
          var fx = chelaileFixes[dirKey][fi];
          if (normStopName(fx[0]) !== n) { continue; }
          var d2c = pointToLineDist2(geomCoords, [fx[1], fx[2]]);
          if (Math.sqrt(d2c) * 111320 <= 150) {
            return { coords: snapToLine([fx[1], fx[2]], geomCoords), derived: true, source: 'chelaile' };
          }
        }
      }
      // ② 派生方向站台（几何汇聚点兜底）
      var dps = derivedByNorm[normStopName(name)] || [];
      var bestDp = null, bestDpD2 = Infinity;
      dps.forEach(function (p) {
        var d2 = pointToLineDist2(geomCoords, [p.lng, p.lat]);
        if (d2 < bestDpD2) { bestDpD2 = d2; bestDp = p; }
      });
      if (bestDp && Math.sqrt(bestDpD2) * 111320 <= 150) { return { coords: snapToLine([bestDp.lng, bestDp.lat], geomCoords), derived: true }; }
    }
    return pos ? { coords: snapToLine(pos, geomCoords), derived: false } : null;
  }

  function addOverlayStops(dirs, colorA, colorB, dupIds) {
    var stopDirs = {};
    dirs.forEach(function (d) {
      d.stops.forEach(function (st) {
        var dn = displayStopName(st[1], d.cn);
        var rec = stopDirs[dn] || (stopDirs[dn] = { name: dn, stopId: st[2], dirs: [] });
        if (rec.dirs.indexOf(d.dir) < 0) { rec.dirs.push(d.dir); }
        rec.stops = rec.stops || {};
        rec.stops[d.dir] = st;
      });
    });
    dirs.forEach(function (d) {
      var color = d.dir === 'B' ? colorB : colorA;
      var geomCoords = null;
      for (var gi = 0; gi < busFeatures.length; gi++) {
        if (busFeatures[gi].properties.route_cn === d.cn && busFeatures[gi].geometry.type === 'LineString') {
          geomCoords = busFeatures[gi].geometry.coordinates;
          break;
        }
      }
      d.stops.forEach(function (st) {
        var pos = bestStopPos(geomCoords, st[1], st[2], d.cn);
        if (!pos) { return; }
        var c = toMapCoords(pos.coords[0], pos.coords[1]);
        var off = [0, 0];
        if ((dupIds[st[2]] || 0) > 1) {
          var base = perpOffset(dirs[0].cn, st[2], 15);
          off = d.dir === 'B' ? [-base[0], -base[1]] : base;
        }
        var m = L.circleMarker([c[1] + off[1], c[0] + off[0]], {
          radius: (color === '#e11d48' || color === '#7c3aed') ? 5 : 4.2,
          color: color, weight: 1.5, fillColor: color, fillOpacity: 0.85
        });
        m.bindTooltip(displayStopName(st[1], d.cn), { direction: 'top', offset: [0, -5] });
        m.on('click', function () { selectBusStop(st[2], st[1]); });
        routeStopsLayer.addLayer(m);
        overlayStopCount += 1;
      });
    });
    if (stopLabelsOn && stopLabelLayer) {
      function geomOf(cn) {
        if (!cn) { return null; }
        for (var lg = 0; lg < busFeatures.length; lg++) {
          if (busFeatures[lg].properties.route_cn === cn && busFeatures[lg].geometry.type === 'LineString') {
            return busFeatures[lg].geometry.coordinates;
          }
        }
        return null;
      }
      Object.keys(stopDirs).forEach(function (dn) {
        var info = stopDirs[dn];
        // 用该站所属方向的几何与停靠记录定位（按方向标签选，双向都停优先 A；dirs 顺序与标签无关）
        var want = info.dirs.indexOf('A') >= 0 ? 'A' : (info.dirs.indexOf('B') >= 0 ? 'B' : dirs[0].dir);
        var d = null;
        for (var di = 0; di < dirs.length; di++) {
          if (dirs[di].dir === want) { d = dirs[di]; break; }
        }
        if (!d) { return; }
        var st = (info.stops && info.stops[d.dir]) || null;
        if (!st) { st = (info.stops && info.stops[dirs[0].dir]) || null; }
        if (!st) { return; }
        var g = geomOf(d.cn);
        if (!g) { return; }
        var pos = bestStopPos(g, st[1], st[2], d.cn);
        if (!pos) { return; }
        var c = toMapCoords(pos.coords[0], pos.coords[1]);
        var both = info.dirs.indexOf('A') >= 0 && info.dirs.indexOf('B') >= 0;
        var color = both ? '#000000' : (info.dirs.indexOf('B') >= 0 ? colorB : colorA);
        var tip = L.circleMarker([c[1], c[0]], { radius: 0, interactive: false });
        tip.bindTooltip('<span style="color:' + color + '">' + esc(dn) + '</span>', {
          permanent: true, direction: 'top', offset: [0, -7], className: 'stop-label', interactive: false
        });
        stopLabelLayer.addLayer(tip);
        labelCount += 1;
        if (both) { labelBlackCount += 1; }
      });
    }
  }

  function updateStopOverlay() {
    overlayStopCount = 0;
    labelCount = 0;
    labelBlackCount = 0;
    if (!routeStopsLayer) { return; }
    routeStopsLayer.clearLayers();
    if (stopLabelLayer) { stopLabelLayer.clearLayers(); }
    if (!overlayOn) { return; }
    var seldirs = panelRouteDirs.filter(function (d) {
      var dd = d.dir || 'A';
      return dd === 'A' ? dirFilter.A : dirFilter.B;
    });
    addOverlayStops(seldirs, '#e11d48', '#fb7185', dupIdsOf(seldirs));
    if (compareNum) {
      var dirs = routeStopsByDir(compareNum);
      addOverlayStops(dirs, '#7c3aed', '#a78bfa', dupIdsOf(dirs));
    }
  }

  // ---------- stop section (平铺 / 电显 + BRT/地铁标记) ----------
  function metroLineColor(line) {
    if (METRO_COLORS[line]) { return METRO_COLORS[line]; }
    var base = line.replace(/(内环|外环|一期|二期|三期|支线|快线)$/, '');
    return METRO_COLORS[base] || '#64748b';
  }

  function metroLineText(line) {
    return line.replace(/^地铁/, '').replace(/号线/g, '');
  }

  function metroLineBadges(stopId) {
    var arr = busStopMetro[stopId];
    if (!arr || !arr.length) { return ''; }
    var seen = {};
    var out = [];
    arr.forEach(function (m) {
      (m.lines || []).forEach(function (line) {
        if (seen[line]) { return; }
        seen[line] = true;
        var color = metroLineColor(line);
        out.push('<span class="stop-badge metro" style="background:' + color + '">' +
          esc(metroLineText(line)) + '</span>');
      });
    });
    return out.join('');
  }

  function stopBadges(stopId, name) {
    var h = '';
    if (isBrtStop(stopId, name)) { h += '<span class="stop-badge brt">BRT</span>'; }
    h += metroLineBadges(stopId);
    return h;
  }

  function ledBadgeItems(stopId, name) {
    var items = [];
    var arr = busStopMetro[stopId];
    var seen = {};
    if (arr) {
      arr.forEach(function (m) {
        (m.lines || []).forEach(function (line) {
          if (seen[line]) { return; }
          seen[line] = true;
          var color = metroLineColor(line);
          items.push('<span class="stop-badge metro" style="background:' + color + '">' +
            esc(metroLineText(line)) + '</span>');
        });
      });
    }
    if (isBrtStop(stopId, name)) { items.push('<span class="stop-badge brt">BRT</span>'); }
    return items;
  }

  function metroNearText(stopId) {
    var arr = busStopMetro[stopId];
    if (!arr || !arr.length) { return ''; }
    return arr.map(function (m) { return m.name + ' ' + m.dist + 'm'; }).join('、');
  }

  function splitStopName(name) {
    var m = String(name || '').match(/^(.+?)[（(]([^（）()]*)[）)]$/);
    if (m) { return { main: m[1], sub: m[2] }; }
    return { main: String(name || ''), sub: '' };
  }

  function dirTerm(d) {
    var m = d.cn.match(/[（(](.+)[）)]$/);
    return m ? m[1].replace(/--/g, ' → ') : d.cn;
  }

  function chipsBlock(d, isMetro) {
  var stops = displayStops(d.stops, d.cn);
    var dot = (!isMetro && d.dir === 'B') ? '#fb7185' : '#e11d48';
    var title = isMetro
      ? '停靠站点（' + stops.length + '，点击查看）'
      : '停靠站点 · ' + esc(d.dir) + '方向（' + esc(dirTerm(d)) + '，' + stops.length + ' 站）';
    return '<div class="section-title">' + (isMetro ? '' : '<span class="dir-dot" style="background:' + dot + '"></span>') + title + '</div>' +
      '<div class="chips">' + stops.map(function (s) {
        return '<button class="chip' + (isMetro ? ' metro' : '') + '" data-stop="' + esc(s[2]) + '" data-name="' + esc(s[1]) + '" data-net="' + (isMetro ? 'm' : 'b') + '">' +
          esc(displayStopName(s[1], d.cn)) + stopBadges(s[2], s[1]) + '</button>';
      }).join('') + '</div>';
  }

  function ledBlock(d, isMetro) {
  var stops = displayStops(d.stops, d.cn);
    var dot = (!isMetro && d.dir === 'B') ? '#fb7185' : '#e11d48';
    var head = isMetro
      ? esc(d.cn)
      : esc(d.dir) + '方向（' + esc(dirTerm(d)) + '）';
    var cells = stops.map(function (s) {
      var near = metroNearText(s[2]);
      var dn = displayStopName(s[1], d.cn);
      var sp = splitStopName(dn);
      var nameCol = '<span class="led-name-col">' + esc(sp.main) + '</span>';
      var subCol = sp.sub
        ? '<span class="led-sub-col">' + esc('（' + sp.sub + '）') + '</span>'
        : '';
      var badges = ledBadgeItems(s[2], s[1]);
      return '<span class="led-station" data-stop="' + esc(s[2]) + '" data-name="' + esc(s[1]) + '" data-net="' + (isMetro ? 'm' : 'b') + '"' +
        (near ? ' title="近 ' + esc(near) + '"' : '') + '>' +
        '<span class="led-badge-stack">' + badges.join('') + '</span>' +
        '<span class="led-name-wrap">' + nameCol + subCol + '</span>' +
        '</span>';
    }).join('');
    return '<div class="led-panel"><div class="led-head">' + (isMetro ? '' : '<span class="dir-dot" style="background:' + dot + '"></span>') + head +
      '<span class="led-hint">可左右滑动</span></div>' +
      '<div class="led-strip">' + cells + '</div></div>';
  }

  function stopSectionInner(routeCn, isMetro) {
    var mode = stopDisplayMode;
    var dirChecks = '';
    if (!isMetro && panelRouteDirs.length > 1) {
      dirChecks = '<label class="dir-check"><input type="checkbox" data-dir="A"' + (dirFilter.A ? ' checked' : '') + '> A方向</label>' +
        '<label class="dir-check"><input type="checkbox" data-dir="B"' + (dirFilter.B ? ' checked' : '') + '> B方向</label>';
    }
    var control = '<div class="stop-mode">' + dirChecks +
      '<button class="mode-btn' + (mode === 'chips' ? ' active' : '') + '" data-mode="chips">平铺</button>' +
      '<button class="mode-btn' + (mode === 'led' ? ' active' : '') + '" data-mode="led">电显</button></div>';
    if (isMetro) {
      var stops = METRO_ROUTE_STOPS[routeCn] || [];
      if (!stops.length) { return control + '<div class="empty">无站点数据</div>'; }
      return control + (mode === 'led' ? ledBlock({ dir: 'A', cn: routeCn, stops: stops }, true) : chipsBlock({ dir: 'A', cn: routeCn, stops: stops }, true));
    }
    var dirs = panelRouteDirs.filter(function (d) {
      var dd = d.dir || 'A';
      return dd === 'A' ? dirFilter.A : dirFilter.B;
    }).sort(function (a, b) { return a.dir < b.dir ? -1 : 1; });
    if (!dirs.length) { return control + '<div class="empty">无站点数据</div>'; }
    return control + dirs.map(function (d) {
      return mode === 'led' ? ledBlock(d, false) : chipsBlock(d, false);
    }).join('');
  }

  function bindStopClicks() {
    Array.prototype.forEach.call(document.querySelectorAll('.chips .chip'), function (ch) {
      ch.addEventListener('click', function () {
        var net = ch.getAttribute('data-net');
        if (net === 'm') { selectMetro(ch.getAttribute('data-stop'), ch.getAttribute('data-name')); }
        else { selectBusStop(ch.getAttribute('data-stop'), ch.getAttribute('data-name')); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.led-station'), function (cell) {
      cell.addEventListener('click', function () {
        var net = cell.getAttribute('data-net');
        if (net === 'm') { selectMetro(cell.getAttribute('data-stop'), cell.getAttribute('data-name')); }
        else { selectBusStop(cell.getAttribute('data-stop'), cell.getAttribute('data-name')); }
      });
    });
  }

  function refreshStopSection() {
    var sec = $('#stop-section');
    if (!sec || !currentPanel || currentPanel.type !== 'route') { return; }
    sec.innerHTML = stopSectionInner(currentPanel.routeCn, currentPanel.isMetro);
    bindStopClicks();
    bindStopMode();
    bindDirChecks();
  }

  function bindStopMode() {
    Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (btn) {
      btn.addEventListener('click', function () {
        stopDisplayMode = btn.getAttribute('data-mode');
        refreshStopSection();
      });
    });
  }

  function bindDirChecks() {
    Array.prototype.forEach.call(document.querySelectorAll('.dir-check input'), function (cb) {
      cb.addEventListener('change', function () {
        dirFilter[cb.getAttribute('data-dir')] = cb.checked;
        refreshStopSection();
        applyDirFilterToMap();
        updateStopOverlay();
      });
    });
  }

  function applyDirFilterToMap() {
    if (!currentPanel || currentPanel.type !== 'route' || currentPanel.isMetro) { return; }
    var feats = (panelRouteFeats || []).filter(function (f) {
      var d = dirOf[f.properties.route_cn] || 'A';
      return d === 'A' ? dirFilter.A : dirFilter.B;
    });
    highlight.clearLayers();
    if (feats.length) { highlight.addData(smoothFeats(featsInSpace(feats, currentSpace))); }
  }

  function renderRoutePanel(routeCn, isMetro, feats) {
    var p = feats[0].properties;
    if (compareLayer) { compareLayer.clearLayers(); }
    compareNum = null;
    currentPanel = { type: 'route', routeCn: routeCn, isMetro: isMetro };
    overlayOn = false;
    overlayStopCount = 0;
    stopLabelsOn = false;
    labelCount = 0;
    labelBlackCount = 0;
    panelRouteDirs = [];
    dirFilter = { A: true, B: true };
    panelRouteFeats = [];
    stopDisplayMode = 'chips';
    if (routeStopsLayer) { routeStopsLayer.clearLayers(); }
    if (stopLabelLayer) { stopLabelLayer.clearLayers(); }
    if (!isMetro) { panelRouteDirs = routeStopsByDir(routeKeyOf(routeCn)); }
    panelRouteFeats = feats;
    var kv = '<dl class="kv">' +
      (isMetro
        ? '<dt>状态</dt><dd>' + esc(p.op_status) + '</dd>' +
          '<dt>类型</dt><dd>' + esc(p.route_type || '—') + '</dd>'
        : '<dt>类型</dt><dd>' + esc(p.route_type || '—') + '</dd>' +
          '<dt>状态</dt><dd>' + esc(p.status_label || '—') +
          (p.status_note ? ' <span class="warn">' + esc(p.status_note) + '</span>' : '') + '</dd>') +
      '<dt>首末站</dt><dd>' + esc(p.s_stop_cn || '—') + ' ⇄ ' + esc(p.e_stop_cn || '—') + '</dd>' +
      '<dt>里程</dt><dd>' + fmt(p.distance_km) + ' km</dd>' +
      '<dt>站点</dt><dd>' + fmt(p.total_stop) + ' 站</dd>' +
      '<dt>票价</dt><dd>' + fmt(p.basic_prc) + ' 元' +
        (p.total_prc && p.total_prc !== p.basic_prc ? '（全程 ' + fmt(p.total_prc) + '）' : '') + '</dd>' +
      '<dt>运营公司</dt><dd>' + esc(p.company_cn || '—') + '</dd>' +
      (p.start_time ? '<dt>首末班</dt><dd>' + esc(fmtTime(p.start_time)) + ' – ' + esc(fmtTime(p.end_time)) + '</dd>' : '') +
      '</dl>';
    var isBrtRoute = !isMetro && /^B\d/.test(routeNumOf(routeCn));
    var showCo = !isMetro && (COLINEARITY_ALL_ROUTES || isBrtRoute);
    var totalStops = isMetro
      ? (METRO_ROUTE_STOPS[routeCn] || []).length
      : panelRouteDirs.reduce(function (s, d) { return s + displayStops(d.stops, d.cn).length; }, 0);
    var stopsCard = '<div class="card" id="card-stops">' +
      '<button class="card-head" id="card-stops-head" aria-expanded="false">' +
      '<span class="card-title">停靠站点</span>' +
      '<span class="card-count">' + totalStops + ' 站</span><span class="chev">▸</span></button>' +
      '<div class="card-body" id="card-stops-body">' +
      '<div id="stop-section">' + stopSectionInner(routeCn, isMetro) + '</div>' +
      '</div></div>';
    var coHtml = showCo
      ? '<div class="card" id="card-co">' +
        '<button class="card-head" id="card-co-head" aria-expanded="false">' +
        '<span class="card-title">共线排行</span><span class="chev">▸</span></button>' +
        '<div class="card-body" id="card-co-body">' +
        '<label class="check overlay-toggle"><input type="checkbox" id="stop-overlay"> 显示线路及对比线路站点</label>' +
        '<label class="check overlay-toggle"><input type="checkbox" id="stop-labels"> 显示站名</label>' +
        '<div id="co-box" class="co-box"></div>' +
        '</div></div>'
      : '';
    var routeBackBtn = backStack.length
      ? '<button class="btn ghost back-btn" id="route-back-btn">← 返回 ' + esc(backEntryLabel(backStack[backStack.length - 1])) + '</button>'
      : '';
    $('#info').innerHTML = routeBackBtn + '<h3>' + esc(p.route_cn) + '</h3>' + kv + stopsCard + coHtml;
    bindStopClicks();
    bindStopMode();
    bindDirChecks();
    var routeBackEl = $('#route-back-btn');
    if (routeBackEl) {
      routeBackEl.addEventListener('click', function () {
        goBackEntry(backStack.pop());
      });
    }
    var stopsHead = $('#card-stops-head');
    var stopsBody = $('#card-stops-body');
    if (stopsHead) {
      stopsHead.addEventListener('click', function () {
        var isOpen = stopsBody.classList.contains('open');
        stopsBody.classList.toggle('open', !isOpen);
        stopsHead.classList.toggle('open', !isOpen);
      });
    }
    var coHead = $('#card-co-head');
    var coBody = $('#card-co-body');
    var coFilled = false;
    if (coHead) {
      coHead.addEventListener('click', function () {
        var isOpen = coBody.classList.contains('open');
        if (isOpen) {
          coBody.classList.remove('open');
          coHead.classList.remove('open');
          return;
        }
        coBody.classList.add('open');
        coHead.classList.add('open');
        if (!coFilled) {
          coFilled = true;
          var box = $('#co-box');
          box.innerHTML = renderColinearity(routeCn, computeColinearity(routeCn));
          box.classList.add('co-show');
        }
      });
    }
    var coBox = $('#co-box');
    if (coBox) {
      coBox.addEventListener('click', function (ev) {
        var t = ev.target;
        while (t && t !== coBox && !t.getAttribute('data-key') && !t.getAttribute('data-compare')) { t = t.parentNode; }
        if (!t || t === coBox) { return; }
        if (t.getAttribute('data-compare')) {
          toggleCompare(t.getAttribute('data-compare'));
          return;
        }
        if (currentPanel && currentPanel.type === 'route' && !currentPanel.isMetro) {
          backStack.push({ key: routeKeyOf(currentPanel.routeCn), net: 'bus' });
        }
        selectRouteByKey(t.getAttribute('data-key'), 'bus', true);
      });
    }
    var overlayChk = $('#stop-overlay');
    if (overlayChk) {
      overlayChk.addEventListener('change', function () {
        overlayOn = overlayChk.checked;
        var lchk = $('#stop-labels');
        if (lchk) {
          lchk.disabled = !overlayChk.checked;
          if (!overlayChk.checked) { lchk.checked = false; stopLabelsOn = false; }
        }
        updateStopOverlay();
      });
    }
    var labelsChk = $('#stop-labels');
    if (labelsChk) {
      labelsChk.addEventListener('change', function () {
        stopLabelsOn = labelsChk.checked;
        updateStopOverlay();
      });
    }
  }

  // ---------- tabs ----------
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-tab');
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
        b.classList.toggle('active', b === btn);
      });
      Array.prototype.forEach.call(document.querySelectorAll('.tab-body'), function (s) {
        s.classList.toggle('active', s.id === 'tab-' + name);
      });
    });
  });

  // ---------- search ----------
  var routeInput = $('#route-search');
  var routeSuggest = $('#route-suggest');
  var stopInput = $('#stop-search');
  var stopSuggest = $('#stop-suggest');

  // 疑似停运/调整线路（搜索时灰显）
  var routeDoubtByKey = {};
  busFeatures.forEach(function (f) {
    var p = f.properties;
    var key = routeKeyOf(p.route_cn);
    var lbl = p.status_label || '';
    if (!routeDoubtByKey[key] && /疑似|停运/.test(lbl)) { routeDoubtByKey[key] = lbl; }
  });

  function routeCandidates(q) {
    q = q.trim().toLowerCase();
    if (q.length < 1) { return []; }
    function score(n) {
      var s = String(n).toLowerCase();
      if (s === q || s === q + '路') { return 0; }
      if (s.indexOf(q) === 0) { return 1; }
      return 2;
    }
    var out = [];
    Object.keys(busNumToKeys).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0) {
        busNumToKeys[n].forEach(function (key) {
          out.push({ label: keyLabel(key), net: 'bus', num: n, key: key, sc: score(n), st: routeDoubtByKey[key] || '' });
        });
      }
    });
    Object.keys(metroNumToCns).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0) { out.push({ label: n, net: 'metro', num: n, sc: score(n) }); }
    });
    out.sort(function (a, b) {
      if (a.sc !== b.sc) { return a.sc - b.sc; }
      return a.num < b.num ? -1 : (a.num > b.num ? 1 : 0);
    });
    var seen = {};
    var seenNum = {};
    var seenKey = {};
    var result = [];
    function push(o) {
      if (result.length >= 12) { return; }
      if (seen[o.label]) { return; }
      if (o.key !== undefined) {
        if (seenKey[o.key]) { return; }
        seenKey[o.key] = true;
      } else if (seenNum[o.num]) {
        return;
      }
      seen[o.label] = true;
      seenNum[o.num] = true;
      result.push(o);
    }
    out.forEach(push);
    busFeatures.forEach(function (f) {
      if (f.properties.route_cn.toLowerCase().indexOf(q) >= 0) {
        push({ label: f.properties.route_cn, net: 'bus', num: routeNumOf(f.properties.route_cn), key: routeKeyOf(f.properties.route_cn), st: routeDoubtByKey[routeKeyOf(f.properties.route_cn)] || '' });
      }
    });
    if (result.length < 12) {
      metroFeatures.forEach(function (f) {
        if (f.properties.route_cn.toLowerCase().indexOf(q) >= 0) {
          push({ label: f.properties.route_cn, net: 'metro', num: routeNumOf(f.properties.route_cn) });
        }
      });
    }
    return result;
  }

  routeInput.addEventListener('input', function () {
    var items = routeCandidates(routeInput.value);
    renderSuggest(routeSuggest, items, function (o) {
      routeInput.value = o.num;
      routeSuggest.classList.remove('show');
      if (o.key !== undefined) { selectRouteByKey(o.key, o.net); }
      else { selectRouteByNum(o.num, o.net); }
    }, function (o) { return o.label; }, function (o) { return o.net === 'metro' ? '地铁' : '公交'; });
  });

  var busStopNames = {};
  BUS_STOPS.features.forEach(function (f) {
    var n = fixedName(f.properties.name_cn);
    (busStopNames[n] = busStopNames[n] || []).push(f.properties.stop_id);
  });
  // 旧名（更名/截断前的写法）也可搜索，指向同一批站点
  Object.keys(STOP_NAME_FIXES).forEach(function (raw) {
    var fixed = STOP_NAME_FIXES[raw];
    if (raw !== fixed && busStopNames[fixed] && !busStopNames[raw]) {
      busStopNames[raw] = busStopNames[fixed];
    }
  });
  var metroStopNames = {};
  METRO_STOPS.features.forEach(function (f) {
    var n = fixedName(f.properties.name_cn);
    (metroStopNames[n] = metroStopNames[n] || []).push(f.properties.stop_id);
  });
  var STOP_PINYIN = window.STOP_PINYIN || {};
  Object.keys(STOP_NAME_FIXES).forEach(function (raw) {
    var fixed = STOP_NAME_FIXES[raw];
    if (!STOP_PINYIN[fixed]) { STOP_PINYIN[fixed] = STOP_PINYIN[raw] || ''; }
  });

  function stopPyMatch(name, q) {
    if (name.toLowerCase().indexOf(q) >= 0) { return true; }
    var py = STOP_PINYIN[name];
    if (!py) { return false; }
    var sep = py.indexOf('|');
    if (sep > 0 && py.slice(0, sep).indexOf(q) >= 0) { return true; }
    if (sep >= 0 && py.slice(sep + 1).indexOf(q) >= 0) { return true; }
    return false;
  }

  function stopCandidates(q) {
    q = q.trim().toLowerCase();
    if (!q) { return []; }
    function collect(names, net, tag, max) {
      var best = {};
      Object.keys(names).forEach(function (n) {
        if (!stopPyMatch(n, q)) { return; }
        var dn = searchStopName(n);
        if (best[dn] === undefined || n === dn) { best[dn] = n; }
      });
      var out2 = [];
      Object.keys(best).forEach(function (dn) {
        if (out2.length >= max) { return; }
        out2.push({ label: dn + tag, net: net, name: best[dn] });
      });
      return out2;
    }
    var out = collect(busStopNames, 'bus', '（公交）', 10);
    out = out.concat(collect(metroStopNames, 'metro', '（地铁）', Math.max(0, 12 - out.length)));
    return out.slice(0, 12);
  }

  stopInput.addEventListener('input', function () {
    var items = stopCandidates(stopInput.value);
    renderSuggest(stopSuggest, items, function (o) {
      stopInput.value = o.name;
      stopSuggest.classList.remove('show');
      if (o.net === 'metro') {
        var sid = metroStopNames[o.name][0];
        selectMetro(sid, o.name);
      } else {
        var bids = busStopNames[o.name];
        selectBusStop(bids[0], o.name);
      }
    }, function (o) { return o.label; }, function (o) { return o.net === 'metro' ? '地铁' : '公交'; });
  });

  function renderSuggest(ul, items, onClick, label, tag) {
    ul.innerHTML = '';
    if (!items.length) { ul.classList.remove('show'); return; }
    items.forEach(function (o) {
      var li = document.createElement('li');
      var stBadge = o.st ? ' <em class="st-badge">' + esc(o.st.replace(/（待核对）/, '')) + '</em>' : '';
      li.innerHTML = '<span>' + esc(label(o)) + stBadge + '</span><span class="tag">' + esc(tag(o)) + '</span>';
      if (o.st) { li.classList.add('muted'); }
      li.addEventListener('click', function () { onClick(o); });
      ul.appendChild(li);
    });
    ul.classList.add('show');
  }

  document.addEventListener('click', function (e) {
    if (!routeSuggest.contains(e.target) && e.target !== routeInput) { routeSuggest.classList.remove('show'); }
    if (!stopSuggest.contains(e.target) && e.target !== stopInput) { stopSuggest.classList.remove('show'); }
  });

  $('#clear-btn').addEventListener('click', clearSelection);

  // ---------- layer toggles ----------
  function bindToggle(id, key, on) {
    var cb = $(id);
    cb.checked = on;
    cb.addEventListener('change', function () {
      layerState[key] = cb.checked;
      if (key === 'brtOnly') {
        if (layerState.busRoutes) {
          if (cb.checked) { map.removeLayer(busRoutesLayer); map.addLayer(brtLayer); }
          else { map.removeLayer(brtLayer); map.addLayer(busRoutesLayer); }
        }
        return;
      }
      var layer = { metroRoutes: metroRoutesLayer, metroStops: metroStopsLayer,
                    busStops: busStopsCluster, busRoutes: busRoutesLayer }[key];
      if (!layer) { return; }
      if (cb.checked) { map.addLayer(layer); } else { map.removeLayer(layer); }
    });
  }
  bindToggle('#lyr-metro-routes', 'metroRoutes', false);
  bindToggle('#lyr-metro-stops', 'metroStops', false);
  bindToggle('#lyr-bus-stops', 'busStops', false);
  bindToggle('#lyr-bus-routes', 'busRoutes', false);
  bindToggle('#lyr-brt-only', 'brtOnly', false);

  // ---------- basemap switcher ----------
  Array.prototype.forEach.call(document.querySelectorAll('input[name="basemap"]'), function (radio) {
    radio.addEventListener('change', function () {
      if (radio.checked) { setTileLayer(radio.value); }
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="basemap"]'), function (radio) {
    radio.checked = (radio.value === currentBasemap);
  });

  // ---------- panel collapse / expand ----------
  var panelToggleBtn = $('#panel-toggle');
  if (panelToggleBtn) {
    panelToggleBtn.addEventListener('click', function () {
      var bodyEl = $('body');
      var collapsed = bodyEl.classList.toggle('panel-collapsed');
      panelToggleBtn.textContent = collapsed ? '☰' : '»';
    });
  }

  // ---------- stats & legend ----------
  var busBrt = busFeatures.filter(function (f) { return /^B\d/.test(routeNumOf(f.properties.route_cn)); }).length;
  var metroOp = metroFeatures.filter(function (f) { return f.properties.op_status === '运营'; }).length;
  $('#stats').textContent =
    '公交 ' + busFeatures.length + ' 条线路 · ' + BUS_STOPS.features.length + ' 站 · BRT ' + busBrt +
    ' 条 | 地铁 运营 ' + metroOp + ' / 在建 ' + (metroFeatures.length - metroOp) +
    ' 条记录 · ' + METRO_STOPS.features.length + ' 站';
  $('#legend').innerHTML =
    '<div class="row"><span class="sw" style="background:#2563eb"></span>BRT 线路</div>' +
    '<div class="row"><span class="sw gray"></span>普通公交</div>' +
    '<div class="row"><span class="sw dash"></span>地铁（在建/规划）</div>';

  setTileLayer(currentBasemap);
  rebuildDataLayers();
  clearSelection();

  // test-only debug hook (not used in production)
  if (window.__APP_DEBUG__) {
    window.__APP_DEBUG__ = {
      selectBusStop: selectBusStop, selectMetro: selectMetro,
      selectRouteByNum: selectRouteByNum, clearSelection: clearSelection,
      routeCandidates: routeCandidates,
      routeKeyOf: routeKeyOf,
      numKeys: function (num) { return (busNumToKeys[num] || []).slice(); },
      stopCandidates: stopCandidates,
      fmtTime: fmtTime,
      normStop: function (n) { return normStopName(n); },
      normIds: function (n) { return stationStopIdsByBase(n); },
      getPlatforms: function (n) { return stationPlatforms[displayStopName(n)] || []; },
      displayStops: displayStops,
      normDisplay: function (n) { return displayStopName(n); },
      isBrt: function (id, name) { return isBrtStop(id, name); },
      colinearity: computeColinearity,
      smoothCoords: smoothRouteCoords,
      pickPlatform: bestPlatformId,
      bestPos: bestStopPos,
      planRoute: planRoute,
      buildNavGraph: buildNavGraph,
      drawNavPlan: drawNavPlan,
      getNavLabels: function () { return navLabelCount; },
      getNavMarked: function () { return navMarkedStations.length; },
      getNavSegmentLen: function () {
        var adds = (navLayer && navLayer._adds) || [];
        if (!adds.length) { return 0; }
        var n = 0;
        (adds[adds.length - 1] || []).forEach(function (f) {
          if (f && f.geometry && f.geometry.coordinates) { n += f.geometry.coordinates.length; }
        });
        return n;
      },
      getCompare: function () { return compareNum; },
      getLabels: function () { return { total: labelCount, black: labelBlackCount }; },
      getDir: function (cn) { return dirOf[cn] || null; },
      setStopMode: function (m) { stopDisplayMode = m; refreshStopSection(); },
      setDirFilter: function (a, b) {
        dirFilter.A = !!a;
        dirFilter.B = !!b;
        refreshStopSection();
        applyDirFilterToMap();
        updateStopOverlay();
      },
      getHighlightDirs: function () {
        var out = [];
        (highlight && highlight._adds || []).forEach(function (feats2) {
          (feats2 || []).forEach(function (f) {
            var d = dirOf[f.properties.route_cn] || 'A';
            if (out.indexOf(d) < 0) { out.push(d); }
          });
        });
        return out.sort();
      },
      isBrtStop: function (id) { return !!brtStationIds[id]; },
      metroNear: function (id) { return busStopMetro[id] || []; },
      getOverlay: function () { return overlayOn; },
      getOverlayCount: function () { return overlayStopCount; },
      setBasemap: setTileLayer, getSpace: function () { return currentSpace; },
      getBasemap: function () { return currentBasemap; }
    };
  }
})();
