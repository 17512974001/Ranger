# -*- coding: utf-8 -*-
"""Diagnose whether metro shapefile geometry aligns with DBF order."""
import json
import os
import struct


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


def read_points(path):
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


def read_lines(path):
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


def main():
    md = r"D:\haowanyouxi\Canton\CPTOND-2025\GMetro"
    su = read_dbf(os.path.join(md, "guangzhou_metro_stops_unique.dbf"))
    pts = read_points(os.path.join(md, "guangzhou_metro_stops_unique.shp"))
    print("stops_unique:", len(su), "points:", len(pts))
    for want in ["体育西路", "广州火车站", "嘉禾望岗", "公园前", "珠江新城"]:
        idx = [i for i, r in enumerate(su) if r["stop_cn"] == want]
        for i in idx[:2]:
            print(f"  {want} idx={i} pt={pts[i]}")

    # routes: check 1号线 polyline bbox and a few station coords on it
    routes = read_dbf(os.path.join(md, "guangzhou_metro_routes.dbf"))
    shapes = read_lines(os.path.join(md, "guangzhou_metro_routes.shp"))
    print("routes:", len(routes), "shapes:", len(shapes))
    for rn in ["地铁1号线(西塱--广州东站)", "地铁3号线(体育西路--机场北(2号航站楼))",
               "地铁4号线(黄村--南沙客运港)"]:
        for i, r in enumerate(routes):
            if r["route_cn"] == rn:
                s = shapes[i]
                xs = [p[0] for p in s]
                ys = [p[1] for p in s]
                print(f"{rn}: n={len(s)} bbox=({min(xs):.4f},{min(ys):.4f})-({max(xs):.4f},{max(ys):.4f})")
                print("   first:", s[0], "last:", s[-1])


if __name__ == "__main__":
    main()
