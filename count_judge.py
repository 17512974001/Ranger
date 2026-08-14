# -*- coding: utf-8 -*-
"""Count direction-judgment values in the detail CSV."""
import collections
import glob


def main():
    p = glob.glob("brt_output/*共线明细.csv")[0]
    with open(p, encoding="utf-8-sig") as f:
        lines = f.read().splitlines()
    header = lines[0].split(",")
    idx = header.index("方向判定")
    cnt = collections.Counter()
    amb = []
    for ln in lines[1:]:
        # simple split: 方向判定 is the last column, no commas inside values
        parts = ln.split(",")
        cnt[parts[idx]] += 1
        if "待定" in parts[idx]:
            amb.append(parts)
    print("rows:", len(lines) - 1)
    for k, v in cnt.items():
        print(f"  {k}: {v} ({v / (len(lines) - 1):.1%})")
    print("\nambiguous rows:")
    for p in amb:
        print(" | ".join(p[:7]))


if __name__ == "__main__":
    main()
