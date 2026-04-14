import { useRef, useEffect, useCallback, useState } from 'react';

const DEFAULT_COLOR = '#1e293b';
const DEFAULT_WIDTH = 2.5;

function drawStrokes(ctx, strokes, w, h) {
  ctx.fillStyle = '#fffdf7';
  ctx.fillRect(0, 0, w, h);
  strokes.forEach((s) => {
    if (s.type !== 'path' || !Array.isArray(s.points) || s.points.length < 2) return;
    ctx.strokeStyle = s.color || DEFAULT_COLOR;
    ctx.lineWidth = s.width || DEFAULT_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0, y0);
    for (let i = 1; i < s.points.length; i += 1) {
      const [xi, yi] = s.points[i];
      ctx.lineTo(xi, yi);
    }
    ctx.stroke();
  });
}

/**
 * Плавающая панель-доска поверх вариантa.
 * Появляется справа в виде прилипшей панели.
 */
export default function VariantWhiteboard({ strokes, onStrokesChange, open, onClose }) {
  const canvasRef = useRef(null);
  const panelRef  = useRef(null);
  const drawing   = useRef(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [panelH, setPanelH] = useState(480);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const panel  = panelRef.current;
    if (!canvas || !panel) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(260, Math.floor(panel.offsetWidth - 32));
    const ch = Math.max(200, panelH - 148);
    canvas.width  = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width  = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, cw, ch);
  }, [strokes, panelH]);

  useEffect(() => {
    if (!open) return;
    redraw();
    const ro = new ResizeObserver(() => redraw());
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, [open, redraw]);

  const clientToCanvas = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const r   = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = ((clientX - r.left) / r.width)  * (canvas.width  / dpr);
    const y = ((clientY - r.top)  / r.height) * (canvas.height / dpr);
    return [x, y];
  };

  const onPointerDown = (e) => {
    if (!canvasRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = clientToCanvas(e.clientX, e.clientY);
    const path = { type: 'path', color, width, points: [[x, y]] };
    drawing.current = path;
    onStrokesChange((prev) => [...prev, path]);
  };

  const onPointerMove = (e) => {
    if (!drawing.current) return;
    const [x, y] = clientToCanvas(e.clientX, e.clientY);
    drawing.current.points.push([x, y]);
    onStrokesChange((prev) => {
      if (!prev.length) return prev;
      const copy = { ...drawing.current, points: [...drawing.current.points] };
      return [...prev.slice(0, -1), copy];
    });
  };

  const onPointerUp = (e) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    drawing.current = null;
  };

  const clearAll = () => { drawing.current = null; onStrokesChange(() => []); };
  const undo     = () => { drawing.current = null; onStrokesChange((prev) => prev.length ? prev.slice(0, -1) : prev); };

  const COLORS = ['#1e293b', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea'];

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: 80,
        right: open ? 0 : -400,
        width: 'min(360px, 100vw)',
        height: panelH,
        zIndex: 2200,
        background: '#fff',
        borderRadius: '16px 0 0 16px',
        boxShadow: '-4px 4px 32px rgba(0,0,0,.18)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'right .25s cubic-bezier(.4,0,.2,1)',
        fontFamily: 'Montserrat, sans-serif',
        overflow: 'hidden',
        border: '1px solid #e2e8f0',
        borderRight: 'none',
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 8px',
        borderBottom: '1px solid #f1f5f9',
        background: '#fefce8',
        flexShrink: 0,
        gap: 8,
      }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: '#713f12', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          Доска
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* resize height */}
          <button type="button" onClick={() => setPanelH((h) => Math.max(320, h - 80))} style={iconBtn} title="Уменьшить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/></svg>
          </button>
          <button type="button" onClick={() => setPanelH((h) => Math.min(820, h + 80))} style={iconBtn} title="Увеличить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button type="button" onClick={onClose} style={{ ...iconBtn, marginLeft: 4 }} title="Свернуть">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        padding: '8px 12px',
        borderBottom: '1px solid #f1f5f9',
        flexShrink: 0,
        background: '#fafafa',
      }}>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setColor(c)}
            style={{
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer',
              background: c,
              border: color === c ? '2.5px solid #0f172a' : '2px solid transparent',
              outline: color === c ? '1.5px solid #fff' : 'none',
              outlineOffset: '-3px',
            }}
          />
        ))}
        <div style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 2px' }} />
        {[1.5, 2.5, 5].map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWidth(w)}
            style={{
              width: 28, height: 22, borderRadius: 6,
              border: width === w ? '2px solid #4F6EF7' : '1px solid #e2e8f0',
              background: width === w ? '#eef2ff' : '#fff',
              cursor: 'pointer', fontSize: 10, fontWeight: 700, color: '#1e293b',
            }}
          >
            {w}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={undo} style={toolBtn} title="Отмена">↩</button>
        <button type="button" onClick={clearAll} style={{ ...toolBtn, color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}>✕</button>
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, padding: '8px 12px 12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{
            display: 'block',
            borderRadius: 10,
            border: '1.5px solid #e2e8f0',
            touchAction: 'none',
            cursor: 'crosshair',
            width: '100%',
            flex: 1,
            background: '#fffdf7',
          }}
        />
        <p style={{ margin: '6px 0 0', fontSize: 10, color: '#94a3b8', lineHeight: 1.4 }}>
          Автосохранение при паузе · Доска общая для ученика и учителя
        </p>
      </div>
    </div>
  );
}

const iconBtn = {
  width: 26, height: 26, borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#fff',
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
  color: '#475569',
};

const toolBtn = {
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 700,
  color: '#475569',
};
