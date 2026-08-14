# -*- coding: utf-8 -*-
"""Prepare combined Guangzhou bus + metro data as web-ready GeoJSON/JSON.

Outputs (in web_data/):
  bus_routes.geojson / bus_stops.geojson
  metro_routes.geojson / metro_stops.geojson
  all_stations.geojson            (bus stops + metro stations combined)
  bus_route_stops.json            route -> ordered stop list
  metro_route_stops.json
  stop_routes.json                bus stop_id -> serving route numbers
  metro_stop_routes.json          metro stop_id -> serving line numbers
  metro_bus_feeders.json          metro station -> nearby bus stops (<=300m)
  README.md                       data dictionary
"""
import json
import math
import os
import re
import struct
import time

import numpy as np

OUT = "web_data"
METRO_DIR = r"D:\haowanyouxi\Canton\CPTOND-2025\GMetro"


# ---------------- readers ----------------
def read_dbf(path):
    with open(path, "rb") as f:
        head = f.read(32)
        nrec = struct.unpack("<I", head[4:8])[0]
        hlen = struct.unpack("<H", head[8:10])[0]
        rlen = struct.unpack("<H", head[10:12])[0]
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            name = d[:11].split(b"\x00")[0].decode("utf-8", "replace")
            fields.append((name, chr(d[11]), d[16], d[17]))
        f.seek(hlen)
        data = f.read(nrec * rlen)
    rows = []
    for i in range(nrec):
        rec = data[i * rlen:(i + 1) * rlen]
        row = {}
        off = 1
        for name, ft, fl, _ in fields:
            raw = rec[off:off + fl]
            off += fl
            if ft in "NnFf":
                s = raw.decode("ascii", "replace").strip()
                try:
                    val = float(s) if s else None
                except ValueError:
                    val = None
            elif ft == "C":
                val = raw.rstrip(b"\x00 ").decode("utf-8", "replace").strip() or None
            else:
                val = raw
            row[name] = val
        rows.append(row)
    return rows


def read_shp_lines(path):
    with open(path, "rb") as f:
        data = f.read()
    shapes = []
    off = 100
    while off + 8 <= len(data):
        rec_len = struct.unpack(">i", data[off + 4:off + 8])[0] * 2
        if rec_len <= 0 or off + 8 + rec_len > len(data):
            break
        content = data[off + 8:off + 8 + rec_len]
        if len(content) >= 4:
            st = struct.unpack("<i", content[0:4])[0]
            if st == 3:
                nparts, npts = struct.unpack("<ii", content[36:44])
                parts = struct.unpack("<" + "i" * nparts, content[44:44 + 4 * nparts])
                raw = struct.unpack("<" + "d" * (2 * npts),
                                    content[44 + 4 * nparts:44 + 4 * nparts + 16 * npts])
                pts = [(raw[i], raw[i + 1]) for i in range(0, 2 * npts, 2)]
                if nparts > 1:
                    # multi-part polyline -> concatenate (rare in this data)
                    parts = parts + (npts,)
                    shape = []
                    for pi in range(nparts):
                        shape.extend(pts[parts[pi]:parts[pi + 1]])
                    shapes.append(shape)
                else:
                    shapes.append(pts)
            else:
                shapes.append([])
        off += 8 + rec_len
    return shapes


def read_shp_points(path):
    with open(path, "rb") as f:
        data = f.read()
    pts = []
    off = 100
    while off + 8 <= len(data):
        rec_len = struct.unpack(">i", data[off + 4:off + 8])[0] * 2
        if rec_len <= 0 or off + 8 + rec_len > len(data):
            break
        content = data[off + 8:off + 8 + rec_len]
        if len(content) >= 4:
            st = struct.unpack("<i", content[0:4])[0]
            if st == 1:
                x, y = struct.unpack("<dd", content[4:20])
                pts.append((x, y))
            else:
                pts.append(None)
        off += 8 + rec_len
    return pts


