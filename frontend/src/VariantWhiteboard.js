import { useRef, useEffect, useCallback, useState } from 'react';

const DEFAULT_COLOR = '#1e293b';
const DEFAULT_WIDTH = 2.5;

function drawStrokes(ctx, strokes, w, h) {
  ctx.fillStyle = '#ffffff';
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
      const [x, y] = s.points[i];
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
}

/** onStrokesChange — как setState: (prev => next) или новый массив */
export default function VariantWhiteboard({ strokes, onStrokesChange, open, onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const drawing = useRef(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(320, Math.floor(rect.width));
    const ch = Math.max(280, Math.floor(rect.height * 0.55));
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, cw, ch);
  }, [strokes]);

  useEffect(() => {
    if (!open) return;
    redraw();
    const ro = new ResizeObserver(() => redraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [open, redraw]);

  const clientToCanvas = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const r = canvas.getBoundingClientRect();
    const cssW = r.width;
    const cssH = r.height;
    const x = ((clientX - r.left) / cssW) * (canvas.width / (window.devicePixelRatio || 1));
    const y = ((clientY - r.top) / cssH) * (canvas.height / (window.devicePixelRatio || 1));
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
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    drawing.current = null;
  };

  const clearAll = () => {
    drawing.current = null;
    onStrokesChange(() => []);
  };

  const undo = () => {
    drawing.current = null;
    onStrokesChange((prev) => (prev.length ? prev.slice(0, -1) : prev));
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2400,
        background: 'rgba(15,23,42,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backdropFilter: 'blur(3px)',
      }}
      role="presentation"
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(0,0,0,.2)',
          padding: 16,
          fontFamily: 'Montserrat, sans-serif',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Доска к варианту</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            Закрыть
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Цвет</span>
          {['#1e293b', '#dc2626', '#2563eb', '#16a34a', '#ca8a04'].map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                border: color === c ? '2px solid #0f172a' : '2px solid #e2e8f0',
                background: c,
                cursor: 'pointer',
              }}
            />
          ))}
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginLeft: 8 }}>Толщина</span>
          {[1.5, 2.5, 4].map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWidth(w)}
              style={{
                padding: '4px 10px',
                borderRadius: 8,
                border: width === w ? '2px solid #4F6EF7' : '1px solid #e2e8f0',
                background: width === w ? '#eef2ff' : '#fff',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {w}
            </button>
          ))}
          <button type="button" onClick={undo} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Шаг назад
          </button>
          <button type="button" onClick={clearAll} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            Очистить
          </button>
        </div>
        <div ref={wrapRef} style={{ width: '100%' }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            style={{ display: 'block', borderRadius: 10, border: '1px solid #e2e8f0', touchAction: 'none', cursor: 'crosshair', maxWidth: '100%' }}
          />
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
          Рисунок сохраняется автоматически при паузе. Доска общая для ученика и учителя по этому назначению.
        </p>
      </div>
    </div>
  );
}
