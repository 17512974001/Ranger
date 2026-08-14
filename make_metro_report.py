# -*- coding: utf-8 -*-
"""Generate metro data quality report."""
import json
import os
import re
import struct


def read_dbf(path):
    with open(path, "rb") as f:
        head = f.read(32)
        nrec = struct.unpack("<I", head[4:8])[0]
        hlen = struct.unpack("<H", head[8:10])[0]
        rlen = struct.unpack("<H", head[10:12])[0]
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            name = d[:11].split(b"\x00")[0].decode("utf-8", "replace")
            fields.append((name, chr(d[11]), d[16], d[17]))
        f.seek(hlen)
        data = f.read(nrec * rlen)
    rows = []
    for i in range(nrec):
        rec = data[i * rlen:(i + 1) * rlen]
        row = {}
        off = 1
        for name, ft, fl, _ in fields:
            raw = rec[off:off + fl]
            off += fl
            if ft in "NnFf":
                s = raw.decode("ascii", "replace").strip()
                try:
                    val = float(s) if s else None
                except ValueError:
                    val = None
            elif ft == "C":
                val = raw.rstrip(b"\x00 ").decode("utf-8", "replace").strip() or None
            else:
                val = raw
            row[name] = val
        rows.append(row)
    return rows


def line_base(rc):
    m = re.match(r"(地铁\d+号线(?:\w+)?|APM线|广佛线|海珠有轨电车1号线|黄埔有轨电车1号线)", rc)
    return m.group(1) if m else rc


