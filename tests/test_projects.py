"""Isolated contract tests: no real files, secrets or model requests."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1] / "backend"))
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


class ProjectsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'TICHA_DATA_DIR': self.temp.name, 'TICHA_AI_KEY': '', 'TICHA_AI_MODEL': ''})
        self.env.start()
        spec = importlib.util.spec_from_file_location('studio_test', ROOT / 'backend/app.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.client = TestClient(self.module.app)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        self.temp.cleanup()

    def create(self, name='项目甲'):
        result = self.client.post('/api/projects', json={'name': name})
        self.assertEqual(result.status_code, 201)
        return result.json()['id']

    def test_name_only_creation_and_persistence(self):
        pid = self.create('  凌西物流园  ')
        self.assertEqual(self.client.get('/api/projects/' + pid).json()['name'], '凌西物流园')
        self.assertEqual(self.client.get('/api/projects').json()[0]['id'], pid)
        with self.module.database() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM messages').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM files').fetchone()[0], 0)

    def test_invalid_names(self):
        for name in ['', '   ', 'a' * 81]:
            self.assertEqual(self.client.post('/api/projects', json={'name': name}).status_code, 422)

    def test_missing_project(self):
        self.assertEqual(self.client.get('/api/projects/missing').status_code, 404)
        self.assertEqual(self.client.get('/api/projects/missing/files').status_code, 404)

    def test_files_scoped_and_downloadable(self):
        a, b = self.create(), self.create('项目乙')
        file = self.client.post(f'/api/projects/{a}/files', files={'file': ('../../录音.webm', b'audio', 'audio/webm')}).json()
        self.assertEqual(file['name'], '录音.webm')
        self.assertEqual(len(self.client.get(f'/api/projects/{a}/files').json()), 1)
        self.assertEqual(self.client.get(f'/api/projects/{b}/files').json(), [])
        self.assertEqual(self.client.get(f'/api/projects/{b}/files/{file["id"]}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/projects/{a}/files/{file["id"]}').content, b'audio')

    def test_empty_file_does_not_leave_metadata(self):
        pid = self.create()
        self.assertEqual(self.client.post(f'/api/projects/{pid}/files', files={'file': ('empty.txt', b'')}).status_code, 422)
        self.assertEqual(self.client.get(f'/api/projects/{pid}/files').json(), [])

    def test_unconfigured_ai_is_explicit_and_does_not_fake_reply(self):
        pid = self.create()
        self.assertEqual(self.client.post(f'/api/projects/{pid}/messages', json={'content': '你好'}).status_code, 503)
        self.assertEqual(self.client.get(f'/api/projects/{pid}/messages').json(), [])

    def test_streamed_reply_saved_only_in_current_project(self):
        a, b = self.create(), self.create('乙')
        from unittest.mock import AsyncMock
        from test_agent_recovery import FakeProcess
        payloads=[]
        process=FakeProcess([{'text':'你好'},{'complete':True,'content':'你好'}])
        process.stdin.write=lambda value:payloads.append(json.loads(value))
        with patch.dict(os.environ, {'TICHA_AI_KEY':'test-key','TICHA_AI_MODEL':'test-model'}), patch.object(self.module.asyncio,'create_subprocess_exec',new=AsyncMock(return_value=process)):
            response=self.client.post(f'/api/projects/{a}/messages',json={'content':'问一问'})
        events=[json.loads(line) for line in response.text.splitlines()]
        self.assertEqual(payloads[0]['messages'][-1]['content'],'问一问')
        self.assertEqual(events[0]['text'],'你好')
        self.assertEqual(next(event['final'] for event in events if 'final' in event),'你好')
        self.assertTrue(events[-1]['done'])
        self.assertEqual(self.client.get(f'/api/projects/{a}/messages').json()[-1]['content'], '你好')
        self.assertEqual(self.client.get(f'/api/projects/{b}/messages').json(), [])

    def test_old_entry_is_not_exposed(self):
        self.assertEqual(self.client.get('/records').status_code, 404)
        self.assertEqual(self.client.get('/ops').status_code, 404)


if __name__ == '__main__':
    unittest.main()
