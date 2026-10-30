"""Real HTTP disconnect and capacity checks against an isolated local server."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import httpx
ROOT=Path(__file__).resolve().parents[1]


class HttpDisconnectTest(unittest.TestCase):
    def test_detached_runs_survive_http_disconnect_and_release_slots(self):
        with tempfile.TemporaryDirectory(prefix='ticha-chat-http-') as directory:
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            env={**os.environ,'TICHA_DATA_DIR':directory,'TICHA_AI_KEY':'test','TICHA_AI_MODEL':'test'}
            server=subprocess.Popen([sys.executable,'-m','uvicorn','disconnect_server:app','--app-dir','tests','--host','127.0.0.1','--port',str(port)],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            try:
                with httpx.Client(base_url=f'http://127.0.0.1:{port}',timeout=10,trust_env=False) as client:
                    for attempt in range(80):
                        try:
                            if client.get('/api/health').status_code==200:break
                        except httpx.TransportError:pass
                        if server.poll() is not None:self.fail('isolated server exited')
                        time.sleep(.1)
                    else:self.fail('isolated server failed to start')
                    pid=client.post('/api/projects',json={'name':'断线测试'}).json()['id'];base=f'/api/projects/{pid}'
                    ids=[client.post(base+'/conversations',json={'title':f'任务{i}'}).json()['id'] for i in range(3)]
                    runs=[]
                    for cid in ids[:2]:
                        with client.stream('POST',base+'/messages',json={'conversation_id':cid,'content':'测试持久任务'}) as response:
                            self.assertEqual(response.status_code,200)
                            runs.append(response.headers['X-Run-Id'])
                            self.assertIn('后台执行',next(response.iter_lines()))
                        # Closing this HTTP stream must not stop its model task.
                    self.assertEqual(client.get(base+f'/conversations/{ids[0]}/run').json()['status'],'running')
                    self.assertEqual(client.post(base+'/messages',json={'conversation_id':ids[2],'content':'第三条'}).status_code,429)
                    self.assertEqual(client.get(base+f'/messages?conversation_id={ids[2]}').json(),[])
                    client.post(base+f'/runs/{runs[0]}/stop')
                    for _ in range(40):
                        if client.get(base+f'/conversations/{ids[0]}/run').json()['status']=='cancelled':break
                        time.sleep(.05)
                    self.assertEqual(client.get(base+f'/conversations/{ids[0]}/run').json()['status'],'cancelled')
                    with client.stream('POST',base+'/messages',json={'conversation_id':ids[2],'content':'名额释放后执行'}) as response:
                        self.assertEqual(response.status_code,200);next(response.iter_lines())
                    reconnected=client.get(base+f'/runs/{runs[1]}/events?after=1')
                    self.assertIn('后台任务已完成',reconnected.text)
                    rows=client.get(base+f'/messages?conversation_id={ids[1]}').json()
                    self.assertEqual(rows[-1]['content'],'后台任务已完成')
            finally:
                server.terminate();server.wait(timeout=10)


if __name__=='__main__':unittest.main()
