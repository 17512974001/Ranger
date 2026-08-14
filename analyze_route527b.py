# -*- coding: utf-8 -*-
"""Segment/competition depth analysis for route 527."""
import json
import re

import pandas as pd


def route_num(route_cn):
    m = re.match(r"([^（(]+)", route_cn)
    return m.group(1).strip() if m else route_cn


def od_of(route_cn):
    m = re.search(r"\((.*)\)\s*$", route_cn)
    return m.group(1) if m else ""


SEGS = {
    "白云站-石槎-同德段": ["广州白云站公交总站", "地铁小坪站", "石槎路中", "桥东", "广州白云站西广场站",
                     "地铁石潭站", "石槎路", "泽德花苑", "横滘", "上步村", "同德乡", "同康路东站", "同康路站"],
    "松北-罗冲围-东风西段": ["松北(停北行)", "松北(南行)", "松南街口", "松南路口", "罗冲围客运站",
                      "富力半岛花园", "和平新村", "和平新村站", "东风西路1", "康王北路"],
    "中山路-解放路段": ["中山七路", "西门口(中山六路)", "中山六路", "解放中路", "解放南路"],
    "宝岗大道-石溪段": ["堑口2", "宝岗大道北", "宝岗大道中", "海珠区妇幼", "海珠区妇幼1",
                  "市红会医院1", "江南新村", "西基东", "昌岗路口", "宝岗大道南", "燕翔路",
                  "保利红棉花园", "保利花园(南石头)", "石溪总站"],
}


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    routes = pd.DataFrame(D["routes"])
    stops = pd.DataFrame(D["stops"])

    s527 = stops[stops["route_cn"].str.startswith("527路", na=False)].copy()
    s527_main = s527[~s527["route_cn"].str.startswith("527路机电", na=False)]
    uniq = s527_main.drop_duplicates("stop_id")
    stop_ids = set(uniq["stop_id"])

    excl = stops["route_cn"].str.startswith("527", na=False)
    other = stops[~excl]
    stop2routes = {sid: set(g["route_cn"].unique()) for sid, g in other.groupby("stop_id")}

    rinfo = {}
    for _, row in routes.iterrows():
        n = route_num(row["route_cn"])
        if n not in rinfo:
            rinfo[n] = {"od": od_of(row["route_cn"]), "len": row["distance"],
                        "stops": row["total_stop"], "price": row["basic_prc"]}

    # per-stop competition count
    rows = []
    for _, r in uniq.iterrows():
        oths = stop2routes.get(r["stop_id"], set())
        rows.append({"stop": r["name_cn"], "n": len(oths), "routes": sorted(route_num(x) for x in oths)})
    ps = pd.DataFrame(rows)
    print("=== 竞争最激烈的站点 Top15 ===")
    print(ps.nlargest(15, "n")[["stop", "n"]].to_string())
    print("\n=== 竞争最弱的站点（其他线路<=2）===")
    weak = ps[ps["n"] <= 2].sort_values("n")
    print(weak[["stop", "n"]].to_string())
    print("\n527 独有站点(无其他线路):", (ps["n"] == 0).sum())

    # segment analysis
    print("\n=== 分段共线特征 ===")
    for seg, names in SEGS.items():
        ids = set(uniq[uniq["name_cn"].isin(names)]["stop_id"])
        seg_routes = {}
        for sid in ids:
            for rc in stop2routes.get(sid, set()):
                seg_routes.setdefault(route_num(rc), set()).add(sid)
        top = sorted(seg_routes.items(), key=lambda kv: -len(kv[1]))[:8]
        n_stops = len(ids)
        print(f"\n[{seg}] 站点数 {n_stops}")
        for n, sids in top:
            print(f"  {n:8s} 覆盖本站段{len(sids):2d}个站: {rinfo.get(n, {}).get('od', '')}")

    # top competitor detail table
    print("\n=== 527 vs 主要共线线路 ===")
    top = ["夜120路", "夜22路", "夜55路", "250路", "521路", "夜3路", "259路", "夜122路",
           "244路", "夜80路", "839路", "夜76路", "244A路", "530路", "夜36路"]
    print(f"{'线路':10s} {'起讫站':38s} {'里程':>6s} {'站点':>4s} {'票价':>4s}")
    for n in top:
        info = rinfo.get(n, {})
        print(f"{n:10s} {str(info.get('od', '')):38s} {float(info.get('len', 0)):6.1f} "
              f"{int(float(info.get('stops', 0))):4d} {float(info.get('price', 0)):4.0f}")


if __name__ == "__main__":
    main()
