import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChatCircle, FileText, FolderSimple, Microphone, Plus, Sparkle, Stop, X } from '@phosphor-icons/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, type Material, type Message, type Project, type Interview, type ReportTemplate, type ReportWorkflow, type Conversation, type ChatRun, type AgentSkill, type MaterialFolder, type OutlineWorkflow, type OutlineAnswers } from './api';
import { Recorder } from './Recorder';
import { MaterialLibrary, FolderNavigation } from './MaterialLibrary';
import { OutlineIntake } from './OutlineIntake';
import { NewDocumentDialog } from './NewDocumentDialog';
import { FloatingAssistant } from './FloatingAssistant';
import { OutlineRecordingDialog } from './OutlineRecordingDialog';
import { SkillPicker, SkillIcon, skillNames } from './SkillPicker';
import { ConversationManagement } from './ConversationManagement';
import { ReportIntake } from './ReportIntake';
import { ComposerResizeHandle } from './ComposerResizeHandle';
const ReportEditor = lazy(() => import('./ReportEditor').then(module => ({default: module.ReportEditor})));

export type View = 'record' | 'materials' | 'reports' | 'chat';
type Props = { project: Project; view: View; onView: (v: View) => void; onProtected: (value: boolean) => void; onError: (value: string) => void; initialPrompt: string; onPromptConsumed: () => void };

