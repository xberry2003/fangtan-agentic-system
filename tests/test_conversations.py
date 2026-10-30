"""Conversation scoping, durable subscriptions, stop and two-run capacity."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import sqlite3
import unittest
from unittest.mock import patch,AsyncMock
from fastapi import HTTPException
from fastapi.testclient import TestClient
from test_agent_recovery import FakeProcess
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class Fixture:
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'fake-key','TICHA_AI_MODEL':'fake-model'});self.env.start()
        spec=importlib.util.spec_from_file_location('conversation_test_app',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'多对话'}).json()['id'];self.base=f'/api/projects/{self.pid}'
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def new(self):return self.client.post(self.base+'/conversations',json={'title':'独立任务'}).json()['id']


class ConversationTest(Fixture,unittest.TestCase):
    def test_legacy_messages_and_workflows_migrate_without_losing_ids(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
        try:
            db.executescript('''CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES('legacy');
            CREATE TABLE files(id TEXT PRIMARY KEY);CREATE TABLE messages(id TEXT PRIMARY KEY,project_id TEXT,role TEXT,content TEXT,created REAL);
            INSERT INTO messages VALUES('old-message','legacy','user','原有内容',1);
            CREATE TABLE outline_workflows(project_id TEXT PRIMARY KEY,id TEXT,status TEXT,snapshot TEXT,revision INTEGER,file_id TEXT,updated REAL);
            CREATE TABLE report_workflows(project_id TEXT PRIMARY KEY,id TEXT,status TEXT,snapshot TEXT,revision INTEGER,updated REAL);
            ''')
            db.execute('INSERT INTO outline_workflows VALUES(?,?,?,?,?,?,?)',('legacy','old-outline','intake',json.dumps({'scenario':'market','topic':'原主题','request':'访谈'}),1,None,1))
            db.execute('INSERT INTO report_workflows VALUES(?,?,?,?,?,?)',('legacy','old-report','intake',json.dumps({'request':'原报告需求'}),1,1))
            self.module.outline_skill.initialize(db);self.module.report_skill.initialize(db);self.module.conversations.initialize(db)
            self.assertEqual(self.module.outline_skill.get(db,'legacy')['id'],'old-outline')
            self.assertEqual(self.module.report_skill.get(db,'legacy')['id'],'old-report')
            self.assertEqual(db.execute('SELECT message_id FROM conversation_messages').fetchone()[0],'old-message')
            self.assertIsNone(self.module.outline_skill.get(db,'legacy','another-chat'))
            self.module.outline_skill.initialize(db);self.module.report_skill.initialize(db)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0],1)
        finally:db.close()
    def test_histories_and_skill_workflows_are_scoped(self):
        a,b=self.new(),self.new()
        with patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=FakeProcess([{'text':'只在甲回答'},{'complete':True,'content':'只在甲回答'}]))):
            self.client.post(self.base+'/messages',json={'conversation_id':a,'content':'你好'})
        self.assertEqual(len(self.client.get(self.base+f'/messages?conversation_id={a}').json()),2)
        self.assertEqual(self.client.get(self.base+f'/messages?conversation_id={b}').json(),[])
        self.client.post(self.base+'/messages',json={'conversation_id':a,'skill':'interview-outline','content':'生成访谈提纲'})
        self.client.post(self.base+'/messages',json={'conversation_id':b,'skill':'report-generation','content':'生成报告'})
        self.assertEqual(self.client.get(self.base+f'/outline-workflow?conversation_id={a}').json()['status'],'intake')
        self.assertIsNone(self.client.get(self.base+f'/report-workflow?conversation_id={a}').json())
        self.assertIsNone(self.client.get(self.base+f'/outline-workflow?conversation_id={b}').json())
        self.assertEqual(self.client.get(self.base+f'/report-workflow?conversation_id={b}').json()['status'],'intake')
    def test_foreign_conversation_and_run_are_rejected(self):
        cid=self.new();other=self.client.post('/api/projects',json={'name':'另一个项目'}).json()['id']
        self.assertEqual(self.client.get(f'/api/projects/{other}/messages?conversation_id={cid}').status_code,404)
        self.assertEqual(self.client.post(f'/api/projects/{other}/messages',json={'conversation_id':cid,'content':'越权'}).status_code,404)
        self.assertEqual(self.client.post(self.base+'/runs/missing/stop').status_code,404)


class RunTest(Fixture,unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_and_reconnect_do_not_cancel_worker(self):
        cid=self.new();release=asyncio.Event()
        with self.module.database() as db:rid=self.module.conversations.reserve(db,self.pid,cid)
        async def source():
            yield json.dumps({'text':'第一段'})
            await release.wait()
            yield json.dumps({'text':'第二段'})
            yield json.dumps({'done':True})
        self.module.runs.launch(rid,source())
        subscriber=self.module.runs.stream(rid)
        first=json.loads(await anext(subscriber));await subscriber.aclose()
        self.assertFalse(self.module.runs.tasks[rid].done())
        release.set();await self.module.runs.tasks[rid]
        resumed=[json.loads(line) async for line in self.module.runs.stream(rid,first['seq'])]
        self.assertEqual(resumed[0]['text'],'第二段');self.assertTrue(resumed[-1]['done'])
        with self.module.database() as db:self.assertEqual(db.execute('SELECT status FROM chat_runs WHERE id=?',(rid,)).fetchone()[0],'completed')
    async def test_two_run_limit_and_manual_stop_release_capacity(self):
        ids=[self.new() for _ in range(3)];release=asyncio.Event()
        async def source():
            yield json.dumps({'text':'已开始'})
            await release.wait()
            yield json.dumps({'done':True})
        runs=[]
        for cid in ids[:2]:
            with self.module.database() as db:
                db.execute('BEGIN IMMEDIATE');rid=self.module.conversations.reserve(db,self.pid,cid)
            self.module.runs.launch(rid,source());runs.append(rid)
        await asyncio.sleep(.02)
        with self.module.database() as db:
            with self.assertRaises(HTTPException) as error:self.module.conversations.reserve(db,self.pid,ids[2])
            self.assertEqual(error.exception.status_code,429)
            with self.assertRaises(HTTPException) as error:self.module.conversations.reserve(db,self.pid,ids[0])
            self.assertEqual(error.exception.status_code,409)
            self.module.runs.stop(db,runs[0])
        task=self.module.runs.tasks.get(runs[0])
        if task:await task
        with self.module.database() as db:
            self.assertEqual(db.execute('SELECT status FROM chat_runs WHERE id=?',(runs[0],)).fetchone()[0],'cancelled')
            saved=db.execute('SELECT content FROM messages JOIN conversation_messages ON message_id=messages.id WHERE conversation_id=?',(ids[0],)).fetchone()[0]
            self.assertIn('已开始',saved)
            third=self.module.conversations.reserve(db,self.pid,ids[2])
            db.execute("UPDATE chat_runs SET status='cancelled' WHERE id=?",(third,))
        release.set();await self.module.runs.tasks[runs[1]]
    async def test_stop_before_first_worker_step_does_not_leak_slot(self):
        cid=self.new()
        with self.module.database() as db:rid=self.module.conversations.reserve(db,self.pid,cid)
        async def source():
            await asyncio.sleep(30)
            yield json.dumps({'done':True})
        self.module.runs.launch(rid,source());task=self.module.runs.tasks[rid]
        with self.module.database() as db:self.module.runs.stop(db,rid)
        try:await task
        except asyncio.CancelledError:pass
        await asyncio.sleep(0)
        with self.module.database() as db:self.assertEqual(db.execute('SELECT status FROM chat_runs WHERE id=?',(rid,)).fetchone()[0],'cancelled')


if __name__=='__main__':unittest.main()
