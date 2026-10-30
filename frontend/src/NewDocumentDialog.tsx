import { useEffect, useRef, useState } from 'react';
import { FileText, X } from '@phosphor-icons/react';
import './NewDocumentDialog.css';

type Props={open:boolean;onClose:()=>void;onCreate:(title:string)=>Promise<void>};
export function NewDocumentDialog({open,onClose,onCreate}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  const [title,setTitle]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(open){setTitle('');setError('');if(!dialog.current?.open)dialog.current?.showModal()}else dialog.current?.close()},[open]);
  async function create(){
    if(!title.trim()||busy)return;
    if(!title.trim().replace(/\.(md|txt)$/i,'')){setError('请输入文档标题。');return}
    setBusy(true);setError('');
    try{await onCreate(title.trim().replace(/\.(md|txt)$/i,''));onClose()}catch(error){setError((error as Error).message)}finally{setBusy(false)}
  }
  return <dialog ref={dialog} className="new-document-dialog" aria-labelledby="new-document-heading" onCancel={event=>{event.preventDefault();if(!busy)onClose()}} onClick={event=>{if(event.target===event.currentTarget&&!busy)onClose()}}><form onSubmit={event=>{event.preventDefault();void create()}}>
    <div className="new-document-dialog-top"><span className="new-document-symbol"><FileText size={23} weight="light"/></span><button type="button" aria-label="关闭新建文档窗口" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <h2 id="new-document-heading">新建文档</h2><p>从一个标题开始，内容会自动保存在当前项目。</p>
    <label>文档标题<input autoFocus aria-label="新文档标题" placeholder="例如：商户访谈记录" value={title} maxLength={180} disabled={busy} onChange={event=>setTitle(event.target.value)}/></label>
    <div className="new-document-destination"><FileText size={14}/><span>报告 · Markdown 文档，同时归档到材料</span></div>
    {error&&<p className="new-document-error" role="alert">{error}</p>}
    <footer><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||!title.trim()||/^\.(md|txt)$/i.test(title.trim())}>{busy?'正在创建…':'创建文档'}</button></footer>
  </form></dialog>;
}