export function Workbench(props: Props) {
  const [files, setFiles] = useState<Material[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [active, setActive] = useState<Interview | null>(null);
  const [outline, setOutline] = useState('');
  const [outlineCandidate,setOutlineCandidate]=useState<string|null>(null);
  const [outlineQuestions,setOutlineQuestions]=useState<string[]>([]);
  const [doc, setDoc] = useState<Material | null>(null);
  const [newDocumentOpen,setNewDocumentOpen]=useState(false);
  const [folders,setFolders]=useState<MaterialFolder[]>([]);
  const [folderId,setFolderId]=useState<string|null>(null);
  const [locked, setLocked] = useState(false);
  const [newVersion, setNewVersion] = useState(0);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(() => Boolean(props.initialPrompt) || props.view === 'chat');
  useEffect(() => { if (props.initialPrompt || props.view === 'chat') setAssistantOpen(true); }, [props.initialPrompt, props.view]);
  const locks = useRef({ recorder: false, chat: false, upload: false });
  function protect(kind: 'recorder' | 'chat' | 'upload', value:boolean) { locks.current[kind] = value; const active = Object.values(locks.current).some(Boolean); setLocked(active); props.onProtected(active); }
  const pid = props.project.id;
  async function refresh() {
    const [materials, sessions, directories] = await Promise.all([api<Material[]>(`/projects/${pid}/files`), api<Interview[]>(`/projects/${pid}/interviews`),api<MaterialFolder[]>(`/projects/${pid}/folders`)]);
    setFiles(materials); setFolders(directories); setInterviews(sessions); setActive(old => old ? sessions.find(item => item.id === old.id) || null : null);setDoc(old=>old?materials.find(item=>item.id===old.id)||null:null);
  }
  useEffect(() => { void refresh().catch(e => props.onError(e.message)); }, [pid]);
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.pid !== pid) return;
      void refresh().catch(e => props.onError(e.message));
      if (detail.fileId && detail.fileId === doc?.id) setDocumentVersion(v => v + 1);
    };
    window.addEventListener('ticha:materials-changed', changed);
    return () => window.removeEventListener('ticha:materials-changed', changed);
  }, [pid, doc?.id]);
  async function useOutline(file: Material) {
    try { const value = await api<{content:string}>(`/projects/${pid}/files/${file.id}/content`); setOutlineCandidate(value.content); }
    catch (e) { props.onError((e as Error).message); }
  }
  async function newDocument(){setNewDocumentOpen(true)}
  async function createDocument(title:string){
    const created=await api<Material>(`/projects/${pid}/documents`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:title.replace(/[/\\]/g,'_')+'.md',title,content:`# ${title}\n\n`})});
    setDoc(created);props.onView('reports');
    try{await refresh()}catch(error){props.onError('文档已创建，列表暂时未刷新。')}
  }
  const isText = (f: Material) => /\.(md|txt)$/i.test(f.name);

  const view = props.view === 'chat' ? 'record' : props.view;
  useEffect(()=>{if(view==='reports'&&!doc){let remembered='';try{remembered=localStorage.getItem(`ticha:last-document:${pid}`)||''}catch{}setDoc(files.find(file=>file.id===remembered&&isText(file))||files.find(file=>file.kind==='report')||files.find(isText)||null)}},[view,files,doc,pid]);
  useEffect(()=>{if(doc)try{localStorage.setItem(`ticha:last-document:${pid}`,doc.id)}catch{}},[pid,doc?.id]);
  return <main className="studio-workspace"><aside className="studio-nav"><nav aria-label="项目工作区">{([{ id: 'record', label: '录音', icon: Microphone }, { id: 'reports', label: '报告', icon: FileText }, { id: 'materials', label: '材料', icon: FolderSimple }] as const).map(({ id, label, icon: Icon }) => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => props.onView(id)}><Icon size={19}/>{label}</button>)}</nav>
    {view === 'record' ? <><div className="nav-heading">本项目访谈</div><button className="new-session" disabled={locked} onClick={() => { setActive(null); setOutline('');setOutlineQuestions([]); setNewVersion(v => v + 1); }}>＋ 新建访谈</button>{interviews.map((item,index) => <button className={'session-row '+(active?.id === item.id ? 'selected':'')} key={item.id} disabled={locked} onClick={() => setActive(item)}><strong>{String(interviews.length-index).padStart(2,'0')}　{item.title}</strong><small>已结束 · {new Date(item.created*1000).toLocaleDateString('zh-CN')}</small></button>)}<p className="nav-caption">所有访谈文件保存在材料中</p></> : view === 'reports' ? <><div className="nav-heading">项目文档</div><button className="new-session" onClick={() => void newDocument()}><Plus size={17}/>新建文档</button>{files.filter(isText).map(f => <button key={f.id} draggable onDragStart={event=>{event.dataTransfer.setData('application/x-ticha-materials',JSON.stringify({pid,ids:[f.id]}));event.dataTransfer.effectAllowed='copy'}} className={'session-row '+(doc?.id===f.id?'selected':'')} onClick={() => setDoc(f)}><FileText size={17}/><strong>{f.name}</strong>{f.kind==='report' && <small>{f.document_type==='outline'?'访谈提纲':'报告'}</small>}</button>)}</> : <FolderNavigation folders={folders} folderId={folderId} onFolder={setFolderId}/>}
    <small className="nav-bottom">体察 · 项目工作空间</small></aside>
    <section className="studio-main">{view === 'materials' ? <MaterialLibrary pid={pid} projectName={props.project.name} files={files} folders={folders} folderId={folderId} onFolder={setFolderId} onRefresh={refresh} onOpen={file=>{setDoc(file);props.onView('reports')}} onOutline={useOutline} onRecord={()=>props.onView('record')} onError={props.onError} onProtected={value=>protect('upload',value)} locked={locked}/>
      : view === 'record' ? <Recorder key={active?.id || 'new-'+newVersion} pid={pid} projectName={props.project.name} files={files} selected={active} initialOutline={outline} initialQuestions={outlineQuestions} onProtected={value=>protect('recorder',value)} onError={props.onError} onSaved={refresh} onSelect={setActive} onOpenReport={fid => { const file=files.find(f=>f.id===fid); if(file){setDoc(file);props.onView('reports');} }}/>
      : <Suspense fallback={<div className="empty">正在打开编辑器…</div>}><ReportEditor key={(doc?.id || 'empty') + ':' + documentVersion} pid={pid} doc={doc} onError={props.onError} onSaved={refresh} onNew={newDocument} onRecord={useOutline}/></Suspense>}
    </section><FloatingAssistant open={assistantOpen} onOpenChange={setAssistantOpen}><Chat pid={pid} visible={assistantOpen} files={files} onOpenMaterial={requested => { const file=files.find(f=>f.id===requested.id)||requested; if (isText(file)) { setDoc(file); props.onView('reports'); } else { setFolderId(file.folder_id||null); props.onView('materials'); } setAssistantOpen(false); }} initialPrompt={props.initialPrompt} onConsumed={props.onPromptConsumed} onProtected={value=>protect('chat',value)} onError={props.onError}/></FloatingAssistant>
    <OutlineRecordingDialog pid={pid} content={outlineCandidate} onClose={()=>setOutlineCandidate(null)} onConfirm={questions=>{setOutline(outlineCandidate||'');setOutlineQuestions(questions);setOutlineCandidate(null);setActive(null);setNewVersion(v=>v+1);props.onView('record')}}/>
    <NewDocumentDialog open={newDocumentOpen} onClose={()=>setNewDocumentOpen(false)} onCreate={createDocument}/>

  </main>;
}

