"""The two skills have independent intake, confirmation and write authority."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock,patch
from test_agent_recovery import FakeProcess
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))


class ReportSkillTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.env=patch.dict(os.environ,{'TICHA_DATA_DIR':self.temp.name,'TICHA_AI_KEY':'fake-key','TICHA_AI_MODEL':'fake-model'});self.env.start()
        spec=importlib.util.spec_from_file_location('report_skill_test_app',ROOT/'backend/app.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        from fastapi.testclient import TestClient
        self.client=TestClient(self.module.app);self.pid=self.client.post('/api/projects',json={'name':'技能测试'}).json()['id'];self.base=f'/api/projects/{self.pid}'
        self.file=self.client.post(self.base+'/documents',json={'name':'采访.md','content':'商户说装卸通道被占用，需要优化车辆调度。'}).json()
    def tearDown(self):self.client.close();self.env.stop();self.temp.cleanup()
    def start(self,skill='report-generation'):
        with patch.object(self.module.asyncio,'create_subprocess_exec',side_effect=AssertionError('No model before confirmation')):
            response=self.client.post(self.base+'/messages',json={'skill':skill,'content':'准备处理本项目','attachment_ids':[self.file['id']]})
        self.assertEqual(response.status_code,200)
        events=[json.loads(line) for line in response.text.splitlines()]
        self.assertFalse(any(event.get('error') for event in events))
        return events[-1]
    def test_report_intake_is_persistent_and_skill_tag_survives_reload(self):
        state=self.start()['report_workflow']
        self.assertEqual(state['attachment_ids'],[self.file['id']])
        self.assertEqual(self.client.get(self.base+'/report-workflow').json()['id'],state['id'])
        self.assertEqual(self.client.get(self.base+'/messages').json()[0]['skill'],'report-generation')
    def test_switching_skill_cancels_previous_confirmation_and_rejects_stale(self):
        report=self.start()['report_workflow']
        outline=self.start('interview-outline')['outline_workflow']
        self.assertEqual(self.client.get(self.base+'/report-workflow').json()['status'],'cancelled')
        result=self.client.post(self.base+'/messages',json={'content':'生成报告','report_flow_id':report['id'],'report_revision':report['revision'],'report_template':'none'})
        self.assertEqual(result.status_code,409)
        self.start()
        self.assertEqual(self.client.get(self.base+'/outline-workflow').json()['status'],'cancelled')
    def test_confirmed_report_has_only_report_tools_and_saves_editable_artifact(self):
        flow=self.start()['report_workflow']
        events=[{'tool_request':True,'name':'create_document','args':{'name':'绕过.md','content':'不允许'}},
                {'tool_request':True,'name':'read_document','args':{'file_id':self.file['id']}},
                {'tool_request':True,'name':'create_report','args':{'name':'访谈整合报告.md','content':'# 访谈整合报告\n\n商户反映装卸通道占用。建议进一步核对具体时段与车辆调度安排。','source_ids':[self.file['id']],'template_id':'none'}},
                {'complete':True,'content':'报告已保存。'}]
        process=FakeProcess(events);payloads=[];process.stdin.write=lambda raw:payloads.append(json.loads(raw))
        with patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=process)):
            response=self.client.post(self.base+'/messages',json={'skill':'report-generation','content':'确认生成报告','report_flow_id':flow['id'],'report_revision':flow['revision'],'report_template':'none','attachment_ids':[self.file['id']]})
        self.assertEqual(response.status_code,200)
        result=[json.loads(line) for line in response.text.splitlines()]
        self.assertFalse(any(event.get('error') for event in result))
        self.assertTrue(any(event.get('tool')=='create_document' and event.get('status')=='failed' for event in result))
        self.assertEqual(payloads[0]['task'],'report-generate')
        self.assertIn('# 报告生成',payloads[0]['system'])
        self.assertNotIn('# 访谈提纲准备技能',payloads[0]['system'])
        files=self.client.get(self.base+'/files').json();self.assertFalse(any(f['name']=='绕过.md' for f in files))
        report=next(f for f in files if f['name']=='访谈整合报告.md');self.assertEqual(report['kind'],'report')
        self.assertEqual(self.client.get(self.base+'/report-workflow').json()['status'],'completed')
    def test_conflicting_skills_and_foreign_flow_rejected(self):
        flow=self.start()['report_workflow'];other=self.client.post('/api/projects',json={'name':'另一项目'}).json()['id']
        self.assertEqual(self.client.post(f'/api/projects/{other}/messages',json={'content':'生成报告','report_flow_id':flow['id'],'report_revision':1,'report_template':'none'}).status_code,409)
        self.assertEqual(self.client.post(self.base+'/messages',json={'content':'生成提纲','skill':'interview-outline','report_flow_id':flow['id'],'report_revision':1,'report_template':'none'}).status_code,422)


if __name__=='__main__':unittest.main()
