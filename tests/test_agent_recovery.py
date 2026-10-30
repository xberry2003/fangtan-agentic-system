"""Provider failures do not turn already-saved artifacts into failed report jobs."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock,patch
from fastapi.testclient import TestClient
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))

class FakeInput:
    def write(self,value):pass
    async def drain(self):pass
class FakeOutput:
    def __init__(self,events):self.events=iter(events)
    async def readline(self):
        event=next(self.events,None)
        return (json.dumps(event)+'\n').encode() if event else b''
class FakeProcess:
    def __init__(self,events):self.stdin=FakeInput();self.stdout=FakeOutput(events);self.returncode=None
    def kill(self):self.returncode=0
    async def wait(self):return 0

class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'fake-key','TICHA_AI_MODEL':'fake-model'});self.env.start()
        spec=importlib.util.spec_from_file_location('recovery_test_app',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'失败恢复'}).json()['id'];self.base=f'/api/projects/{self.pid}'
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def run_events(self,events):
        with patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=FakeProcess(events))):
            response=self.client.post(self.base+'/messages',json={'content':'请新增一份测试文档'})
        return [json.loads(line) for line in response.text.splitlines() if line.strip()]
    def test_saved_document_remains_successful_when_final_model_reply_fails(self):
        events=self.run_events([{'tool_request':True,'name':'create_document','args':{'name':'已完成.md','content':'# 已完成\n\n内容已保存'}},{'error':'连接临时中断','error_code':'network','diagnostic':{'phase':'model'}}])
        self.assertTrue(any(event.get('done') for event in events));self.assertFalse(any(event.get('error') for event in events))
        final=next(event for event in events if event.get('final'));self.assertEqual(len(final['artifacts']),1)
        self.assertEqual(len(self.client.get(self.base+'/messages').json()[-1]['artifacts']),1)
    def test_failure_without_saved_file_has_error_code_and_no_success(self):
        events=self.run_events([{'error':'输出被截断','error_code':'output_limit','diagnostic':{'phase':'model'}}])
        error=next(event for event in events if event.get('error'))
        self.assertEqual(error['error_code'],'output_limit');self.assertIn('错误编号',error['error']);self.assertNotIn('diagnostic',error)
        self.assertFalse(any(event.get('done') for event in events))
    def test_attachment_references_reach_agent_and_survive_history(self):
        file=self.client.post(self.base+'/documents',json={'name':'材料.md','content':'真实材料正文'}).json()
        process=FakeProcess([{'complete':True,'content':'收到附件'}])
        payloads=[]
        process.stdin.write=lambda value:payloads.append(json.loads(value))
        with patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=process)):
            response=self.client.post(self.base+'/messages',json={'content':'请总结这个附件','attachment_ids':[file['id'],file['id']]})
        self.assertEqual(response.status_code,200)
        self.assertIn(file['id'],payloads[0]['messages'][-1]['content'])
        rows=self.client.get(self.base+'/messages').json()
        self.assertEqual([item['id'] for item in rows[0]['attachments']],[file['id']])
        self.assertEqual(rows[0]['content'],'请总结这个附件')
        process=FakeProcess([{'complete':True,'content':'继续整理'}]);payloads=[]
        process.stdin.write=lambda value:payloads.append(json.loads(value))
        with patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=process)):
            self.client.post(self.base+'/messages',json={'content':'继续总结刚才的文件'})
        self.assertIn(file['id'],payloads[0]['messages'][0]['content'])
    def test_attachment_scope_and_limit_are_checked_before_saving_message(self):
        other=self.client.post('/api/projects',json={'name':'另一项目'}).json()['id']
        file=self.client.post(f'/api/projects/{other}/documents',json={'name':'私有.md','content':'其他项目'}).json()
        response=self.client.post(self.base+'/messages',json={'content':'读取附件','attachment_ids':[file['id']]})
        self.assertEqual(response.status_code,404)
        self.assertEqual(self.client.get(self.base+'/messages').json(),[])
        self.assertEqual(self.client.post(self.base+'/messages',json={'content':'读取附件','attachment_ids':['x']*21}).status_code,422)

if __name__=='__main__':unittest.main()