def main():
    md = r"D:\haowanyouxi\Canton\CPTOND-2025\GMetro"
    routes = read_dbf(os.path.join(md, "guangzhou_metro_routes.dbf"))
    su = read_dbf(os.path.join(md, "guangzhou_metro_stops_unique.dbf"))
    segs = read_dbf(os.path.join(md, "guangzhou_metro_segments.dbf"))

    with open("web_data/metro_bus_feeders.json", encoding="utf-8") as f:
        feeders = json.load(f)

    op = [r for r in routes if r["status"] == "1"]
    un = [r for r in routes if r["status"] == "3"]

    # operational line length: unique base lines, take first direction
    op_base = {}
    for r in op:
        b = line_base(r["route_cn"])
        op_base.setdefault(b, r["length"])
    op_len = sum(v for v in op_base.values() if v)
    un_base = {}
    for r in un:
        un_base.setdefault(line_base(r["route_cn"]), r["length"])
    un_len = sum(v for v in un_base.values() if v)

    # station stats
    nums = [r["num"] or 0 for r in su]
    transfer = sorted(su, key=lambda x: -(x["num"] or 0))[:12]

    # missing fields
    missing = {c: sum(1 for r in routes if not r[c]) for c in
               ["company_cn", "start_time", "end_time", "basic_prc", "total_prc"]}

    # feeder stats: metro station -> #bus stops within 300m
    feeder_cnt = [(v["station"], len(v["bus_stops"])) for v in feeders.values()]
    feeder_cnt.sort(key=lambda x: -x[1])

    # name issues
    name_issues = []
    for r in su:
        n = r["stop_cn"] or ""
        if n in ("广州火车", "广州东", "广州南", "广州北", "广州白云"):
            name_issues.append((n, r["stop_en"]))
        elif "航楼" in n:
            name_issues.append((n, r["stop_en"]))

    md_text = []
    md_text.append("# 广州地铁数据质量报告\n")
    md_text.append("## 一、数据概况\n")
    md_text.append("| 项目 | 数值 |")
    md_text.append("|---|---|")
    md_text.append(f"| 线路记录 | {len(routes)} 条（含往返方向） |")
    md_text.append(f"| 已运营线路 | {len(op)} 条记录 / {len(op_base)} 条线，里程合计约 {op_len:.1f} km |")
    md_text.append(f"| 在建或规划段 | {len(un)} 条记录 / {len(un_base)} 段，里程合计约 {un_len:.1f} km |")
    md_text.append(f"| 去重车站 | {len(su)} 个 |")
    md_text.append(f"| 区间 | {len(segs)} 个 |")
    md_text.append(f"| 车站停靠线路数 | 平均 {sum(nums)/len(nums):.1f} 条，最多 {max(nums)} 条 |")
    md_text.append("")
    md_text.append("## 二、线路构成\n")
    md_text.append("### 已运营（status=1，21 条线 / 42 条记录）\n")
    md_text.append("地铁1、2、3、4、5、6、7、8、9、11（环线）、13、14（含知识城支线）、18、21、22 号线，"
                   "以及 APM 线、广佛线、海珠有轨电车1号线、黄埔有轨电车1号线。\n")
    md_text.append(f"### 在建或规划（status=3，{len(un_base)} 段 / {len(un)} 条记录）\n")
    md_text.append("10号线、12号线（含中段）、13号线二期、14号线二期、18号线北延/南延/后通段、"
                   "22号线北延/后通段、8号线东延/北延段及北延支线。\n")
    md_text.append("> 提示：这些段尚无运营时间与票价，做地图时应按 op_status 过滤或弱化显示。\n")
    md_text.append("## 三、车站与换乘\n")
    md_text.append("换乘能力最强的车站（按停靠线路数）：\n")
    md_text.append("| 车站 | 停靠线路数 |")
    md_text.append("|---|---|")
    for r in transfer:
        md_text.append(f"| {r['stop_cn']} | {int(r['num'])} |")
    md_text.append("")
    md_text.append("## 四、地铁站周边公交接驳（300 米内）\n")
    md_text.append(f"409 个地铁站中有 **{len(feeders)} 个**能找到 300 米内的公交站，"
                   f"合计 {sum(c for _, c in feeder_cnt)} 个公交站点对。接驳最密的换乘点：\n")
    md_text.append("| 地铁站 | 300米内公交站数 |")
    md_text.append("|---|---|")
    for name, c in feeder_cnt[:12]:
        md_text.append(f"| {name} | {c} |")
    md_text.append("")
    md_text.append("## 五、字段完整性与数据问题\n")
    md_text.append("| 字段 | 缺失记录数 / 70 | 说明 |")
    md_text.append("|---|---|---|")
    md_text.append(f"| 运营公司 | {missing['company_cn']} | 全部在建/规划段缺公司 |")
    md_text.append(f"| 首末班时间 | {missing['start_time']} | 部分已运营线路也缺（2、6、7、9号线、广佛线、有轨电车） |")
    md_text.append(f"| 票价 | {missing['basic_prc']} | 在建/规划段无票价 |")
    md_text.append("")
    md_text.append("**站名问题（抓取时截断/翻译）：**\n")
    for n, e in name_issues:
        md_text.append(f"- 中文“{n}”（英文“{e}”）应为完整站名（如“广州火车站”“广州东站”“机场北(2号航站楼)”）")
    md_text.append("- 部分英文站名为直译，如 黄边=Yellow edge、市二宫=Municipality Ninomiya、人和=people、公园前=In front of the park。")
    md_text.append("- “广州火车站”在数据中写作“广州火车”，做公交-地铁站名匹配时需注意。\n")
    md_text.append("## 六、价值小结\n")
    md_text.append("1. 地铁数据质量整体可靠：几何、里程、换乘信息完整，status 字段可直接区分运营/在建。")
    md_text.append("2. 与公交合并后，可实现 公交—地铁 换乘接驳分析（已生成 metro_bus_feeders.json）、"
                   "双网覆盖与竞争分析、换乘枢纽专题等网站功能。")
    md_text.append("3. 上线前建议：修正截断站名、弱化显示在建线路、统一中英文名。")

    with open("web_data/地铁数据质量报告.md", "w", encoding="utf-8") as f:
        f.write("\n".join(md_text))
    print("metro quality report saved")


if __name__ == "__main__":
    main()
