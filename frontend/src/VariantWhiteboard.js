/**
 * Доска — прозрачный canvas поверх варианта (как в 01 generator / genu.ru).
 *
 * Canvas: position:fixed, full-viewport, z-index:10001, background:transparent.
 * Координаты хранятся относительно containerRef (корень варианта).
 * При скролле canvas перерисовывается с translate, сдвигая штрихи за содержимым.
 * Тулбар — position:fixed bottom:0, как в 01 generator.
 */
import { useRef, useEffect, useCallback, useState } from 'react';

const COLORS = ['#000000', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#9333ea', '#ffffff'];
const PEN_WIDTH = 3;

function drawStrokes(ctx, strokes) {
  strokes.forEach((s) => {
    if (s.type !== 'path' || !Array.isArray(s.points) || s.points.length < 2) return;
    ctx.strokeStyle = s.color || '#000';
    ctx.lineWidth   = s.width  || PEN_WIDTH;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    const [x0, y0] = s.points[0];
    ctx.moveTo(x0, y0);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i][0], s.points[i][1]);
    }
    ctx.stroke();
  });
}

export default function VariantWhiteboard({
  strokes,
  onStrokesChange,
  open,
  onClose,
  containerRef,   // ref to the scrollable variant root element
}) {
  const canvasRef  = useRef(null);
  const drawing    = useRef(null);
  const geomRef    = useRef({ vw: 1, vh: 1, dpr: 1 });
  const rafRef     = useRef(null);
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(PEN_WIDTH);
  const [erasing, setErasing] = useState(false);

  /* ── coordinate helpers ─────────────────────────────────────── */

  /** Client coords → logical coords relative to containerRef. */
  const boardCoords = useCallback((clientX, clientY) => {
    const root = containerRef?.current;
    if (!root) {
      // fallback: use page coords (works for full-page standalone)
      return [clientX + window.scrollX, clientY + window.scrollY];
    }
    const mr = root.getBoundingClientRect();
    const sw = root.scrollWidth  || mr.width  || 1;
    const sh = root.scrollHeight || mr.height || 1;
    const sx = mr.width  > 0 ? sw / mr.width  : 1;
    const sy = mr.height > 0 ? sh / mr.height : 1;
    return [(clientX - mr.left) * sx, (clientY - mr.top) * sy];
  }, [containerRef]);

  /* ── resize + redraw ─────────────────────────────────────────── */

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { vw, vh, dpr } = geomRef.current;
    const pw = canvas.width;
    const ph = canvas.height;
    if (pw < 1 || ph < 1) return;

    const root = containerRef?.current;
    const mr   = root ? root.getBoundingClientRect() : { left: 0, top: 0 };

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();
    ctx.translate(mr.left, mr.top);
    ctx.beginPath();
    ctx.rect(-mr.left, -mr.top, vw, vh);
    ctx.clip();
    drawStrokes(ctx, strokes);
    ctx.restore();
  }, [strokes, containerRef]);

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; redraw(); });
  }, [redraw]);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw  = Math.max(1, Math.round(window.innerWidth  || 1));
    const vh  = Math.max(1, Math.round(window.innerHeight || 1));
    canvas.width  = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width  = `${vw}px`;
    canvas.style.height = `${vh}px`;
    geomRef.current = { vw, vh, dpr };
    redraw();
  }, [redraw]);

  /* ── mount / scroll / resize observers ──────────────────────── */

  useEffect(() => {
    if (!open) return;
    resizeCanvas();
    const onResize = () => resizeCanvas();
    const onScroll = () => scheduleRedraw();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    // Also observe the container element for internal scrolling
    const root = containerRef?.current;
    if (root) root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      if (root) root.removeEventListener('scroll', onScroll);
    };
  }, [open, resizeCanvas, scheduleRedraw, containerRef]);

  // Redraw whenever strokes change
  useEffect(() => {
    if (open) scheduleRedraw();
  }, [open, strokes, scheduleRedraw]);

  /* ── pointer events ──────────────────────────────────────────── */

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = boardCoords(e.clientX, e.clientY);
    if (erasing) {
      onStrokesChange((prev) => eraseAt(prev, x, y));
      return;
    }
    const path = { type: 'path', color, width, points: [[x, y]] };
    drawing.current = path;
    onStrokesChange((prev) => [...prev, path]);
  };

  const handlePointerMove = (e) => {
    if (!drawing.current && !erasing) return;
    const [x, y] = boardCoords(e.clientX, e.clientY);
    if (erasing) {
      onStrokesChange((prev) => eraseAt(prev, x, y));
      return;
    }
    drawing.current.points.push([x, y]);
    onStrokesChange((prev) => {
      if (!prev.length) return prev;
      const copy = { ...drawing.current, points: [...drawing.current.points] };
      return [...prev.slice(0, -1), copy];
    });
  };

  const handlePointerUp = (e) => {
    try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    drawing.current = null;
  };

  function eraseAt(strokes, x, y) {
    const R = 16;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.type !== 'path') continue;
      const hit = s.points.some(([px, py]) => Math.hypot(px - x, py - y) < R);
      if (hit) {
        const next = [...strokes];
        next.splice(i, 1);
        return next;
      }
    }
    return strokes;
  }

  const clearAll = () => { drawing.current = null; onStrokesChange(() => []); };
  const undo     = () => { drawing.current = null; onStrokesChange((prev) => prev.length ? prev.slice(0, -1) : prev); };

  if (!open) return null;

  const cursorStyle = erasing ? 'cell' : 'crosshair';

  return (
    <>
      {/* Transparent drawing canvas — full viewport, fixed */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10001,
          background: 'transparent',
          touchAction: drawing.current || erasing ? 'none' : 'manipulation',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          cursor: cursorStyle,
          pointerEvents: 'auto',
        }}
      />

      {/* Toolbar — fixed at bottom, like 01 generator */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10002,
          background: '#fff',
          borderTop: '1px solid #f3f4f6',
          boxShadow: '0 -4px 20px rgba(0,0,0,.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '12px 20px',
          fontFamily: 'Montserrat, sans-serif',
          pointerEvents: 'auto',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Pen */}
        <ToolBtn active={!erasing} onClick={() => setErasing(false)} title="Карандаш">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
          </svg>
        </ToolBtn>

        {/* Eraser */}
        <ToolBtn active={erasing} onClick={() => setErasing(true)} title="Ластик">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
            <path d="M22 21H7"/><path d="m5 11 9 9"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* Colors */}
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => { setColor(c); setErasing(false); }}
            style={{
              width: 24, height: 24, borderRadius: 4, padding: 0,
              background: c,
              border: color === c && !erasing ? '2.5px solid #2563eb' : c === '#ffffff' ? '2px solid #e5e7eb' : '2px solid transparent',
              cursor: 'pointer',
              boxShadow: color === c && !erasing ? '0 0 0 2px rgba(37,99,235,.25)' : 'none',
              flexShrink: 0,
              transform: color === c && !erasing ? 'scale(1.1)' : 'scale(1)',
              transition: 'transform .15s, border-color .15s',
            }}
          />
        ))}

        <Divider />

        {/* Stroke width */}
        {[2, 4, 7].map((w) => (
          <button
            key={w}
            type="button"
            title={`Толщина ${w}`}
            onClick={() => { setWidth(w); setErasing(false); }}
            style={{
              width: 36, height: 36, borderRadius: 8, padding: 0,
              border: width === w && !erasing ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
              background: width === w && !erasing ? '#eff6ff' : '#fafafa',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: Math.max(8, w * 3.5),
              height: w,
              borderRadius: w,
              background: color === '#ffffff' ? '#94a3b8' : color,
            }} />
          </button>
        ))}

        <Divider />

        {/* Undo */}
        <ToolBtn onClick={undo} title="Отменить">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10h10a5 5 0 0 1 5 5v2"/>
            <path d="M3 10l4-4M3 10l4 4"/>
          </svg>
        </ToolBtn>

        {/* Clear */}
        <ToolBtn onClick={clearAll} title="Очистить всё" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#dc2626' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
        </ToolBtn>

        <Divider />

        {/* Close */}
        <ToolBtn onClick={onClose} title="Закрыть доску" style={{ background: '#fef2f2', borderColor: '#fecaca', color: '#dc2626' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </ToolBtn>
      </div>
    </>
  );
}

function ToolBtn({ children, onClick, title, active, style }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        width: 40, height: 40, borderRadius: 10, padding: 0,
        border: active ? '1.5px solid #93c5fd' : '1.5px solid #e5e7eb',
        background: active ? '#eff6ff' : '#fafafa',
        color: active ? '#2563eb' : '#4b5563',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        transition: 'background .15s, border-color .15s, color .15s',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: '#e5e7eb', flexShrink: 0, margin: '0 4px' }} />;
}
