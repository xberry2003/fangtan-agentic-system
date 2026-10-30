"""Image evidence and template report assembly; no external model calls."""
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class ImageReportTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'','TICHA_AI_MODEL':''});self.env.start()
        spec=importlib.util.spec_from_file_location('image_report_test',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'图片报告'}).json()['id'];self.base=f'/api/projects/{self.pid}'
        self.text=self.client.post(self.base+'/files',files={'file':('采访.md','# 采访\n\n商户反映通道占用。'.encode(),'text/markdown')}).json()
        data=io.BytesIO();Image.new('RGB',(32,32),'white').save(data,format='PNG');self.image=self.client.post(self.base+'/files',files={'file':('现场.png',data.getvalue(),'image/png')}).json()
        self.sources={};self.templates=set()
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def tool(self,name,args):return self.module.agent_tool(self.pid,name,args,'根据采访材料和照片按照市场调研模板生成报告',self.sources,self.templates,'market-research')
    def read_image(self):
        result={'id':self.image['id'],'name':self.image['name'],'description':'可见白色示意图片，不是真实现场。','hash':hashlib.sha256((Path(self.temp.name)/'files'/self.pid/self.image['id']).read_bytes()).hexdigest(),'model':'test','image_url':f'/api/projects/{self.pid}/files/{self.image["id"]}/image'}
        with patch.object(self.module.report_images,'inspect',return_value=result):self.tool('inspect_image',{'file_id':self.image['id']})
    def args(self):
        tid='market-research';self.tool('read_document',{'file_id':self.text['id']});self.tool('read_report_template',{'template_id':tid})
        content='# 市场调研报告\n\n'+'\n\n'.join('#'*(section['level']+1)+' '+section['title']+'\n\n材料未提供，待补充。' for section in self.module.report_templates.TEMPLATES_BY_ID[tid]['sections'])
        return {'name':'整合报告.md','content':content,'source_ids':[self.text['id']],'template_id':tid,'images':[{'file_id':self.image['id'],'heading':'3.2 需求特征与痛点','caption':'测试示意图，不是真实现场。'}]}
    def test_template_text_and_inspected_image_save_together(self):
        args=self.args();self.read_image();report=self.tool('create_report',args)
        saved=self.client.get(self.base+'/files/'+report['id']+'/content').json()['content']
        self.assertIn(f'/files/{self.image["id"]}/image',saved);self.assertIn('本报告材料索引',saved)
        self.assertLess(saved.index('/image)'),saved.index('第四章 竞争格局'))
        with self.module.database() as db:
            import json
            ids=json.loads(db.execute('SELECT source_ids FROM report_documents WHERE file_id=?',(report['id'],)).fetchone()[0])
            self.assertIn(self.image['id'],ids)
    def test_unread_image_and_wrong_section_are_rejected(self):
        args=self.args()
        with self.assertRaises(HTTPException):self.tool('create_report',args)
        self.read_image();args['images'][0]['heading']='不存在的章节'
        with self.assertRaises(HTTPException):self.tool('create_report',args)
    def test_vision_failure_cannot_become_image_evidence(self):
        with patch.object(self.module.report_images,'inspect',side_effect=HTTPException(502,'vision unavailable')):
            with self.assertRaises(HTTPException):self.tool('inspect_image',{'file_id':self.image['id']})
        self.assertNotIn(self.image['id'],self.sources)
    def test_artifact_link_belongs_to_its_message_only(self):
        with self.module.database() as db:
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',('first',self.pid,'assistant','第一轮',1))
            db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',('second',self.pid,'assistant','第二轮',2))
            db.execute('INSERT INTO message_artifacts VALUES(?,?)',('first',self.text['id']))
        rows=self.client.get(self.base+'/messages').json()
        self.assertEqual(rows[0]['artifacts'][0]['id'],self.text['id']);self.assertEqual(rows[1]['artifacts'],[])
        self.client.post(self.base+'/materials/delete',json={'file_ids':[self.text['id']]}).raise_for_status()
        self.assertEqual(self.client.get(self.base+'/messages').json()[0]['artifacts'],[])

if __name__=='__main__':unittest.main()
