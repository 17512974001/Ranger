# -*- coding: utf-8 -*-
"""Query bus routes serving the Meihuacun stop."""
import json

import pandas as pd


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    stops = pd.DataFrame(D["stops"])
    su = pd.DataFrame(D["stops_unique"])

    hits = su[su["stop_cn"].str.contains("梅花村", na=False)]
    print("=== stops_unique 中包含 '梅花村' 的站点 ===")
    print(hits[["stop_cn", "stop_id", "num"]].to_string())

    s = stops[stops["name_cn"].str.contains("梅花村", na=False)]
    print("\n=== stops 表匹配记录数:", len(s), "===")
    print(s[["name_cn", "stop_id", "route_cn", "sequence"]].to_string())

    routes = sorted(s["route_cn"].unique())
    print("\n=== 经过梅花村站的线路（去重）===")
    for r in routes:
        print(r)


if __name__ == "__main__":
    main()
