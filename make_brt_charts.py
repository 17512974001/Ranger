# -*- coding: utf-8 -*-
"""Generate SVG charts + map for the BRT (B-prefix) analysis."""
import json
import math
import re
import struct

import pandas as pd

OUT = "brt_output"


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


def svg_escape(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def base(line):
    m = re.match(r"B(\d+)", line.upper())
    return "B" + m.group(1) if m else line


def main():
    import os
    os.makedirs(OUT, exist_ok=True)

    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    routes = pd.DataFrame(D["routes"])
    stops = pd.DataFrame(D["stops"])
    su = pd.DataFrame(D["stops_unique"])

    mask = routes["route_cn"].str.upper().str.startswith("B", na=False)
    br = routes[mask].copy().reset_index(drop=True)
    br["base"] = br["route_cn"].apply(base)
    bnames = set(br["route_cn"].tolist())
    bs = stops[stops["route_cn"].isin(bnames)]

    # ---------- map ----------
    all_shapes = read_shp("guangzhou_bus_routes.shp")
    br_idx = set(br.index.tolist())
    b_shapes = [(i, s) for i, s in enumerate(all_shapes) if i in br_idx]
    b_pts = [p for _, s in b_shapes for p in s]
    lon0, lat0 = 113.35, 23.12
    xs = [(p[0] - lon0) * math.cos(math.radians(lat0)) for p in b_pts]
    ys = [p[1] - lat0 for p in b_pts]
    xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
    pad_x = (xmax - xmin) * 0.05
    pad_y = (ymax - ymin) * 0.05
    xmin -= pad_x
    xmax += pad_x
    ymin -= pad_y
    ymax += pad_y

    W, H = 1200, 900
    def tx(x, y):
        px = (x - xmin) / (xmax - xmin) * (W - 80) + 40
        py = H - 50 - (y - ymin) / (ymax - ymin) * (H - 100)
        return px, py

    palette = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
               "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff",
               "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
               "#000075", "#808080", "#f0f0f0"]
    bases = sorted(br["base"].unique(), key=lambda s: int(s[1:]))
    base_color = {b: palette[i % len(palette)] for i, b in enumerate(bases)}

    context = []
    for i, s in enumerate(all_shapes):
        if i in br_idx or len(s) < 2:
            continue
        pts = []
        ok = True
        for p in s:
            x, y = tx(*p)
            if x < -5000 or x > W + 5000 or y < -5000 or y > H + 5000:
                ok = False
                break
            pts.append((x, y))
        if ok and pts:
            d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
            context.append(d)

    b_paths = []
    for i, s in b_shapes:
        b = br.loc[i, "base"]
        pts = [tx(*p) for p in s]
        d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
        b_paths.append((b, d))

    legend_items = []
    for b in bases:
        legend_items.append(
            f'<rect x="0" y="0" width="16" height="10" rx="2" fill="{base_color[b]}"/>'
            f'<text x="20" y="9" font-size="12" fill="#333">{b}</text>')

    def grid(li, cols=4, x0=40, y0=20, dx=150, dy=22):
        out = []
        for idx, item in enumerate(li):
            c, r = idx % cols, idx // cols
            out.append(f'<g transform="translate({x0 + c * dx},{y0 + r * dy})">{item}</g>')
        return "".join(out)

    legend_svg = grid(legend_items, cols=6, x0=40, y0=20, dx=150, dy=22)
    legend_h = (len(legend_items) + 5) // 6 * 22 + 8

    ctx_svg = "".join(f'<path d="{d}" stroke="#e8e8ee" stroke-width="0.8" fill="none"/>' for d in context)
    b_svg = "".join(f'<path d="{d}" stroke="{base_color[b]}" stroke-width="1.8" stroke-opacity="0.85" fill="none"/>'
                    for b, d in b_paths)

    title = ("广州 BRT（B 字头线路）路网图：灰线为全市普通线路，彩色线为 B1–B31 "
             f"（共 {len(b_paths)} 条线路记录）")
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H + legend_h + 60}" viewBox="0 0 {W} {H + legend_h + 60}" font-family="Microsoft YaHei, SimHei, sans-serif">
<rect x="0" y="0" width="{W}" height="{H + legend_h + 60}" fill="#ffffff"/>
<text x="{W/2}" y="34" font-size="22" font-weight="bold" text-anchor="middle" fill="#222">{svg_escape(title)}</text>
<g transform="translate(0,{legend_h + 44})">
{ctx_svg}
{b_svg}
</g>
<g>{legend_svg}</g>
</svg>'''
    with open(os.path.join(OUT, "brt_map.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print("map saved")

    # ---------- corridor coverage chart ----------
    corridor = ["棠下村", "棠东", "华景新城", "车陂", "师大暨大", "黄村", "天朗明居",
                "体育中心", "上社", "石牌桥", "岗顶", "珠村", "茅岗", "莲溪"]
    counts = []
    for name in corridor:
        counts.append((name, bs[bs["name_cn"] == name]["route_cn"].nunique()))
    counts.sort(key=lambda t: t[1])
    n = len(counts)
    cw, chh = 780, 460
    x0, y0 = 240, 60
    maxv = max(c[1] for c in counts)
    bw = (chh - 90) / n
    bars = []
    labels = []
    vals = []
    for i, (name, v) in enumerate(counts):
        y = y0 + i * bw + 8
        w = (v / maxv) * (cw - x0 - 150)
        bars.append(f'<rect x="{x0}" y="{y:.1f}" width="{w:.1f}" height="{bw - 14:.1f}" rx="4" fill="#4363d8"/>')
        labels.append(f'<text x="{x0 - 12}" y="{y + (bw - 14) / 2 + 5:.1f}" font-size="15" text-anchor="end" fill="#333">{svg_escape(name)}</text>')
        vals.append(f'<text x="{x0 + w + 8:.1f}" y="{y + (bw - 14) / 2 + 5:.1f}" font-size="14" fill="#222">{v}</text>')
    svg2 = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{cw}" height="{chh}" viewBox="0 0 {cw} {chh}" font-family="Microsoft YaHei, SimHei, sans-serif">
<rect width="{cw}" height="{chh}" fill="#fff"/>
<text x="{x0}" y="36" font-size="20" font-weight="bold" fill="#222">BRT 走廊主要站点：停靠的 B 字头线路数</text>
{''.join(labels)}{''.join(bars)}{''.join(vals)}
</svg>'''
    with open(os.path.join(OUT, "brt_corridor.svg"), "w", encoding="utf-8") as f:
        f.write(svg2)
    print("corridor chart saved")

    # ---------- per-base line length chart ----------
    g = br.groupby("base").agg(
        median=("distance", "median"),
        mx=("distance", "max"),
        mn=("distance", "min"),
        cnt=("route_cn", "count"),
        stops=("total_stop", "max"),
    ).reset_index()
    g = g.sort_values("median")
    n2 = len(g)
    w2, h2 = 900, 560
    x0b, y0b = 110, 70
    plotw = w2 - x0b - 60
    ploth = h2 - y0b - 60
    maxd = g["mx"].max()
    bh = ploth / n2
    bars2, lab2, rng2, val2 = [], [], [], []
    for i, row in g.iterrows():
        y = y0b + i * bh + 4
        hbar = bh - 10
        wmed = row["median"] / maxd * plotw
        wmx = row["mx"] / maxd * plotw
        wmn = row["mn"] / maxd * plotw
        bars2.append(f'<rect x="{x0b + wmn:.1f}" y="{y:.1f}" width="{(wmx - wmn):.1f}" height="{hbar:.1f}" rx="3" fill="#c9d4f2"/>')
        bars2.append(f'<rect x="{x0b + wmed:.1f}" y="{y:.1f}" width="{max(wmed - wmn, 3):.1f}" height="{hbar:.1f}" rx="3" fill="#4363d8"/>')
        lab2.append(f'<text x="{x0b - 10}" y="{y + hbar / 2 + 5:.1f}" font-size="14" text-anchor="end" fill="#333">{row["base"]}</text>')
        rng2.append(f'<text x="{x0b + wmx + 6:.1f}" y="{y + hbar / 2 + 5:.1f}" font-size="12" fill="#888">{row["mn"]:.0f}–{row["mx"]:.0f} km</text>')
    svg3 = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w2}" height="{h2}" viewBox="0 0 {w2} {h2}" font-family="Microsoft YaHei, SimHei, sans-serif">
