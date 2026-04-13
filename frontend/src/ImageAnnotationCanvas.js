import { useRef, useEffect, useCallback, useState } from 'react';

const COLORS = ['#e53e3e', '#f6c90e', '#38a169', '#3182ce', '#805ad5', '#000000'];
const WIDTHS  = [2, 4, 7];

function replayStrokes(ctx, strokes, scale) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    ctx.beginPath();
    ctx.strokeStyle = s.color || '#e53e3e';
    ctx.lineWidth   = (s.width || 3) * scale;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.moveTo(s.points[0].x * scale, s.points[0].y * scale);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x * scale, s.points[i].y * scale);
    }
    ctx.stroke();
  }
}

export default function ImageAnnotationCanvas({
  imageUrl,
  annotations = [],
  readOnly = false,
  onChange,
}) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const imgRef       = useRef(null);
  const drawing      = useRef(false);
  const currentStroke = useRef([]);

  const [strokes, setStrokes]   = useState(annotations || []);
  const [color,   setColor]     = useState(COLORS[0]);
  const [width,   setWidth]     = useState(WIDTHS[1]);
  const [tool,    setTool]      = useState('pen');
  const [scale,   setScale]     = useState(1);

  const strokesRef = useRef(strokes);
  const toolRef    = useRef(tool);
  const colorRef   = useRef(color);
  const widthRef   = useRef(width);
  useEffect(() => { strokesRef.current = strokes;  }, [strokes]);
  useEffect(() => { toolRef.current    = tool;     }, [tool]);
  useEffect(() => { colorRef.current   = color;    }, [color]);
  useEffect(() => { widthRef.current   = width;    }, [width]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    replayStrokes(ctx, strokesRef.current, scale);
  }, [scale]);

  useEffect(() => { redraw(); }, [strokes, scale, redraw]);

  useEffect(() => {
    setStrokes(annotations || []);
  }, [annotations]);

  const fitCanvas = useCallback(() => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !img.naturalWidth) return;
    const w  = img.offsetWidth;
    const h  = img.offsetHeight;
    const sc = w / img.naturalWidth;
    canvas.width  = w;
    canvas.height = h;
    setScale(sc);
  }, []);

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top)  / scale,
    };
  };

  const onPointerDown = (e) => {
    if (readOnly) return;
    e.preventDefault();
    drawing.current    = true;
    currentStroke.current = [getPos(e)];
  };

  const onPointerMove = (e) => {
    if (!drawing.current || readOnly) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.current.push(pos);

    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    if (toolRef.current === 'eraser') {
      replayStrokes(ctx, strokesRef.current, scale);
      return;
    }
    const pts = currentStroke.current;
    ctx.beginPath();
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth   = widthRef.current * scale;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.moveTo(pts[pts.length - 2].x * scale, pts[pts.length - 2].y * scale);
    ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale);
    ctx.stroke();
  };

  const onPointerUp = (e) => {
    if (!drawing.current || readOnly) return;
    drawing.current = false;
    const pts = currentStroke.current;
    currentStroke.current = [];

    if (toolRef.current === 'eraser') {
      // Erase strokes that have any point within 20px radius of last touch
      if (!pts.length) return;
      const last = pts[pts.length - 1];
      const R = 20 / scale;
      const remaining = strokesRef.current.filter(s =>
        !s.points.some(p => {
          const dx = p.x - last.x, dy = p.y - last.y;
          return Math.sqrt(dx * dx + dy * dy) < R;
        }),
      );
      setStrokes(remaining);
      if (onChange) onChange(remaining);
      return;
    }

    if (pts.length < 2) return;
    const newStroke = { points: pts, color: colorRef.current, width: widthRef.current, tool: 'pen' };
    const updated   = [...strokesRef.current, newStroke];
    setStrokes(updated);
    if (onChange) onChange(updated);
  };

  const undo = () => {
    const updated = strokes.slice(0, -1);
    setStrokes(updated);
    if (onChange) onChange(updated);
  };

  const clear = () => {
    setStrokes([]);
    if (onChange) onChange([]);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', userSelect: 'none' }} ref={containerRef}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Ответ"
        style={{ display: 'block', maxWidth: '100%', borderRadius: 8 }}
        onLoad={fitCanvas}
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          cursor: readOnly ? 'default' : (tool === 'eraser' ? 'crosshair' : 'crosshair'),
          touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {!readOnly && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          display: 'flex', flexDirection: 'column', gap: 6,
          background: 'rgba(255,255,255,0.9)', borderRadius: 10,
          padding: '8px 7px', boxShadow: '0 2px 10px rgba(0,0,0,.15)',
        }}>
          {/* Tool */}
          <div style={{ display: 'flex', gap: 4 }}>
            {['pen', 'eraser'].map(t => (
              <button
                key={t}
                onClick={() => setTool(t)}
                title={t === 'pen' ? 'Карандаш' : 'Ластик'}
                style={{
                  width: 28, height: 28, border: 'none', borderRadius: 6, cursor: 'pointer',
                  background: tool === t ? '#4F6EF7' : '#f1f5f9',
                  color: tool === t ? '#fff' : '#64748b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                }}
              >
                {t === 'pen' ? '✏️' : '⌫'}
              </button>
            ))}
          </div>

          {/* Colors */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, maxWidth: 64 }}>
            {COLORS.map(c => (
              <button
                key={c}
                onClick={() => { setColor(c); setTool('pen'); }}
                style={{
                  width: 18, height: 18, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer',
                  boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none',
                }}
              />
            ))}
          </div>

          {/* Widths */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {WIDTHS.map(w => (
              <button
                key={w}
                onClick={() => setWidth(w)}
                style={{
                  width: 28, height: 28, border: 'none', borderRadius: 6,
                  background: width === w ? '#e2e8f0' : 'transparent', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <div style={{ width: w * 2, height: w * 2, borderRadius: '50%', background: color }} />
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={undo}
              disabled={!strokes.length}
              title="Отменить"
              style={{
                flex: 1, height: 26, border: 'none', borderRadius: 6, cursor: 'pointer',
                background: '#f1f5f9', color: '#64748b', fontSize: 11,
                opacity: strokes.length ? 1 : 0.4,
              }}
            >↩</button>
            <button
              onClick={clear}
              disabled={!strokes.length}
              title="Очистить"
              style={{
                flex: 1, height: 26, border: 'none', borderRadius: 6, cursor: 'pointer',
                background: '#fee2e2', color: '#dc2626', fontSize: 10,
                opacity: strokes.length ? 1 : 0.4,
              }}
            >✕</button>
          </div>
        </div>
      )}
    </div>
  );
}