type ChatProps={ pid:string;visible:boolean;files:Material[];onOpenMaterial:(file:Material)=>void;initialPrompt:string;onConsumed:()=>void;onProtected:(v:boolean)=>void;onError:(e:string)=>void };
function Chat(props:ChatProps){
  const [chats,setChats]=useState<Conversation[]>([]);
  const [cid,setCid]=useState('');
  const [manage,setManage]=useState(false);
  const [requestedTab,setRequestedTab]=useState<'chat'|'materials'>('chat');
  async function refreshChats(){const rows=await api<Conversation[]>(`/projects/${props.pid}/conversations`);setChats(rows);setCid(old=>{if(rows.some(chat=>chat.id===old))return old;let saved='';try{saved=localStorage.getItem(`ticha:last-chat:${props.pid}`)||''}catch{}return rows.find(chat=>chat.id===saved)?.id||rows[0]?.id||''})}
  useEffect(()=>{void refreshChats().catch(e=>props.onError(e.message));const timer=window.setInterval(()=>void refreshChats().catch(()=>{}),1800);return()=>clearInterval(timer)},[props.pid]);
  function select(id:string){setCid(id);setManage(false);setRequestedTab('chat');try{localStorage.setItem(`ticha:last-chat:${props.pid}`,id)}catch{}}
  const active=chats.find(chat=>chat.id===cid);
  return <div className="chat-view"><div className="assistant-session-slot" hidden={manage}>{cid?<ChatSession key={cid} {...props} visible={props.visible&&!manage} cid={cid} title={active?.title||'新对话'} onManage={()=>setManage(true)} requestedTab={requestedTab}/>:<div className="empty">正在恢复项目对话…</div>}</div>{manage&&<><div className="assistant-tabs"><button onClick={()=>{setRequestedTab('chat');setManage(false)}}>体察助手</button><button aria-selected="true">对话管理</button><button onClick={()=>{setRequestedTab('materials');setManage(false)}}>项目材料</button></div><ConversationManagement pid={props.pid} conversations={chats} selected={cid} onSelect={select} onRefresh={refreshChats} onError={props.onError}/></>}</div>;
}