<rect width="{w2}" height="{h2}" fill="#fff"/>
<text x="{x0b}" y="36" font-size="20" font-weight="bold" fill="#222">各 B 字头线路里程（蓝色为中位数，浅色为最小–最大范围）</text>
{''.join(lab2)}{''.join(bars2)}{''.join(rng2)}
</svg>'''
    with open(os.path.join(OUT, "brt_lengths.svg"), "w", encoding="utf-8") as f:
        f.write(svg3)
    print("lengths chart saved")

    # ---------- stops per base line ----------
    g2 = br.groupby("base").agg(
        stops=("total_stop", "max"),
        mn=("total_stop", "min"),
        cnt=("route_cn", "count"),
    ).reset_index().sort_values("stops")
    n3 = len(g2)
    w3, h3 = 900, 560
    maxs = g2["stops"].max()
    bh3 = ploth / n3
    bars3, lab3, val3 = [], [], []
    for i, row in g2.iterrows():
        y = y0b + i * bh3 + 4
        hbar = bh3 - 10
        wm = row["mn"] / maxs * plotw
        wM = row["stops"] / maxs * plotw
        bars3.append(f'<rect x="{x0b + wm:.1f}" y="{y:.1f}" width="{(wM - wm):.1f}" height="{hbar:.1f}" rx="3" fill="#c9d4f2"/>')
        bars3.append(f'<rect x="{x0b + wM:.1f}" y="{y:.1f}" width="4" height="{hbar:.1f}" fill="#3cb44b"/>')
        lab3.append(f'<text x="{x0b - 10}" y="{y + hbar / 2 + 5:.1f}" font-size="14" text-anchor="end" fill="#333">{row["base"]}</text>')
        val3.append(f'<text x="{x0b + wM + 6:.1f}" y="{y + hbar / 2 + 5:.1f}" font-size="12" fill="#888">{int(row["mn"])}–{int(row["stops"])} 站</text>')
    svg4 = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w3}" height="{h3}" viewBox="0 0 {w3} {h3}" font-family="Microsoft YaHei, SimHei, sans-serif">
<rect width="{w3}" height="{h3}" fill="#fff"/>
<text x="{x0b}" y="36" font-size="20" font-weight="bold" fill="#222">各 B 字头线路站点数（绿线为最多站点，浅色为最少–最多范围）</text>
{''.join(lab3)}{''.join(bars3)}{''.join(val3)}
</svg>'''
    with open(os.path.join(OUT, "brt_stops.svg"), "w", encoding="utf-8") as f:
        f.write(svg4)
    print("stops chart saved")

    # ---------- summary json for report ----------
    summ = {
        "n_routes": len(br),
        "n_bases": len(bases),
        "n_unique_stops": bs["stop_id"].nunique(),
        "n_stop_records": len(bs),
        "mean_len": round(br["distance"].mean(), 2),
        "median_len": round(br["distance"].median(), 2),
        "min_len": round(br["distance"].min(), 2),
        "max_len": round(br["distance"].max(), 2),
        "mean_stops": round(br["total_stop"].mean(), 2),
        "max_stops": int(br["total_stop"].max()),
        "bases": [{"base": b, "count": int(c)} for b, c in br.groupby("base")["route_cn"].count().items()],
        "corridor": [{"stop": n, "lines": int(v)} for n, v in counts],
    }
    with open(os.path.join(OUT, "brt_summary.json"), "w", encoding="utf-8") as f:
        json.dump(summ, f, ensure_ascii=False, indent=2)
    print("summary saved")


if __name__ == "__main__":
    main()