# ---------------- geometry helpers ----------------
def perp_dist(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def douglas_peucker(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        lo, hi = stack.pop()
        if hi - lo < 2:
            continue
        dmax, idx = -1, -1
        for i in range(lo + 1, hi):
            d = perp_dist(pts[i], pts[lo], pts[hi])
            if d > dmax:
                dmax, idx = d, i
        if dmax > tol:
            keep[idx] = True
            stack.append((lo, idx))
            stack.append((idx, hi))
    return [p for p, k in zip(pts, keep) if k]


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = np.radians(lat2 - lat1)
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def clean_num(v):
    if v is None:
        return None
    try:
        f = float(v)
        return round(f, 3) if f != int(f) else int(f)
    except (TypeError, ValueError):
        return v


def route_num(route_cn):
    m = re.match(r"([^（(]+)", route_cn or "")
    return m.group(1).strip() if m else route_cn


def write_geojson(path, features):
    gj = {"type": "FeatureCollection", "features": features}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()

    # ---------- bus ----------
    print("reading bus data ...")
    bus_routes = read_dbf("guangzhou_bus_routes.dbf")
    bus_stops_unique = read_dbf("guangzhou_bus_stops_unique.dbf")
    bus_stops_all = read_dbf("guangzhou_bus_stops.dbf")
    bus_line_shapes = read_shp_lines("guangzhou_bus_routes.shp")
    bus_stop_pts = read_shp_points("guangzhou_bus_stops_unique.shp")
    print(f"  routes={len(bus_routes)} unique_stops={len(bus_stops_unique)} "
          f"stop_records={len(bus_stops_all)} shapes={len(bus_line_shapes)} pts={len(bus_stop_pts)}")

    # ---------- metro ----------
    print("reading metro data ...")
    met_routes = read_dbf(os.path.join(METRO_DIR, "guangzhou_metro_routes.dbf"))
    met_stops_unique = read_dbf(os.path.join(METRO_DIR, "guangzhou_metro_stops_unique.dbf"))
    met_stops_all = read_dbf(os.path.join(METRO_DIR, "guangzhou_metro_stops.dbf"))
    met_line_shapes = read_shp_lines(os.path.join(METRO_DIR, "guangzhou_metro_routes.shp"))
    met_stop_pts = read_shp_points(os.path.join(METRO_DIR, "guangzhou_metro_stops_unique.shp"))
    print(f"  routes={len(met_routes)} unique_stops={len(met_stops_unique)} "
          f"stop_records={len(met_stops_all)} shapes={len(met_line_shapes)} pts={len(met_stop_pts)}")

    # ---------- bus routes GeoJSON (simplified) ----------
    print("building bus_routes.geojson (simplify + round) ...")
    tol = 0.0002
    feats = []
    n_pts_before = n_pts_after = 0
    for i, r in enumerate(bus_routes):
        shape = bus_line_shapes[i]
        simple = douglas_peucker(shape, tol) if len(shape) > 2 else shape
        coords = [[round(x, 6), round(y, 6)] for x, y in simple]
        n_pts_before += len(shape)
        n_pts_after += len(coords)
        feats.append({
            "type": "Feature",
            "properties": {
                "id": i,
                "route_cn": r["route_cn"], "route_en": r["route_en"],
                "route_type": r["route_type"], "route_type_en": r["type_en"],
                "company_cn": r["company_cn"],
                "s_stop_cn": r["s_stop_cn"], "e_stop_cn": r["e_stop_cn"],
                "distance_km": clean_num(r["distance"]),
                "length_km": clean_num(r["length"]),
                "total_stop": clean_num(r["total_stop"]),
                "start_time": r["start_time"], "end_time": r["end_time"],
                "loop": r["loop"], "status": r["status"],
                "status_label": "运营" if r["status"] == "1" else "停运/停用",
                "basic_prc": r["basic_prc"], "total_prc": r["total_prc"],
                "city_cn": r["city_cn"],
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    write_geojson(os.path.join(OUT, "bus_routes.geojson"), feats)
    print(f"  vertices {n_pts_before} -> {n_pts_after} "
          f"({(1 - n_pts_after / max(n_pts_before, 1)):.0%} reduction)")

    # ---------- bus stops GeoJSON ----------
    print("building bus_stops.geojson ...")
    feats = []
    for i, r in enumerate(bus_stops_unique):
        pt = bus_stop_pts[i]
        if pt is None:
            continue
        feats.append({
            "type": "Feature",
            "properties": {
                "stop_id": r["stop_id"], "name_cn": r["stop_cn"], "name_en": r["stop_en"],
                "num_routes": clean_num(r["num"]), "city_cn": r["city_cn"],
            },
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 6), round(pt[1], 6)]},
        })
    write_geojson(os.path.join(OUT, "bus_stops.geojson"), feats)
    print(f"  {len(feats)} stops")

    # ---------- metro routes GeoJSON ----------
    print("building metro_routes.geojson ...")
    feats = []
    for i, r in enumerate(met_routes):
        shape = met_line_shapes[i]
        coords = [[round(x, 6), round(y, 6)] for x, y in shape]
        feats.append({
            "type": "Feature",
            "properties": {
                "id": i,
                "route_cn": r["route_cn"], "route_en": r["route_en"],
                "route_type": r["route_type"],
                "company_cn": r["company_cn"],
                "s_stop_cn": r["s_stop_cn"], "e_stop_cn": r["e_stop_cn"],
                "distance_km": clean_num(r["distance"]),
                "length_km": clean_num(r["length"]),
                "total_stop": clean_num(r["total_stop"]),
                "start_time": r["start_time"], "end_time": r["end_time"],
                "loop": r["loop"], "status": r["status"],
                "op_status": "运营" if r["status"] == "1" else "在建或规划",
                "basic_prc": r["basic_prc"], "total_prc": r["total_prc"],
                "merged_cnt": clean_num(r["merged_cnt"]),
            },
            "geometry": {"type": "LineString", "coordinates": coords},
        })
    write_geojson(os.path.join(OUT, "metro_routes.geojson"), feats)
    print(f"  {len(feats)} routes")

    # ---------- metro stops GeoJSON ----------
    print("building metro_stops.geojson ...")
    feats = []
    for i, r in enumerate(met_stops_unique):
        pt = met_stop_pts[i]
        if pt is None:
            continue
        feats.append({
            "type": "Feature",
            "properties": {
                "stop_id": r["stop_id"], "name_cn": r["stop_cn"], "name_en": r["stop_en"],
                "num_lines": clean_num(r["num"]), "city_cn": r["city_cn"],
            },
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 6), round(pt[1], 6)]},
        })
    write_geojson(os.path.join(OUT, "metro_stops.geojson"), feats)
    print(f"  {len(feats)} stops")

    # ---------- combined stations ----------
    print("building all_stations.geojson ...")
    feats = []
    for i, r in enumerate(bus_stops_unique):
        pt = bus_stop_pts[i]
        if pt is None:
            continue
        feats.append({
            "type": "Feature",
            "properties": {"id": r["stop_id"], "name_cn": r["stop_cn"], "name_en": r["stop_en"],
                           "network": "bus", "num_services": clean_num(r["num"])},
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 6), round(pt[1], 6)]},
        })
    for i, r in enumerate(met_stops_unique):
        pt = met_stop_pts[i]
        if pt is None:
            continue
        feats.append({
            "type": "Feature",
            "properties": {"id": r["stop_id"], "name_cn": r["stop_cn"], "name_en": r["stop_en"],
                           "network": "metro", "num_services": clean_num(r["num"])},
            "geometry": {"type": "Point", "coordinates": [round(pt[0], 6), round(pt[1], 6)]},
        })
    write_geojson(os.path.join(OUT, "all_stations.geojson"), feats)
    print(f"  {len(feats)} stations")

    # ---------- route -> ordered stops ----------
    print("building route-stop mappings ...")
    bus_route_stops = {}
    for r in sorted(bus_stops_all, key=lambda x: (str(x["route_cn"]), float(x["sequence"] or 0))):
        bus_route_stops.setdefault(r["route_cn"], []).append(
            [int(r["sequence"]), r["name_cn"], r["stop_id"]])
    with open(os.path.join(OUT, "bus_route_stops.json"), "w", encoding="utf-8") as f:
        json.dump(bus_route_stops, f, ensure_ascii=False, separators=(",", ":"))

    met_route_stops = {}
    for r in sorted(met_stops_all, key=lambda x: (str(x["route_cn"]), float(x["sequence"] or 0))):
        met_route_stops.setdefault(r["route_cn"], []).append(
            [int(r["sequence"]), r["name_cn"], r["stop_id"]])
    with open(os.path.join(OUT, "metro_route_stops.json"), "w", encoding="utf-8") as f:
        json.dump(met_route_stops, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- stop -> serving routes ----------
    stop_routes = {}
    for r in bus_stops_all:
        stop_routes.setdefault(r["stop_id"], set()).add(route_num(r["route_cn"]))
    stop_routes = {k: sorted(v) for k, v in stop_routes.items()}
    with open(os.path.join(OUT, "stop_routes.json"), "w", encoding="utf-8") as f:
        json.dump(stop_routes, f, ensure_ascii=False, separators=(",", ":"))

    met_stop_routes = {}
    for r in met_stops_all:
        met_stop_routes.setdefault(r["stop_id"], set()).add(route_num(r["route_cn"]))
    met_stop_routes = {k: sorted(v) for k, v in met_stop_routes.items()}
    with open(os.path.join(OUT, "metro_stop_routes.json"), "w", encoding="utf-8") as f:
        json.dump(met_stop_routes, f, ensure_ascii=False, separators=(",", ":"))

    # ---------- metro-bus feeder analysis (<=300 m) ----------
    print("computing metro-bus feeders ...")
    bus_ids = [r["stop_id"] for r in bus_stops_unique]
    bus_names = [r["stop_cn"] for r in bus_stops_unique]
    bus_nums = [r["num"] for r in bus_stops_unique]
    bus_lat = np.array([p[1] for p in bus_stop_pts if p is not None])
    bus_lon = np.array([p[0] for p in bus_stop_pts if p is not None])
    valid = [i for i, p in enumerate(bus_stop_pts) if p is not None]
    feeders = {}
    total_pairs = 0
    for i, r in enumerate(met_stops_unique):
        pt = met_stop_pts[i]
        if pt is None:
            continue
        d = haversine_m(bus_lat, bus_lon, pt[1], pt[0])
        hit = np.where(d <= 300.0)[0]
        total_pairs += len(hit)
        if len(hit):
            order = np.argsort(d[hit])
            feeders[r["stop_id"]] = {
                "station": r["stop_cn"],
                "bus_stops": [
                    [bus_ids[valid[hit[j]]], bus_names[valid[hit[j]]],
                     int(round(d[hit][j])), int(bus_nums[valid[hit[j]]] or 0)]
                    for j in order
                ],
            }
    with open(os.path.join(OUT, "metro_bus_feeders.json"), "w", encoding="utf-8") as f:
        json.dump(feeders, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {len(feeders)}/{len(met_stops_unique)} metro stations have bus stops within 300m; "
          f"{total_pairs} pairs")

    # ---------- README ----------
    readme = f"""# 广州公共交通线网 Web 数据（公交 + 地铁）

由原始 shapefile 预处理生成，坐标系 WGS84，坐标保留 6 位小数（约 0.1 米精度）。

## 文件说明

| 文件 | 内容 | 要素数 |
|---|---|---|
| bus_routes.geojson | 公交线路（已轻度抽稀，Douglas-Peucker 0.0002°） | {len(bus_routes)} |
| bus_stops.geojson | 去重公交站点（含服务线路数 num） | {len(bus_stops_unique)} |
| metro_routes.geojson | 地铁/有轨电车线路（含运营状态 op_status） | {len(met_routes)} |
| metro_stops.geojson | 去重地铁车站（含停靠线路数 num_lines） | {len(met_stops_unique)} |
| all_stations.geojson | 公交站 + 地铁站合并图层（network: bus/metro） | {len(bus_stops_unique) + len(met_stops_unique)} |
| bus_route_stops.json | 线路 -> 有序站点（[[序号, 站名, 站点ID], ...]） | {len(bus_route_stops)} 条线路 |
| metro_route_stops.json | 地铁线路 -> 有序车站 | {len(met_route_stops)} 条线路 |
| stop_routes.json | 公交站点ID -> 经过的线路号列表 | {len(stop_routes)} 个站点 |
| metro_stop_routes.json | 地铁站ID -> 停靠的线路号列表 | {len(met_stop_routes)} 个站点 |
| metro_bus_feeders.json | 地铁站 -> 300 米内公交站（含距离与服务线路数） | {len(feeders)} 个地铁站 |

## 状态字段说明
- 公交 status: 1 = 运营；0 = 停运/停用（数据自带标记）。
- 地铁 status: 1 = 运营；3 = 在建或规划（共 {sum(1 for r in met_routes if r['status'] == '3')} 条线路记录）。

## 常见用途
- 地图叠加：公交线 + 地铁线 + 站点热力（num/num_lines 可做覆盖热度）。
- 站点反查：stop_routes.json / metro_stop_routes.json 实现"某站有哪些线路"。
- 换乘接驳：metro_bus_feeders.json 展示每个地铁站周边公交接驳。
- 竞争分析：两条线路共线程度可基于 bus_route_stops.json 计算。

## 数据口径提醒
- 公交站点 ID 不区分上下行，部分站点往返共用同一 ID（见 527 分析中的"方向判定"）。
- 地铁数据含在建/规划段，展示时建议按 op_status 过滤或弱化显示。
"""
    with open(os.path.join(OUT, "README.md"), "w", encoding="utf-8") as f:
        f.write(readme)

    print(f"\ndone in {time.time() - t0:.1f}s -> {OUT}/")


if __name__ == "__main__":
    main()
