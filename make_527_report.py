# -*- coding: utf-8 -*-
"""Build the 527 competitiveness Markdown report."""
import json
import os
import re

import pandas as pd

OUT = "brt_output"


def route_num(route_cn):
    m = re.match(r"([^（(]+)", route_cn)
    return m.group(1).strip() if m else route_cn


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "527_data.json"), "r", encoding="utf-8") as f:
        data = json.load(f)
    with open("_parsed_bus.json", "r", encoding="utf-8") as f:
        D = json.load(f)
    stops = pd.DataFrame(D["stops"])
    routes = pd.DataFrame(D["routes"])

    rinfo = data["rinfo"]
    overview = data["overview"]
    score = pd.DataFrame(data["score"])
    main = pd.DataFrame(data["main"])
    n_unique = data["n_unique_stops"]

    # direction stop lists
    s527 = stops[stops["route_cn"].str.startswith("527路", na=False)]
    s527_main = s527[~s527["route_cn"].str.startswith("527路机电", na=False)]
    dirs = {}
    for rc, g in s527_main.sort_values(["route_cn", "sequence"]).groupby("route_cn"):
        dirs[rc] = g[["sequence", "name_cn"]].values.tolist()

    md = []
    md.append("# 527路（广州白云站公交总站—石溪总站）逐站共线及竞争力分析\n")
    md.append("> 数据口径：以站点 ID 精确匹配；其他线路不含 527 主线及 527 机电班车本身；")
    md.append("> 线路起讫站取自线路名称。同一线路往返方向按一个线路号合并统计。\n")

    md.append("## 一、线路概况\n")
    md.append("| 项目 | 去程 白云站→石溪 | 回程 石溪→白云站 |")
    md.append("|---|---|---|")
    md.append("| 线路 | 527路 | 527路 |")
    md.append("| 里程 (km) | 27.6 | 22.1 |")
    md.append("| 站点数 | 37 | 34 |")
    md.append("| 票价 | 3 元 | 3 元 |")
    md.append("| 运营公司 | 广州第二巴士客运公司 | 广州第二巴士客运公司 |")
    md.append("")
    md.append("另存在变体 **527路机电班车**（石溪总站—机电技工学校总站，约 20 km / 27 站，票价 2 元），")
    md.append("在南段（石溪—解放路—中山路）与 527 主线高度重叠，并向北延伸至增槎路/槎头片区。\n")

    md.append("## 二、双向停靠站点\n")
    for rc, lst in dirs.items():
        md.append(f"### {rc}（{len(lst)} 站）\n")
        md.append(" | ".join(["序号", "站名"]) + "\n")
        md.append("|---|---|\n")
        for seq, name in lst:
            md.append(f"| {int(seq)} | {name} |\n")

    md.append(f"## 三、每站共线概览（双向，{len(overview)} 行）\n")
    md.append("“其他线路数”为该方向站点停靠的、除 527 外的线路号数（去重）；")
    md.append("“方向记录数”含其他线路自身往返方向的记录数；“主要共线线路”按线路号排序取前 8。\n")
    md.append("| 方向 | 序号 | 站名 | 其他线路数 | 方向记录数 | 主要共线线路 |")
    md.append("|---|---|---|---|---|---|")
    for r in overview:
        others = r["共线线路"].split("、")
        top = "、".join(others[:8]) + ("…" if len(others) > 8 else "")
        short = "去程(白云站→石溪)" if "白云站公交总站--石溪总站" in r["527方向"] else "回程(石溪→白云站)"
        md.append(f"| {short} | {r['序号']} | {r['站名']} | {r['其他线路数']} | {r['方向记录数']} | {top} |")
    md.append("")

    md.append("## 四、与 527 共线最多的线路（Top 30）\n")
    md.append(f"覆盖比例 = 共线站点数 ÷ 527 去重站点数（{n_unique}）；去程/回程为该线分别在 527 两个方向上共线的站点数。\n")
    md.append("| 线路 | 起讫站 | 共线站点数 | 去程 | 回程 | 覆盖比例 | 线路里程 | 站点数 | 票价 |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    for _, r in score.head(30).iterrows():
        md.append(f"| {r['线路']} | {r['起讫站']} | {int(r['共线站点数'])} | {int(r['去程共线站数'])} | "
                  f"{int(r['回程共线站数'])} | {r['覆盖527站点比例']:.0%} | "
                  f"{float(r['线路里程']):.1f} | {int(r['站点数'])} | {float(r['票价']):.0f} |")
    md.append("")

    md.append("## 五、分段竞争特征\n")
    seg_rows = [
        ("白云站—石槎—同德段", "夜80路(9站)、539路(7站)、夜77路/夜94路(各6站)、259路(5站)、夜76路/夜122路(各5站)、7路、63路",
         "日间竞争者主要是 539路、259路、7路、63路；同德围片区线路密集，站点复用度高。"),
        ("松北—罗冲围—东风西段", "夜120路(7站)、夜3路/B3路/521路(各6站)、夜19路(5站)、198路/729路/839路(各4站)",
         "B3路（罗冲围—汇彩路）在该段形成 BRT 与常规线交汇；521路/夜3路与 527 同向进入石溪方向。"),
        ("中山路—解放路段", "夜120路/88路/夜30路/250路(各5站)、夜79路/233路/193路/广286路(各3站)",
         "老城核心段，全段 5 站全部被 30+ 条线路覆盖，且与地铁1号线（西门口、公园前）高度平行，是竞争最饱和的走廊。"),
        ("宝岗大道—石溪段", "夜120路(13站)、夜55路(11站)、夜22路(9站)、530路/250路(各8站)、夜36路/244路(各7站)、121路(6站)",
         "527 在南段的终端走廊；夜120路几乎是 527 南段的镜像夜线，530路/250路/244路为日间主要对手。"),
    ]
    md.append("| 路段 | 主要共线线路（共线站数） | 特征 |")
    md.append("|---|---|---|")
    for seg, lines, note in seg_rows:
        md.append(f"| {seg} | {lines} | {note} |")
    md.append("")

    md.append("## 六、竞争力分析\n")
    md.append("### 1. 总体格局\n")
    md.append(f"527 全线 **{n_unique} 个去重站点没有一个是独有站**；"
              f"{len(score)} 条线路至少与它共线一站。")
    md.append(f"竞争最弱的只有 松北（南/北行）两站（各仅 1 条其他线路），其余站点基本都处于 20 条以上线路的共享走廊。\n")
    md.append("### 2. 直接竞争对手（按共线强度）\n")
    md.append("| 层级 | 线路 | 竞争关系 |")
    md.append("|---|---|---|")
    md.append("| 高度重叠 | 夜120路（石溪—西湾路） | 与 527 共线 28 站（58%），南段+老城段几乎镜像；仅晚间运行 |")
    md.append("| 高度重叠 | 250路（中山八路—石榴岗） | 共线 13 站，覆盖中山路—解放路—宝岗—石溪走廊 |")
    md.append("| 高度重叠 | 521路 / 夜3路（凰岗—石溪） | 各共线 12 站，同向服务 松北—罗冲围—宝岗—石溪 |")
    md.append("| 高度重叠 | 259路（嘉禾长湴—罗冲围） | 共线 12 站，北段（白云—石槎—同德）竞争最强日间线 |")
    md.append("| 中高重叠 | 244路（黄石东—江南大道南）/ 244A路 | 共线 10/8 站，宝岗大道走廊主力 |")
    md.append("| 中高重叠 | 530路（石岗路—…） | 共线 8 站，石溪—宝岗段日间对手 |")
    md.append("| 同起点 | 839路（白云站—芳和花园）、夜77路（白云站—广州东站）、夜94路 | 共线 9/7/7 站，共享白云站始发客流 |")
    md.append("| 北段补充 | 夜80路（地铁西村—石马）、539路（永泰—同德围）、7路（石槎路—大沙头） | 石槎—同德片区强分流 |")
    md.append("")
    md.append("### 3. 527 的相对优劣势\n")
    md.append("**优势**：")
    md.append("- 白云站—石溪的纵向直达走廊，是少数从广州白云站公交总站始发、贯穿同德围—罗冲围—老城—宝岗—石溪的常规日间线路，无需换乘；")
    md.append("- 覆盖面广：37/34 站接驳地铁（地铁小坪、石潭、西门口、江南新村等）及多个总站枢纽；")
    md.append("- 与 527 机电班车（2 元）形成快慢/价位互补，南段冗余度高、班次弹性大。")
    md.append("")
    md.append("**劣势**：")
    md.append("- 无独有站点，全线处于高度共享走廊，尤其 中山路—解放路（5 站全部 30+ 线路）与 宝岗大道—石溪（每站 30–51 条）；")
    md.append("- 里程长、站点密（37 站 / 27.6 km），长距离效率低于地铁（1号线西门口—公园前、8号线、广佛线等平行/换乘）；")
    md.append("- 票价 3 元，高于同走廊 2 元的 521路、530路、244A路、839路，价格敏感客群易流失；")
    md.append("- 方向性不对称：回程绕行 宝岗大道南/市红会医院1，里程少 5.5 km、站点少 3 个，双向服务水平有差异；")
    md.append("- 数据中 527 未记录首末班时间，线路时刻信息的完整性低于部分对手。")
    md.append("")
    md.append("### 4. 结论\n")
    md.append("527 的价值在于“白云站—海珠石溪”一票直达的走廊覆盖，而不是线路独特性。")
    md.append("在 中山路—解放路 与 宝岗大道 两段，它只是 30–50 条线路中的一员，替代选择极多；")
    md.append("真正有护城河的是北段（白云站—同德围）的日间直达与 527 机电班车在南段的快线补充。")
    md.append("若与 夜120路、250路、521路/夜3路、259路 等相比，527 的竞争力中等偏上：")
    md.append("胜在纵向贯通与枢纽覆盖，弱在票价、时效与双向不对称。")
    md.append("")
    md.append("---")
    md.append("附表：`527_共线分析.xlsx`（每站共线明细 / 每站共线概览 / 共线线路排行）与 CSV 文件见 `brt_output` 目录。")

    with open(os.path.join(OUT, "527_竞争力分析.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md))
    print("527 report saved")


if __name__ == "__main__":
    main()
