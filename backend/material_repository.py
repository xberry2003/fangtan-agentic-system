"""Project material persistence. SQLite-specific SQL is contained in this repository.

Binary storage is independent of these relational records, allowing a future
PostgreSQL repository to keep the same material API and file identifiers.
"""
from pathlib import Path
import time
import uuid
from fastapi import HTTPException

DEFAULTS={'audio':'访谈录音','text':'文字资料','image':'现场照片','reference':'参考文件','outline':'访前准备','report':'访谈报告'}
FILE_SELECT="""SELECT f.*,COALESCE(e.updated,f.created) AS updated,e.folder_id,
COALESCE(e.origin,'上传') AS origin,CASE WHEN r.file_id IS NULL THEN 'material' ELSE 'report' END AS kind,r.template_id,COALESCE(l.document_type,'report') AS document_type
FROM files f LEFT JOIN material_entries e ON e.file_id=f.id LEFT JOIN report_documents r ON r.file_id=f.id LEFT JOIN document_labels l ON l.file_id=f.id"""


def initialize_schema(db):
    db.executescript("""
    CREATE TABLE IF NOT EXISTS material_folders(
      id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),
      parent_id TEXT REFERENCES material_folders(id),name TEXT NOT NULL,
      default_key TEXT,created REAL NOT NULL,updated REAL NOT NULL,
      UNIQUE(project_id,default_key));
    CREATE UNIQUE INDEX IF NOT EXISTS folder_sibling_name ON material_folders(project_id,COALESCE(parent_id,''),name);
    CREATE TABLE IF NOT EXISTS material_entries(
      file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      folder_id TEXT REFERENCES material_folders(id),origin TEXT NOT NULL,updated REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS material_folder_lookup ON material_entries(folder_id);
    CREATE TABLE IF NOT EXISTS material_migrations(project_id TEXT PRIMARY KEY REFERENCES projects(id));
    """)


