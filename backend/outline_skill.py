"""Persistent intake workflow for the interview-outline Agent skill."""
import json
import re
import time
import uuid
from fastapi import HTTPException
from outline_taxonomy import SCENARIOS, known_industry, intake_fields, outline_questions


def initialize(db):
    columns={row[1] for row in db.execute('PRAGMA table_info(outline_workflows)')}
    if columns and 'conversation_scope' not in columns:
        db.execute('ALTER TABLE outline_workflows RENAME TO outline_workflows_legacy')
    db.executescript("""
    CREATE TABLE IF NOT EXISTS outline_workflows(project_id TEXT REFERENCES projects(id),conversation_scope TEXT NOT NULL DEFAULT '',id TEXT UNIQUE NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,revision INTEGER NOT NULL,file_id TEXT REFERENCES files(id) ON DELETE SET NULL,updated REAL NOT NULL,PRIMARY KEY(project_id,conversation_scope));
    CREATE TABLE IF NOT EXISTS document_labels(file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,document_type TEXT NOT NULL);
    """)
    if columns and 'conversation_scope' not in columns:
        db.execute("INSERT INTO outline_workflows SELECT project_id,'',id,status,snapshot,revision,file_id,updated FROM outline_workflows_legacy")
        db.execute('DROP TABLE outline_workflows_legacy')


def wants_outline(text):
    if '报告' in text and not re.search(r'(?:生成|编写|写|拟|设计|制定|准备|列出|做)[^，。！？\n]{0,60}(?:提纲|采访问题|访谈问题)',text):return False
    return bool(re.search(r'提纲|采访问题|访谈问题|访前问题',text) and re.search(r'生成|写|做|准备|拟|列|制定|设计|帮|需要|想要',text) and not re.search(r'不要生成|不用生成|取消|不需要|修改|改写|编辑|解释|分析|检查|评价|审阅|导入|删除|什么是|如何生成|怎么生成',text))


def generic_topic(text):
    # Strip polite request prefixes; they are not research topics.
    text=re.sub(r'你为我|你帮我|请你|麻烦你|为我','',text.strip())
    return bool(re.fullmatch(r'(?:你好[，,！! ]*)?(?:我)?(?:想要?|需要|要)?(?:请|麻烦)?(?:你|帮我|给我)?(?:帮我|给我)?(?:先|再)?(?:生成|做|写|准备|拟|列出)?(?:一份|一个|一些|一下)?(?:调研|访谈|采访)?(?:提纲|采访问题|访谈问题|访前问题)[。！! ]*',text.strip()))


def get(db,pid,scope=''):
    row=db.execute('SELECT * FROM outline_workflows WHERE project_id=? AND conversation_scope=?',(pid,scope)).fetchone()
    if not row:return None
    state=json.loads(row['snapshot']);state.update(id=row['id'],status=row['status'],revision=row['revision'],file_id=row['file_id'])
    taxonomy={'scenario':state['scenario'],'prompt':state['topic']+' '+state.get('request',''),'mode':'ai'}
    fields=intake_fields(taxonomy)
    industry=known_industry(taxonomy)
    if state.get('answers',{}).get('industry'):industry=state['answers']['industry'][0]
    return {**state,'fields':fields,'known_industry':industry,'scenario_name':SCENARIOS[state['scenario']]['name']}


def start(db,pid,request,topic='',scenario='market',restart=False,scope=''):
    old=get(db,pid,scope)
    if old and old['status'] in {'intake','confirmed'} and not restart:return old
    if scenario not in SCENARIOS:scenario='market'
    source=topic.strip() if topic.strip() else request.strip()
    if generic_topic(source):source=''
    industry=known_industry({'prompt':source+' '+request})
    snapshot={'topic':source[:500],'request':request[:12000],'scenario':scenario,'answers':{'industry':[industry] if industry else [],'goal':[],'audience':[]},'location':'','duration':'45','notes':''}
    flow_id=uuid.uuid4().hex
    if old:db.execute('UPDATE outline_workflows SET id=?,status=?,snapshot=?,revision=1,file_id=NULL,updated=? WHERE project_id=? AND conversation_scope=?',(flow_id,'intake',json.dumps(snapshot,ensure_ascii=False),time.time(),pid,scope))
    else:db.execute('INSERT INTO outline_workflows VALUES(?,?,?,?,?,?,?,?)',(pid,scope,flow_id,'intake',json.dumps(snapshot,ensure_ascii=False),1,None,time.time()))
    return get(db,pid,scope)


def confirm(db,pid,flow_id,revision,data,scope=''):
    state=get(db,pid,scope)
    if not state or state['id']!=flow_id or state['revision']!=revision or state['status'] not in {'intake','confirmed'}:raise HTTPException(409,'提纲流程已变化，请重新打开当前清单')
    topic=data.get('topic','').strip()
    if not 2<=len(topic)<=500 or generic_topic(topic):raise HTTPException(422,'请补充具体的研究主题或访谈对象')
    answers={}
    custom=data.get('custom',{})
    for field in SCENARIOS[state['scenario']]['fields']:
        key=field['key'];values=data.get('answers',{}).get(key,[])
        if not isinstance(values,list) or any(not isinstance(value,str) for value in values):raise HTTPException(422,'选择内容格式不正确')
        allowed=set(field['options'])
        allowed.update(state.get('answers',{}).get(key,[]))
        if key=='industry':allowed.update(known_industry({'prompt':topic+' '+state.get('request','')}) and [known_industry({'prompt':topic+' '+state.get('request','')})] or [])
        other=custom.get(key,'').strip()
        if len(other)>160:raise HTTPException(422,'其他选项请控制在160字以内')
        if other:allowed.add(other)
        chosen=list(dict.fromkeys(values))
        if other and other not in chosen:chosen.append(other)
        if not chosen or (not field['multiple'] and len(chosen)!=1) or any(value not in allowed for value in chosen):raise HTTPException(422,field['label']+'：请选择有效选项，或填写“其他”')
        answers[key]=chosen
    if data.get('duration') not in {'30','45','60','90'}:raise HTTPException(422,'请选择访谈时长')
    snapshot={key:state[key] for key in ('request','scenario')}
    snapshot.update(topic=topic,answers=answers,location=data.get('location','').strip()[:200],duration=data['duration'],notes=data.get('notes','').strip()[:3000],custom=custom)
    db.execute('UPDATE outline_workflows SET status=?,snapshot=?,revision=revision+1,updated=? WHERE project_id=? AND conversation_scope=?',('confirmed',json.dumps(snapshot,ensure_ascii=False),time.time(),pid,scope))
    return get(db,pid,scope)


def assert_generation(db,pid,flow_id,revision,scope=''):
    state=get(db,pid,scope)
    duplicate=state and state['status']=='completed' and state['file_id'] and state['revision']==(revision or 0)+1
    if not state or state['id']!=flow_id or (state['revision']!=revision and not duplicate) or state['status'] not in {'confirmed','completed'}:raise HTTPException(409,'请先确认本次研究范围，或重新加载流程')
    return state
