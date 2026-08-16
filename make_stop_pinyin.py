# -*- coding: utf-8 -*-
"""为站点名生成拼音索引（data/stop_pinyin.js），供网站搜索使用。"""
import json
import os
import re

from pypinyin import Style, lazy_pinyin


def parse_js_var(path, var):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"window\.%s\s*=\s*(.*?);?\s*$" % re.escape(var), text, re.S)
    if not m:
        raise RuntimeError("cannot find %s in %s" % (var, path))
    return json.loads(m.group(1))


def pinyin_ini(name):
    """首字母缩写：每个汉字取声母首字母，ASCII 字母数字原样保留，标点跳过。"""
    out = []
    for tok in lazy_pinyin(name, style=Style.NORMAL):
        if re.fullmatch(r"[a-z]+", tok):
            out.append(tok[0])
        elif re.fullmatch(r"[0-9]+", tok):
            out.append(tok)
        elif re.fullmatch(r"[a-z0-9]+", tok):
            out.append(tok[0])
    return "".join(out)


def pinyin_full(name):
    out = []
    for tok in lazy_pinyin(name, style=Style.NORMAL):
        if re.fullmatch(r"[a-z0-9]+", tok):
            out.append(tok)
    return "".join(out)


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    names = set()
    bus = parse_js_var(os.path.join(base, "data", "bus_stops.js"), "BUS_STOPS")
    for f in bus["features"]:
        names.add(f["properties"]["name_cn"])
    metro = parse_js_var(os.path.join(base, "data", "metro_stops.js"), "METRO_STOPS")
    for f in metro["features"]:
        names.add(f["properties"]["name_cn"])

    lines = ["window.STOP_PINYIN = {"]
    for n in sorted(names):
        ini = pinyin_ini(n).lower()
        full = pinyin_full(n).lower()
        if not ini and not full:
            continue
        lines.append('  %s:"%s|%s",' % (json.dumps(n, ensure_ascii=False), ini, full))
    lines.append("};")

    out_path = os.path.join(base, "data", "stop_pinyin.js")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("站点名:", len(names), "| 写入:", out_path)


if __name__ == "__main__":
    main()