function ChatSession({ pid, cid, title, onManage,requestedTab, visible, files, onOpenMaterial, initialPrompt, onConsumed, onError }:ChatProps&{cid:string;title:string;onManage:()=>void;requestedTab:'chat'|'materials'}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState(()=>{try{return localStorage.getItem(`ticha:chat-draft:${cid}`)||''}catch{return ''}});
  useEffect(()=>{try{localStorage.setItem(`ticha:chat-draft:${cid}`,draft)}catch{}},[cid,draft]);
  const [attachments,setAttachments]=useState<Material[]>([]);
  const [attachmentDrag,setAttachmentDrag]=useState(false);
  function attach(ids:string[]){
    const found=ids.map(id=>files.find(file=>file.id===id));
    if(found.some(file=>!file)){onError('部分文件已删除或不属于当前项目');return}
    setAttachments(old=>Array.from(new Map([...old,...found as Material[]].map(file=>[file.id,file])).values()).slice(0,20));setTab('chat');
  }
  const [composerHeight, setComposerHeight] = useState(40);
  function resizeComposer(height:number){setComposerHeight(Math.max(32,Math.min(280,height)))}
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toolStatus, setToolStatus] = useState('');
  const [tab, setTab] = useState<'chat' | 'materials'>(requestedTab);
  useEffect(()=>setTab(requestedTab),[requestedTab]);
  const [templates,setTemplates]=useState<ReportTemplate[]>([]);
  const [selectedSkill,setSelectedSkill]=useState<AgentSkill|null>(null);
  const [reportWorkflow,setReportWorkflow]=useState<ReportWorkflow|null>(null);
  useEffect(()=>{api<ReportWorkflow|null>(`/projects/${pid}/report-workflow?conversation_id=${cid}`).then(setReportWorkflow).catch(()=>{})},[pid]);
  const [elapsed,setElapsed]=useState(0);
  const messagesViewport=useRef<HTMLDivElement>(null);
  const followLatest=useRef(true);
  const [outlineWorkflow,setOutlineWorkflow]=useState<OutlineWorkflow|null>(null);
  useEffect(()=>{let live=true;api<OutlineWorkflow|null>(`/projects/${pid}/outline-workflow?conversation_id=${cid}`).then(state=>{if(live)setOutlineWorkflow(old=>old||state)}).catch(e=>{if(live)onError(e.message)});return()=>{live=false}},[pid]);

  useEffect(()=>{let live=true;api<{templates:ReportTemplate[]}>('/report-templates').then(data=>{if(live)setTemplates(data.templates)}).catch(e=>{if(live)onError(e.message)});return()=>{live=false}},[]);
  const controller = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement>(null);
  const runId=useRef<string|null>(null);
  useEffect(()=>{
    let live=true;const bootstrap=new AbortController();controller.current=bootstrap;
    void (async()=>{
      const rows=await api<Message[]>(`/projects/${pid}/messages?conversation_id=${cid}`);
      const run=await api<ChatRun|null>(`/projects/${pid}/conversations/${cid}/run`);
      if(!live)return;
      setMessages(rows);setLoading(false);
      if(run&&['running','stopping'].includes(run.status)){
        if(initialPrompt){setDraft(initialPrompt);onConsumed()}
        setBusy(true);runId.current=run.id;
        try{await receiveRun(run.id,rows,undefined,bootstrap.signal)}catch(e){if((e as Error).name!=='AbortError'&&live)onError((e as Error).message)}finally{if(live)setBusy(false)}
      }else if(initialPrompt){onConsumed();void send(initialPrompt,rows)}
      else setMessages(await api<Message[]>(`/projects/${pid}/messages?conversation_id=${cid}`));
    })().catch(e=>{if(live){onError(e.message);setLoading(false)}});
    return()=>{live=false;controller.current?.abort()}; // Disconnect display only; server owns the run.
  },[pid,cid]);
  useEffect(()=>{if(!busy){setElapsed(0);return}const started=Date.now();const timer=window.setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>window.clearInterval(timer)},[busy]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>{const element=messagesViewport.current;if(element&&visible&&element.clientHeight>0&&followLatest.current)element.scrollTop=element.scrollHeight});return()=>cancelAnimationFrame(frame)},[messages,busy,toolStatus,outlineWorkflow,reportWorkflow,visible,tab]);
  async function receiveRun(id:string,history:Message[],initialResponse:Response|undefined,signal:AbortSignal){
    let full='',artifacts:Material[]=[],assistantId='stream-'+id,lastSeq=0,done=false;
    const paint=()=>setMessages([...history.filter(message=>message.id!==assistantId),{id:assistantId,role:'assistant',content:full,artifacts}]);
    function line(value:string){
      if(!value.trim())return;
      const event=JSON.parse(value);
      if(event.seq){if(event.seq<=lastSeq)return;lastSeq=event.seq}
      if(event.error)throw new Error(event.error);
      if(event.done)done=true;
      if(event.cancelled){setToolStatus('已手动终止');done=true}
      if(event.outline_workflow)setOutlineWorkflow(event.outline_workflow);
      if(event.report_workflow)setReportWorkflow(event.report_workflow);
      if(event.heartbeat&&event.phase)setToolStatus(event.phase+'…');
      if(event.tool){const labels:Record<string,string>={list_materials:'查看项目材料',read_document:'读取文档',create_document:'新建文档',update_document:'修改文档',list_report_templates:'查看报告模板',read_report_template:'读取模板结构',create_report:'保存报告',start_interview_outline:'准备目标清单',save_interview_outline:'保存访谈提纲',inspect_image:'解读现场照片'};setToolStatus((labels[event.tool]||'处理材料')+(event.status==='running'?'…':event.status==='failed'?'遇到问题，正在处理…':'完成，正在继续整理…'))}
      if(event.changed&&event.file_id){artifacts=[...artifacts.filter(file=>file.id!==event.file_id),{id:event.file_id,name:event.name,mime:'text/markdown',size:0,created:Date.now()/1000,kind:event.kind,document_type:event.document_type}];paint();window.dispatchEvent(new CustomEvent('ticha:materials-changed',{detail:{pid,fileId:event.file_id}}))}
      if(typeof event.final==='string'){full=event.final;assistantId=event.message_id||assistantId;artifacts=event.artifacts||artifacts;paint()}
      if(event.text){full+=event.text;setToolStatus('正在生成回复…');paint()}
    }
    let response=initialResponse;
    try{
      while(!done&&!signal.aborted){
        try{
          response=response||await fetch(`/api/projects/${pid}/runs/${id}/events?after=${lastSeq}`,{signal});
          if(!response.ok)throw new Error('暂时无法连接后台任务');
          const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='';
          while(!signal.aborted){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()!;lines.forEach(line)}
          buffer+=decoder.decode();if(buffer.trim())line(buffer);
          response=undefined;
          if(!done){setToolStatus('正在恢复后台任务连接…');await new Promise(resolve=>setTimeout(resolve,1200))}
        }catch(e){
          if(signal.aborted||!((e as Error) instanceof TypeError))throw e;
          response=undefined;setToolStatus('网络暂时断开，后台仍在执行，正在重连…');await new Promise(resolve=>setTimeout(resolve,1200));
        }
      }
    }finally{
      if(!signal.aborted){runId.current=null;setToolStatus('');setMessages(await api<Message[]>(`/projects/${pid}/messages?conversation_id=${cid}`));void api<OutlineWorkflow|null>(`/projects/${pid}/outline-workflow?conversation_id=${cid}`).then(setOutlineWorkflow).catch(()=>{});void api<ReportWorkflow|null>(`/projects/${pid}/report-workflow?conversation_id=${cid}`).then(setReportWorkflow).catch(()=>{});window.dispatchEvent(new CustomEvent('ticha:materials-changed',{detail:{pid}}))}
    }
  }
  async function send(content:string,history=messages,outline?:OutlineWorkflow,report?:{flow:ReportWorkflow;template:string;ids:string[]}){
    const skill:AgentSkill|null=outline?'interview-outline':report?'report-generation':selectedSkill;
    content=content.trim()||(skill==='interview-outline'?'请生成一份访谈提纲':skill==='report-generation'?'请根据项目材料生成报告':'');
    if(!content||busy)return;
    setBusy(true);setSelectedSkill(null);setDraft('');setToolStatus('正在启动后台任务…');followLatest.current=true;onError('');
    const sentAttachments=outline?[]:report?files.filter(file=>report.ids.includes(file.id)):attachments;setAttachments([]);
    const next:Message[]=[...history,{role:'user',content,attachments:sentAttachments,skill:skill||undefined}];setMessages(next);
    const connection=new AbortController();controller.current=connection;
    let started=false;
    try{
      const response=await fetch(`/api/projects/${pid}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:cid,content,attachment_ids:sentAttachments.map(file=>file.id),skill:skill||undefined,report_template:report?.template,report_flow_id:report?.flow.id,report_revision:report?.flow.revision,outline_flow_id:outline?.id,outline_revision:outline?.revision}),signal:connection.signal});
      if(!response.ok){const error=await response.json();throw new Error(error.detail||'无法启动任务')}
      const id=response.headers.get('X-Run-Id');if(!id)throw new Error('后台未返回任务编号');started=true;runId.current=id;
      await receiveRun(id,next,response,connection.signal);
    }catch(e){if((e as Error).name!=='AbortError'){if(!started){setMessages(history);setDraft(content);setAttachments(sentAttachments);setSelectedSkill(skill)}onError((e as Error).message)}}
    finally{setBusy(false);if(!started)setToolStatus('')}
  }
  async function stopRun(){if(!runId.current)return;setToolStatus('正在终止本轮任务，保留已完成的文件…');try{await api(`/projects/${pid}/runs/${runId.current}/stop`,{method:'POST'})}catch(e){onError((e as Error).message)}}
  async function confirmOutline(answers:OutlineAnswers){
    if(!outlineWorkflow||busy)return;
    const confirmed=await api<OutlineWorkflow>(`/projects/${pid}/outline-workflow/confirm?conversation_id=${cid}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...answers,flow_id:outlineWorkflow.id,revision:outlineWorkflow.revision})});
    setOutlineWorkflow(confirmed);
    await send(`请根据已确认的研究范围生成访谈提纲：${confirmed.topic}。`,messages,confirmed);
  }
  async function cancelOutline(){
    try{await api(`/projects/${pid}/outline-workflow/cancel?conversation_id=${cid}`,{method:'POST'});setOutlineWorkflow(null);setDraft('')}catch(error){onError((error as Error).message)}
  }
  const reportActive=reportWorkflow&&['intake','confirmed'].includes(reportWorkflow.status);
  const outlineActive=outlineWorkflow&&(outlineWorkflow.status==='intake'||outlineWorkflow.status==='confirmed');
  return <div className="chat-view">
    <div className="assistant-tabs" role="tablist" aria-label="助手面板">
      <button id="assistant-chat-tab" role="tab" aria-selected={tab === 'chat'} aria-controls="assistant-chat-body" onClick={() => setTab('chat')}>体察助手</button>
      <button role="tab" aria-selected="false" onClick={onManage}>对话管理</button>
      <button id="assistant-materials-tab" role="tab" aria-selected={tab === 'materials'} aria-controls="assistant-materials-body" onClick={() => setTab('materials')}>项目材料</button>
    </div>
    <section id="assistant-chat-body" role="tabpanel" aria-labelledby="assistant-chat-tab" className="assistant-conversation" hidden={tab !== 'chat'}>
      <div ref={messagesViewport} className="messages" aria-live="polite" aria-busy={busy} onScroll={event=>{const element=event.currentTarget;followLatest.current=element.scrollHeight-element.scrollTop-element.clientHeight<90}}>
        <div className="assistant-context">{/* Each conversation owns its context; files remain project-wide. */}<span className="conversation-context-title">{title}</span></div>
        {!messages.length && <div className="chat-welcome"><ChatCircle size={30} weight="thin"/><h2>{loading ? '正在恢复对话…' : '从这里接着聊。'}</h2><p>准备访谈、整理材料，或一起完善报告。</p></div>}
        {messages.map((m, i) => <article key={m.id || i} className={'message ' + m.role} aria-label={m.role === 'user' ? '你的消息' : '体察助手回复'}>
          {m.role === 'assistant' && <span className="assistant-avatar" aria-hidden="true"><Sparkle size={20} weight="fill"/></span>}
          <div className="message-content">{m.skill&&<span className="message-skill"><SkillIcon skill={m.skill}/>{skillNames[m.skill]}</span>}{m.attachments?.length ? <div className="message-attachments">{m.attachments.map(file=><button key={file.id} type="button" onClick={()=>onOpenMaterial(file)}><FileText size={15}/>{file.name}</button>)}</div>:null}<Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>{m.artifacts?.filter(artifact=>files.some(file=>file.id===artifact.id)).map(artifact=><button key={artifact.id} className="assistant-report-link" onClick={()=>onOpenMaterial(artifact)}><FileText size={17}/><span>{artifact.document_type==='outline'?'编辑提纲':'打开文档'}：{artifact.name}</span><span aria-hidden="true">↗</span></button>)}</div>
        </article>)}
        {busy&&<div className="agent-thinking" role="status"><span className="thinking-orbit" aria-hidden="true"><Sparkle size={17} weight="fill"/></span><div><span>{toolStatus||'体察正在思考…'}</span><span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span>{elapsed>=8&&<small>已用 {elapsed} 秒 · 可随时停止</small>}</div></div>}

        {outlineActive&&!busy&&<OutlineIntake key={outlineWorkflow.id+':'+outlineWorkflow.revision} pid={pid} workflow={outlineWorkflow} onConfirm={confirmOutline}/>}
        {reportActive&&!busy&&<ReportIntake key={reportWorkflow.id} workflow={reportWorkflow} templates={templates} files={files} onCancel={()=>{void api(`/projects/${pid}/report-workflow/cancel?conversation_id=${cid}`,{method:'POST'}).then(()=>setReportWorkflow(null)).catch(e=>onError(e.message))}} onConfirm={async(template,ids)=>{const sources=Array.from(new Set([...ids,...attachments.map(file=>file.id)]));if(sources.length>20)throw new Error('单轮最多附加20个文件，请减少所选材料或在对话中指定文件夹。');await send('请按已确认模板和材料生成报告。',messages,undefined,{flow:reportWorkflow,template,ids:sources})}}/>}
        <div ref={tail}/>
      </div>
      <div className="assistant-composer">{outlineActive&&!busy?<div className="outline-composer-note"><SkillPicker disabled={busy} onSelect={skill=>{void cancelOutline().then(()=>setSelectedSkill(skill))}}/><span>请完成上方选择，确认后生成提纲。</span><button onClick={()=>void cancelOutline()}>取消，继续对话</button></div>:<><form className={'chat-input '+(attachmentDrag?'attachment-drop-active':'')} onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-ticha-materials')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';setAttachmentDrag(true)}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setAttachmentDrag(false)}} onDrop={event=>{if(!event.dataTransfer.types.includes('application/x-ticha-materials'))return;event.preventDefault();event.stopPropagation();setAttachmentDrag(false);if(busy){onError('请等待当前回复完成后添加附件');return}try{const data=JSON.parse(event.dataTransfer.getData('application/x-ticha-materials'));if(data.pid!==pid||!Array.isArray(data.ids)||!data.ids.every((id:unknown)=>typeof id==='string'))throw new Error();attach(data.ids)}catch{onError('请拖入当前项目中的文件')}}} onSubmit={e => { e.preventDefault(); void send(draft); }}>
        {selectedSkill&&<span className="selected-skill"><SkillIcon skill={selectedSkill}/>{skillNames[selectedSkill]}<button type="button" aria-label="移除所选技能" onClick={()=>setSelectedSkill(null)}><X size={13}/></button></span>}
        {attachmentDrag&&<span className="attachment-drop-label">松开，添加为本轮附件</span>}
        {!!attachments.length&&<div className="attachment-chips">{attachments.map(file=><span key={file.id}><FileText size={15}/><span>{file.name}</span><button type="button" aria-label={'移除附件 '+file.name} disabled={busy} onClick={()=>setAttachments(old=>old.filter(item=>item.id!==file.id))}><X size={13}/></button></span>)}</div>}
        <ComposerResizeHandle height={composerHeight} onChange={resizeComposer}/>
        <textarea style={{height:composerHeight}} aria-label="项目对话内容" placeholder="继续讨论，或说说你想怎么修改…" value={draft} disabled={busy} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }}/>
        <div><SkillPicker disabled={busy} onSelect={setSelectedSkill}/><span className="composer-hint">{attachments.length?`已附 ${attachments.length} 个文件`:'可拖入项目文件作为附件'}</span>
          {busy ? <button type="button" className="send" aria-label="停止生成" onClick={()=>void stopRun()}><Stop size={17} weight="fill"/></button> : <button className="send" aria-label="发送消息" disabled={loading || (!draft.trim()&&!selectedSkill)}><ArrowUp size={21}/></button>}
        </div>
      </form></>}<p className="assistant-disclaimer">AI 可能出错，请核对来源与原文</p></div>
    </section>
    <section id="assistant-materials-body" role="tabpanel" aria-labelledby="assistant-materials-tab" className="assistant-materials" hidden={tab !== 'materials'}>
      <p>当前项目的文件，可打开查看或在对话中按名称引用。</p>
      {files.length ? files.map(file => <div className="assistant-attachment-file" key={file.id}><button className="assistant-file" draggable onDragStart={event=>{event.dataTransfer.setData('application/x-ticha-materials',JSON.stringify({pid,ids:[file.id]}));event.dataTransfer.effectAllowed='copy'}} onClick={() => onOpenMaterial(file)}><FileText size={19}/><span>{file.name}</span></button><button type="button" disabled={busy} title="添加为对话附件" aria-label={'附加 '+file.name} onClick={()=>attach([file.id])}><Plus size={17}/></button></div>) : <div className="chat-welcome"><FolderSimple size={30} weight="thin"/><p>这个项目还没有材料。</p></div>}
    </section>
  </div>;
}
