import { useEffect, useRef, useState } from 'react';
import { CheckCircle, Microphone, Pause, Play, Stop } from '@phosphor-icons/react';
import { OutlineRecordingDialog } from './OutlineRecordingDialog';
import { useInterviewProgress } from './useInterviewProgress';
import { api, uploadFile, type Interview, type Material } from './api';

type Props = { pid:string; projectName:string; files:Material[]; selected:Interview|null; initialOutline:string; initialQuestions:string[]; onProtected:(v:boolean)=>void; onError:(v:string)=>void; onSaved:()=>Promise<void>; onSelect:(item:Interview|null)=>void; onOpenReport:(id:string)=>void };
export function Recorder({ pid, projectName, files, selected, initialOutline, initialQuestions, onProtected, onError, onSaved, onSelect, onOpenReport }:Props) {
  const progress=useInterviewProgress(pid,initialQuestions,selected?.questions);
  const [outlineCandidate,setOutlineCandidate]=useState<string|null>(null);
  const [consent,setConsent]=useState(false); const [state,setState]=useState<'idle'|'requesting'|'recording'|'paused'|'saving'|'failed'|'saved'>(selected?'saved':'idle');
  const [elapsed,setElapsed]=useState(0); const [name,setName]=useState(''); const [outline,setOutline]=useState(initialOutline); const [session,setSession]=useState(selected);
  const [processing,setProcessing]=useState(false); const [processError,setProcessError]=useState('');
  const media=useRef<MediaRecorder|null>(null); const stream=useRef<MediaStream|null>(null); const chunks=useRef<Blob[]>([]); const pending=useRef<File|null>(null); const uploaded=useRef<Material|null>(null);
  useEffect(()=>{if(state!=='recording')return;const timer=window.setInterval(()=>setElapsed(v=>v+1),1000);return()=>clearInterval(timer)},[state]);
  useEffect(()=>()=>{stream.current?.getTracks().forEach(t=>t.stop())},[]);
  async function process(item:Interview){
    setProcessing(true);setProcessError('');let current=item;
    try { if(!current.transcript_id) current=await api<Interview>(`/projects/${pid}/interviews/${current.id}/transcribe`,{method:'POST'});
      setSession(current); await onSaved();
      if(!current.report_id) current=await api<Interview>(`/projects/${pid}/interviews/${current.id}/report`,{method:'POST'});
      setSession(current);await onSaved();
    } catch(e){setProcessError((e as Error).message);try{await onSaved()}catch{} }
    finally{setProcessing(false)}
  }
  async function save(){
    if(!pending.current&&!uploaded.current)return;setState('saving');
    try{if(!uploaded.current)uploaded.current=await uploadFile(pid,pending.current!);
      const item=await api<Interview>(`/projects/${pid}/interviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:name.trim()||uploaded.current.name.replace(/\.[^.]+$/,''),audio_id:uploaded.current.id,outline:progress.latest.current.length?'# 本场访谈提纲\n\n'+progress.latest.current.map((q,i)=>`${i+1}. ${q.text}`).join('\n'):outline,questions:progress.latest.current})});
      pending.current=null;uploaded.current=null;setSession(item);setState('saved');onProtected(false);try{await onSaved()}catch{onError('录音已保存，材料列表刷新失败。')}void process(item);
    }catch(e){setState('failed');onError('保存或关联失败，录音仍保留在本页，请重试或下载备份。'+(e as Error).message)}
  }
  async function start(){
    if(!consent||state==='requesting')return;
    if(outline.trim()&&!progress.questions.length){setOutlineCandidate(outline);return}
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){onError('当前环境无法使用麦克风，请用本机 localhost 或 HTTPS 的 Chrome / Edge。');return}
    setState('requesting');onProtected(true);onError('');
    try{stream.current=await navigator.mediaDevices.getUserMedia({audio:true});const recorder=new MediaRecorder(stream.current);media.current=recorder;chunks.current=[];setElapsed(0);
      recorder.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};
      recorder.onstop=async()=>{setState('saving');stream.current?.getTracks().forEach(t=>t.stop());const blob=new Blob(chunks.current,{type:recorder.mimeType});chunks.current=[];
        if(!blob.size){await progress.stop();setState('idle');onProtected(false);onError('未获取到录音内容，可以重新开始。');return}
        const ext=recorder.mimeType.includes('mp4')?'.m4a':recorder.mimeType.includes('ogg')?'.ogg':'.webm';const title=name.trim()||'访谈 '+new Date().toLocaleString('zh-CN').replace(/[/:]/g,'-');pending.current=new File([blob],title+ext,{type:recorder.mimeType});await progress.stop();await progress.match();void save()};
      recorder.onerror=()=>{onError('录音已中断，正在保存已收到的内容。');if(recorder.state!=='inactive')recorder.stop()};
      stream.current.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{if(recorder.state!=='inactive')recorder.stop()}));recorder.start(1000);setState('recording');progress.start(stream.current);
    }catch{void progress.stop();stream.current?.getTracks().forEach(t=>t.stop());onProtected(false);setState('idle');onError('无法开启麦克风，请检查权限和设备后重试。')}
  }
  async function selectOutline(id:string){if(!id){setOutline('');return}try{const content=await api<{content:string}>(`/projects/${pid}/files/${id}/content`);setOutlineCandidate(content.content)}catch(e){onError((e as Error).message)}}
  async function importOutline(file:File|undefined){if(!file)return;if(!/\.(txt|md)$/i.test(file.name)){onError('请导入 UTF-8 格式的 TXT 或 Markdown 提纲。');return}if(file.size>1024*1024){onError('提纲不能超过 1 MB。');return}try{const text=await file.text();if(text.length>30000){onError('提纲不能超过 30000 个字符。');return}await uploadFile(pid,file);setOutlineCandidate(text);await onSaved()}catch(e){onError((e as Error).message)}}
  function download(){if(!pending.current)return;const url=URL.createObjectURL(pending.current);const a=document.createElement('a');a.href=url;a.download=pending.current.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const status=({idle:'尚未开始',requesting:'等待麦克风授权…',recording:'● 正在录音',paused:'已暂停，可继续本场',saving:'正在保存到项目材料…',failed:'尚未完成保存，请重试',saved:'本场访谈已结束'})[state];
  const checklist=!!progress.questions.length&&<section className="interview-checklist"><header><strong>本场提问清单</strong><span>已问 {progress.questions.filter(q=>q.asked).length} / {progress.questions.length}</span></header><p>依据实时转写自动识别，可手动修正。已问不代表受访者已完整回答。</p>{progress.questions.map((question,index)=><label className={'interview-question '+(question.asked?'is-asked':'')} key={question.text}><input type="checkbox" checked={question.asked} disabled={state==='saved'||state==='saving'} onChange={()=>progress.toggle(question.text)}/><span>{index+1}. {question.text}<small>{question.source==='auto'?'已识别提问':question.source==='manual'?'手动标记':question.asked?'已问':'待提问'}</small></span></label>)}</section>;
  return <div className="recorder"><div className="record-heading"><span className="eyebrow">{projectName} / 访谈录音</span><h1>{session?.title||'新录音'}</h1><p>录音、逐字稿和访谈纪要保存在当前项目材料中。</p></div>
    {state==='saved'&&session ? <div className="finished"><h2>本场访谈已结束</h2><audio controls src={`/api/projects/${pid}/files/${session.audio_id}/audio`}/><h3>已保存到项目材料</h3><div className="saved-row"><span>原始录音</span><a href={`/api/projects/${pid}/files/${session.audio_id}`}>下载</a></div><div className="saved-row"><span>逐字稿</span><span>{session.transcript_id?'已保存':processing?'正在转写':'待转写'}</span></div><div className="saved-row"><span>访谈纪要</span><span>{session.report_id?'已生成':processing?'处理中':'待生成'}</span></div>{processError&&<p className="process-error" role="status">{processError}</p>}{session.report_id?<button className="primary" onClick={()=>onOpenReport(session.report_id!)}>打开访谈纪要</button>:<button className="primary" disabled={processing} onClick={()=>void process(session)}>{processing?'正在处理…':'生成／重试访谈纪要'}</button>}<button className="secondary" onClick={()=>{setSession(null);setName('');setElapsed(0);setOutline('');progress.replace([]);setState('idle');onSelect(null)}}>再录一场</button></div> : <><label className="record-name">访谈名称 <span>选填</span><input aria-label="访谈名称" placeholder="例如：王店主 · 装卸与经营" value={name} disabled={state!=='idle'} maxLength={80} onChange={e=>setName(e.target.value)}/></label><div className="record-console"><Microphone size={42} weight="thin"/><p className="record-status">{status}</p><time>{String(Math.floor(elapsed/60)).padStart(2,'0')}:{String(elapsed%60).padStart(2,'0')}</time>{state==='idle'&&<><label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>已取得受访者录音及云端转写和整理同意</label><button className="primary record-start" disabled={!consent} onClick={()=>void start()}><Microphone size={21}/>开始录音</button><small>{progress.questions.length?`已选 ${progress.questions.length} 个问题，录音时会显示提问进度。`:'无需提纲，也可以直接开始。'}</small></>}{(state==='recording'||state==='paused')&&<div className="record-controls"><button className="primary" onClick={()=>{if(state==='recording'){media.current?.pause();void progress.stop();setState('paused')}else{media.current?.resume();if(stream.current)progress.start(stream.current);setState('recording')}}}>{state==='recording'?<Pause size={18}/>:<Play size={18}/>} {state==='recording'?'暂停录音':'继续录音'}</button><button className="secondary" onClick={()=>{if(confirm('结束本场访谈并保存录音？'))media.current?.stop()}}><Stop size={18}/>结束本场</button></div>}{(state==='recording'||state==='paused')&&<small>当前录音暂存本页，请结束并保存后离开。</small>}{state==='failed'&&<div className="recovery"><button className="primary" onClick={()=>void save()}>重试保存</button><button className="secondary" onClick={download}>下载录音备份</button><button onClick={()=>{if(confirm('确定放弃本页未保存的录音？建议先下载备份。')){pending.current=null;uploaded.current=null;setState('idle');onProtected(false)}}}>放弃本次录音</button></div>}</div>
      {checklist}
      <details className="outline-box" open={!!initialOutline}><summary>访前准备（选填） <span>{outline?'已带入提纲':'导入提纲或填写访谈重点'}</span></summary><div><label>选择项目内提纲<select disabled={state!=='idle'} value="" onChange={e=>void selectOutline(e.target.value)}><option value="">选择 Markdown 或文字文件</option>{files.filter(f=>/\.(md|txt)$/i.test(f.name)).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label className="outline-upload">导入提纲<input disabled={state!=='idle'} type="file" accept=".md,.txt" onChange={e=>{void importOutline(e.target.files?.[0]);e.target.value=''}}/></label><textarea aria-label="访谈提纲" value={outline} maxLength={30000} readOnly={!!progress.questions.length} disabled={state!=='idle'} onChange={e=>setOutline(e.target.value)} placeholder="每行一个问题，可随时增删或直接开始录音。"/>{state==='idle'&&outline.trim()&&<button className="secondary" onClick={()=>setOutlineCandidate(outline)}>重新选择本场问题</button>}</div></details>
      <div className="live-transcript"><h3>实时文字</h3><small>{state==='paused'?'录音已暂停；继续后恢复实时转写。':progress.status}</small><div className="live-transcript-text">{progress.transcript}<em>{progress.partial&&'\n'+progress.partial}</em></div></div></>}
    {state==='saved'&&checklist}
    <OutlineRecordingDialog pid={pid} content={outlineCandidate} onClose={()=>setOutlineCandidate(null)} onConfirm={questions=>{setOutline(outlineCandidate||'');progress.replace(questions);setOutlineCandidate(null)}}/>
  </div>;
}
