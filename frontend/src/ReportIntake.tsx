import { useState } from 'react';
import { FileText, Check } from '@phosphor-icons/react';
import type { Material, ReportTemplate, ReportWorkflow } from './api';
import './SkillPicker.css';

export function ReportIntake({ workflow, templates, files, onConfirm, onCancel }: { workflow:ReportWorkflow; templates:ReportTemplate[]; files:Material[]; onConfirm:(template:string,ids:string[])=>Promise<void>; onCancel:()=>void }){
  const [template,setTemplate]=useState(workflow.template_id||'');
  const [ids,setIds]=useState<string[]>(workflow.attachment_ids.filter(id=>files.some(file=>file.id===id)));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <section className="report-skill-intake" aria-label="报告生成技能确认"><header><FileText size={19}/><strong>报告生成</strong></header><p>选择报告模板。没有附加文件时，可勾选来源材料，或沿用你在对话里指定的范围。</p>
    <div className="report-template-cards">{[...templates,{id:'none',name:'不套模板',description:'按材料内容组织报告'}].map(item=><button type="button" disabled={busy} key={item.id} aria-pressed={template===item.id} onClick={()=>setTemplate(item.id)}><FileText size={17}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{template===item.id&&<Check size={16}/>}</button>)}</div>
    <details className="report-source-selection" open={ids.length>0}><summary>来源材料 <span>{ids.length?`已选 ${ids.length} 项`:'可选'}</span></summary>{files.length?files.map(file=><label key={file.id}><input type="checkbox" disabled={busy||(!ids.includes(file.id)&&ids.length>=20)} checked={ids.includes(file.id)} onChange={()=>setIds(old=>old.includes(file.id)?old.filter(id=>id!==file.id):[...old,file.id])}/><span>{file.name}</span></label>):<p>请先上传材料。不会依据模板编造内容。</p>}</details>
    {error&&<p role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={onCancel}>取消技能</button><button className="primary" disabled={!template||busy||!files.length} onClick={async()=>{setBusy(true);setError('');try{await onConfirm(template,ids)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?'正在生成…':'确认模板，生成报告'}</button></footer>
  </section>;
}
