import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ListChecks } from '@phosphor-icons/react';
import { type OutlineAnswers, type OutlineWorkflow } from './api';
import './OutlineIntake.css';

type Props={pid:string;workflow:OutlineWorkflow;onConfirm:(answers:OutlineAnswers)=>Promise<void>};
export function OutlineIntake({pid,workflow,onConfirm}:Props){
  const draftKey=`ticha:outline-intake:${pid}:${workflow.id}`;
  const initial=():OutlineAnswers=>{
    try{const draft=JSON.parse(localStorage.getItem(draftKey)||'null');if(draft?.revision===workflow.revision)return draft.answers}catch{}
    const answers=Object.fromEntries(Object.entries(workflow.answers).map(([key,values])=>[key,values.filter(value=>value!==workflow.custom?.[key])]));
    return {topic:workflow.topic,answers,custom:workflow.custom||{},location:workflow.location,duration:workflow.duration||'45',notes:workflow.notes};
  };
  const [form,setForm]=useState<OutlineAnswers>(initial);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [changingIndustry,setChangingIndustry]=useState(false);
  const [other,setOther]=useState<Record<string,boolean>>(()=>Object.fromEntries(Object.entries(form.custom).map(([key,value])=>[key,Boolean(value)])));
  useEffect(()=>{try{localStorage.setItem(draftKey,JSON.stringify({revision:workflow.revision,answers:form}))}catch{}},[form,draftKey,workflow.revision]);
  function choose(key:string,value:string,multiple:boolean){
    setForm(old=>{const selected=old.answers[key]||[];return {...old,answers:{...old.answers,[key]:multiple?(selected.includes(value)?selected.filter(item=>item!==value):[...selected,value]):[value]},custom:multiple?old.custom:{...old.custom,[key]:''}}});
    if(!multiple)setOther(old=>({...old,[key]:false}));
  }
  function toggleOther(key:string,multiple:boolean){
    const next=!other[key];setOther(old=>({...old,[key]:next}));
    setForm(old=>({...old,answers:!multiple&&next?{...old.answers,[key]:[]}:old.answers,custom:{...old.custom,[key]:next?old.custom[key]||'':''}}));
  }
  async function submit(){
    setError('');
    if(!form.topic.trim()){setError('请补充这次想研究的具体主题。');return}
    for(const field of workflow.fields){if(!(form.answers[field.key]?.length||form.custom[field.key]?.trim())){setError('请完成：'+field.label);return}if(other[field.key]&&!form.custom[field.key]?.trim()){setError('请填写“其他”的具体内容。');return}}
    setBusy(true);try{await onConfirm(form);try{localStorage.removeItem(draftKey)}catch{}}catch(error){setError((error as Error).message)}finally{setBusy(false)}
  }
  return <form className="outline-intake" onSubmit={event=>{event.preventDefault();void submit()}}>
    <header><span className="outline-skill-icon"><ListChecks size={18}/></span><div><strong>第1步 · 目标与方案</strong><p>确认范围后，生成可编辑的访谈提纲</p></div></header>
    <label className="outline-text-field">这次想研究什么？<input aria-label="研究主题" value={form.topic} maxLength={500} disabled={busy} placeholder="例如：上海新能源车主的购车决策与用车痛点" onChange={event=>setForm({...form,topic:event.target.value})}/></label>
    <div className="outline-scenario">{workflow.scenario_name}<span>访前准备</span></div>
    {workflow.fields.map((field,index)=>{
      const selected=form.answers[field.key]||[];
      const resolved=field.key==='industry'&&workflow.known_industry&&!changingIndustry;
      return <fieldset key={field.key} disabled={busy}><legend><span>{index+1}</span>{field.label}<small>{field.multiple?'可多选':'单选'}</small></legend>
        {resolved?<div className="outline-known"><span><Check size={14}/>{selected[0]||workflow.known_industry}</span><button type="button" onClick={()=>setChangingIndustry(true)}>更改</button></div>:<><div className="outline-options">{field.options.map(option=><button type="button" key={option} aria-pressed={selected.includes(option)} onClick={()=>choose(field.key,option,field.multiple)}>{option}{selected.includes(option)&&<Check size={12}/>}</button>)}<button type="button" aria-pressed={Boolean(other[field.key])} onClick={()=>toggleOther(field.key,field.multiple)}>其他{other[field.key]&&<Check size={12}/>}</button></div>{other[field.key]&&<input className="outline-other" aria-label={field.label+'其他选项'} maxLength={160} placeholder={field.key==='goal'?'填写你希望了解的问题':field.key==='audience'?'填写你计划访谈的人群':'填写具体行业或产品'} value={form.custom[field.key]||''} onChange={event=>setForm({...form,custom:{...form.custom,[field.key]:event.target.value}})}/>}</>}
      </fieldset>;
    })}
    <div className="outline-optional-fields"><label className="outline-text-field">地点 <span>选填</span><input value={form.location} maxLength={200} disabled={busy} placeholder="城市、园区或企业" onChange={event=>setForm({...form,location:event.target.value})}/></label><label className="outline-text-field">预计时长<select value={form.duration} disabled={busy} onChange={event=>setForm({...form,duration:event.target.value})}>{['30','45','60','90'].map(value=><option key={value} value={value}>{value} 分钟</option>)}</select></label></div>
    <label className="outline-text-field">访谈重点或其他要求 <span>选填</span><textarea value={form.notes} disabled={busy} maxLength={3000} placeholder="例如：重点问最近一次购车经历，少问行业宏观问题" onChange={event=>setForm({...form,notes:event.target.value})}/></label>
    {error&&<p className="outline-intake-error" role="alert">{error}</p>}
    <button className="outline-confirm" disabled={busy}>{busy?'正在确认…':workflow.status==='confirmed'?'确认范围，重新生成提纲':'确认范围，生成访谈提纲'}<ArrowUpRight size={16}/></button>
    <p className="outline-save-note">生成后保存到材料「访前准备」，可在「报告」中编辑。</p>
  </form>;
}
