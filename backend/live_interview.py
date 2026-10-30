"""Server-side PCM recognition relay; original recording is independent."""
import asyncio
import json
import os
import uuid
from urllib.parse import urlparse
from fastapi import WebSocket
from websockets.asyncio.client import connect


async def relay(ws: WebSocket):
    # Do not allow arbitrary sites to open a local microphone-processing session.
    origin = ws.headers.get('origin')
    if origin and urlparse(origin).netloc != ws.headers.get('host'):
        await ws.close(code=1008)
        return
    await ws.accept()
    tasks = []
    try:
        config = await asyncio.wait_for(ws.receive_json(), 10)
        key = os.getenv('DASHSCOPE_API_KEY', '')
        if not key:
            await ws.send_json({'error': '实时转写未配置，录音仍可正常保存，结束后可重试转写。'})
            return
        rate = config.get('sample_rate')
        if config.get('consent') is not True or rate not in (8000, 16000, 22050, 24000, 32000, 44100, 48000):
            await ws.send_json({'error': '请先同意云端转写并使用有效音频采样率。'})
            return
        task_id = uuid.uuid4().hex
        async with connect(os.getenv('DASHSCOPE_REALTIME_URL', 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'), additional_headers={'Authorization': 'Bearer ' + key}, open_timeout=15, max_size=1024*1024) as upstream:
            await upstream.send(json.dumps({'header': {'action': 'run-task', 'task_id': task_id, 'streaming': 'duplex'}, 'payload': {'task_group': 'audio', 'task': 'asr', 'function': 'recognition', 'model': 'paraformer-realtime-v2', 'parameters': {'format': 'pcm', 'sample_rate': rate, 'language_hints': ['zh', 'en']}, 'input': {}}}))
            first = json.loads(await asyncio.wait_for(upstream.recv(), 20))
            if first.get('header', {}).get('event') != 'task-started':
                await ws.send_json({'error': '实时语音服务未能启动，原始录音不受影响。'})
                return
            await ws.send_json({'ready': True})

            async def send_audio():
                while True:
                    packet = await asyncio.wait_for(ws.receive(), 120)
                    if packet['type'] == 'websocket.disconnect':
                        return
                    if packet.get('bytes'):
                        if len(packet['bytes']) > 65536:
                            raise ValueError('audio frame too large')
                        await upstream.send(packet['bytes'])
                    elif packet.get('text') and json.loads(packet['text']).get('finish'):
                        await upstream.send(json.dumps({'header': {'action': 'finish-task', 'task_id': task_id, 'streaming': 'duplex'}, 'payload': {'input': {}}}))
                        await asyncio.sleep(15)  # receiver ends first after final results
                        return

            async def receive_text():
                async for raw in upstream:
                    event = json.loads(raw)
                    kind = event.get('header', {}).get('event')
                    if kind == 'result-generated':
                        sentence = event.get('payload', {}).get('output', {}).get('sentence', {})
                        if sentence.get('text') and not sentence.get('heartbeat'):
                            await ws.send_json({'text': sentence['text'], 'final': bool(sentence.get('sentence_end')), 'begin': sentence.get('begin_time', 0)})
                    elif kind == 'task-finished':
                        await ws.send_json({'done': True})
                        return
                    elif kind == 'task-failed':
                        await ws.send_json({'error': '实时转写中断，录音继续保存；可结束后重新转写。'})
                        return
            tasks = [asyncio.create_task(send_audio()), asyncio.create_task(receive_text())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except Exception:
        # Never expose upstream exceptions or credentials to the browser.
        try:
            await ws.send_json({'error': '实时转写暂不可用，原始录音仍在继续，可结束后转写。'})
        except Exception:
            pass
    finally:
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await ws.close()
        except Exception:
            pass
