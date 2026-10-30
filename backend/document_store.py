"""SQLite is authoritative for editable documents; disk files are export caches."""
import hashlib
import re
import time
import uuid
from pathlib import Path
from fastapi import HTTPException


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS document_contents(file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,hash TEXT NOT NULL,updated REAL NOT NULL)')


def infer_title(content,name):
    found=re.match(r'^\s*# (.+?)[ \t]*\r?\n',content+'\n')
    return (found.group(1).strip() if found else Path(name).stem)[:180] or '未命名文档'


def record(db,fid,content,name,title=None):
    title=title.strip() if title is not None else infer_title(content,name)
    if not title or len(title)>180:raise HTTPException(422,'请填写1到180字的标题')
    digest=hashlib.sha256(content.encode('utf-8')).hexdigest();now=time.time()
    db.execute('INSERT INTO document_contents VALUES(?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET title=excluded.title,content=excluded.content,hash=excluded.hash,updated=excluded.updated',(fid,title,content,digest,now))
    return {'title':title,'content':content,'hash':digest,'updated':now,'name':name}


def sync_file(path,content):
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=content.encode('utf-8')
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==hashlib.sha256(raw).hexdigest():return
    temporary=path.with_name(uuid.uuid4().hex+'.tmp')
    try:temporary.write_bytes(raw);temporary.replace(path)
    finally:temporary.unlink(missing_ok=True)


def read(db,fid,path,name):
    row=db.execute('SELECT * FROM document_contents WHERE file_id=?',(fid,)).fetchone()
    if row:data={**dict(row),'name':name}
    else:
        try:content=path.read_text(encoding='utf-8-sig')
        except (UnicodeError,OSError) as exc:raise HTTPException(415,'文档暂时无法读取，请检查原文件；不会保存空内容覆盖它') from exc
        data=record(db,fid,content,name)
    sync_file(path,data['content'])
    return data


def save(db,fid,path,name,content,expected_hash,versions,title=None):
    prior=read(db,fid,path,name)
    next_title=title.strip() if title is not None else infer_title(content,name)
    if content==prior['content'] and next_title==prior['title']:return prior
    if expected_hash and prior['hash']!=expected_hash:raise HTTPException(409,'文档已有新版本，你的草稿已保留，请重新加载并核对')
    versions.mkdir(parents=True,exist_ok=True)
    (versions/(uuid.uuid4().hex+'.md')).write_text(prior['content'],encoding='utf-8')
    data=record(db,fid,content,name,next_title)
    sync_file(path,content)
    return data
