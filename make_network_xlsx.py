# -*- coding: utf-8 -*-
"""把全网共线/重复度/走廊/分站字典的 CSV 汇总成一个 Excel 工作簿。"""
import os

import pandas as pd

base = os.path.dirname(os.path.abspath(__file__))
net = os.path.join(base, "output", "network")
out = os.path.join(net, "全网共线重复度分析.xlsx")

sheets = [
    ("线路重复度指标", "线路重复度指标.csv"),
    ("共线线路对", "共线线路对.csv"),
    ("高密度站点", "高密度站点.csv"),
    ("高重复走廊", "高重复走廊.csv"),
    ("分站规范化字典", "分站规范化字典.csv"),
]

with pd.ExcelWriter(out, engine="openpyxl") as w:
    for name, f in sheets:
        df = pd.read_csv(os.path.join(net, f), encoding="utf-8-sig")
        df.to_excel(w, sheet_name=name, index=False)

print("生成:", out, "| 大小:", round(os.path.getsize(out) / 1024 / 1024, 2), "MB")
