import { useEffect, useRef, useState } from 'react';
import { api, type QuestionProgress } from './api';
import { openLiveTranscription, type LiveSession } from './liveTranscription';

export function useInterviewProgress(pid:string, initial:string[], saved?:QuestionProgress[]){
  const [questions,setQuestions]=useState<QuestionProgress[]>(saved||initial.map(text=>({text,asked:false,source:'pending'})));
  const [transcript,setTranscript]=useState('');
  const [partial,setPartial]=useState('');
  const [status,setStatus]=useState('录音开始后显示实时转写。');
  const latest=useRef(questions);latest.current=questions;
  const segments=useRef(new Map<string,string>());
  const manual=useRef(new Set<string>());
  const session=useRef<LiveSession|null>(null);
  const mounted=useRef(true);
  const matching=useRef<Promise<void>|null>(null);
  const pendingText=useRef('');
  const debounce=useRef<number|undefined>(undefined);
  async function match(){
    if(matching.current)await matching.current;
    const text=pendingText.current;pendingText.current='';
    if(!text||!latest.current.some(q=>!q.asked&&!manual.current.has(q.text)))return;
    const snapshot=latest.current;
    const work=(async()=>{
      try{
        const result=await api<{asked:number[];unavailable?:boolean}>(`/projects/${pid}/question-progress`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(-4000),questions:snapshot.map(q=>q.text)})});
        if(!mounted.current)return;
        if(result.unavailable)setStatus('实时转写继续；自动标记暂不可用，可手动勾选。');
        const asked=new Set(result.asked.map(index=>snapshot[index]?.text));
        const updated:QuestionProgress[]=latest.current.map(q=>asked.has(q.text)&&!manual.current.has(q.text)?{...q,asked:true,source:'auto'}:q);latest.current=updated;setQuestions(updated);
      }catch{if(mounted.current)setStatus('问题自动标记暂不可用，可手动勾选。')}
    })();
    matching.current=work;await work;if(matching.current===work)matching.current=null;
  }
  function start(stream:MediaStream){
    session.current=openLiveTranscription(pid,stream,(text,final,id)=>{
      if(!mounted.current)return;
      if(final){segments.current.set(id,text);setTranscript([...segments.current.values()].join('\n'));setPartial('');pendingText.current=(pendingText.current+'\n'+text).slice(-4000);clearTimeout(debounce.current);debounce.current=window.setTimeout(()=>void match(),1500)}else setPartial(text);
    },value=>{if(mounted.current)setStatus(value)});
  }
  async function stop(){const current=session.current;session.current=null;await current?.stop();setPartial('');}
  function replace(texts:string[]){manual.current.clear();segments.current.clear();setTranscript('');setPartial('');pendingText.current='';setStatus('录音开始后显示实时转写。');setQuestions(texts.map(text=>({text,asked:false,source:'pending'})))}
  function toggle(text:string){manual.current.add(text);setQuestions(old=>old.map(q=>q.text===text?{...q,asked:!q.asked,source:'manual'}:q))}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(debounce.current);void session.current?.stop()}},[]);
  return {questions,latest,transcript,partial,status,start,stop,replace,toggle,match};
}
