import './ReportEditor.css';
import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown as MarkdownExtension } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { ArrowCounterClockwise, ArrowClockwise, Code, FileText, ImageSquare, ListBullets, ListNumbers, List, Plus, Microphone, Table, TextB } from '@phosphor-icons/react';
import { api, uploadFile, type Material, type ReportTemplate } from './api';

type Props={pid:string;doc:Material|null;onError:(s:string)=>void;onSaved:()=>Promise<void>;onNew:()=>Promise<void>;onRecord:(f:Material)=>Promise<void>};
type Heading={text:string;level:number;position:number};

export function ReportEditor({pid,doc,onError,onSaved,onNew,onRecord}:Props){
  const [value,setValue]=useState('');
  const [title,setTitle]=useState('');
  const [initial,setInitial]=useState({content:'',title:''});
  const [hash,setHash]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(Boolean(doc));
  const [loadError,setLoadError]=useState('');
  const [source,setSource]=useState(false);
  const [headings,setHeadings]=useState<Heading[]>([]);
  const [templateName,setTemplateName]=useState('');
  const [conflict,setConflict]=useState(false);
  const [status,setStatus]=useState<'saved'|'draft'|'saving'|'error'>('saved');
  const [outlineOpen,setOutlineOpen]=useState(()=>{try{return localStorage.getItem('ticha:document-outline-open')==='true'}catch{return false}});
  const imageInput=useRef<HTMLInputElement>(null);
  const titleInput=useRef<HTMLInputElement>(null);
  const draftKey=doc?`ticha-studio:document-draft:v2:${pid}:${doc.id}`:'';
  const legacyKey=doc?`ticha-studio:draft:${pid}:${doc.id}`:'';
  const lastLoaded=useRef({content:'',title:'',hash:''});
  const liveValue=useRef('');
  const liveTitle=useRef('');
  const currentHash=useRef('');
  const ready=useRef(false);
  const alive=useRef(true);
  const saving=useRef<Promise<void>|null>(null);
  const conflicted=useRef(false);
  const flush=useRef<()=>Promise<void>>(async()=>{});
  const changed=()=>liveValue.current!==lastLoaded.current.content||liveTitle.current!==lastLoaded.current.title;
  const split=(raw:string,fallback:string)=>{const found=raw.match(/^\s*# ([^\r\n]+)[ \t]*\r?\n?/);return {title:found?.[1].trim()||fallback,body:found?raw.slice(found[0].length).replace(/^\s*\n/,''):raw}};
  const combine=(heading:string,body:string)=>heading.trim()?`# ${heading.trim()}\n\n${body}`:body;
  function backup(){try{localStorage.setItem(draftKey,JSON.stringify({content:liveValue.current,title:liveTitle.current,baseHash:currentHash.current,updated:Date.now()}))}catch{onError('本地草稿备份失败，请检查自动保存状态。')}}
  function remember(next:string,nextTitle=liveTitle.current){
    if(!ready.current)return;
    liveValue.current=next;liveTitle.current=nextTitle;setValue(next);setTitle(nextTitle);setStatus('draft');backup();
  }
  const editor=useEditor({
    extensions:[StarterKit,TableKit,Image,TaskList,TaskItem.configure({nested:true}),MarkdownExtension.configure({markedOptions:{gfm:true}})],
    content:'',contentType:'markdown',shouldRerenderOnTransaction:true,
    editorProps:{attributes:{class:'report-prose','aria-label':'编辑报告正文','data-placeholder':'在这里开始书写正文…'}},
    onUpdate:({editor})=>{if(ready.current)remember(combine(liveTitle.current,editor.getMarkdown()))},
  });
  useEffect(()=>{
    if(!doc||!editor)return;
    ready.current=false;setLoading(true);setLoadError('');
    let live=true;
    api<{content:string;title:string;hash:string}>(`/projects/${pid}/files/${doc.id}/content`).then(data=>{
      if(!live)return;
      let draft:{content:string;title:string;baseHash:string}|null=null;
      try{draft=JSON.parse(localStorage.getItem(draftKey)||'null')}catch{}
      if(draft&&(typeof draft.content!=='string'||typeof draft.title!=='string'||typeof draft.baseHash!=='string'))draft=null;
      // Old editor lifecycle events could create an empty local draft: never let it mask saved text.
      if(!draft)try{const legacy=localStorage.getItem(legacyKey);const base=localStorage.getItem(legacyKey+':base');if(legacy?.trim()&&base===data.hash&&legacy!==data.content)draft={content:legacy,title:split(legacy,data.title).title,baseHash:base}}catch{}
      const next=draft?.content??data.content;
      const nextTitle=draft?.title??data.title;
      currentHash.current=data.hash;setHash(data.hash);lastLoaded.current=data;
      const hasConflict=Boolean(draft&&draft.baseHash!==data.hash&&(draft.content!==data.content||draft.title!==data.title));
      conflicted.current=hasConflict;setConflict(hasConflict);
      liveValue.current=next;liveTitle.current=nextTitle;setValue(next);setTitle(nextTitle);setInitial(data);
      editor.commands.setContent(split(next,nextTitle).body,{contentType:'markdown',emitUpdate:false});
      ready.current=true;setLoading(false);setStatus(next===data.content&&nextTitle===data.title?'saved':'draft');
    }).catch(error=>{if(live){setLoading(false);setLoadError(error.message);onError(error.message)}});
    return()=>{live=false};
  },[pid,doc?.id,editor]);
  // setEditable emits an update by default. Lifecycle changes must not become user edits.
  useEffect(()=>{editor?.setEditable(ready.current&&!loading&&!busy&&!loadError,false)},[editor,loading,busy,loadError]);
  useEffect(()=>{
    if(!editor)return;
    const outline:Heading[]=[];
    editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading')outline.push({text:node.textContent,level:node.attrs.level,position:pos})});
    setHeadings(outline);
  },[editor,value,loading,source]);
  useEffect(()=>{
    if(!doc?.template_id){setTemplateName('');return}
    let live=true;api<{templates:ReportTemplate[]}>('/report-templates').then(data=>{if(live)setTemplateName(data.templates.find(t=>t.id===doc.template_id)?.name||'')}).catch(()=>{});
    return()=>{live=false};
  },[doc?.template_id]);
  async function save(silent=false):Promise<void>{
    if(!doc||!ready.current||conflicted.current||!liveTitle.current.trim()||!changed())return;
    if(saving.current){await saving.current;return}
    const snapshot={content:liveValue.current,title:liveTitle.current};
    if(alive.current)setStatus('saving');
    const work=(async()=>{
      try{
        const result=await api<{hash:string;title:string}>(`/projects/${pid}/files/${doc.id}/content`,{method:'PUT',headers:{'Content-Type':'application/json'},keepalive:new Blob([snapshot.content]).size<50000,body:JSON.stringify({name:doc.name,content:snapshot.content,title:snapshot.title.trim(),expected_hash:currentHash.current})});
        if(liveTitle.current===snapshot.title){liveTitle.current=result.title;if(alive.current)setTitle(result.title)}
        currentHash.current=result.hash;lastLoaded.current={...snapshot,title:result.title,hash:result.hash};
        if(!changed()){try{localStorage.removeItem(draftKey);localStorage.removeItem(legacyKey);localStorage.removeItem(legacyKey+':base')}catch{}}else backup();
        if(alive.current){setHash(result.hash);setInitial({content:snapshot.content,title:result.title});setStatus(changed()?'draft':'saved');try{await onSaved()}catch{onError('文档已保存至数据库，文档列表暂时未刷新。')}}else window.dispatchEvent(new CustomEvent('ticha:materials-changed',{detail:{pid}}));
      }catch(error){
        backup();
        if(alive.current){setStatus('error');const message=(error as Error).message;
          if(message.includes('新版本')){conflicted.current=true;setConflict(true);try{lastLoaded.current=await api(`/projects/${pid}/files/${doc.id}/content`)}catch{}}
          if(!silent||!message.includes('新版本'))onError(message);
        }
      }
    })();
    saving.current=work;try{await work}finally{saving.current=null}
  }
  flush.current=()=>save(true);
  useEffect(()=>{
    if(loading||loadError||busy||conflict||status==='error'||status==='saving'||!changed()||!title.trim())return;
    const timer=window.setTimeout(()=>void save(true),1200);return()=>window.clearTimeout(timer);
  },[value,title,hash,loading,loadError,busy,conflict,status]);
  useEffect(()=>{
    alive.current=true;
    const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void flush.current()}};
    const hidden=()=>{if(document.visibilityState==='hidden')void flush.current()};
    window.addEventListener('keydown',key);document.addEventListener('visibilitychange',hidden);
    return()=>{alive.current=false;void flush.current();window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',hidden)};
  },[]);
  function changeTitle(next:string){
    const body=source?split(liveValue.current,liveTitle.current).body:editor?.getMarkdown()||'';
    remember(combine(next,body),next);
  }
  function toggleSource(){
    if(source&&editor){const parsed=split(value,title);liveTitle.current=parsed.title;setTitle(parsed.title);editor.commands.setContent(parsed.body,{contentType:'markdown',emitUpdate:false})}
    setSource(!source);
  }
  function resolveConflict(useSaved:boolean){
    const latest=lastLoaded.current;currentHash.current=latest.hash;setHash(latest.hash);setInitial({content:latest.content,title:latest.title});
    if(useSaved){liveValue.current=latest.content;liveTitle.current=latest.title;setValue(latest.content);setTitle(latest.title);editor?.commands.setContent(split(latest.content,latest.title).body,{contentType:'markdown',emitUpdate:false});try{localStorage.removeItem(draftKey)}catch{}}
    conflicted.current=false;setConflict(false);setStatus(useSaved?'saved':'draft');if(!useSaved)backup();
  }
  async function insertImage(file:File|undefined){
    if(!file||!editor)return;
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)){onError('请选择 PNG、JPEG、WEBP 或 GIF 图片');return}
    setBusy(true);
    try{const material=await uploadFile(pid,file);editor.chain().focus().setImage({src:`/api/projects/${pid}/files/${material.id}/image`,alt:file.name}).run();await onSaved()}
    catch(error){onError((error as Error).message)}finally{setBusy(false)}
  }
  const dirty=value!==initial.content||title!==initial.title;
  const saveLabel=loading?'正在读取文档…':loadError?'读取失败，未修改原文':conflict?'有版本冲突':status==='saving'?'正在保存…':status==='error'?'保存失败，草稿已备份':dirty?'等待自动保存…':'已保存至数据库';
  if(!doc)return <div className="empty"><FileText size={40} weight="thin"/><h2>开始一份报告。</h2><p>可以新建文档，或通过体察助手根据材料生成报告。</p><button className="secondary" onClick={()=>void onNew()}><Plus size={18}/>新建文档</button></div>;
  return <div className={"report-editor "+(outlineOpen?"outline-is-open":"outline-is-closed")}>
    <header className="report-toolbar"><button className="report-outline-toggle" aria-label={outlineOpen?"收起本文目录":"展开本文目录"} aria-expanded={outlineOpen} onClick={()=>{const next=!outlineOpen;setOutlineOpen(next);try{localStorage.setItem("ticha:document-outline-open",String(next))}catch{}}}><List size={20}/></button><div className="report-file-name"><FileText size={17}/><span>{doc.name}</span></div>
      <div className="report-formatting" aria-label="文档格式工具">
        <select aria-label="段落样式" disabled={source||loading||busy} value={editor?.isActive('heading')?String(editor.getAttributes('heading').level):'0'} onChange={e=>{const level=Number(e.target.value);if(level)editor?.chain().focus().setHeading({level:level as 1|2|3}).run();else editor?.chain().focus().setParagraph().run()}}><option value="0">正文</option><option value="1">标题 1</option><option value="2">标题 2</option><option value="3">标题 3</option><option value="4">标题 4</option><option value="5">标题 5</option><option value="6">标题 6</option></select>
        <button title="加粗" aria-label="加粗" aria-pressed={editor?.isActive('bold')} disabled={source||loading||busy} onClick={()=>editor?.chain().focus().toggleBold().run()}><TextB size={18}/></button>
        <button title="项目符号" aria-label="项目符号" aria-pressed={editor?.isActive('bulletList')} disabled={source||loading||busy} onClick={()=>editor?.chain().focus().toggleBulletList().run()}><ListBullets size={18}/></button>
        <button title="编号列表" aria-label="编号列表" aria-pressed={editor?.isActive('orderedList')} disabled={source||loading||busy} onClick={()=>editor?.chain().focus().toggleOrderedList().run()}><ListNumbers size={18}/></button>
        <button title="插入表格" aria-label="插入表格" disabled={source||loading||busy} onClick={()=>editor?.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}><Table size={18}/></button>
        <button title="插入图片并归档到材料" aria-label="插入图片" disabled={source||loading||busy} onClick={()=>imageInput.current?.click()}><ImageSquare size={18}/></button>
        <button title="撤销" aria-label="撤销" disabled={source||loading||busy||!editor?.can().undo()} onClick={()=>editor?.chain().focus().undo().run()}><ArrowCounterClockwise size={17}/></button>
        <button title="重做" aria-label="重做" disabled={source||loading||busy||!editor?.can().redo()} onClick={()=>editor?.chain().focus().redo().run()}><ArrowClockwise size={17}/></button>
        <button title="Markdown 源码" aria-label="切换Markdown源码" aria-pressed={source} disabled={loading||busy} onClick={toggleSource}><Code size={18}/></button>
      </div>
      <button className="report-save" disabled={busy||loading||!dirty||conflict||!title.trim()||Boolean(loadError)||status==='saving'} onClick={()=>void save()}>{status==='saving'?'保存中…':'保存'}</button>
      <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>{void insertImage(e.target.files?.[0]);e.target.value=''}}/>
    </header>
    {loadError&&<div className="report-conflict" role="alert">{loadError}。为防止覆盖原文，暂时关闭编辑，请重新打开文档。</div>}
    {conflict&&<div className="report-conflict">已保存版本有更新，你的编辑草稿仍保留。<button onClick={()=>resolveConflict(true)}>使用已保存版本</button><button onClick={()=>resolveConflict(false)}>保留草稿继续编辑</button></div>}
    <div className="report-body">
      <aside className="report-outline" aria-label="本文目录" hidden={!outlineOpen}><span>本文目录</span><button className="report-title-nav" onClick={()=>{titleInput.current?.scrollIntoView({block:'center'});titleInput.current?.focus()}}>{title||'未命名文档'}</button>{headings.length?headings.map((heading,i)=><button key={i} style={{paddingLeft:Math.min(heading.level-1,2)*10+4}} onClick={()=>editor?.chain().focus().setTextSelection(heading.position+1).scrollIntoView().run()} disabled={source}>{heading.text||'未命名标题'}</button>):<p>正文小标题会显示在这里</p>}</aside>
      <div className="report-paper"><div className="report-meta"><span>{doc.document_type==='outline'?'访谈提纲':templateName||'项目文档'} · {saveLabel}</span><button className="outline-record-cta" disabled={busy||loading||dirty||status==='saving'||Boolean(loadError)} onClick={()=>void onRecord(doc)}><Microphone size={18}/>带此提纲开始访谈 ↗</button></div>
        <input ref={titleInput} className="report-title-input" aria-label="文档标题" placeholder="请输入文档标题" value={title} maxLength={180} disabled={loading||Boolean(loadError)} onChange={event=>changeTitle(event.target.value)}/>
        {source?<textarea className="report-source" aria-label="Markdown源码" value={value} disabled={loading||busy||Boolean(loadError)} onChange={e=>{const parsed=split(e.target.value,title);remember(e.target.value,parsed.title)}}/>:<EditorContent editor={editor}/>}
        <footer className="report-paper-footer"><span>{value.replace(/\s/g,'').length} 字符</span><span>{source?'Markdown 源码':'自动保存 · Ctrl / ⌘ S 立即保存'}</span></footer>
      </div>
    </div>
  </div>;
}
