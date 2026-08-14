# -*- coding: utf-8 -*-
"""Check metro station name quality (truncation etc.)."""
import os
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


def main():
    md = r"D:\haowanyouxi\Canton\CPTOND-2025\GMetro"
    su = read_dbf(os.path.join(md, "guangzhou_metro_stops_unique.dbf"))
    print("station count:", len(su))
    print("\nsample station names (first 40):")
    for r in su[:40]:
        print(f"  {r['stop_cn']} | {r['stop_en']} | num={r['num']}")

    print("\nnames containing 广州/火车/东站:")
    for r in su:
        n = r["stop_cn"] or ""
        if ("广州" in n) or ("火车" in n) or ("东站" in n) or ("南站" in n):
            print(f"  {n} | {r['stop_en']}")

    print("\ntop transfer stations:")
    for r in sorted(su, key=lambda x: -(x["num"] or 0))[:12]:
        print(f"  {r['stop_cn']} ({r['stop_en']}) num={r['num']}")


if __name__ == "__main__":
    main()
