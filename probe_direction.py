# -*- coding: utf-8 -*-
"""Probe how many detail rows merge both directions, and whether geometry can
infer travel direction at shared stops."""
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
    dy = b[1] - a[1]
    dx = (b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.degrees(math.atan2(dx, dy)) % 360


def angle_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    stops = pd.DataFrame(D["stops"])
    routes = pd.DataFrame(D["routes"])

    with open("brt_output/527_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    detail = pd.DataFrame(data["detail"])

    # how many detail rows have both-direction OD?
    multi = detail[detail["起讫站"].str.contains(" / ", na=False)]
    print("detail rows:", len(detail), "| rows with two-direction OD:", len(multi),
          f"({len(multi)/len(detail):.1%})")
    stops_multi = multi.groupby(["527方向", "站名"])["共线线路"].nunique().reset_index()
    print("stations affected (527 dir x stop):", len(stops_multi))
    print(stops_multi.head(30).to_string())

    # geometry direction check at 桥东
    stop_pts = read_shp_points("guangzhou_bus_stops.shp")
    line_shapes = read_shp_lines("guangzhou_bus_routes.shp")
    # map stop records -> index in shp: same order as DBF rows
    # route records -> index in routes DBF: same order as routes table rows
    routes_idx = {rc: i for i, rc in enumerate(routes["route_cn"])}
    sid = "BV10017093"
    rec = stops[stops["stop_id"] == sid].head(1).iloc[0]
    ridx = stops.index.get_loc(rec.name)
    spt = stop_pts[ridx]
    print("\nstop 桥东 point:", spt)

    for rn in ["527路(广州白云站公交总站--石溪总站)", "527路(石溪总站--广州白云站公交总站)",
               "259路(嘉禾长湴总站--罗冲围总站(松南路))", "259路(罗冲围总站(松南路)--嘉禾长湴总站)"]:
        row = routes[routes["route_cn"] == rn]
        if row.empty:
            print(rn, "not in routes table")
            continue
        i = routes_idx[rn]
        shape = line_shapes[i]
        # find nearest polyline vertex to stop, then bearing from prev to next vertex
        best = min(range(len(shape)), key=lambda k: (shape[k][0]-spt[0])**2 + (shape[k][1]-spt[1])**2)
        lo, hi = max(best-2, 0), min(best+2, len(shape)-1)
        brg = bearing(shape[lo], shape[hi]) if lo < hi else None
        print(f"{rn}: near vertex {best}, bearing {brg:.1f} deg")


if __name__ == "__main__":
    main()
