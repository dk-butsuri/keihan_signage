from keihan_tracker.delay_tracker import get_ekispert_delay, get_yahoo_delay
import delay_ai
import dotenv
dotenv.load_dotenv()
from os import environ
import asyncio

async def main():
    #res = await delay_ai.convert(await get_ekispert_delay(environ["EKISPERT_API_KEY"]))
    res = await get_yahoo_delay(4)
    
    for i in res:
        print(i)

asyncio.run(main())