# -*- coding: utf-8 -*-
"""Inspect raw route records at one of 527's stops."""
import json

import pandas as pd


def main():
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    stops = pd.DataFrame(D["stops"])

    sid = "BV10021897"  # 保利花园(南石头)
    g = stops[stops["stop_id"] == sid]
    print("=== stop_id", sid, "===")
    print(g[["name_cn", "route_cn", "sequence"]].to_string())


if __name__ == "__main__":
    main()
