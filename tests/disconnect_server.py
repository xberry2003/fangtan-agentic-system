"""Isolated ASGI fixture: slow deterministic model, no external model calls."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import app as studio


class Input:
    def write(self,value):pass
    async def drain(self):pass


class Output:
    def __init__(self):self.index=0
    async def readline(self):
        self.index+=1
        if self.index==1:return (json.dumps({'text':'任务仍在后台执行'})+'\n').encode()
        if self.index==2:
            await asyncio.sleep(2)
            return (json.dumps({'complete':True,'content':'后台任务已完成'})+'\n').encode()
        return b''


class Process:
    def __init__(self):self.stdin=Input();self.stdout=Output();self.returncode=None
    def kill(self):self.returncode=0
    async def wait(self):return 0


async def spawn(*args,**kwargs):return Process()
studio.asyncio.create_subprocess_exec=spawn
app=studio.app
