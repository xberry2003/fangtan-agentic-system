"""Project material folders, deletion and migration contracts; no browser/API model."""
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class MaterialsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'','TICHA_AI_MODEL':''});self.env.start()
        spec=importlib.util.spec_from_file_location('material_test_app',ROOT/'backend/app.py')
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app)
        self.pid=self.client.post('/api/projects',json={'name':'材料项目'}).json()['id']
        self.base=f'/api/projects/{self.pid}'

    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def folder(self,name,parent=None):
        response=self.client.post(self.base+'/folders',json={'name':name,'parent_id':parent});self.assertEqual(response.status_code,201);return response.json()
    def upload(self,name='记录.txt',folder=None,mime='text/plain'):
        response=self.client.post(self.base+'/files',data={'folder_id':folder} if folder else {},files={'file':(name,b'evidence',mime)});self.assertEqual(response.status_code,201);return response.json()

    def test_persistent_folder_tree_and_automatic_archive(self):
        file=self.upload();folders=self.client.get(self.base+'/folders').json()
        self.assertEqual(next(folder for folder in folders if folder['id']==file['folder_id'])['name'],'文字资料')
        root=self.folder('实地资料');child=self.folder('第一天',root['id'])
        self.client.post(self.base+'/materials/move',json={'file_ids':[file['id']],'target_id':child['id']}).raise_for_status()
        self.assertEqual(self.client.get(self.base+'/files').json()[0]['folder_id'],child['id'])
        with self.module.database() as db:
            stored=self.module.MaterialRepository(db,self.pid).file(file['id'])
            self.assertEqual(stored['folder_id'],child['id'])
        duplicate=self.client.post(self.base+'/folders',json={'name':'第一天','parent_id':root['id']})
        self.assertEqual(duplicate.status_code,409)

    def test_no_cross_project_move_upload_or_deletion(self):
        own=self.upload();other=self.client.post('/api/projects',json={'name':'隔离项目'}).json()['id']
        foreign_folder=self.client.get(f'/api/projects/{other}/folders').json()[0]['id']
        self.assertEqual(self.client.post(self.base+'/materials/move',json={'file_ids':[own['id']],'target_id':foreign_folder}).status_code,404)
        self.assertEqual(self.client.post(f'/api/projects/{other}/materials/delete',json={'file_ids':[own['id']]}).status_code,404)
        self.assertEqual(self.client.post(self.base+'/files',data={'folder_id':foreign_folder},files={'file':('x.txt',b'x')}).status_code,404)
        self.assertEqual(self.client.get(self.base+'/files/'+own['id']).status_code,200)

    def test_cycles_rejected_and_nested_folder_deletion_removes_bytes(self):
        root=self.folder('待删资料');child=self.folder('子目录',root['id']);file=self.upload(folder=child['id'])
        cycle=self.client.post(self.base+'/materials/move',json={'folder_ids':[root['id']],'target_id':child['id']})
        self.assertEqual(cycle.status_code,422)
        preview=self.client.post(self.base+'/materials/delete-preview',json={'folder_ids':[root['id']]}).json()
        self.assertEqual(preview,{'file_count':1,'folder_count':2})
        deleted=self.client.post(self.base+'/materials/delete',json={'folder_ids':[root['id']]}).json()
        self.assertEqual(deleted['deleted_file_ids'],[file['id']])
        self.assertEqual(self.client.get(self.base+'/files/'+file['id']).status_code,404)
        self.assertFalse((Path(self.temp.name)/'files'/self.pid/file['id']).exists())
        self.assertFalse(any(folder['id']==root['id'] for folder in self.client.get(self.base+'/folders').json()))

    def test_failed_database_delete_restores_files(self):
        file=self.upload()
        with patch.object(self.module.MaterialRepository,'delete_records',side_effect=RuntimeError('rollback')):
            with self.assertRaises(RuntimeError):self.client.post(self.base+'/materials/delete',json={'file_ids':[file['id']]})
        self.assertEqual(self.client.get(self.base+'/files/'+file['id']).content,b'evidence')

    def test_delete_recording_detaches_interview_and_keeps_other_materials(self):
        audio=self.upload('访谈.webm',mime='audio/webm');report=self.client.post(self.base+'/documents',json={'name':'报告.md','content':'# 报告'}).json()
        self.client.post(self.base+'/interviews',json={'title':'商户访谈','audio_id':audio['id']}).raise_for_status()
        self.client.post(self.base+'/materials/delete',json={'file_ids':[audio['id']]}).raise_for_status()
        self.assertEqual(self.client.get(self.base+'/interviews').json(),[])
        self.assertEqual(self.client.get(self.base+'/files/'+report['id']).status_code,200)

    def test_folder_zip_preserves_structure_and_file_names(self):
        folder=self.folder('访谈原始资料');file=self.upload('逐字稿.txt',folder['id'])
        response=self.client.post(self.base+'/materials/download',json={'folder_ids':[folder['id']]})
        self.assertEqual(response.status_code,200)
        with ZipFile(io.BytesIO(response.content)) as archive:self.assertEqual(archive.read('访谈原始资料/逐字稿.txt'),b'evidence')
        self.assertEqual(self.client.post(self.base+'/materials/rename',json={'kind':'file','item_id':file['id'],'name':'错误.pdf'}).status_code,422)

if __name__=='__main__':unittest.main()
