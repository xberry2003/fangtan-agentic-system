"""Saved document/title persistence, cache recovery and competing editor writes."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class DocumentStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'','TICHA_AI_MODEL':''});self.env.start()
        spec=importlib.util.spec_from_file_location('document_storage_test',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'文档持久化'}).json()['id'];self.base=f'/api/projects/{self.pid}'
        self.file=self.client.post(self.base+'/documents',json={'name':'记录.md','content':'# 记录\n\n已保存的正文'}).json();self.url=self.base+'/files/'+self.file['id']+'/content'
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def test_save_title_and_content_survive_switch_and_new_client(self):
        initial=self.client.get(self.url).json()
        response=self.client.put(self.url,json={'name':self.file['name'],'title':'新的采访记录','content':'# 新的采访记录\n\n访谈事实与现场记录。','expected_hash':initial['hash']})
        self.assertEqual(response.status_code,200)
        self.client.post(self.base+'/documents',json={'name':'另一份.md','content':'# 另一份'})
        with TestClient(self.module.app) as refreshed:result=refreshed.get(self.url).json()
        self.assertEqual(result['title'],'新的采访记录');self.assertIn('访谈事实',result['content']);self.assertEqual(result['name'],'新的采访记录.md')
        with self.module.database() as db:
            row=db.execute('SELECT * FROM document_contents WHERE file_id=?',(self.file['id'],)).fetchone()
            self.assertEqual(row['content'],result['content'])
    def test_database_recovers_missing_or_empty_export_cache(self):
        path=Path(self.temp.name)/'files'/self.pid/self.file['id']
        path.write_text('',encoding='utf-8')
        self.assertIn('已保存的正文',self.client.get(self.url).json()['content'])
        self.assertIn('已保存的正文',path.read_text(encoding='utf-8'))
        path.unlink()
        self.assertIn('已保存的正文',self.client.get(self.base+'/files/'+self.file['id']).text)
    def test_stale_editor_cannot_replace_newer_agent_document(self):
        initial=self.client.get(self.url).json()
        result=self.module.agent_tool(self.pid,'update_document',{'file_id':self.file['id'],'expected_hash':initial['hash'],'content':'# 记录\n\n助手保存的新内容'},'修改记录文档')
        self.assertTrue(result['saved'])
        response=self.client.put(self.url,json={'name':'记录.md','title':'记录','content':'','expected_hash':initial['hash']})
        self.assertEqual(response.status_code,409);self.assertIn('助手保存的新内容',self.client.get(self.url).json()['content'])
    def test_legacy_file_hydration_and_project_isolation(self):
        file=self.client.post(self.base+'/files',files={'file':('历史.md','# 历史\n\n旧文档内容'.encode(),'text/markdown')}).json()
        url=self.base+'/files/'+file['id']+'/content'
        self.assertIn('旧文档内容',self.client.get(url).json()['content'])
        with self.module.database() as db:self.assertIsNotNone(db.execute('SELECT 1 FROM document_contents WHERE file_id=?',(file['id'],)).fetchone())
        other=self.client.post('/api/projects',json={'name':'另一个项目'}).json()['id']
        self.assertEqual(self.client.get(f'/api/projects/{other}/files/{file["id"]}/content').status_code,404)
    def test_deletion_clears_database_document_snapshot(self):
        self.client.post(self.base+'/materials/delete',json={'file_ids':[self.file['id']]}).raise_for_status()
        with self.module.database() as db:self.assertIsNone(db.execute('SELECT 1 FROM document_contents WHERE file_id=?',(self.file['id'],)).fetchone())

if __name__=='__main__':unittest.main()
