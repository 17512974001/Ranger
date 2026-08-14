# -*- coding: utf-8 -*-
"""Pin down the feeder mismatch for Tiyu West Road metro station."""
import json
import math
import os
import struct

import numpy as np


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


def haversine(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = np.radians(lat2 - lat1)
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def main():
    md = r"D:\haowanyouxi\Canton\CPTOND-2025\GMetro"
    su = read_dbf(os.path.join(md, "guangzhou_metro_stops_unique.dbf"))
    mpts = read_points(os.path.join(md, "guangzhou_metro_stops_unique.shp"))
    hits = [i for i, r in enumerate(su) if r["stop_cn"] == "体育西路"]
    print("体育西路 records:", [(i, su[i]["stop_id"], mpts[i]) for i in hits])

    bus_su = read_dbf("guangzhou_bus_stops_unique.dbf")
    bpts = read_points("guangzhou_bus_stops_unique.shp")
    print("\n广州科技创新基地 records:")
    for i, r in enumerate(bus_su):
        if "科技创新基地" in (r["stop_cn"] or ""):
            print("  idx", i, r["stop_cn"], r["stop_id"], "pt", bpts[i])
    print("\n揽月路 records:")
    for i, r in enumerate(bus_su):
        if "揽月路" in (r["stop_cn"] or ""):
            print("  idx", i, r["stop_cn"], r["stop_id"], "pt", bpts[i])

    # find which bus stop is ~16m from 体育西路 metro (113.316086, 23.133735)
    if hits:
        mp = mpts[hits[0]]
        d = haversine(np.array([p[1] for p in bpts]), np.array([p[0] for p in bpts]), mp[1], mp[0])
        order = np.argsort(d)
        print("\nnearest bus stops to 体育西路 metro:")
        for j in order[:8]:
            print(f"  {d[j]:6.1f}m  idx={j}  {bus_su[j]['stop_cn']} {bus_su[j]['stop_id']} {bpts[j]}")


if __name__ == "__main__":
    main()
