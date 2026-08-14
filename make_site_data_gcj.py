# -*- coding: utf-8 -*-
"""Convert web_data (WGS84) GeoJSON into GCJ02 JS files for the Amap basemap.

Only coordinate-bearing files are converted; attribute-only JSON files stay as-is.
web_data/ itself remains the WGS84 source of truth.
"""
import json
import math
import os

OUT = "transit_site"
DATA = os.path.join(OUT, "data")
SRC = "web_data"

PI = 3.1415926535897932384626
X_PI = PI * 3000.0 / 180.0
A = 6378245.0
EE = 0.00669342162296594323


def out_of_china(lng, lat):
    return not (72.004 <= lng <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _transform_lat(x, y):
    ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(y * PI) + 40.0 * math.sin(y / 3.0 * PI)) * 2.0 / 3.0
    ret += (160.0 * math.sin(y / 12.0 * PI) + 320 * math.sin(y * PI / 30.0)) * 2.0 / 3.0
    return ret


def _transform_lng(x, y):
    ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    ret += (20.0 * math.sin(6.0 * x * PI) + 20.0 * math.sin(2.0 * x * PI)) * 2.0 / 3.0
    ret += (20.0 * math.sin(x * PI) + 40.0 * math.sin(x / 3.0 * PI)) * 2.0 / 3.0
    ret += (150.0 * math.sin(x / 12.0 * PI) + 300.0 * math.sin(x / 30.0 * PI)) * 2.0 / 3.0
    return ret


def wgs84_to_gcj02(lng, lat):
    if out_of_china(lng, lat):
        return [lng, lat]
    dlat = _transform_lat(lng - 105.0, lat - 35.0)
    dlng = _transform_lng(lng - 105.0, lat - 35.0)
    radlat = lat / 180.0 * PI
    magic = math.sin(radlat)
    magic = 1 - EE * magic * magic
    sqrtmagic = math.sqrt(magic)
    dlat = (dlat * 180.0) / ((A * (1 - EE)) / (magic * sqrtmagic) * PI)
    dlng = (dlng * 180.0) / (A / sqrtmagic * math.cos(radlat) * PI)
    return [lng + dlng, lat + dlat]


def transform_geom(g):
    if g["type"] == "Point":
        c = g["coordinates"]
        g["coordinates"] = [round(v, 6) for v in wgs84_to_gcj02(c[0], c[1])]
    elif g["type"] == "LineString":
        g["coordinates"] = [
            [round(v, 6) for v in wgs84_to_gcj02(c[0], c[1])] for c in g["coordinates"]
        ]
    return g


def main():
    os.makedirs(DATA, exist_ok=True)
    files = {
        "bus_routes.geojson": "BUS_ROUTES",
        "bus_stops.geojson": "BUS_STOPS",
        "metro_routes.geojson": "METRO_ROUTES",
        "metro_stops.geojson": "METRO_STOPS",
    }
    for fn, var in files.items():
        with open(os.path.join(SRC, fn), encoding="utf-8") as f:
            gj = json.load(f)
        for feat in gj["features"]:
            feat["geometry"] = transform_geom(feat["geometry"])
        js_name = fn.replace(".geojson", ".js")
        with open(os.path.join(DATA, js_name), "w", encoding="utf-8") as f:
            f.write(f"window.{var} = {json.dumps(gj, ensure_ascii=False, separators=(',', ':'))};\n")
        print(f"{js_name}: {os.path.getsize(os.path.join(DATA, js_name))/1024:.0f} KB (GCJ02)")

    # sample shift check
    with open(os.path.join(DATA, "bus_stops.js"), encoding="utf-8") as f:
        js = f.read()
    import re
    m = re.search(r"梅花村[^}]*?\[([\d.]+), ([\d.]+)\]", js)
    if m:
        print("sample 梅花村 GCJ02:", m.group(1), m.group(2))
    print("done -> transit_site/data (GCJ02); web_data stays WGS84")


if __name__ == "__main__":
    main()
