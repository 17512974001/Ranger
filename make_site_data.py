# -*- coding: utf-8 -*-
"""Convert web_data JSON/GeoJSON into JS files that work from file:// (no server)."""
import os

OUT = "transit_site"
DATA = os.path.join(OUT, "data")
SRC = "web_data"

MAPS = {
    "bus_routes.geojson": "BUS_ROUTES",
    "bus_stops.geojson": "BUS_STOPS",
    "metro_routes.geojson": "METRO_ROUTES",
    "metro_stops.geojson": "METRO_STOPS",
    "bus_route_stops.json": "BUS_ROUTE_STOPS",
    "stop_routes.json": "STOP_ROUTES",
    "metro_route_stops.json": "METRO_ROUTE_STOPS",
    "metro_stop_routes.json": "METRO_STOP_ROUTES",
    "metro_bus_feeders.json": "METRO_FEEDERS",
}


def main():
    os.makedirs(DATA, exist_ok=True)
    total = 0
    for fn, var in MAPS.items():
        with open(os.path.join(SRC, fn), encoding="utf-8") as f:
            content = f.read()
        js_name = fn.replace(".geojson", ".js").replace(".json", ".js")
        with open(os.path.join(DATA, js_name), "w", encoding="utf-8") as f:
            f.write(f"window.{var} = {content};\n")
        size = os.path.getsize(os.path.join(DATA, js_name))
        total += size
        print(f"{js_name}: {size/1024:.0f} KB")
    print(f"total: {total/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
