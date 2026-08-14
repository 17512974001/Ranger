# -*- coding: utf-8 -*-
"""Extract route 527 stops in both directions and list co-stopping routes per stop."""
import json

import pandas as pd


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    routes = pd.DataFrame(D["routes"])
    stops = pd.DataFrame(D["stops"])
    su = pd.DataFrame(D["stops_unique"])

    r527 = routes[routes["route_cn"].str.startswith("527路", na=False)]
    print("=== 527路 in routes table ===")
    print(r527.to_string())

    s527 = stops[stops["route_cn"].str.startswith("527路", na=False)].copy()
    print("\n=== 527路 stop records:", len(s527), "===")
    for dirname, g in s527.groupby("route_cn"):
        g = g.sort_values("sequence")
        print(f"\n方向: {dirname}  站点数: {len(g)}")
        print(g[["sequence", "name_cn", "stop_id"]].to_string())


if __name__ == "__main__":
    main()
