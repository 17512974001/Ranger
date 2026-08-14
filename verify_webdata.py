# -*- coding: utf-8 -*-
"""Spot-check generated web data files."""
import json


def main():
    base = "web_data"
    with open(base + "/bus_routes.geojson", encoding="utf-8") as f:
        routes = json.load(f)["features"]
    hit = [x for x in routes if x["properties"]["route_cn"].startswith("527路(")]
    print("527 main route features:", len(hit))
    if hit:
        r = hit[0]
        print(" sample:", r["properties"]["route_cn"], "| coords:", len(r["geometry"]["coordinates"]),
              "| op fields:", {k: r["properties"][k] for k in ("distance_km", "total_stop", "status_label")})

    with open(base + "/bus_stops.geojson", encoding="utf-8") as f:
        stops = json.load(f)["features"]
    hit = [x for x in stops if x["properties"]["name_cn"] == "梅花村"]
    print("梅花村 stops:", len(hit))
    if hit:
        print(" sample:", hit[0]["properties"], hit[0]["geometry"]["coordinates"])

    with open(base + "/metro_routes.geojson", encoding="utf-8") as f:
        mr = json.load(f)["features"]
    op = sum(1 for x in mr if x["properties"]["op_status"] == "运营")
    under = sum(1 for x in mr if x["properties"]["op_status"] == "在建或规划")
    print(f"metro routes: {len(mr)} = 运营 {op} + 在建/规划 {under}")

    with open(base + "/metro_bus_feeders.json", encoding="utf-8") as f:
        fd = json.load(f)
    for name in ["体育西路", "广州火车站", "嘉禾望岗"]:
        hit = [v for v in fd.values() if v["station"] == name]
        if hit:
            print(f"{name} 周边300m公交站: {len(hit[0]['bus_stops'])} 个, 最近: {hit[0]['bus_stops'][0]}")
        else:
            print(name, "未在接驳表中")

    with open(base + "/stop_routes.json", encoding="utf-8") as f:
        sr = json.load(f)
    print("梅花村站经过线路数:", len(sr.get("BV10016241", [])))
    print(sr.get("BV10016241"))


if __name__ == "__main__":
    main()
