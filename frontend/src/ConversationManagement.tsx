import { useState } from 'react';
import { ChatCircle, Plus, Stop } from '@phosphor-icons/react';
import { api, type Conversation } from './api';
import './ConversationManagement.css';

export function ConversationManagement({pid,conversations,selected,onSelect,onRefresh,onError}:{pid:string;conversations:Conversation[];selected:string;onSelect:(id:string)=>void;onRefresh:()=>Promise<void>;onError:(text:string)=>void}){
  const [title,setTitle]=useState('');const [creating,setCreating]=useState(false);
  const labels={running:'思考中',stopping:'正在终止',completed:'已完成',failed:'执行失败',cancelled:'已终止',interrupted:'服务重启，任务中断'};
  return <section className="conversation-management"><header><h2>项目对话</h2><p>每条对话独立处理任务，最多同时执行 2 条。切换或刷新不会停止正在运行的任务。</p></header>
    <form onSubmit={async event=>{event.preventDefault();if(creating)return;setCreating(true);try{const chat=await api<Conversation>(`/projects/${pid}/conversations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title.trim()||'新对话'})});setTitle('');await onRefresh();onSelect(chat.id)}catch(e){onError((e as Error).message)}finally{setCreating(false)}}}><input aria-label="新对话名称" placeholder="新对话名称（选填）" value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/><button type="submit" disabled={creating}><Plus size={17}/>新建对话</button></form>
    <div className="conversation-list">{conversations.map(chat=>{const active=chat.run&&['running','stopping'].includes(chat.run.status);return <article className={chat.id===selected?'is-current':''} key={chat.id}><button className="conversation-open" onClick={()=>onSelect(chat.id)}><ChatCircle size={21}/><span><strong>{chat.title}</strong><small>{chat.message_count||0} 条消息 · {new Date(chat.updated*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></span></button><span className={'conversation-status '+(active?'is-running':'')}>{chat.run?labels[chat.run.status]:'尚未开始'}</span>{active&&<button className="conversation-stop" title="手动终止这条对话的生成" aria-label={'终止 '+chat.title} disabled={chat.run?.status==='stopping'} onClick={async()=>{try{await api(`/projects/${pid}/runs/${chat.run!.id}/stop`,{method:'POST'});await onRefresh()}catch(e){onError((e as Error).message)}}}><Stop size={15}/></button>}</article>})}</div>
  </section>;
}
