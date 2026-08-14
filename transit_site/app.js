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
    if (window.__DEFAULT_BASEMAP__ && BASEMAPS[window.__DEFAULT_BASEMAP__]) {
      return window.__DEFAULT_BASEMAP__;
    }
    return 'gaode';
  })();
  var currentSpace = BASEMAPS[initialBasemapKey].space;
  var currentBasemap = initialBasemapKey;
  var tileLayer = null;
  function setTileLayer(key) {
    var bm = BASEMAPS[key];
    if (!bm) { return; }
    currentBasemap = key;
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
    metroRoutes: true, metroStops: true, busStops: true, busRoutes: true, brtOnly: false
  };
  var metroRoutesLayer = null;
  var metroStopsLayer = null;
  var busStopsCluster = null;
  var busRoutesLayer = null;
  var brtLayer = null;
  var highlight = null;
  var stopHighlight = null;

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
      color: brt ? '#2563eb' : (active ? '#9aa1ab' : '#d1d5db'),
      weight: brt ? 2.8 : 1.6,
      opacity: brt ? 0.95 : (active ? 0.6 : 0.45),
      dashArray: active ? null : '4 4'
    };
  }
  function buildBusRoutes(space, feats, cacheKey) {
    return L.geoJSON(featsInSpace(feats, space, cacheKey), {
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

    metroRoutesLayer = buildMetroRoutes(currentSpace);
    metroStopsLayer = buildMetroStops(currentSpace);
    busStopsCluster = buildBusStopsCluster(currentSpace);
    busRoutesLayer = buildBusRoutes(currentSpace, busFeatures, 'busRoutes');
    brtLayer = buildBusRoutes(currentSpace, brtSource, 'brt');
    highlight = L.geoJSON(null, { style: { color: '#e11d48', weight: 6, opacity: 0.95 } });
    stopHighlight = L.layerGroup();

    if (layerState.metroRoutes) { map.addLayer(metroRoutesLayer); }
    if (layerState.metroStops) { map.addLayer(metroStopsLayer); }
    if (layerState.busStops) { map.addLayer(busStopsCluster); }
    if (layerState.busRoutes) { map.addLayer(layerState.brtOnly ? brtLayer : busRoutesLayer); }
    map.addLayer(highlight);
    map.addLayer(stopHighlight);
  }

  // ---------- selection ----------
  function clearSelection() {
    if (highlight) { highlight.clearLayers(); }
    if (stopHighlight) { stopHighlight.clearLayers(); }
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
    var isMetro = metroCns.has(routeCn);
    var feats = (isMetro ? metroFeatures : busFeatures).filter(function (f) {
      return f.properties.route_cn === routeCn;
    });
    highlight.clearLayers();
    highlight.addData(featsInSpace(feats, currentSpace));
    fitFeatures(feats);
    renderRoutePanel(routeCn, isMetro, feats);
  }

  function selectRouteByNum(num, network) {
    var cns = network === 'metro' ? (metroNumToCns[num] || []) : (busNumToCns[num] || []);
    if (!cns.length) { return; }
    if (network === 'metro') { selectRoute(cns[0]); }
    else {
      var feats = busFeatures.filter(function (f) { return routeNumOf(f.properties.route_cn) === num; });
      highlight.clearLayers();
      highlight.addData(featsInSpace(feats, currentSpace));
      fitFeatures(feats);
      renderRoutePanel(cns[0], false, feats);
    }
  }

  function selectBusStop(stopId, name) {
    var f = busStopById[stopId];
    if (!f) { return; }
    stopHighlight.clearLayers();
    var c = toMapCoords(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    L.circleMarker([c[1], c[0]], {
      radius: 9, color: '#e11d48', weight: 2, fillColor: '#e11d48', fillOpacity: 0.35
    }).addTo(stopHighlight);
    map.setView([c[1], c[0]], Math.max(map.getZoom(), 15));
    var routes = STOP_ROUTES[stopId] || [];
    var html = '<h3>' + esc(name) + '（公交站）</h3>' +
      '<dl class="kv"><dt>服务线路</dt><dd>' + fmt(f.properties.num_routes) + ' 条</dd></dl>' +
      '<div class="section-title">经过线路（' + routes.length + '）</div>' +
      '<div class="chips">' +
      routes.map(function (n) {
        return '<button class="chip" data-num="' + esc(n) + '" data-net="bus">' + esc(n) + '</button>';
      }).join('') +
      '</div>';
    $('#info').innerHTML = html;
    bindChips();
  }

  function selectMetro(stopId, name) {
    var f = metroStopById[stopId];
    if (!f) { return; }
    var c = toMapCoords(f.geometry.coordinates[0], f.geometry.coordinates[1]);
    stopHighlight.clearLayers();
    L.circleMarker([c[1], c[0]], {
      radius: 10, color: '#e11d48', weight: 2, fillColor: '#e11d48', fillOpacity: 0.3
    }).addTo(stopHighlight);
    map.setView([c[1], c[0]], Math.max(map.getZoom(), 14));

    var lines = METRO_STOP_ROUTES[stopId] || [];
    var feeder = METRO_FEEDERS[stopId];
    var html = '<h3>' + esc(name) + '（地铁站）</h3>' +
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

  function renderRoutePanel(routeCn, isMetro, feats) {
    var p = feats[0].properties;
    var stops = isMetro ? (METRO_ROUTE_STOPS[routeCn] || []) : (BUS_ROUTE_STOPS[routeCn] || []);
    var kv = '<dl class="kv">' +
      (isMetro
        ? '<dt>状态</dt><dd>' + esc(p.op_status) + '</dd>' +
          '<dt>类型</dt><dd>' + esc(p.route_type || '—') + '</dd>'
        : '<dt>类型</dt><dd>' + esc(p.route_type || '—') + '</dd>' +
          '<dt>状态</dt><dd>' + esc(p.status_label || '—') + '</dd>') +
      '<dt>起讫</dt><dd>' + esc(p.s_stop_cn || '—') + ' → ' + esc(p.e_stop_cn || '—') + '</dd>' +
      '<dt>里程</dt><dd>' + fmt(p.distance_km) + ' km</dd>' +
      '<dt>站点</dt><dd>' + fmt(p.total_stop) + ' 站</dd>' +
      '<dt>票价</dt><dd>' + fmt(p.basic_prc) + ' 元' +
        (p.total_prc && p.total_prc !== p.basic_prc ? '（全程 ' + fmt(p.total_prc) + '）' : '') + '</dd>' +
      '<dt>运营公司</dt><dd>' + esc(p.company_cn || '—') + '</dd>' +
      (p.start_time ? '<dt>首末班</dt><dd>' + esc(p.start_time) + ' – ' + esc(p.end_time) + '</dd>' : '') +
      '</dl>';
    var stopChips = stops.length
      ? '<div class="section-title">停靠站点（' + stops.length + '，点击查看）</div>' +
        '<div class="chips">' + stops.map(function (s) {
          var cls = isMetro ? ' chip metro' : ' chip';
          return '<button class="' + cls + '" data-stop="' + esc(s[2]) + '" data-name="' + esc(s[1]) + '" data-net="' + (isMetro ? 'm' : 'b') + '">' +
            esc(s[1]) + '</button>';
        }).join('') + '</div>'
      : '';
    $('#info').innerHTML = '<h3>' + esc(p.route_cn) + '</h3>' + kv + stopChips;
    Array.prototype.forEach.call(document.querySelectorAll('.chips .chip'), function (ch) {
      ch.addEventListener('click', function () {
        var net = ch.getAttribute('data-net');
        if (net === 'm') { selectMetro(ch.getAttribute('data-stop'), ch.getAttribute('data-name')); }
        else { selectBusStop(ch.getAttribute('data-stop'), ch.getAttribute('data-name')); }
      });
    });
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

  function routeCandidates(q) {
    q = q.trim().toLowerCase();
    if (q.length < 1) { return []; }
    var out = [];
    Object.keys(busNumToCns).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0) { out.push({ label: n, net: 'bus', num: n }); }
    });
    Object.keys(metroNumToCns).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0) { out.push({ label: n, net: 'metro', num: n }); }
    });
    busFeatures.forEach(function (f) {
      if (out.length >= 12) { return; }
      if (f.properties.route_cn.toLowerCase().indexOf(q) >= 0) {
        out.push({ label: f.properties.route_cn, net: 'bus', num: routeNumOf(f.properties.route_cn) });
      }
    });
    if (out.length < 12) {
      metroFeatures.forEach(function (f) {
        if (out.length >= 12) { return; }
        if (f.properties.route_cn.toLowerCase().indexOf(q) >= 0) {
          out.push({ label: f.properties.route_cn, net: 'metro', num: routeNumOf(f.properties.route_cn) });
        }
      });
    }
    var seen = {};
    return out.filter(function (o) {
      if (seen[o.label]) { return false; }
      seen[o.label] = true;
      return true;
    }).slice(0, 12);
  }

  routeInput.addEventListener('input', function () {
    var items = routeCandidates(routeInput.value);
    renderSuggest(routeSuggest, items, function (o) {
      routeInput.value = o.num;
      routeSuggest.classList.remove('show');
      selectRouteByNum(o.num, o.net);
    }, function (o) { return o.label; }, function (o) { return o.net === 'metro' ? '地铁' : '公交'; });
  });

  var busStopNames = {};
  BUS_STOPS.features.forEach(function (f) {
    var n = f.properties.name_cn;
    (busStopNames[n] = busStopNames[n] || []).push(f.properties.stop_id);
  });
  var metroStopNames = {};
  METRO_STOPS.features.forEach(function (f) {
    var n = f.properties.name_cn;
    (metroStopNames[n] = metroStopNames[n] || []).push(f.properties.stop_id);
  });

  function stopCandidates(q) {
    q = q.trim().toLowerCase();
    if (!q) { return []; }
    var out = [];
    Object.keys(busStopNames).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0 && out.length < 10) {
        out.push({ label: n + '（公交）', net: 'bus', name: n });
      }
    });
    Object.keys(metroStopNames).forEach(function (n) {
      if (n.toLowerCase().indexOf(q) >= 0 && out.length < 12) {
        out.push({ label: n + '（地铁）', net: 'metro', name: n });
      }
    });
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
      li.innerHTML = '<span>' + esc(label(o)) + '</span><span class="tag">' + esc(tag(o)) + '</span>';
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
  bindToggle('#lyr-metro-routes', 'metroRoutes', true);
  bindToggle('#lyr-metro-stops', 'metroStops', true);
  bindToggle('#lyr-bus-stops', 'busStops', true);
  bindToggle('#lyr-bus-routes', 'busRoutes', true);
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
      setBasemap: setTileLayer, getSpace: function () { return currentSpace; },
      getBasemap: function () { return currentBasemap; }
    };
  }
})();
