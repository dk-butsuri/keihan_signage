# 運行情報の取得を手元で確かめるスクリプト（config.yml の delays を使う）
import asyncio
import yaml
import operation_info


async def main():
    with open("config.yml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f).get("delays") or {}
    rows, error = await operation_info.fetch(operation_info.build_tracker(cfg), cfg)
    if error:
        print("取得に失敗した取得先:", error)
    for r in rows:
        print(f"{r['line']}: {r['status']}  ({r['announced_time']})\n{r['detail']}\n")

asyncio.run(main())
