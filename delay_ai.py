from typing import Literal
import asyncio
from google import genai
from google.genai import types
from keihan_tracker.delay_tracker import DelayLine
from pydantic import BaseModel
from dotenv import load_dotenv
from os import environ

load_dotenv()

class ModernDelayData(DelayLine):
    InfoType: Literal["運転見合わせ","計画運休","列車遅延","ダイヤ乱れ","運転再開"] | str

MDDList = list[ModernDelayData]

async def convert(delays: list[DelayLine], bypass:bool = False) -> MDDList:
    if not delays:
        return MDDList([])

    if bypass:
        res = []
        for delay in delays:
            res.append(ModernDelayData(
                LineName=delay.LineName,
                status=delay.status,
                detail=delay.detail,
                AnnouncedTime=delay.AnnouncedTime,
                InfoType=delay.status
            ))
        return MDDList(res)

    client = genai.Client(api_key=environ["GOOGLE_API_KEY"])

    async def classify(delay: DelayLine) -> ModernDelayData:
        response = await client.aio.models.generate_content(
            model="gemini-3.1-flash-lite-preview",
            contents=f"""
            以下の1件の遅延情報のInfoTypeを分類してください。
            InfoTypeは「運転見合わせ」「計画運休」「列車遅延」「ダイヤ乱れ」「運転再開」から選択してください。
            判断できない場合はstatusの文字列をそのままInfoTypeに使用してください。

            {delay}
            """,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ModernDelayData,
            ),
        )
        parsed = response.parsed
        if not isinstance(parsed, ModernDelayData):
            return ModernDelayData(**delay.model_dump(), InfoType=delay.status)
        return parsed

    try:
        responses = await asyncio.gather(*[classify(d) for d in delays])
    except Exception as e:
        print(f"[delay_ai] Gemini API error, falling back to bypass: {e}")
        return await convert(delays, bypass=True)

    results: dict[str, ModernDelayData] = {}
    for delay, parsed in zip(delays, responses):
        key = delay.LineName
        existing = results.get(key)
        if existing is None or (delay.AnnouncedTime is not None and (existing.AnnouncedTime is None or delay.AnnouncedTime >= existing.AnnouncedTime)):
            results[key] = parsed

    return MDDList(list(results.values()))