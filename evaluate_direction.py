# -*- coding: utf-8 -*-
"""Evaluate reliability of stop-sequence bearing matching for direction disambiguation."""
import json
import math
import re
import struct

import pandas as pd


def route_num(route_cn):
    m = re.match(r"([^（(]+)", route_cn)
    return m.group(1).strip() if m else route_cn


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
                shapes.append([(raw[i], raw[i + 1]) for i in range(0, 2 * npts, 2)])
            else:
                shapes.append([])
        off += 8 + rec_len
    return shapes


def bearing(a, b):
    if a is None or b is None or a == b:
        return None
    dy = b[1] - a[1]
    dx = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.degrees(math.atan2(dx, dy)) % 360


def angle_diff(a, b):
    if a is None or b is None:
        return None
    d = abs(a - b) % 360
    return min(d, 360 - d)


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    stops = pd.DataFrame(D["stops"])
    stop_pts = read_shp_points("guangzhou_bus_stops.shp")
    stops["pt"] = stop_pts
    routes = pd.DataFrame(D["routes"])
    line_shapes = read_shp_lines("guangzhou_bus_routes.shp")
    routes_idx = {rc: i for i, rc in enumerate(routes["route_cn"])}

    def poly_bearing(rc, spt):
        i = routes_idx.get(rc)
        if i is None:
            return None
        shape = line_shapes[i]
        if len(shape) < 2 or spt is None:
            return None
        best = min(range(len(shape)),
                   key=lambda k: (shape[k][0] - spt[0]) ** 2 + (shape[k][1] - spt[1]) ** 2)
        lo, hi = max(best - 2, 0), min(best + 2, len(shape) - 1)
        if lo >= hi:
            return None
        return bearing(shape[lo], shape[hi])

    with open("brt_output/527_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    detail = pd.DataFrame(data["detail"])
    multi = detail[detail["起讫站"].str.contains(" / ", na=False)].copy()

    # route -> ordered stop points
    route_pts = {}
    for rc, g in stops[stops["route_cn"].str.startswith("527路", na=False)].groupby("route_cn"):
        route_pts[rc] = g.sort_values("sequence")["pt"].tolist()
    other_stops = stops[~stops["route_cn"].str.startswith("527", na=False)]
    for rc, g in other_stops.groupby("route_cn"):
        route_pts[rc] = g.sort_values("sequence")["pt"].tolist()

    def dir_bearing(rc, sid):
        """bearing of route rc while passing stop with id sid (via stop sequence)"""
        seq = other_stops[other_stops["route_cn"] == rc].sort_values("sequence").reset_index(drop=True)
        hit = seq.index[seq["stop_id"] == sid]
        if len(hit) == 0:
            return None
        k = int(hit[0])
        pts = seq["pt"].tolist()
        lo, hi = k - 1, k + 1
        if lo < 0:
            lo, hi = 0, min(k + 2, len(pts) - 1)
        if hi > len(pts) - 1:
            hi = len(pts) - 1
            lo = max(k - 2, 0)
        return bearing(pts[lo], pts[hi])

    def b527(rc_dir, sid):
        seq = stops[(stops["route_cn"] == rc_dir)].sort_values("sequence").reset_index(drop=True)
        hit = seq.index[seq["stop_id"] == sid]
        if len(hit) == 0:
            return None
        k = int(hit[0])
        pts = seq["pt"].tolist()
        lo, hi = k - 1, k + 1
        if lo < 0:
            lo, hi = 0, min(k + 2, len(pts) - 1)
        if hi > len(pts) - 1:
            hi = len(pts) - 1
            lo = max(k - 2, 0)
        return bearing(pts[lo], pts[hi])

    rows = []
    rows_p = []
    for _, r in multi.iterrows():
        b527v = b527(r["527方向"], r["站点ID"])
        cand = []
        for rc in other_stops[other_stops["stop_id"] == r["站点ID"]]["route_cn"].unique():
            if route_num(rc) == r["共线线路"]:
                cand.append(rc)
        diffs = []
        diffs_p = []
        spt = other_stops[other_stops["stop_id"] == r["站点ID"]]["pt"].iloc[0]
        b527p = poly_bearing(r["527方向"], spt)
        for rc in cand:
            b = dir_bearing(rc, r["站点ID"])
            d = angle_diff(b, b527v)
            diffs.append((rc, b, d))
            bp = poly_bearing(rc, spt)
            dp = angle_diff(bp, b527p)
            diffs_p.append((rc, bp, dp))
        diffs = sorted(diffs, key=lambda x: x[2] if x[2] is not None else 999)
        diffs_p = sorted(diffs_p, key=lambda x: x[2] if x[2] is not None else 999)
        rows.append({
            "527方向": r["527方向"], "站名": r["站名"], "线路": r["共线线路"],
            "b527": b527v, "n_cand": len(diffs),
            "best": diffs[0][2] if diffs else None,
            "second": diffs[1][2] if len(diffs) > 1 else None,
            "best_rc": diffs[0][0] if diffs else "",
        })
        rows_p.append({
            "527方向": r["527方向"], "站名": r["站名"], "线路": r["共线线路"],
            "b527p": b527p, "n_cand": len(diffs_p),
            "best": diffs_p[0][2] if diffs_p else None,
            "second": diffs_p[1][2] if len(diffs_p) > 1 else None,
            "best_rc": diffs_p[0][0] if diffs_p else "",
        })
    ev = pd.DataFrame(rows)
    evp = pd.DataFrame(rows_p)
    print("evaluated rows:", len(ev))
    print("\nbest bearing diff describe:")
    print(ev["best"].describe())
    margin = ev["best"].notna() & ev["second"].notna()
    ev["margin"] = (ev["second"] - ev["best"]).where(margin)
    print("\nmargin (second-best - best) describe:")
    print(ev["margin"].describe())
    print("\nbest diff <=30 deg:", (ev["best"] <= 30).sum(), f"({(ev['best'] <= 30).mean():.1%})")
    print("margin >=45 deg:", (ev["margin"] >= 45).sum(),
          f"({(ev['margin'] >= 45).sum() / ev['margin'].notna().sum():.1%} of rows with 2+ candidates)")
    print("\nsample rows:")
    print(ev.head(12).to_string())
    print("\nworst margin rows:")
    print(ev.nsmallest(12, "margin")[["站名", "线路", "b527", "best", "second", "margin"]].to_string())

    print("\n=== polyline-based ===")
    print("best bearing diff describe:")
    print(evp["best"].describe())
    margin = evp["best"].notna() & evp["second"].notna()
    evp["margin"] = (evp["second"] - evp["best"]).where(margin)
    print("margin describe:")
    print(evp["margin"].describe())
    print("best diff <=30 deg:", (evp["best"] <= 30).sum(),
          f"({(evp['best'] <= 30).mean():.1%})")
    print("margin >=45 deg:", (evp["margin"] >= 45).sum(),
          f"({(evp['margin'] >= 45).sum() / evp['margin'].notna().sum():.1%} of rows with 2+ candidates)")
    print("\nworst margin rows (polyline):")
    print(evp.nsmallest(12, "margin")[["站名", "线路", "b527p", "best", "second", "margin"]].to_string())


if __name__ == "__main__":
    main()
