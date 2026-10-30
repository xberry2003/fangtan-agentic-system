import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretRight, DownloadSimple, DotsThree, File, FileAudio, FilePdf, FileText, FolderSimple, FolderPlus, ImageSquare, List, Microphone, PencilSimple, Plus, MagnifyingGlass, SquaresFour, Trash, UploadSimple, X } from '@phosphor-icons/react';
import { api, uploadFile, type Material, type MaterialFolder } from './api';
import './MaterialLibrary.css';

type Props={pid:string;projectName:string;files:Material[];folders:MaterialFolder[];folderId:string|null;onFolder:(id:string|null)=>void;onRefresh:()=>Promise<void>;onOpen:(file:Material)=>void;onOutline:(file:Material)=>Promise<void>;onRecord:()=>void;onError:(message:string)=>void;onProtected:(busy:boolean)=>void;locked:boolean};
type Entry={kind:'file'|'folder';id:string;name:string};
type Modal={type:'new'|'rename'|'move'|'delete';items:Entry[]};
const editable=(file:Material)=>/\.(md|txt)$/i.test(file.name);
const formatSize=(size:number)=>size>=1048576?(size/1048576).toFixed(1)+' MB':size>=1024?Math.ceil(size/1024)+' KB':size+' B';
const dateLabel=(time:number)=>{const date=new Date(time*1000);return date.toLocaleDateString('zh-CN')===new Date().toLocaleDateString('zh-CN')?'今天 '+date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):date.toLocaleDateString('zh-CN')};
const payload=(items:Entry[])=>({file_ids:items.filter(item=>item.kind==='file').map(item=>item.id),folder_ids:items.filter(item=>item.kind==='folder').map(item=>item.id)});

export function FolderNavigation({folders,folderId,onFolder}:{folders:MaterialFolder[];folderId:string|null;onFolder:(id:string|null)=>void}){
  const tree=(parent:string|null,depth=0):ReactNode=>folders.filter(folder=>folder.parent_id===parent).map(folder=><div key={folder.id}><button className={'category library-folder-nav '+(folderId===folder.id?'selected':'')} style={{paddingLeft:10+depth*14}} onClick={()=>onFolder(folder.id)}><FolderSimple size={18}/><span>{folder.name}</span><small>{folder.item_count||''}</small></button>{tree(folder.id,depth+1)}</div>);
  return <><div className="nav-heading">项目材料</div><button className={'category '+(folderId===null?'selected':'')} onClick={()=>onFolder(null)}><FolderSimple size={18}/>全部材料</button><div className="library-folder-tree">{tree(null)}</div></>;
}

