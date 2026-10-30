"""Project conversations and durable, reconnectable generation runs."""
import asyncio
import json
import time
import uuid
from fastapi import HTTPException


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,created REAL NOT NULL,updated REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_messages(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id));
    CREATE TABLE IF NOT EXISTS chat_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id),status TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_run_events(run_id TEXT NOT NULL REFERENCES chat_runs(id),seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,seq));
    CREATE INDEX IF NOT EXISTS chat_run_status ON chat_runs(status,conversation_id);
    CREATE INDEX IF NOT EXISTS conversation_message_scope ON conversation_messages(conversation_id);
    ''')
    for row in db.execute('SELECT id FROM projects').fetchall():
        chat=resolve(db,row['id'])
        db.execute('INSERT OR IGNORE INTO conversation_messages SELECT id,? FROM messages WHERE project_id=? AND id NOT IN (SELECT message_id FROM conversation_messages)',(chat['id'],row['id']))
    # Browser navigation never changes a run status. A process restart is different.
    db.execute("UPDATE chat_runs SET status='interrupted',updated=? WHERE status IN ('running','stopping')",(time.time(),))


def resolve(db,pid,cid=None):
    if cid:
        row=db.execute('SELECT * FROM conversations WHERE id=? AND project_id=?',(cid,pid)).fetchone()
        if not row:raise HTTPException(404,'当前项目中没有这条对话')
        return dict(row)
    row=db.execute('SELECT * FROM conversations WHERE project_id=? AND is_default=1',(pid,)).fetchone()
    if row:return dict(row)
    now=time.time();cid='default-'+pid
    has_history=db.execute('SELECT 1 FROM messages WHERE project_id=? LIMIT 1',(pid,)).fetchone()
    db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?)',(cid,pid,'历史对话' if has_history else '新对话',1,now,now))
    return dict(db.execute('SELECT * FROM conversations WHERE id=?',(cid,)).fetchone())


def scope(chat):return '' if chat['is_default'] else chat['id']


def save_message(db,mid,pid,role,content,cid):
    db.execute('INSERT INTO messages VALUES(?,?,?,?,?)',(mid,pid,role,content,time.time()))
    db.execute('INSERT INTO conversation_messages VALUES(?,?)',(mid,cid))
    db.execute('UPDATE conversations SET updated=? WHERE id=?',(time.time(),cid))


def reserve(db,pid,cid):
    if db.execute("SELECT 1 FROM chat_runs WHERE conversation_id=? AND status IN ('running','stopping')",(cid,)).fetchone():raise HTTPException(409,'这条对话正在处理，请等待完成或手动终止')
    if db.execute("SELECT COUNT(*) FROM chat_runs WHERE status IN ('running','stopping')").fetchone()[0]>=2:raise HTTPException(429,'已有两条对话正在思考，请等待其中一条结束后再发送')
    rid=uuid.uuid4().hex;now=time.time()
    db.execute('INSERT INTO chat_runs VALUES(?,?,?,?,?,?)',(rid,pid,cid,'running',now,now))
    return rid


class RunManager:
    def __init__(self,database):self.database=database;self.tasks={}

    def launch(self,rid,source):
        task=asyncio.create_task(self._consume(rid,source))
        self.tasks[rid]=task
        def finished(completed):
            self.tasks.pop(rid,None)
            # Cancellation can arrive before the coroutine's first instruction.
            with self.database() as db:
                row=db.execute('SELECT status FROM chat_runs WHERE id=?',(rid,)).fetchone()
                if row and row['status'] in ('running','stopping'):
                    db.execute('UPDATE chat_runs SET status=?,updated=? WHERE id=?',('cancelled' if completed.cancelled() else 'failed',time.time(),rid))
        task.add_done_callback(finished)

    def append(self,rid,event):
        with self.database() as db:
            seq=db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM chat_run_events WHERE run_id=?',(rid,)).fetchone()[0]
            db.execute('INSERT INTO chat_run_events VALUES(?,?,?)',(rid,seq,json.dumps(event,ensure_ascii=False)))
            db.execute('UPDATE chat_runs SET updated=? WHERE id=?',(time.time(),rid))

    async def _consume(self,rid,source):
        status='completed';partial='';final=False;artifacts=[]
        try:
            async for line in source:
                event=json.loads(line)
                partial+=event.get('text','')
                if 'final' in event:partial=event['final'];final=True
                if event.get('changed') and event.get('file_id'):artifacts.append(event['file_id'])
                if event.get('error'):status='failed'
                self.append(rid,event)
        except asyncio.CancelledError:
            status='cancelled'
        except Exception:
            status='failed';self.append(rid,{'error':'后台任务未完成，已有文件保留。'})
        finally:
            await source.aclose()
            with self.database() as db:
                run=db.execute('SELECT * FROM chat_runs WHERE id=?',(rid,)).fetchone()
                if not final and (partial or artifacts):
                    mid=uuid.uuid4().hex
                    text=partial+('\n\n（已手动终止，以上为未完成内容。）' if status=='cancelled' else '\n\n（本轮未完成，已保留收到的内容。）')
                    save_message(db,mid,run['project_id'],'assistant',text,run['conversation_id'])
                    for fid in set(artifacts):
                        if db.execute('SELECT 1 FROM files WHERE id=?',(fid,)).fetchone():db.execute('INSERT OR IGNORE INTO message_artifacts VALUES(?,?)',(mid,fid))
                db.execute('UPDATE chat_runs SET status=?,updated=? WHERE id=?',(status,time.time(),rid))
            if status=='cancelled':self.append(rid,{'cancelled':True,'done':True})

    async def stream(self,rid,after=0):
        while True:
            with self.database() as db:
                run=db.execute('SELECT * FROM chat_runs WHERE id=?',(rid,)).fetchone()
                rows=db.execute('SELECT seq,data FROM chat_run_events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200',(rid,after)).fetchall()
            for row in rows:
                after=row['seq'];yield json.dumps({**json.loads(row['data']),'seq':after,'run_id':rid},ensure_ascii=False)+'\n'
            if not rows and run['status'] not in ('running','stopping'):
                with self.database() as db:
                    last=db.execute('SELECT data FROM chat_run_events WHERE run_id=? ORDER BY seq DESC LIMIT 1',(rid,)).fetchone()
                event=json.loads(last['data']) if last else {}
                if not event.get('done') and not event.get('error'):
                    yield json.dumps({'run_id':rid,'run_status':run['status'],'done':True})+'\n'
                return
            await asyncio.sleep(.12)

    def stop(self,db,rid):
        task=self.tasks.get(rid)
        row=db.execute('SELECT status FROM chat_runs WHERE id=?',(rid,)).fetchone()
        if task and row['status']=='running':
            db.execute("UPDATE chat_runs SET status='stopping' WHERE id=?",(rid,));task.cancel()
