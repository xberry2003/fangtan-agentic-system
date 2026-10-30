import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { ArrowsOutCardinal, CirclesThree, X } from '@phosphor-icons/react';
import './FloatingAssistant.css';

type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Layout = { orb: Point; panel: Rect };
const storageKey = 'ticha:assistant-layout:v2';
const margin = 8;
const orbSize = 42;
const dockBottom = 12;
const dockGap = 10;
function constrain(layout: Layout, docked = false): Layout {
  const width = Math.min(Math.max(350, layout.panel.width), window.innerWidth - margin * 2);
  const panelBottom = window.innerHeight - dockBottom - orbSize - dockGap;
  const height = Math.min(Math.max(380, layout.panel.height), docked ? panelBottom - margin : window.innerHeight - margin * 2);
  const bound = (value: number, max: number) => Math.max(margin, Math.min(value, max - margin));
  if (docked) {
    const x = bound(layout.orb.x, window.innerWidth - orbSize);
    return { orb: { x, y: window.innerHeight - dockBottom - orbSize }, panel: { width, height, x: bound(x + orbSize / 2 - width / 2, window.innerWidth - width), y: panelBottom - height } };
  }
  return {
    orb: { x: bound(layout.orb.x, window.innerWidth - orbSize), y: bound(layout.orb.y, window.innerHeight - orbSize) },
    panel: { width, height, x: bound(layout.panel.x, window.innerWidth - width), y: bound(layout.panel.y, window.innerHeight - height) },
  };
}
function initialLayout(): Layout {
  const fallback: Layout = {
    orb: { x: window.innerWidth - 72, y: window.innerHeight - 66 },
    panel: { x: window.innerWidth - 460, y: window.innerHeight - 746, width: 430, height: 650 },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && [saved.orb?.x, saved.orb?.y, saved.panel?.x, saved.panel?.y, saved.panel?.width, saved.panel?.height].every(Number.isFinite)) return constrain(saved);
  } catch { /* Layout preferences must not prevent opening the assistant. */ }
  return constrain(fallback);
}

export function FloatingAssistant({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const [layout, setLayout] = useState(() => constrain(initialLayout(), open));
  const [interacting, setInteracting] = useState(false);
  const orb = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ pointer: number; start: Point; layout: Layout; kind: string; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    const fit = () => setLayout(current => constrain(current, open));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);
  useEffect(() => { if (!interacting) try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch {} }, [layout, interacting]);
  function close() { onOpenChange(false); orb.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { onOpenChange(false); orb.current?.focus(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onOpenChange]);
  function start(event: PointerEvent<HTMLElement>, kind: string) {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, layout, kind, moved: false };
    suppressClick.current = false;
    setInteracting(true);
    event.preventDefault();
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true;
    const base = current.layout;
    let next: Layout;
    if (current.kind === 'orb') next = { ...base, orb: { x: base.orb.x + dx, y: base.orb.y + dy } };
    else if (current.kind === 'panel' && open) next = { ...base, orb: { ...base.orb, x: base.orb.x + dx } };
    else if (current.kind === 'panel') next = { ...base, panel: { ...base.panel, x: base.panel.x + dx, y: base.panel.y + dy } };
    else {
      const p = base.panel, kind = current.kind;
      const widthChange = kind.includes('e') ? dx : kind.includes('w') ? -dx : 0;
      const heightChange = kind.includes('n') ? -dy : kind.includes('s') ? dy : 0;
      next = { ...base, panel: { ...p, width: p.width + widthChange * 2, height: p.height + heightChange } };
    }
    setLayout(constrain(next, open));
  }
  function finish(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    suppressClick.current = current.moved;
    gesture.current = null;
    setInteracting(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const pointerEvents = { onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish };
  const style = { left: layout.panel.x, top: layout.panel.y, width: layout.panel.width, height: layout.panel.height, '--assistant-height': `${layout.panel.height}px` } as CSSProperties;
  return <>
    <aside id="studio-assistant-panel" className={`studio-assistant floating-assistant ${interacting ? 'is-adjusting' : ''}`} style={style} aria-label="体察助手对话" hidden={!open} inert={!open}>
      <button className="assistant-drag-handle" title="左右拖动对话窗，悬浮球随窗口移动" aria-label="移动对话窗" onPointerDown={event => start(event, 'panel')} {...pointerEvents} onKeyDown={event => {
        const delta = event.shiftKey ? 40 : 10;
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        setLayout(current => constrain({ ...current, orb: { ...current.orb, x: current.orb.x + (event.key === 'ArrowRight' ? delta : -delta) } }, open));
      }}><ArrowsOutCardinal size={17}/></button>
      <button className="assistant-close" aria-label="收起体察助手" onClick={close}><X size={19}/></button>
      {children}
      {['n','e','s','w','ne','nw','se','sw'].map(edge => <div key={edge} className={`assistant-resize-edge edge-${edge}`} onPointerDown={event => start(event, edge)} {...pointerEvents} aria-hidden="true"/>)}
      <button className="assistant-size-handle" title="拖动调整窗口大小；方向键微调" aria-label="调整对话窗大小" onPointerDown={event => start(event, 'se')} {...pointerEvents} onKeyDown={event => {
        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        setLayout(current => constrain({ ...current, panel: { ...current.panel, width: current.panel.width + (event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0), height: current.panel.height + (event.key === 'ArrowDown' ? 20 : event.key === 'ArrowUp' ? -20 : 0) } }, open));
      }}/>
    </aside>
    <button ref={orb} className={`assistant-orb movable-orb ${open ? 'is-open' : ''}`} style={{ left: layout.orb.x, top: layout.orb.y }} onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-ticha-materials')){event.preventDefault();onOpenChange(true)}}} title="点击打开助手，拖动可移动" aria-label={open ? '收起体察助手，可拖动' : '打开体察助手，可拖动'} aria-expanded={open} aria-controls="studio-assistant-panel" onPointerDown={event => start(event, 'orb')} {...pointerEvents} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpenChange(!open); }}>{open ? <X size={18}/> : <CirclesThree size={22}/>}</button>
  </>;
}