export function MaterialLibrary(props:Props){
  const {pid,files,folders,folderId}=props;
  const [search,setSearch]=useState('');
  const [layout,setLayout]=useState<'list'|'grid'>('list');
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [menu,setMenu]=useState<string|null>(null);
  const [modal,setModal]=useState<Modal|null>(null);
  const [name,setName]=useState('');
  const [target,setTarget]=useState('');
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState('');
  const [dragging,setDragging]=useState(false);
  const [deletion,setDeletion]=useState<{file_count:number;folder_count:number}|null>(null);
  const [modalError,setModalError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const folderInput=useRef<HTMLInputElement>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const searchRef=useRef<HTMLInputElement>(null);
  const key=(entry:Entry)=>entry.kind+':'+entry.id;
  const query=search.trim().toLowerCase();
  const shownFolders=folders.filter(folder=>query?folder.name.toLowerCase().includes(query):folder.parent_id===folderId);
  const shownFiles=files.filter(file=>query?file.name.toLowerCase().includes(query):(file.folder_id||null)===folderId);
  const entries:Entry[]=[...shownFolders.map(folder=>({kind:'folder' as const,id:folder.id,name:folder.name})),...shownFiles.map(file=>({kind:'file' as const,id:file.id,name:file.name}))];
  const selectedItems=entries.filter(entry=>selected.has(key(entry)));
  const allSelected=entries.length>0&&selectedItems.length===entries.length;
  const unavailable=busy||props.locked;
  useEffect(()=>{folderInput.current?.setAttribute('webkitdirectory','');folderInput.current?.setAttribute('directory','')},[]);
  useEffect(()=>{setSelected(new Set());setSearch('');setMenu(null)},[pid,folderId]);
  useEffect(()=>{setSelected(old=>new Set([...old].filter(id=>entries.some(entry=>key(entry)===id))))},[files,folders,search]);
  useEffect(()=>{if(folderId&&!folders.some(folder=>folder.id===folderId))props.onFolder(null)},[folders,folderId]);
  useEffect(()=>{if(modal){if(!dialog.current?.open)dialog.current?.showModal()}else if(dialog.current?.open)dialog.current.close()},[modal]);
  useEffect(()=>{if(!menu)return;const close=()=>setMenu(null);window.addEventListener('click',close);return()=>window.removeEventListener('click',close)},[menu]);
  function protection(value:boolean){setBusy(value);props.onProtected(value)}
  function toggle(entry:Entry){setSelected(old=>{const next=new Set(old);next.has(key(entry))?next.delete(key(entry)):next.add(key(entry));return next})}
  const ancestry:MaterialFolder[]=[];
  let current=folders.find(folder=>folder.id===folderId);
  while(current){ancestry.unshift(current);current=folders.find(folder=>folder.id===current?.parent_id)}
  function folderPath(id:string){const names:string[]=[];let folder=folders.find(item=>item.id===id);while(folder){names.unshift(folder.name);folder=folders.find(item=>item.id===folder?.parent_id)}return names.join(' / ')}
  async function upload(list:FileList|null,includeFolders=false){
    if(!list?.length||unavailable)return;
    const pending=Array.from(list);
    protection(true);props.onError('');
    let completed=0;
    const known=[...folders];
    try{
      for(const file of pending){
        let destination=folderId;
        if(includeFolders&&file.webkitRelativePath){
          for(const part of file.webkitRelativePath.split('/').slice(0,-1)){
            let child=known.find(item=>item.parent_id===destination&&item.name===part);
            if(!child){child=await api<MaterialFolder>(`/projects/${pid}/folders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:part,parent_id:destination})});known.push(child)}
            destination=child.id;
          }
        }
        setProgress(`上传 ${completed+1} / ${pending.length}`);
        await uploadFile(pid,file,destination);completed++;
      }
    }catch(error){props.onError(`${(error as Error).message}，已保存 ${completed} 个文件，可重试剩余文件。`)}
    finally{try{await props.onRefresh()}catch(error){props.onError((error as Error).message)}protection(false);setProgress('')}
  }
  async function openModal(type:Modal['type'],items:Entry[]=[]){
    setMenu(null);setModalError('');setDeletion(null);setName(type==='rename'?items[0].name:'');setTarget(folderId||'');setModal({type,items});
    if(type==='delete')try{setDeletion(await api(`/projects/${pid}/materials/delete-preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(items))}))}catch(error){setModalError((error as Error).message)}
  }
  async function submit(){
    if(!modal||busy)return;
    protection(true);setModalError('');
    try{
      const base={method:'POST',headers:{'Content-Type':'application/json'}};
      if(modal.type==='new')await api(`/projects/${pid}/folders`,{...base,body:JSON.stringify({name,parent_id:folderId})});
      if(modal.type==='rename')await api(`/projects/${pid}/materials/rename`,{...base,body:JSON.stringify({kind:modal.items[0].kind,item_id:modal.items[0].id,name})});
      if(modal.type==='move')await api(`/projects/${pid}/materials/move`,{...base,body:JSON.stringify({...payload(modal.items),target_id:target||null})});
      if(modal.type==='delete'){const result=await api<{deleted_file_ids:string[]}>(`/projects/${pid}/materials/delete`,{...base,body:JSON.stringify(payload(modal.items))});for(const fid of result.deleted_file_ids){try{localStorage.removeItem(`ticha-studio:draft:${pid}:${fid}`);localStorage.removeItem(`ticha-studio:draft:${pid}:${fid}:base`)}catch{}}}
      setSelected(new Set());setModal(null);await props.onRefresh();
    }catch(error){setModalError((error as Error).message)}finally{protection(false)}
  }
  async function downloadSelection(){
    if(!selectedItems.length||unavailable)return;
    protection(true);
    try{
      const response=await fetch(`/api/projects/${pid}/materials/download`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(selectedItems))});
      if(!response.ok){const error=await response.json();throw new Error(error.detail||'打包下载失败')}
      const url=URL.createObjectURL(await response.blob());const anchor=document.createElement('a');anchor.href=url;anchor.download=props.projectName+'-材料.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(error){props.onError((error as Error).message)}finally{protection(false)}
  }
  function icon(file:Material){
    if(['image/jpeg','image/png','image/webp','image/gif'].includes(file.mime))return <img className="library-thumbnail" loading="lazy" src={`/api/projects/${pid}/files/${file.id}/image`} alt=""/>;
    const Icon=file.mime?.startsWith('audio/')?FileAudio:/\.pdf$/i.test(file.name)?FilePdf:editable(file)?FileText:file.mime?.startsWith('image/')?ImageSquare:File;
    return <span className={'library-type-icon '+(file.mime?.startsWith('audio/')?'is-audio':/\.pdf$/i.test(file.name)?'is-pdf':'')}><Icon size={24} weight="light"/></span>;
  }
  function openFile(file:Material){if(editable(file))props.onOpen(file);else if(file.mime?.startsWith('audio/')){const anchor=document.createElement('a');anchor.href=`/api/projects/${pid}/files/${file.id}`;anchor.download=file.name;anchor.click()}else{const anchor=document.createElement('a');anchor.href=`/api/projects/${pid}/files/${file.id}`;anchor.download=file.name;anchor.click()}}
  const row=(entry:Entry)=>{
    const file=entry.kind==='file'?files.find(file=>file.id===entry.id):undefined;
    const folder=entry.kind==='folder'?folders.find(folder=>folder.id===entry.id):undefined;
    const checked=selected.has(key(entry));
    return <div key={key(entry)} className={'library-row '+(checked?'is-selected ':'')+(entry.kind==='folder'?'is-folder':'')}>
      <label className="library-check"><input type="checkbox" aria-label={`选择 ${entry.name}`} checked={checked} onChange={()=>toggle(entry)} disabled={busy}/></label>
      <button className="library-name" draggable={!!file} onDragStart={event=>{if(!file)return;const ids=checked?selectedItems.filter(item=>item.kind==='file').map(item=>item.id):[file.id];event.dataTransfer.setData('application/x-ticha-materials',JSON.stringify({pid,ids}));event.dataTransfer.effectAllowed='copy'}} onClick={()=>folder?props.onFolder(folder.id):file&&openFile(file)}>{folder?<span className="library-type-icon is-folder"><FolderSimple size={26} weight="light"/></span>:file&&icon(file)}<span><strong>{entry.name}</strong>{query&&<small>{folder?folderPath(folder.id):file?.folder_id?folderPath(file.folder_id):'全部材料'}</small>}</span></button>
      <span className="library-size">{folder?folder.item_count+' 个子项':file&&formatSize(file.size)}</span>
      <span className="library-origin">{folder?'文件夹':file?.origin||'上传'}{file?.kind==='report'&&<small>报告</small>}</span>
      <span className="library-date">{dateLabel(folder?.updated||file?.updated||file?.created||0)}</span>
      <div className="library-row-actions"><button className="library-delete-icon" aria-label={`删除 ${entry.name}`} title="删除" disabled={unavailable} onClick={()=>void openModal('delete',[entry])}><Trash size={17}/></button><button aria-label={`${entry.name} 更多操作`} aria-expanded={menu===key(entry)} title="更多操作" onClick={event=>{event.stopPropagation();setMenu(menu===key(entry)?null:key(entry))}}><DotsThree size={22}/></button>
        {menu===key(entry)&&<div className="library-menu" onClick={event=>event.stopPropagation()}>{file&&editable(file)&&<><button onClick={()=>{setMenu(null);props.onOpen(file)}}><PencilSimple size={15}/>编辑文档</button><button onClick={()=>{setMenu(null);void props.onOutline(file)}}><Microphone size={15}/>带提纲录音</button></>}{file&&<a href={`/api/projects/${pid}/files/${file.id}`} download><DownloadSimple size={15}/>下载文件</a>}<button disabled={unavailable} onClick={()=>void openModal('rename',[entry])}><PencilSimple size={15}/>重命名</button><button disabled={unavailable} onClick={()=>void openModal('move',[entry])}><FolderSimple size={15}/>移动到</button><button className="danger" disabled={unavailable} onClick={()=>void openModal('delete',[entry])}><Trash size={15}/>删除</button></div>}
      </div>
    </div>;
  };
  return <div className="material-library" onDragOver={event=>{event.preventDefault();if(event.dataTransfer.types.includes('Files'))setDragging(true)}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false)}} onDrop={event=>{event.preventDefault();setDragging(false);if(event.dataTransfer.types.includes('Files'))void upload(event.dataTransfer.files)}}>
    <header className="library-heading"><span className="eyebrow">项目归档</span><h1>项目材料</h1><p>本项目的录音、文字、照片与报告，都收纳在这里。</p></header>
    <nav className="library-breadcrumb" aria-label="材料路径"><span>{props.projectName}</span><CaretRight size={12}/><button onClick={()=>props.onFolder(null)} aria-current={!folderId?'page':undefined}>全部材料</button>{ancestry.map(folder=><span key={folder.id}><CaretRight size={12}/><button aria-current={folder.id===folderId?'page':undefined} onClick={()=>props.onFolder(folder.id)}>{folder.name}</button></span>)}</nav>
    <div className="library-toolbar"><div className="library-create-actions"><button className="secondary" disabled={unavailable} onClick={()=>void openModal('new')}><FolderPlus size={17}/>新建文件夹</button><button className="secondary" disabled={unavailable} onClick={()=>fileInput.current?.click()}><UploadSimple size={17}/>{progress||'上传文件'}</button><button className="secondary" disabled={unavailable} onClick={()=>folderInput.current?.click()}><FolderSimple size={17}/>上传文件夹</button></div><div className="library-view-tools"><label className="library-search"><MagnifyingGlass size={17}/><input ref={searchRef} aria-label="搜索本项目材料" placeholder="搜索本项目文件" value={search} onChange={event=>setSearch(event.target.value)}/>{search&&<button aria-label="清除搜索" onClick={()=>setSearch('')}><X size={14}/></button>}</label><div className="library-layout"><button aria-label="列表视图" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><List size={18}/></button><button aria-label="网格视图" aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}><SquaresFour size={18}/></button></div></div></div>
    <input hidden ref={fileInput} type="file" multiple onChange={event=>{void upload(event.target.files);event.target.value=''}}/><input hidden ref={folderInput} type="file" multiple onChange={event=>{void upload(event.target.files,true);event.target.value=''}}/>
    <div className={'library-table '+(layout==='grid'?'is-grid':'')}><div className="library-table-head"><label className="library-check"><input type="checkbox" aria-label="选择当前列表全部项目" checked={allSelected} disabled={!entries.length||busy} onChange={()=>setSelected(allSelected?new Set():new Set(entries.map(key)))}/></label><span>名称 <small>{entries.length} 项</small></span><span>大小 / 内容</span><span>来源</span><span>更新时间</span><span/></div>{entries.map(row)}</div>
    {!entries.length&&<div className="library-empty"><FolderSimple size={40} weight="thin"/><h2>{query?'没有找到匹配的材料':'文件夹还是空的'}</h2><p>{query?'换个关键词试试。':'上传文件，或先录一场访谈。'}</p>{!query&&<button className="secondary" onClick={props.onRecord}><Microphone size={17}/>开始录音</button>}</div>}
    {selectedItems.length>0&&<div className="library-batch" role="region" aria-label="所选材料操作"><strong>已选 {selectedItems.length} 项</strong><button disabled={unavailable} onClick={()=>void openModal('move',selectedItems)}><FolderSimple size={17}/>移动到</button><button disabled={unavailable} onClick={()=>void downloadSelection()}><DownloadSimple size={17}/>下载</button><button className="danger" disabled={unavailable} onClick={()=>void openModal('delete',selectedItems)}><Trash size={17}/>删除</button><button aria-label="取消选择" onClick={()=>setSelected(new Set())}><X size={18}/></button></div>}
    <button className={'library-dropzone '+(dragging?'is-dragging':'')} disabled={unavailable} onClick={()=>fileInput.current?.click()}><UploadSimple size={19}/>{progress||'拖入文件或点击上传，保存到当前项目'}</button>
    <dialog className="library-dialog" ref={dialog} onCancel={event=>{event.preventDefault();if(!busy)setModal(null)}} onClick={event=>{if(event.target===event.currentTarget&&!busy)setModal(null)}}>{modal&&<form onSubmit={event=>{event.preventDefault();void submit()}}><div className="library-dialog-heading"><h2>{modal.type==='new'?'新建文件夹':modal.type==='rename'?'重命名':modal.type==='move'?'移动到':'删除所选材料？'}</h2><button type="button" aria-label="关闭" disabled={busy} onClick={()=>setModal(null)}><X size={20}/></button></div>{(modal.type==='new'||modal.type==='rename')&&<label>名称<input autoFocus value={name} maxLength={modal.type==='new'?120:180} onChange={event=>setName(event.target.value)} placeholder="输入名称"/></label>}{modal.type==='move'&&<label>目标文件夹<select value={target} onChange={event=>setTarget(event.target.value)}><option value="">全部材料（根目录）</option>{folders.map(folder=><option value={folder.id} key={folder.id}>{folderPath(folder.id)}</option>)}</select></label>}{modal.type==='delete'&&<><p>{deletion?`将删除 ${deletion.file_count} 个文件、${deletion.folder_count} 个文件夹（含文件夹内的材料）。`:'正在核对文件夹内的材料…'}</p><p>删除会同步移除报告和访谈列表中的相关入口，引用这些文件的内容也可能受影响。删除后无法在页面恢复。</p><ul>{modal.items.slice(0,5).map(item=><li key={key(item)}>{item.name}</li>)}{modal.items.length>5&&<li>以及其他 {modal.items.length-5} 项</li>}</ul></>}{modalError&&<p className="library-modal-error" role="alert">{modalError}</p>}<div className="library-dialog-footer"><button type="button" className="secondary" disabled={busy} onClick={()=>setModal(null)}>取消</button><button className={modal.type==='delete'?'library-confirm-delete':'primary'} disabled={busy||((modal.type==='new'||modal.type==='rename')&&!name.trim())||(modal.type==='delete'&&!deletion)}>{busy?'处理中…':modal.type==='delete'?'确认删除':modal.type==='move'?'移动':'确定'}</button></div></form>}</dialog>
  </div>;
}
