import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, ArrowRight, CaretDown, CaretRight, CirclesThree, Cursor, FolderSimple, MagnifyingGlass, Microphone, Moon, Paperclip, Plus, Sun, X } from '@phosphor-icons/react';
import { api, type Project } from './api';
import { RevealBackdrop } from './RevealBackdrop';
import { TypewriterSubtitle } from './TypewriterSubtitle';
import { Workbench, type View } from './Workbench';

const LAST = 'ticha-studio:last-project';
const remembered = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
function remember(id: string) { try { localStorage.setItem(LAST, id); } catch { /* Navigation still works without local storage. */ } }

function ProjectPicker({ projects, busy, onSelect, onCreate }: { projects: Project[]; busy: boolean; onSelect: (p: Project) => void; onCreate: (name: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); if (name.trim() && !busy) await onCreate(name.trim()); }
  const filtered = projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="project-picker">
    {creating ? <form onSubmit={submit} className="create-form"><label htmlFor="project-name">给新项目起个名字</label><input id="project-name" autoFocus placeholder="例如：凌西物流园升级改造" value={name} maxLength={80} onChange={e => setName(e.target.value)} disabled={busy}/><p>录音、对话和材料都会保存在这个项目里。</p><div className="form-actions"><button type="button" onClick={() => setCreating(false)} disabled={busy}>返回</button><button className="primary" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建项目'}</button></div></form>
      : <><label className="search"><MagnifyingGlass size={18}/><input aria-label="搜索项目" placeholder="搜索项目" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="project-list">{filtered.map(p => <button className="project-row" key={p.id} disabled={busy} onClick={() => onSelect(p)}><FolderSimple size={21}/><strong>{p.name}</strong><small>{new Date(p.updated * 1000).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</small><CaretRight size={15}/></button>)}{!filtered.length && <p className="list-empty">{projects.length ? '没有找到匹配的项目' : '还没有项目，从一个名字开始。'}</p>}</div><button className="new-project" disabled={busy} onClick={() => setCreating(true)}><span><Plus size={20}/></span>新建项目</button></>}
  </div>;
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [screen, setScreen] = useState<'home' | 'workspace'>('home');
  const [view, setView] = useState<View>('materials');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [protectedWork, setProtectedWork] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'projects' | 'guide' | null>(null);
  const [projectMenu, setProjectMenu] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [dark, setDark] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentUrl = useRef(location.href);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!projectMenu) return;
    const close = (event: MouseEvent) => { if (!projectMenuRef.current?.contains(event.target as Node)) setProjectMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProjectMenu(false); };
    document.addEventListener('click', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', escape); };
  }, [projectMenu]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  useEffect(() => {
    let disposed = false;
    async function boot() {
      setLoading(true); setError('');
      try {
        const list = await api<Project[]>('/projects');
        if (disposed) return;
        setProjects(list);
        const params = new URLSearchParams(location.search);
        const id = params.get('project') || remembered();
        if (id) {
          const found = list.find(p => p.id === id);
          if (found) {
            setProject(found); remember(found.id);
            const target = params.get('view');
            setScreen(target ? 'workspace' : 'home');
            setView(target === 'record' || target === 'chat' || target === 'reports' ? target : 'materials');
            if (!params.get('project')) history.replaceState({}, '', `?project=${found.id}`);
          } else { setProject(null); history.replaceState({}, '', location.pathname); }
        }
        currentUrl.current = location.href;
      } catch (cause) { if (!disposed) setError((cause as Error).message); }
      finally { if (!disposed) setLoading(false); }
    }
    void boot();
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const pop = () => {
      if (protectedWork) { history.pushState({}, '', currentUrl.current); setError('请先停止录音并保存，或等待当前操作完成。'); return; }
      const params = new URLSearchParams(location.search);
      const found = projects.find(p => p.id === params.get('project'));
      setProject(found || null); if (found) remember(found.id);
      const next = params.get('view'); setScreen(next && found ? 'workspace' : 'home');
      setView(next === 'record' || next === 'chat' || next === 'reports' ? next : 'materials'); currentUrl.current = location.href;
    };
    const unload = (event: BeforeUnloadEvent) => { if (protectedWork) { event.preventDefault(); event.returnValue = ''; } };
    addEventListener('popstate', pop); addEventListener('beforeunload', unload);
    return () => { removeEventListener('popstate', pop); removeEventListener('beforeunload', unload); };
  }, [projects, protectedWork]);
  useEffect(() => { if (modal) dialog.current?.showModal(); else dialog.current?.close(); }, [modal]);
  function navigate(next: 'home' | 'workspace', tab = view) {
    if (protectedWork) { setError('请先停止录音并保存，或等待当前操作完成。'); return; }
    setError(''); setScreen(next); setView(tab);
    history.pushState({}, '', project ? `?project=${project.id}${next === 'workspace' ? '&view=' + tab : ''}` : location.pathname);
    currentUrl.current = location.href;
  }
  function select(p: Project) {
    if (protectedWork) return;
    setProject(p); remember(p.id); setScreen('home'); setPrompt(''); setPendingPrompt(''); setModal(null); setProjectMenu(false); setError('');
    history.pushState({}, '', `?project=${p.id}`); currentUrl.current = location.href;
  }
  function switchWorkspaceProject(p: Project) {
    if (protectedWork) return;
    setProject(p); remember(p.id); setProjectMenu(false); setPendingPrompt(''); setError('');
    history.pushState({}, '', `?project=${p.id}&view=${view}`); currentUrl.current = location.href;
  }
  async function create(name: string) {
    setBusy(true); setError('');
    try { const p = await api<Project>('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); setProjects(list => [p, ...list]); select(p); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  function send(e?: FormEvent) {
    e?.preventDefault(); if (!prompt.trim() || !project) return;
    setPendingPrompt(prompt.trim()); setPrompt(''); navigate('workspace', 'chat');
  }
  function chooseProject() { if (!protectedWork) setModal('projects'); else setError('请先完成当前录音或保存操作。'); }
  return <div className="app">
    <header className="header"><button className="brand" onClick={() => navigate('home')} aria-label="体察项目首页"><CirclesThree size={30}/><strong>体察</strong><span>FIELDWORK</span></button>
      {screen === 'workspace' && project && <div className="header-project-wrap" ref={projectMenuRef}><button className="header-project" aria-expanded={projectMenu} onClick={() => { if (protectedWork) { setError('请先完成当前录音或保存操作。'); return; } setProjectMenu(!projectMenu); }}><FolderSimple size={19}/><span>{project.name}</span><CaretDown size={14}/></button>{projectMenu && <div className="header-project-menu"><p>切换项目</p>{projects.map(p => <button key={p.id} onClick={() => switchWorkspaceProject(p)} aria-current={p.id === project.id ? 'true' : undefined}><FolderSimple size={17}/><span>{p.name}</span>{p.id === project.id && <small>当前</small>}</button>)}<button onClick={() => { setProjectMenu(false); chooseProject(); }}><Plus size={17}/>新建或搜索项目</button></div>}</div>}
      <nav><button onClick={chooseProject}>我的项目 <CaretRight size={14}/></button><button onClick={() => setModal('guide')}>使用指南</button><button className="theme-button" aria-label={dark ? '切换浅色模式' : '切换深色模式'} onClick={() => setDark(!dark)}>{dark ? <Sun size={21}/> : <Moon size={21}/>}</button></nav>
    </header>
    {loading ? <main className="loading" role="status">正在打开项目空间…</main> : screen === 'home' ? <main className="home">
      <section className="hero"><RevealBackdrop revealed={revealed}/><div className="hero-content">
        <div className="hero-heading"><div className="wordmark-cn">体察</div><div className="wordmark-en">FIELDWORK</div><TypewriterSubtitle text="以访谈，唤出知识与经验。"/></div>
        {project ? <><div className="current-project"><button onClick={chooseProject} className="project-chip"><FolderSimple size={19}/><span><small>当前项目：</small>{project.name}</span><CaretDown size={15}/></button><button className="switch-project" onClick={chooseProject}>切换项目</button></div>
          <form className="composer" onSubmit={send}><label htmlFor="project-prompt">在这个项目里，你想做什么？</label><textarea ref={input} id="project-prompt" value={prompt} maxLength={12000} onChange={e => setPrompt(e.target.value)} placeholder="继续修改报告，整理新材料，或准备一次访谈……" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/><div className="composer-footer"><span>对话保存在当前项目</span><button className="send" disabled={!prompt.trim()} aria-label="发送消息"><ArrowUp size={24}/></button></div></form>
          <div className="home-actions"><button onClick={() => navigate('workspace', 'record')}><Microphone size={19}/>开始录音</button><button onClick={() => navigate('workspace', 'materials')}><Paperclip size={19}/>上传材料</button><span/><button className="open-workspace" onClick={() => navigate('workspace', 'materials')}>打开工作台 <ArrowRight size={18}/></button></div><p className="project-note">录音、材料与对话将保存到当前项目。</p></>
          : <ProjectPicker projects={projects} busy={busy} onSelect={select} onCreate={create}/>}
      </div><div className="hero-floor"><button onClick={() => setRevealed(!revealed)}><Cursor size={16}/>{revealed ? '恢复光标擦除' : '移动光标，探索底图'}<span>{revealed ? '收起' : '查看'}</span></button><span>问得深入，才能看得清楚。</span></div></section>
    </main> : project && <Workbench key={project.id} project={project} view={view} onView={tab => navigate('workspace', tab)} onProtected={setProtectedWork} onError={setError} initialPrompt={pendingPrompt} onPromptConsumed={() => setPendingPrompt('')}/>}
    <dialog ref={dialog} onCancel={e => { if (busy) e.preventDefault(); else setModal(null); }} onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><div className="dialog-heading"><h2>{modal === 'guide' ? '从项目开始' : '选择项目'}</h2><button aria-label="关闭" disabled={busy} onClick={() => setModal(null)}><X size={21}/></button></div>{modal === 'projects' ? <ProjectPicker projects={projects} busy={busy} onSelect={select} onCreate={create}/> : <div className="guide"><p>先选择或创建项目，之后的录音、文件和对话都属于这个项目。</p><p>下次打开，会自动恢复上次项目。你也可以随时通过项目名称切换。</p><p>本轮完成独立项目首页、录音文件保存、上传及项目对话入口。转写、访谈报告和完整编辑能力将在后续接入。</p></div>}</dialog>
    {error && <div className="error" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}><X size={18}/></button></div>}
  </div>;
}
