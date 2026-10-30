import { useEffect, useRef, useState } from 'react';
import { FileText, ListChecks, Plus } from '@phosphor-icons/react';
import type { AgentSkill } from './api';
import './SkillPicker.css';

export const skillNames:Record<AgentSkill,string>={'interview-outline':'访谈提纲','report-generation':'报告生成'};
export function SkillIcon({skill}:{skill:AgentSkill}){return skill==='interview-outline'?<ListChecks size={16}/>:<FileText size={16}/>}
export function SkillPicker({disabled,onSelect}:{disabled:boolean;onSelect:(skill:AgentSkill)=>void}){
  const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[open]);
  return <div className="skill-picker" ref={root} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false)}}}><button type="button" className="composer-materials" aria-label="选择技能" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(!open)}><Plus size={21}/></button>{open&&<div className="skill-picker-menu" role="group" aria-label="可用技能"><small>选择本轮技能</small>{(Object.keys(skillNames) as AgentSkill[]).map(skill=><button type="button" key={skill} onClick={()=>{onSelect(skill);setOpen(false)}}><SkillIcon skill={skill}/><span>{skillNames[skill]}</span></button>)}</div>}</div>;
}
