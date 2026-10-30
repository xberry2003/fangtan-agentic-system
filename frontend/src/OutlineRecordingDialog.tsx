import { useEffect, useRef, useState } from 'react';
import { Microphone, X } from '@phosphor-icons/react';
import { api } from './api';
import './OutlineRecordingDialog.css';

export function OutlineRecordingDialog({ pid, content, onClose, onConfirm }: { pid:string; content:string|null; onClose:()=>void; onConfirm:(questions:string[])=>void }) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [questions,setQuestions]=useState<string[]>([]);
  const [selected,setSelected]=useState<Set<number>>(new Set());
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(content===null){dialog.current?.close();return}
    let live=true;setLoading(true);setError('');setQuestions([]);
    if(!dialog.current?.open)dialog.current?.showModal();
    api<{questions:string[]}>(`/projects/${pid}/outline-questions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})}).then(result=>{if(live){setQuestions(result.questions);setSelected(new Set(result.questions.map((_,index)=>index)))}}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});
    return()=>{live=false};
  },[content,pid]);
  return <dialog ref={dialog} className="outline-record-dialog" onCancel={e=>{e.preventDefault();onClose()}} aria-labelledby="outline-record-title"><header><div><h2 id="outline-record-title">选择本场访谈的问题</h2><p>默认全部带入，可以取消不需要的问题。</p></div><button aria-label="关闭问题选择" onClick={onClose}><X size={20}/></button></header>
    <div className="outline-selection-tools"><span>已选 {selected.size} / {questions.length} 个问题</span><button onClick={()=>setSelected(new Set(questions.map((_,i)=>i)))}>全选</button><button onClick={()=>setSelected(new Set())}>清空</button></div>
    <div className="outline-question-options">{loading?<p>正在提取提纲中的问题…</p>:error?<p role="alert">{error}</p>:!questions.length?<p>未发现明确的访谈问题。请先在提纲中添加编号问题或问句，再重试。</p>:questions.map((question,index)=><label key={index}><input type="checkbox" checked={selected.has(index)} onChange={()=>setSelected(old=>{const next=new Set(old);next.has(index)?next.delete(index):next.add(index);return next})}/><span><small>{String(index+1).padStart(2,'0')}</small>{question}</span></label>)}</div>
    <footer><button className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={loading||!selected.size} onClick={()=>onConfirm(questions.filter((_,i)=>selected.has(i)))}><Microphone size={18}/>确认，创建本场访谈</button></footer>
  </dialog>;
}
