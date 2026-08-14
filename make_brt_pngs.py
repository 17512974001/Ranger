# -*- coding: utf-8 -*-
"""Render PNG versions of the BRT charts/map with PIL (reliable Chinese fonts)."""
import json
import math
import os
import re
import struct

import pandas as pd
from PIL import Image, ImageDraw, ImageFont

OUT = "brt_output"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_REG = "C:/Windows/Fonts/msyh.ttc"


def read_shp(path):
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
                pts_raw = struct.unpack("<" + "d" * (2 * npts),
                                        content[44 + 4 * nparts:44 + 4 * nparts + 16 * npts])
                pts = [(pts_raw[i], pts_raw[i + 1]) for i in range(0, 2 * npts, 2)]
                shapes.append(pts)
            else:
                shapes.append([])
        off += 8 + rec_len
    return shapes


def base(line):
    m = re.match(r"B(\d+)", line.upper())
    return "B" + m.group(1) if m else line


def load_fonts():
    def f(path, size):
        return ImageFont.truetype(path, size)
    return (f(FONT_BOLD, 34), f(FONT_BOLD, 24), f(FONT_REG, 22),
            f(FONT_REG, 18), f(FONT_REG, 16), f(FONT_REG, 14))


def draw_map(br, all_shapes, fonts):
    fb, ft, fr, fs, fs2, fxs = fonts
    br_idx = set(br.index.tolist())
    b_shapes = [(i, s) for i, s in enumerate(all_shapes) if i in br_idx]
    b_pts = [p for _, s in b_shapes for p in s]
    lon0, lat0 = 113.35, 23.12
    xs = [(p[0] - lon0) * math.cos(math.radians(lat0)) for p in b_pts]
    ys = [p[1] - lat0 for p in b_pts]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    pad_x = (xmax - xmin) * 0.06
    pad_y = (ymax - ymin) * 0.06
    xmin -= pad_x
    xmax += pad_x
    ymin -= pad_y
    ymax += pad_y

    W, H = 1500, 1120
    M = 55
    def tx(x, y):
        px = M + (x - xmin) / (xmax - xmin) * (W - 2 * M)
        py = H - M - (y - ymin) / (ymax - ymin) * (H - 2 * M)
        return px, py

    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W - 1, H - 1], outline="#d0d0d8", width=2)

    # context routes
    for i, s in enumerate(all_shapes):
        if i in br_idx or len(s) < 2:
            continue
        pts = [tx(*p) for p in s]
        if all(0 <= p[0] <= W and 0 <= p[1] <= H for p in pts):
            d.line(pts, fill="#ececf2", width=2, joint="curve")

    palette = ["#d62728", "#2ca02c", "#ffbb00", "#1f77b4", "#ff7f0e", "#9467bd",
               "#17becf", "#e377c2", "#bcbd22", "#8c564b", "#7f7f7f", "#c49c94",
               "#636efa", "#ff9896", "#98df8a", "#aec7e8", "#ffbb78", "#c5b0d5",
               "#9edae5", "#f7b6d2", "#dbdb8d", "#c7c7c7"]
    bases = sorted(br["base"].unique(), key=lambda s: int(s[1:]))
    base_color = {b: palette[i % len(palette)] for i, b in enumerate(bases)}

    for i, s in b_shapes:
        b = br.loc[i, "base"]
        pts = [tx(*p) for p in s]
        d.line(pts, fill=base_color[b], width=5, joint="curve")

    title = f"广州 BRT（B 字头线路）路网图  ·  彩色线为 B1–B31 共 {len(b_shapes)} 条线路，灰色为全市普通线路"
    d.text((W / 2, 28), title, font=fb, fill="#222222", anchor="mm")

    # legend
    cols = 6
    lx, ly = M, H - 62
    for i, b in enumerate(bases):
        c, r = i % cols, i // cols
        x = lx + c * 130
        y = ly - r * 34
        d.rounded_rectangle([x, y - 15, x + 30, y - 5], radius=3, fill=base_color[b])
        d.text((x + 38, y - 10), b, font=fr, fill="#333333", anchor="lm")

    img.save(os.path.join(OUT, "brt_map.png"))
    print("png map saved")


