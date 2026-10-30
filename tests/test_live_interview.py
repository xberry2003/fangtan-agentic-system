"""Outline selection, recorded progress and duplex ASR protocol contracts."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class Provider:
    def __init__(self):self.queue=asyncio.Queue();self.sent=[]
    async def __aenter__(self):return self
    async def __aexit__(self,*args):pass
    async def send(self,value):
        self.sent.append(value)
        if isinstance(value,bytes):
            await self.queue.put(json.dumps({'header':{'event':'result-generated'},'payload':{'output':{'sentence':{'text':'最近一次进货遇到了什么问题？','sentence_end':True,'begin_time':0}}}}))
        else:
            action=json.loads(value)['header']['action']
            await self.queue.put(json.dumps({'header':{'event':'task-started' if action=='run-task' else 'task-finished'}}))
    async def recv(self):return await self.queue.get()
    def __aiter__(self):return self
    async def __anext__(self):return await self.recv()


class LiveInterviewTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'DASHSCOPE_API_KEY':'fake-asr-key','TICHA_AI_KEY':'fake-key','TICHA_AI_MODEL':'fake-model'})
        self.env.start()
        spec=importlib.util.spec_from_file_location('live_test_app',ROOT/'backend/app.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app)
        self.pid=self.client.post('/api/projects',json={'name':'录音测试'}).json()['id']
        self.base=f'/api/projects/{self.pid}'
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def test_extract_actual_interview_questions_not_intro_or_code(self):
        text='# 访谈提纲\n## 核心研究问题\n1. 市场如何变化？\n## 核心问题与追问\n1. **最近一次进货遇到了什么问题？**\n   - 当时如何处理？\n```\n代码是什么？\n```\n## 结束提醒\n请完成授权。'
        result=self.client.post(self.base+'/outline-questions',json={'content':text})
        self.assertEqual(result.json()['questions'],['最近一次进货遇到了什么问题？','当时如何处理？'])
    def test_selected_questions_and_progress_survive_reload(self):
        file=self.client.post(self.base+'/files',files={'file':('录音.webm',b'audio','audio/webm')}).json()
        questions=[{'text':'最近一次进货遇到什么问题？','asked':True,'source':'auto'},{'text':'当时如何处理？','asked':False,'source':'manual'}]
        result=self.client.post(self.base+'/interviews',json={'title':'商户访谈','audio_id':file['id'],'outline':'选定的问题','questions':questions})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.get(self.base+'/interviews').json()[0]['questions'],questions)
    def test_realtime_relay_waits_ready_streams_pcm_and_final_text(self):
        provider=Provider()
        with patch.object(self.module.live_interview,'connect',return_value=provider):
            with self.client.websocket_connect(self.base+'/live-transcription') as socket:
                socket.send_json({'sample_rate':16000,'consent':True})
                self.assertTrue(socket.receive_json()['ready'])
                socket.send_bytes(b'\0'*3200)
                self.assertTrue(socket.receive_json()['final'])
                socket.send_json({'finish':True})
                self.assertTrue(socket.receive_json()['done'])
        self.assertIn(b'\0'*3200,provider.sent)
        self.assertEqual(json.loads(provider.sent[0])['payload']['parameters']['format'],'pcm')
    def test_unconfigured_and_cross_origin_fail_without_affecting_audio_files(self):
        with patch.dict(os.environ,{'DASHSCOPE_API_KEY':''}):
            with self.client.websocket_connect(self.base+'/live-transcription') as socket:
                socket.send_json({'sample_rate':16000,'consent':True})
                self.assertIn('录音仍可正常保存',socket.receive_json()['error'])
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect(self.base+'/live-transcription',headers={'origin':'https://unrelated.example'}):pass
    def test_question_matching_filters_invalid_model_indices(self):
        response=Mock();response.raise_for_status=Mock();response.json.return_value={'choices':[{'message':{'content':'{"asked":[0,999,-1,true,0]}'}}]}
        client=AsyncMock();client.post.return_value=response
        context=AsyncMock();context.__aenter__.return_value=client
        with patch.object(self.module.httpx,'AsyncClient',return_value=context):
            result=self.client.post(self.base+'/question-progress',json={'text':'请问最近一次进货遇到了什么问题？','questions':['最近一次进货遇到什么问题？']})
        self.assertEqual(result.json()['asked'],[0])
        self.assertEqual(self.client.post(self.base+'/question-progress',json={'text':'商户说今天很忙。','questions':['怎么进货？']}).json()['asked'],[])


if __name__=='__main__':unittest.main()
