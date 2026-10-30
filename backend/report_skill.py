"""Independent, revisioned report-template intake. No outline state is reused."""
import json
import re
import time
import uuid
from fastapi import HTTPException


def initialize(db):
    columns={row[1] for row in db.execute('PRAGMA table_info(report_workflows)')}
    if columns and 'conversation_scope' not in columns:db.execute('ALTER TABLE report_workflows RENAME TO report_workflows_legacy')
    db.execute("CREATE TABLE IF NOT EXISTS report_workflows(project_id TEXT REFERENCES projects(id),conversation_scope TEXT NOT NULL DEFAULT '',id TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,updated REAL NOT NULL,PRIMARY KEY(project_id,conversation_scope))")
    if columns and 'conversation_scope' not in columns:
        db.execute("INSERT INTO report_workflows SELECT project_id,'',id,status,snapshot,revision,updated FROM report_workflows_legacy")
        db.execute('DROP TABLE report_workflows_legacy')


def wants_report(text):
    return bool('报告' in text and re.search('生成|整合|汇总|编写|制作|出|做|写|弄',text) and not re.search('不要生成|取消|不用生成|如何生成|怎么生成|怎么做|如何做',text))


def get(db,pid,scope=''):
    row=db.execute('SELECT * FROM report_workflows WHERE project_id=? AND conversation_scope=?',(pid,scope)).fetchone()
    return {**json.loads(row['snapshot']),'id':row['id'],'status':row['status'],'revision':row['revision']} if row else None


def start(db,pid,request,attachment_ids,scope=''):
    state={'request':request,'attachment_ids':attachment_ids,'template_id':'','file_id':None}
    flow=uuid.uuid4().hex
    db.execute('INSERT INTO report_workflows VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,conversation_scope) DO UPDATE SET id=excluded.id,status=excluded.status,snapshot=excluded.snapshot,revision=excluded.revision,updated=excluded.updated',(pid,scope,flow,'intake',json.dumps(state,ensure_ascii=False),1,time.time()))
    return get(db,pid,scope)


def confirm(db,pid,flow,revision,template,templates,scope=''):
    state=get(db,pid,scope)
    if not state or state['id']!=flow or state['revision']!=revision or state['status'] not in ('intake','confirmed'):
        raise HTTPException(409,'报告生成流程已变化，请重新选择模板')
    if template!='none' and template not in templates:raise HTTPException(422,'请选择本次报告模板，或明确不套模板')
    state['template_id']=template
    db.execute('UPDATE report_workflows SET status=?,snapshot=?,updated=? WHERE project_id=? AND conversation_scope=?',('confirmed',json.dumps(state,ensure_ascii=False),time.time(),pid,scope))
    return get(db,pid,scope)


def cancel(db,pid,scope=''):
    db.execute("UPDATE report_workflows SET status='cancelled',revision=revision+1 WHERE project_id=? AND conversation_scope=? AND status IN ('intake','confirmed')",(pid,scope))


def complete(db,pid,flow,file_id,scope=''):
    state=get(db,pid,scope)
    if not state or state['id']!=flow:return
    state['file_id']=file_id
    db.execute('UPDATE report_workflows SET status=?,snapshot=?,revision=revision+1,updated=? WHERE project_id=? AND conversation_scope=?',('completed',json.dumps(state,ensure_ascii=False),time.time(),pid,scope))