class MaterialRepository:
    def __init__(self,db,pid):self.db,self.pid=db,pid

    def folder(self,fid):
        row=self.db.execute('SELECT * FROM material_folders WHERE id=? AND project_id=?',(fid,self.pid)).fetchone()
        if not row:raise HTTPException(404,'文件夹不存在或不属于当前项目')
        return dict(row)

    def file(self,fid):
        row=self.db.execute(FILE_SELECT+' WHERE f.id=? AND f.project_id=?',(fid,self.pid)).fetchone()
        if not row:raise HTTPException(404,'项目文件不存在')
        return dict(row)

    def files(self):return [dict(row) for row in self.db.execute(FILE_SELECT+' WHERE f.project_id=? ORDER BY COALESCE(e.updated,f.created) DESC',(self.pid,))]

    def folders(self):
        return [dict(row) for row in self.db.execute('SELECT d.*, (SELECT COUNT(*) FROM material_folders c WHERE c.parent_id=d.id)+(SELECT COUNT(*) FROM material_entries e WHERE e.folder_id=d.id) AS item_count FROM material_folders d WHERE d.project_id=? ORDER BY d.created,d.name',(self.pid,))]

    def create_folder(self,name,parent_id=None,default_key=None):
        name=name.strip()
        if not name or len(name)>120 or name in {'.','..'} or any(char in name for char in '/\\\x00'):
            raise HTTPException(422,'请输入有效文件夹名称，不包含路径符号')
        if parent_id:self.folder(parent_id)
        if self.db.execute("SELECT id FROM material_folders WHERE project_id=? AND COALESCE(parent_id,'')=? AND name=?",(self.pid,parent_id or '',name)).fetchone():
            raise HTTPException(409,'同一位置已有同名文件夹')
        fid,now=uuid.uuid4().hex,time.time()
        self.db.execute('INSERT INTO material_folders VALUES(?,?,?,?,?,?,?)',(fid,self.pid,parent_id,name,default_key,now,now))
        self.touch_project()
        return self.folder(fid)

    def default_folder(self,key):
        row=self.db.execute('SELECT id FROM material_folders WHERE project_id=? AND default_key=?',(self.pid,key)).fetchone()
        if row:return row['id']
        existing=self.db.execute('SELECT id FROM material_folders WHERE project_id=? AND parent_id IS NULL AND name=?',(self.pid,DEFAULTS[key])).fetchone()
        if existing:
            self.db.execute('UPDATE material_folders SET default_key=? WHERE id=?',(key,existing['id']));return existing['id']
        return self.create_folder(DEFAULTS[key],default_key=key)['id']

    def initialize_project(self):
        if self.db.execute('SELECT 1 FROM material_migrations WHERE project_id=?',(self.pid,)).fetchone():return
        for key in DEFAULTS:self.default_folder(key)
        for file in self.files():self.register_file(file['id'],'自动归档')
        self.db.execute('INSERT INTO material_migrations VALUES(?)',(self.pid,))

    def register_file(self,fid,origin,folder_id=None,default_key=None):
        file=self.file(fid)
        if folder_id:self.folder(folder_id)
        else:
            mime=file.get('mime') or ''
            suffix=Path(file['name']).suffix.lower()
            key=default_key or ('report' if file['kind']=='report' else 'audio' if mime.startswith('audio/') else 'image' if mime.startswith('image/') else 'outline' if '提纲' in file['name'] else 'text' if suffix in {'.txt','.md','.docx','.csv','.json','.srt','.vtt'} else 'reference')
            folder_id=self.default_folder(key)
        existing=self.db.execute('SELECT file_id,folder_id FROM material_entries WHERE file_id=?',(fid,)).fetchone()
        if existing:self.db.execute('UPDATE material_entries SET folder_id=?,origin=?,updated=? WHERE file_id=?',(folder_id,origin,time.time(),fid))
        else:self.db.execute('INSERT INTO material_entries VALUES(?,?,?,?)',(fid,folder_id,origin,time.time()))
        self.touch_folder(folder_id)
        if existing and existing['folder_id']!=folder_id:self.touch_folder(existing['folder_id'])
        self.touch_project()
        return self.file(fid)

    def touch_folder(self,fid):
        while fid:
            row=self.db.execute('SELECT parent_id FROM material_folders WHERE id=? AND project_id=?',(fid,self.pid)).fetchone()
            if not row:return
            self.db.execute('UPDATE material_folders SET updated=? WHERE id=?',(time.time(),fid));fid=row['parent_id']

    def touch_project(self):self.db.execute('UPDATE projects SET updated=? WHERE id=?',(time.time(),self.pid))

    def touch_file(self,fid):
        file=self.file(fid)
        self.touch_folder(file.get('folder_id'))
        self.db.execute('UPDATE material_entries SET updated=? WHERE file_id=?',(time.time(),fid));self.touch_project()

    def rename(self,kind,item_id,name):
        name=name.strip()
        if not name or len(name)>180 or name in {'.','..'} or any(char in name for char in '/\\\x00'):raise HTTPException(422,'名称不合法')
        if kind=='folder':
            item=self.folder(item_id)
            duplicate=self.db.execute("SELECT id FROM material_folders WHERE project_id=? AND COALESCE(parent_id,'')=? AND name=? AND id<>?",(self.pid,item['parent_id'] or '',name,item_id)).fetchone()
            if duplicate:raise HTTPException(409,'同一位置已有同名文件夹')
            self.db.execute('UPDATE material_folders SET name=?,updated=? WHERE id=?',(name,time.time(),item_id))
        elif kind=='file':
            item=self.file(item_id)
            if Path(name).suffix.lower()!=Path(item['name']).suffix.lower():raise HTTPException(422,'重命名时请保留原文件扩展名')
            self.db.execute('UPDATE files SET name=? WHERE id=? AND project_id=?',(name,item_id,self.pid));self.touch_file(item_id)
        else:raise HTTPException(422,'类型不合法')
        self.touch_project()

    def move(self,file_ids,folder_ids,target_id):
        if target_id:self.folder(target_id)
        for fid in file_ids:self.file(fid)
        for folder_id in folder_ids:
            folder=self.folder(folder_id)
            ancestor=target_id
            while ancestor:
                if ancestor==folder_id:raise HTTPException(422,'不能移动到自身或子文件夹')
                ancestor=self.folder(ancestor)['parent_id']
            duplicate=self.db.execute("SELECT id FROM material_folders WHERE project_id=? AND COALESCE(parent_id,'')=? AND name=? AND id<>?",(self.pid,target_id or '',folder['name'],folder_id)).fetchone()
            if duplicate:raise HTTPException(409,'目标位置已有同名文件夹')
        names=[self.folder(fid)['name'] for fid in folder_ids]
        if len(names)!=len(set(names)):raise HTTPException(409,'选中的文件夹存在同名项，请分别移动')
        for fid in file_ids:
            self.touch_folder(self.file(fid).get('folder_id'))
            self.db.execute('UPDATE material_entries SET folder_id=?,updated=? WHERE file_id=?',(target_id,time.time(),fid))
        for fid in folder_ids:
            self.touch_folder(self.folder(fid)['parent_id'])
            self.db.execute('UPDATE material_folders SET parent_id=?,updated=? WHERE id=?',(target_id,time.time(),fid))
        self.touch_folder(target_id)
        self.touch_project()

    def expand_deletion(self,file_ids,folder_ids):
        for fid in file_ids:self.file(fid)
        folders=set()
        def visit(fid):
            self.folder(fid)
            if fid in folders:return
            folders.add(fid)
            for row in self.db.execute('SELECT id FROM material_folders WHERE project_id=? AND parent_id=?',(self.pid,fid)):visit(row['id'])
        for fid in folder_ids:visit(fid)
        files=set(file_ids)
        for fid in folders:
            files.update(row['file_id'] for row in self.db.execute('SELECT file_id FROM material_entries WHERE folder_id=?',(fid,)))
        return files,folders

    def delete_records(self,file_ids,folder_ids):
        for fid in file_ids:self.touch_folder(self.file(fid).get('folder_id'))
        for fid in folder_ids:self.touch_folder(self.folder(fid)['parent_id'])
        for fid in file_ids:
            self.db.execute('DELETE FROM interviews WHERE project_id=? AND audio_id=?',(self.pid,fid))
            self.db.execute('UPDATE interviews SET transcript_id=NULL WHERE project_id=? AND transcript_id=?',(self.pid,fid))
            self.db.execute('UPDATE interviews SET report_id=NULL WHERE project_id=? AND report_id=?',(self.pid,fid))
            self.db.execute('DELETE FROM files WHERE project_id=? AND id=?',(self.pid,fid))
        def depth(fid):
            count=0;parent=self.folder(fid)['parent_id']
            while parent:count+=1;parent=self.folder(parent)['parent_id']
            return count
        for fid in sorted(folder_ids,key=depth,reverse=True):self.db.execute('DELETE FROM material_folders WHERE id=? AND project_id=?',(fid,self.pid))
        self.touch_project()
