import { useRef, type PointerEvent } from 'react';

/** Resize upward so the send controls remain anchored to the panel bottom. */
export function ComposerResizeHandle({ height, onChange }: { height: number; onChange: (height: number) => void }) {
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  function finish(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <button type="button" className="composer-resize-handle" aria-label="调整发送栏高度，向上拉高或向下缩小" title="上下拖动调整发送栏高度" onPointerDown={event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag.current = { id: event.pointerId, y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }} onPointerMove={event => {
    const current = drag.current;
    if (current?.id === event.pointerId) onChange(current.height + current.y - event.clientY);
  }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onKeyDown={event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    onChange(height + (event.key === 'ArrowUp' ? 16 : -16));
  }}><span/></button>;
}
