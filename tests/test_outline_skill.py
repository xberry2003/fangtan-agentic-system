"""Outline skill flow, selection validation, archival and retry contracts."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class OutlineTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'','TICHA_AI_MODEL':''});self.env.start()
        spec=importlib.util.spec_from_file_location('outline_test_app',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'提纲项目'}).json()['id'];self.base=f'/api/projects/{self.pid}'
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def start(self,text='我想要生成一份上海新能源汽车市场调研提纲'):
        with self.module.database() as db:return self.module.outline_skill.start(db,self.pid,text)
    def confirm(self,state):
        response=self.client.post(self.base+'/outline-workflow/confirm',json={'flow_id':state['id'],'revision':state['revision'],'topic':'上海新能源汽车消费者购车过程','answers':{'industry':['新能源汽车'],'goal':['识别用户痛点'],'audience':['消费者']},'duration':'45','custom':{'goal':'比较补能体验'},'notes':'聚焦最近一次购车经历'})
        self.assertEqual(response.status_code,200);return response.json()
    def test_intent_routing_and_known_industry(self):
        skill=self.module.outline_skill
        self.assertTrue(skill.wants_outline('我想要生成一份调研提纲'))
        self.assertFalse(skill.wants_outline('修改现有的访谈提纲'))
        self.assertFalse(skill.wants_outline('根据这份访谈提纲生成报告'))
        self.assertFalse(skill.wants_outline('请帮我分析现有提纲'))
        self.assertFalse(skill.wants_outline('不要生成调研提纲'))
        self.assertTrue(skill.generic_topic('我想要生成一份调研提纲'))
        self.assertTrue(skill.wants_outline('我想要你为我生成一份调研提纲'))
        self.assertTrue(skill.generic_topic('我想要你为我生成一份调研提纲'))
        state=self.start();self.assertEqual(state['known_industry'],'新能源汽车')
        industry=next(field for field in state['fields'] if field['key']=='industry')
        self.assertIn('新能源汽车',industry['options'])
        self.assertEqual(self.client.get(self.base+'/outline-workflow').json()['id'],state['id'])
    def test_unconfirmed_request_returns_only_intake_without_model_or_files(self):
        with patch.dict(os.environ,{'TICHA_AI_KEY':'fake-key','TICHA_AI_MODEL':'fake-model'}):
            with patch.object(self.module.asyncio,'create_subprocess_exec',side_effect=AssertionError('Intake must not invoke the model')):
                response=self.client.post(self.base+'/messages',json={'content':'我想要你为我生成一份调研提纲'})
        self.assertEqual(response.status_code,200)
        events=[json.loads(line) for line in response.text.splitlines() if line.strip()]
        self.assertFalse(any(event.get('error') for event in events))
        self.assertTrue(events[-1]['done'])
        self.assertEqual(events[-1]['outline_workflow']['status'],'intake')
        self.assertEqual(events[-1]['outline_workflow']['topic'],'')
        self.assertNotIn('##', ''.join(event.get('text','') for event in events))
        self.assertEqual(self.client.get(self.base+'/files').json(),[])
        for tool in ('create_document','create_report','update_document'):
            with self.assertRaises(HTTPException):
                self.module.agent_tool(self.pid,tool,{},'我想要你为我生成一份调研提纲')
    def test_confirmation_keeps_custom_answers_and_rejects_stale(self):
        state=self.start();confirmed=self.confirm(state)
        self.assertEqual(confirmed['status'],'confirmed');self.assertIn('比较补能体验',confirmed['answers']['goal'])
        self.assertEqual(confirmed['notes'],'聚焦最近一次购车经历')
        response=self.client.post(self.base+'/outline-workflow/confirm',json={'flow_id':state['id'],'revision':state['revision'],'topic':'重复确认','answers':{},'duration':'45'})
        self.assertEqual(response.status_code,409)
    def test_save_requires_confirmation_archives_one_editable_file_and_retry_is_idempotent(self):
        state=self.start()
        content='# 上海新能源汽车访谈提纲\n\n## 访谈目标与范围\n了解消费者最近一次购车过程，聚焦真实经历、选择依据、实际影响和替代方案。提纲并不是访谈结论。\n\n## 受访对象与时长\n新能源汽车消费者，约45分钟。\n\n## 开场与授权\n请先确认录音授权，自愿回答，允许跳过不愿分享的内容。\n\n## 核心问题\n1. 请回忆最近一次购车，是什么触发了这次决定？\n   - 当时有哪些选择？\n2. 最终选择前，你具体比较了哪些车辆？\n   - 哪个因素改变了决定？\n3. 最近一次使用充电设施时，发生了什么？\n   - 你当时如何处理？\n\n## 收尾\n还有哪些重要经历没有谈到？\n'
        args={'flow_id':state['id'],'revision':state['revision'],'name':'访谈提纲.md','content':content}
        with self.assertRaises(HTTPException):self.module.agent_tool(self.pid,'save_interview_outline',args,'生成访谈提纲')
        confirmed=self.confirm(state);args['revision']=confirmed['revision'];authorization={'id':confirmed['id'],'revision':confirmed['revision']}
        first=self.module.agent_tool(self.pid,'save_interview_outline',args,'生成访谈提纲',outline_authorization=authorization)
        second=self.module.agent_tool(self.pid,'save_interview_outline',args,'生成访谈提纲',outline_authorization=authorization)
        self.assertEqual(first['id'],second['id'])
        files=self.client.get(self.base+'/files').json();self.assertEqual(len(files),1)
        self.assertEqual(files[0]['kind'],'report');self.assertEqual(files[0]['document_type'],'outline')
        folders=self.client.get(self.base+'/folders').json();self.assertEqual(next(folder['name'] for folder in folders if folder['id']==files[0]['folder_id']),'访前准备')
        self.assertEqual(self.client.get(self.base+'/files/'+first['id']+'/content').json()['content'],content)
        self.assertEqual(self.client.get(self.base+'/outline-workflow').json()['status'],'completed')
    def test_cancelled_or_other_project_flow_cannot_save(self):
        state=self.start();confirmed=self.confirm(state)
        self.client.post(self.base+'/outline-workflow/cancel').raise_for_status()
        with self.module.database() as db:
            with self.assertRaises(HTTPException):self.module.outline_skill.assert_generation(db,self.pid,confirmed['id'],confirmed['revision'])
        other=self.client.post('/api/projects',json={'name':'其他项目'}).json()['id']
        self.assertEqual(self.client.post(f'/api/projects/{other}/outline-workflow/confirm',json={'flow_id':confirmed['id'],'revision':confirmed['revision'],'topic':'错误归属','answers':{},'duration':'45'}).status_code,409)

if __name__=='__main__':unittest.main()
