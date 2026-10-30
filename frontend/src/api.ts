export type Project = { id: string; name: string; updated: number; created: number };
export type Material = { id: string; name: string; mime: string; size: number; created: number; kind?: string; document_type?:string; template_id?: string; folder_id?: string | null; origin?: string; updated?: number };
export type Message = { id?: string; role: 'user' | 'assistant'; content: string; artifacts?:Material[]; attachments?:Material[];skill?:AgentSkill };
export type QuestionProgress = {text:string;asked:boolean;source:'pending'|'manual'|'auto'};
export type Interview = { id: string; title: string; audio_id: string; outline: string; transcript_id: string | null; report_id: string | null; questions?:QuestionProgress[]; created: number };
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, options);
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(typeof value.detail === 'string' ? value.detail : '请求失败，请稍后重试');
  }
  return response.json();
}
export async function uploadFile(pid: string, file: File, folderId?: string | null) {
  const form = new FormData(); form.append('file', file); if(folderId)form.append('folder_id',folderId);
  return api<Material>(`/projects/${pid}/files`, { method: 'POST', body: form });
}

export type ReportTemplate = {id:string;name:string;description:string;sections:string[]};

export type MaterialFolder = {id:string;name:string;parent_id:string|null;created:number;updated:number;item_count:number};

export type OutlineField={key:string;label:string;options:string[];multiple:boolean;allow_custom:boolean;resolved_value?:string};
export type OutlineWorkflow={id:string;status:'intake'|'confirmed'|'completed'|'cancelled';revision:number;file_id:string|null;topic:string;scenario:string;scenario_name:string;answers:Record<string,string[]>;custom?:Record<string,string>;location:string;duration:string;notes:string;fields:OutlineField[];known_industry:string};
export type OutlineAnswers={topic:string;answers:Record<string,string[]>;custom:Record<string,string>;location:string;duration:string;notes:string};

export type AgentSkill='interview-outline'|'report-generation';
export type ReportWorkflow={id:string;revision:number;status:'intake'|'confirmed'|'completed'|'cancelled';request:string;attachment_ids:string[];template_id:string;file_id:string|null};

export type ChatRun={id:string;status:'running'|'stopping'|'completed'|'failed'|'cancelled'|'interrupted';created:number};
export type Conversation={id:string;title:string;updated:number;message_count?:number;run?:ChatRun|null};