def draw_corridor(bs, corridor, fonts):
    fb, ft, fr, fs, fs2, fxs = fonts
    counts = [(name, bs[bs["name_cn"] == name]["route_cn"].nunique()) for name in corridor]
    counts.sort(key=lambda t: t[1])
    n = len(counts)
    W, H = 1000, 620
    x0, y0 = 300, 90
    plotw = W - x0 - 120
    ploth = H - y0 - 80
    maxv = max(c[1] for c in counts)
    bw = ploth / n
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    d.text((x0, 45), "BRT 走廊主要站点：停靠的 B 字头线路数", font=fb, fill="#222222", anchor="lm")
    for i, (name, v) in enumerate(counts):
        y = y0 + i * bw + 6
        w = (v / maxv) * plotw
        d.rounded_rectangle([x0, y, x0 + w, y + bw - 12], radius=5, fill="#1f77b4")
        d.text((x0 - 16, y + (bw - 12) / 2), name, font=fr, fill="#333333", anchor="rm")
        d.text((x0 + w + 10, y + (bw - 12) / 2), str(v), font=fr, fill="#222222", anchor="lm")
    for tick in range(0, maxv + 1, max(1, maxv // 5)):
        x = x0 + tick / maxv * plotw
        d.line([x, y0 - 6, x, H - 60], fill="#eeeeee", width=1)
    img.save(os.path.join(OUT, "brt_corridor.png"))
    print("png corridor saved")


def draw_lengths(br, fonts):
    fb, ft, fr, fs, fs2, fxs = fonts
    g = br.groupby("base").agg(
        med=("distance", "median"), mx=("distance", "max"),
        mn=("distance", "min"), cnt=("route_cn", "count"),
    ).reset_index().sort_values("med")
    n = len(g)
    W, H = 1050, 640
    x0, y0 = 130, 95
    plotw = W - x0 - 190
    ploth = H - y0 - 70
    maxd = g["mx"].max()
    bh = ploth / n
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    d.text((x0, 45), "各 B 字头线路里程（蓝条为中位数，浅条为最小–最大范围）", font=fb, fill="#222222", anchor="lm")
    for i, row in g.iterrows():
        y = y0 + i * bh + 4
        hbar = bh - 10
        wmn = row["mn"] / maxd * plotw
        wmed = row["med"] / maxd * plotw
        wmx = row["mx"] / maxd * plotw
        d.rounded_rectangle([x0 + wmn, y, x0 + wmx, y + hbar], radius=3, fill="#c9d4f2")
        d.rounded_rectangle([x0 + wmn, y, x0 + max(wmed, wmn + 3), y + hbar], radius=3, fill="#1f77b4")
        d.text((x0 - 12, y + hbar / 2), row["base"], font=fr, fill="#333333", anchor="rm")
        d.text((x0 + wmx + 10, y + hbar / 2), f'{row["mn"]:.0f}–{row["mx"]:.0f} km', font=fs, fill="#777777", anchor="lm")
    img.save(os.path.join(OUT, "brt_lengths.png"))
    print("png lengths saved")


def draw_stops(br, fonts):
    fb, ft, fr, fs, fs2, fxs = fonts
    g = br.groupby("base").agg(
        mx=("total_stop", "max"), mn=("total_stop", "min"), cnt=("route_cn", "count"),
    ).reset_index().sort_values("mx")
    n = len(g)
    W, H = 1050, 640
    x0, y0 = 130, 95
    plotw = W - x0 - 190
    ploth = H - y0 - 70
    maxs = g["mx"].max()
    bh = ploth / n
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)
    d.text((x0, 45), "各 B 字头线路站点数（绿线为最多站点，浅条为最少–最多范围）", font=fb, fill="#222222", anchor="lm")
    for i, row in g.iterrows():
        y = y0 + i * bh + 4
        hbar = bh - 10
        wmn = row["mn"] / maxs * plotw
        wmx = row["mx"] / maxs * plotw
        d.rounded_rectangle([x0 + wmn, y, x0 + wmx, y + hbar], radius=3, fill="#cde7cd")
        d.line([x0 + wmx, y - 2, x0 + wmx, y + hbar + 2], fill="#2ca02c", width=4)
        d.text((x0 - 12, y + hbar / 2), row["base"], font=fr, fill="#333333", anchor="rm")
        d.text((x0 + wmx + 10, y + hbar / 2), f'{int(row["mn"])}–{int(row["mx"])} 站', font=fs, fill="#777777", anchor="lm")
    img.save(os.path.join(OUT, "brt_stops.png"))
    print("png stops saved")


def main():
    os.makedirs(OUT, exist_ok=True)
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    routes = pd.DataFrame(D["routes"])
    stops = pd.DataFrame(D["stops"])
    mask = routes["route_cn"].str.upper().str.startswith("B", na=False)
    br = routes[mask].copy().reset_index(drop=True)
    br["base"] = br["route_cn"].apply(base)
    bs = stops[stops["route_cn"].isin(set(br["route_cn"]))]
    fonts = load_fonts()

    all_shapes = read_shp("guangzhou_bus_routes.shp")
    draw_map(br, all_shapes, fonts)
    corridor = ["棠下村", "棠东", "华景新城", "车陂", "师大暨大", "黄村", "天朗明居",
                "体育中心", "上社", "石牌桥", "岗顶", "珠村", "茅岗", "莲溪"]
    draw_corridor(bs, corridor, fonts)
    draw_lengths(br, fonts)
    draw_stops(br, fonts)


if __name__ == "__main__":
    main()
