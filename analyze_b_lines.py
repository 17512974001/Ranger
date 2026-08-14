# -*- coding: utf-8 -*-
"""BRT (B-prefix) line analysis for Guangzhou bus dataset."""
import json
import re
import sys

import pandas as pd


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    routes = pd.DataFrame(D["routes"])
    segments = pd.DataFrame(D["segments"])
    stops = pd.DataFrame(D["stops"])
    su = pd.DataFrame(D["stops_unique"])

    mask = routes["route_cn"].str.upper().str.startswith("B", na=False)
    br = routes[mask].copy().reset_index(drop=True)
    bnames = set(br["route_cn"].tolist())
    bs = stops[stops["route_cn"].isin(bnames)].copy()

    # ---- corridor segments: verify how many B lines run each BRT pair ----
    corridor_pairs = [
        ("体育中心", "石牌桥"),
        ("石牌桥", "岗顶"),
        ("岗顶", "师大暨大"),
        ("师大暨大", "华景新城"),
        ("华景新城", "上社"),
        ("上社", "学院"),
        ("学院", "棠下村"),
        ("棠下村", "棠东"),
        ("棠东", "天朗明居"),
        ("天朗明居", "车陂"),
        ("车陂", "东圃镇"),
        ("东圃镇", "黄村"),
        ("黄村", "珠村"),
        ("珠村", "莲溪"),
        ("莲溪", "茅岗"),
        ("茅岗", "蟹山"),
        ("蟹山", "鱼珠"),
    ]
    print("=== BRT corridor pair coverage (all segments / B-line segments) ===")
    bseg = segments[segments["s_stopid"].isin(bs["stop_id"]) | segments["e_stopid"].isin(bs["stop_id"])]
    for a, b in corridor_pairs:
        pair_all = segments[(segments["s_stop_cn"] == a) & (segments["e_stop_cn"] == b) |
                            (segments["s_stop_cn"] == b) & (segments["e_stop_cn"] == a)]
        pair_b = bseg[(bseg["s_stop_cn"] == a) & (bseg["e_stop_cn"] == b) |
                      (bseg["s_stop_cn"] == b) & (bseg["e_stop_cn"] == a)]
        print(f"{a} - {b}: all={len(pair_all)} bseg={len(pair_b)}")

    # ---- stop name variants on corridor ----
    print("\n=== stop names containing BRT keywords ===")
    kw = su[su["stop_cn"].str.contains("BRT", na=False)]
    print("stops_unique names containing 'BRT':", len(kw))
    print(kw[["stop_cn", "num"]].head(30).to_string())

    # ---- shared segments among B lines by stop ids ----
    print("\n=== B-line shared segments Top25 (by B-line count) ===")
    pair = bseg[["s_stopid", "e_stopid", "s_stop_cn", "e_stop_cn", "distance"]].copy()
    pair["key"] = pair.apply(lambda r: "|".join(sorted([str(r["s_stopid"]), str(r["e_stopid"])])), axis=1)
    pair["label"] = pair.apply(lambda r: " -> ".join(sorted([str(r["s_stop_cn"]), str(r["e_stop_cn"])])), axis=1)
    pcount = pair.groupby(["key", "label"])["distance"].first().reset_index()
    pcount["lines"] = pair.groupby("key")["key"].transform("count")
    pcount = pcount.drop_duplicates("key")
    print(pcount.nlargest(25, "lines")[["label", "lines", "distance"]].to_string())

    # ---- number of unique B routes stopping at corridor stops ----
    print("\n=== B-line counts at corridor stops (by stop name) ===")
    for a, _ in corridor_pairs:
        n = bs[bs["name_cn"] == a]["route_cn"].nunique()
        print(f"{a}: {n}")

    # ---- per-route stop count consistency ----
    cnt = bs.groupby("route_cn")["stop_id"].nunique()
    chk = cnt.reset_index(name="n").merge(br[["route_cn", "total_stop"]], on="route_cn", how="left")
    diff = chk[chk["n"] != chk["total_stop"]]
    print("\n=== total_stop mismatch ===")
    print(diff.to_string())

    # ---- segment distance stats for B lines ----
    print("\n=== B-line segment distance stats ===")
    print(bseg["distance"].describe().to_string())

    # ---- check English-name B lines not captured by CN name ----
    en_only = routes[routes["route_en"].str.upper().str.startswith("B", na=False) &
                     ~routes["route_cn"].str.upper().str.startswith("B", na=False)]
    print("\n=== route_en starts with B but route_cn doesn't ===")
    print(len(en_only), en_only["route_cn"].head(20).tolist())

    # ---- city distribution of B lines ----
    print("\n=== B-line city_cn distribution ===")
    print(br["city_cn"].value_counts(dropna=False).to_string())

    # ---- time availability ----
    avail = br.dropna(subset=["start_time"])
    print("\n=== B-line first-bus times (available %d/%d) ===" % (len(avail), len(br)))
    hh = avail["start_time"].str[:2].astype(int)
    print("mode:", avail["start_time"].mode().head(5).tolist(), "earliest:", avail["start_time"].min(),
          "median:", avail["start_time"].median(), "latest:", avail["start_time"].max())
    end_avail = br.dropna(subset=["end_time"])
    print("last-bus mode:", end_avail["end_time"].mode().head(5).tolist(),
          "median:", end_avail["end_time"].median())

    # ---- buses per stop on corridor using name_cn ----
    print("\n=== B-line stop counts (name_cn) top 30 ===")
    top = bs.groupby("name_cn")["route_cn"].nunique().sort_values(ascending=False).head(30)
    print(top.to_string())


if __name__ == "__main__":
    main()
