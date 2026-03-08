import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import MathContent from "../components/MathContent";

const COLORS = [
  { value: "#000000", label: "Чёрный" },
  { value: "#2196F3", label: "Синий" },
  { value: "#F44336", label: "Красный" },
];

const SUBJECT_NAMES = {
  math: "математике",
  inf: "информатике",
};

const LEVEL_NAMES = {
  ege: "ЕГЭ",
  oge: "ОГЭ",
};

function ExamPage() {
  const { level, subject, variant_id } = useParams();
  const location = useLocation();
  const mode = location.state?.mode || "variant";
  const subjectLabel = location.state?.subjectName || SUBJECT_NAMES[subject] || subject;
  const levelLabel = LEVEL_NAMES[level] || level.toUpperCase();
  const testTaskLabels = location.state?.testTaskLabels || [];

  const [variant, setVariant] = useState(null);
  const [error, setError] = useState(null);

  // Ответы части 1
  const [userAnswers, setUserAnswers] = useState({}); // { taskId: "текст" }
  const [checkedTasks, setCheckedTasks] = useState({}); // { taskId: true/false } — какие проверены

  // Баллы части 2 — { taskId: число }
  const [scores, setScores] = useState({});

  // Показанные ответы части 2 — { taskId: true }
  const [visibleAnswers, setVisibleAnswers] = useState({});

  // Доска
  const [boardOpen, setBoardOpen] = useState(false);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser" | "line" | "triangle" | "circle" | "square"
  const [color, setColor] = useState("#000000");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Таймер варианта
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState("idle"); // "idle" | "running" | "paused"

  // Загрузка PDF
  const [pdfLoading, setPdfLoading] = useState(null); // null | "default" | "spring"

  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const objectsRef = useRef([]);
  const redoStackRef = useRef([]);
  const redrawRef = useRef(null);
  const currentLineRef = useRef(null);
  const currentShapeRef = useRef(null);
  const drawingRef = useRef(false);
  const erasingRef = useRef(false);

  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  /* =========================
     Загрузка варианта
  ========================== */
  useEffect(() => {
    fetch(`/api/${level}/${subject}/variant/${variant_id}/`)
      .then((res) => {
        if (!res.ok) throw new Error("Ошибка загрузки варианта");
        return res.json();
      })
      .then((data) => setVariant(data))
      .catch((err) => setError(err.message));
  }, [level, subject, variant_id]);

  /* =========================
     Таймер
  ========================== */
  useEffect(() => {
    if (timerStatus !== "running") return;
    const id = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerStatus]);

  function formatTimer(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /* =========================
     MathJax
  ========================== */
  useEffect(() => {
    if (!variant) return;
    let cancelled = false;
    const tryTypeset = () => {
      if (cancelled) return;
      if (window.MathJax?.typesetPromise) {
        try { window.MathJax.typesetPromise(); } catch (_) {}
      } else {
        setTimeout(tryTypeset, 100);
      }
    };
    const delay = variant ? 50 : 0;
    const timer = setTimeout(tryTypeset, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [variant, boardOpen]);

  /* =========================
     Canvas + WebSocket
  ========================== */
  useEffect(() => {
    if (!boardOpen) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    canvas.style.touchAction = "none";

    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsHost = import.meta.env.DEV ? "localhost:8000" : window.location.host;
    const socket = new WebSocket(protocol + wsHost + "/ws/board/test/");
    socketRef.current = socket;

    const rectRef = { current: null };
    const geomRef = { current: { w: 1, h: 1, dpr: 1 } };
    const PEN_WIDTH = 3;
    const POINT_STEP = 6;

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewportW = document.documentElement.clientWidth || window.innerWidth;
      const scrollH = document.documentElement.scrollHeight;
      const canvasH = Math.min(scrollH, 15000);

      const container = document.getElementById("board-container");
      if (container) container.style.height = scrollH + "px";

      canvas.width = Math.round(viewportW * dpr);
      canvas.height = Math.max(1, Math.round(canvasH * dpr));
      canvas.style.top = "0";
      canvas.style.width = "100%";
      canvas.style.height = canvasH + "px";

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      geomRef.current = { w: viewportW, h: canvasH, dpr };
      rectRef.current = null;
      redraw();
    }

    function getPos(e) {
      let rect = rectRef.current;
      if (!rect) {
        rect = canvas.getBoundingClientRect();
        rectRef.current = rect;
      }
      const { w, h } = geomRef.current;
      const sx = rect.width > 0 ? w / rect.width : 1;
      const sy = rect.height > 0 ? h / rect.height : 1;
      return {
        x: Math.round(((e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left) * sx),
        y: Math.round(((e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top) * sy),
      };
    }

    function drawPath(points, color, width) {
      if (points.length < 1) return;
      if (points.length === 1) {
        const s = Math.max(1, width);
        ctx.fillStyle = color;
        ctx.fillRect(points[0].x - (s >> 1), points[0].y - (s >> 1), s, s);
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    function drawShape(obj) {
      const w = obj.width || PEN_WIDTH;
      ctx.strokeStyle = obj.color;
      ctx.lineWidth = w;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";

      if (obj.type === "segment" && obj.points?.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(obj.points[0].x, obj.points[0].y);
        ctx.lineTo(obj.points[1].x, obj.points[1].y);
        ctx.stroke();
      } else if (obj.type === "triangle" && obj.points?.length === 3) {
        ctx.beginPath();
        ctx.moveTo(obj.points[0].x, obj.points[0].y);
        ctx.lineTo(obj.points[1].x, obj.points[1].y);
        ctx.lineTo(obj.points[2].x, obj.points[2].y);
        ctx.closePath();
        ctx.stroke();
      } else if (obj.type === "circle") {
        ctx.beginPath();
        ctx.arc(obj.center.x, obj.center.y, obj.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (obj.type === "rect" && obj.points?.length === 2) {
        const [a, b] = obj.points;
        ctx.strokeRect(
          Math.round(Math.min(a.x, b.x)),
          Math.round(Math.min(a.y, b.y)),
          Math.round(Math.abs(b.x - a.x)),
          Math.round(Math.abs(b.y - a.y))
        );
      }
    }

    function redraw() {
      const { w, h, dpr } = geomRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      objectsRef.current.forEach((obj) => {
        if (obj.type === "line") drawPath(obj.points, obj.color, obj.width);
        else drawShape(obj);
      });
      if (currentLineRef.current) drawPath(currentLineRef.current.points, currentLineRef.current.color, currentLineRef.current.width);
      if (currentShapeRef.current) drawShape(currentShapeRef.current);
    }
    redrawRef.current = redraw;

    function hitTest(obj, x, y, r) {
      if (obj.type === "line") {
        return obj.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) < r);
      }
      if (obj.type === "segment" && obj.points?.length >= 2) {
        const [a, b] = obj.points;
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
        const px = a.x + t * dx, py = a.y + t * dy;
        return Math.hypot(x - px, y - py) < r;
      }
      if (obj.type === "circle") {
        return Math.hypot(x - obj.center.x, y - obj.center.y) < obj.radius + r;
      }
      if (obj.type === "rect" && obj.points?.length >= 2) {
        const [a, b] = obj.points;
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
        return x >= minX - r && x <= maxX + r && y >= minY - r && y <= maxY + r;
      }
      if (obj.type === "triangle" && obj.points?.length >= 3) {
        return obj.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) < r);
      }
      return false;
    }

    function eraseAt(x, y) {
      const radius = 12;
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        if (hitTest(objectsRef.current[i], x, y, radius)) {
          objectsRef.current.splice(i, 1);
          socket.send(JSON.stringify({ action: "remove_object", index: i }));
          setCanUndo(objectsRef.current.length > 0);
          redraw();
          return;
        }
      }
    }

    function onPointerDown(e) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      rectRef.current = canvas.getBoundingClientRect();
      const pos = getPos(e);
      const t = toolRef.current;

      if (t === "eraser") {
        erasingRef.current = true;
        eraseAt(pos.x, pos.y);
        return;
      }

      if (t === "line" || t === "triangle" || t === "circle" || t === "square") {
        drawingRef.current = true;
        currentShapeRef.current = {
          type: t === "line" ? "segment" : t === "square" ? "rect" : t,
          color: colorRef.current,
          width: PEN_WIDTH,
          points: t === "circle" ? [] : [{ x: pos.x, y: pos.y }],
          ...(t === "circle" && { center: { x: pos.x, y: pos.y }, radius: 0 }),
        };
        redraw();
        return;
      }

      drawingRef.current = true;
      currentLineRef.current = {
        type: "line",
        color: colorRef.current,
        width: PEN_WIDTH,
        points: [{ x: pos.x, y: pos.y }],
      };
      redraw();
    }

    function onPointerMove(e) {
      e.preventDefault();
      const pos = getPos(e);

      if (toolRef.current === "eraser" && erasingRef.current) {
        eraseAt(pos.x, pos.y);
        return;
      }

      if (drawingRef.current && currentShapeRef.current) {
        const shape = currentShapeRef.current;
        if (shape.type === "segment" && shape.points.length >= 1) {
          shape.points[1] = { x: pos.x, y: pos.y };
        } else if (shape.type === "rect" && shape.points.length >= 1) {
          shape.points[1] = { x: pos.x, y: pos.y };
        } else if (shape.type === "circle") {
          shape.radius = Math.hypot(pos.x - shape.center.x, pos.y - shape.center.y);
        } else if (shape.type === "triangle" && shape.points.length >= 1) {
          const [p1] = shape.points;
          const p2 = { x: pos.x, y: pos.y };
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          shape.points = [p1, p2, { x: (p1.x + p2.x) / 2 - dy, y: (p1.y + p2.y) / 2 + dx }];
        }
        redraw();
        return;
      }

      if (!drawingRef.current || !currentLineRef.current) return;

      const line = currentLineRef.current;
      const last = line.points[line.points.length - 1];
      const dist = Math.hypot(pos.x - last.x, pos.y - last.y);

      if (dist >= POINT_STEP) {
        const n = Math.ceil(dist / POINT_STEP);
        for (let i = 1; i < n; i++) {
          const t = i / n;
          line.points.push({
            x: Math.round(last.x + (pos.x - last.x) * t),
            y: Math.round(last.y + (pos.y - last.y) * t),
          });
        }
      }
      line.points.push({ x: pos.x, y: pos.y });

      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function onPointerUp(e) {
      if (e && e.preventDefault) e.preventDefault();
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}

      if (drawingRef.current && currentShapeRef.current) {
        const shape = currentShapeRef.current;
        const valid =
          (shape.type === "segment" && shape.points.length >= 2) ||
          (shape.type === "triangle" && shape.points.length >= 3) ||
          (shape.type === "circle" && shape.radius > 2) ||
          (shape.type === "rect" && shape.points.length >= 2);
        if (valid) {
          redoStackRef.current = [];
          setCanRedo(false);
          objectsRef.current.push(shape);
          setCanUndo(true);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: "add_object", object: shape }));
          }
        }
        currentShapeRef.current = null;
      } else if (drawingRef.current && currentLineRef.current) {
        redoStackRef.current = [];
        setCanRedo(false);
        objectsRef.current.push(currentLineRef.current);
        setCanUndo(true);
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ action: "add_object", object: currentLineRef.current }));
        }
        currentLineRef.current = null;
      }

      drawingRef.current = false;
      erasingRef.current = false;
      redraw();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") setBoardOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (redoStackRef.current.length > 0) {
            const obj = redoStackRef.current.pop();
            objectsRef.current.push(obj);
            redraw();
            setCanUndo(true);
            setCanRedo(redoStackRef.current.length > 0);
          }
        } else {
          if (objectsRef.current.length > 0) {
            const obj = objectsRef.current.pop();
            redoStackRef.current.push(obj);
            redraw();
            setCanUndo(objectsRef.current.length > 0);
            setCanRedo(true);
          }
        }
      }
    }

    socket.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.action === "add_object") {
        objectsRef.current.push(data.object);
        redraw();
      }
      if (data.action === "remove_object") {
        objectsRef.current.splice(data.index, 1);
        redraw();
      }
      if (data.action === "clear_all") {
        objectsRef.current = [];
        redraw();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp, { passive: false });
    canvas.addEventListener("pointercancel", onPointerUp, { passive: false });
    canvas.addEventListener("pointerleave", onPointerUp, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", resizeCanvas);

    resizeCanvas();

    return () => {
      redrawRef.current = null;
      socket.close();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [boardOpen]);

  /* =========================
     Проверка ответов
  ========================== */
  // Для математики и информатики: убираем пробелы при сравнении
  function normalize(str) {
    return String(str ?? "").trim().replace(/\s+/g, "");
  }

  function checkTask(taskId, correctAnswer, userValue = null) {
    const raw = userValue !== null ? userValue : userAnswers[taskId] || "";
    const isCorrect = normalize(raw) === normalize(correctAnswer || "");
    setCheckedTasks((prev) => ({ ...prev, [taskId]: isCorrect }));
  }

  // Задания по информатике с таблицей ответов (18, 20, 25, 26, 27): 2 столбца, 7 строк
  const INF_TABLE_TASK_NUMBERS = [18, 20, 25, 26, 27];
  const INF_TABLE_ROWS = 7;
  const INF_TABLE_COLS = 2;

  function isTableAnswerTask(subj, num) {
    return subj === "inf" && INF_TABLE_TASK_NUMBERS.includes(num);
  }

  function getTableAnswerString(taskId, rows, cols) {
    const raw = userAnswers[taskId] || "";
    const lines = raw.split(/\r?\n/);
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || "";
      matrix.push(line.split(/\t/).slice(0, cols));
      while (matrix[r].length < cols) matrix[r].push("");
    }
    return matrix;
  }

  function setTableCell(taskId, row, col, value, rows, cols) {
    const matrix = getTableAnswerString(taskId, rows, cols);
    matrix[row][col] = value;
    const str = matrix.map((rowArr) => rowArr.join("\t")).join("\n");
    setUserAnswers((prev) => ({ ...prev, [taskId]: str }));
  }

  function getTableAnswerForCheck(taskId, rows, cols) {
    const matrix = getTableAnswerString(taskId, rows, cols);
    return matrix.map((rowArr) => rowArr.join("\t")).join("\n");
  }

  function resetTask(taskId) {
    setUserAnswers((prev) => {
      const updated = { ...prev };
      delete updated[taskId];
      return updated;
    });
    setCheckedTasks((prev) => {
      const updated = { ...prev };
      delete updated[taskId];
      return updated;
    });
  }

  function togglePart2Answer(taskId) {
    setVisibleAnswers((p) => ({ ...p, [taskId]: !p[taskId] }));
  }

  function resetAllAnswers() {
    setUserAnswers({});
    setCheckedTasks({});
    setScores({});
    setVisibleAnswers({});
  }

  function undoBoard() {
    if (objectsRef.current.length === 0) return;
    const obj = objectsRef.current.pop();
    redoStackRef.current.push(obj);
    redrawRef.current?.();
    setCanUndo(objectsRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }

  function redoBoard() {
    if (redoStackRef.current.length === 0) return;
    const obj = redoStackRef.current.pop();
    objectsRef.current.push(obj);
    redrawRef.current?.();
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }

  function clearBoard() {
    if (!window.confirm("Очистить всю доску?")) return;
    objectsRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "clear_all" }));
    }
  }

  function changeScore(taskId, delta, max = 3) {
    setScores((prev) => {
      const cur = prev[taskId] || 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [taskId]: next };
    });
  }

  if (error) return <div style={{ padding: 20 }}>Ошибка: {error}</div>;
  if (!variant) return <div style={{ padding: 20 }}>Загрузка...</div>;

  const part1Tasks = variant.tasks.filter((t) => t.part === 1);
  const part2Tasks = variant.tasks.filter((t) => t.part === 2);

  // Связанные задания 19–21 — только для ЕГЭ информатика; для математики всё как обычные задания
  const LINKED_19_21 = [19, 20, 21];
  const part2Linked1921 = part2Tasks.filter((t) => LINKED_19_21.includes(t.number));
  const part2Rest = part2Tasks.filter((t) => !LINKED_19_21.includes(t.number));
  const showLinkedGroup = subject === "inf" && part2Linked1921.length === 3;
  // Для математики или если не все три — показываем 19/20/21 как обычные задания
  const part2Regular = showLinkedGroup ? part2Rest : [...part2Linked1921, ...part2Rest].sort((a, b) => a.number - b.number);

  const correctCount = Object.values(checkedTasks).filter(Boolean).length;
  const part2ScoreSum = part2Tasks.reduce((sum, t) => sum + (scores[t.id] || 0), 0);
  const totalScore = correctCount + part2ScoreSum;
  const maxScore = part1Tasks.length + part2Tasks.length * 3;

  const openPdf = async (variantId) => {
    setPdfLoading("default");
    try {
      const url = `/api/${level}/${subject}/variant/${variantId}/pdf/`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Ошибка загрузки PDF");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `variant-${variantId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err) {
      const a = document.createElement("a");
      a.href = `/api/${level}/${subject}/variant/${variantId}/pdf/`;
      a.download = `variant-${variantId}.pdf`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setPdfLoading(null);
    }
  };

  const openPdfSpring = async (variantId) => {
    setPdfLoading("spring");
    try {
      const url = `/api/${level}/${subject}/variant/${variantId}/pdf/?theme=spring`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Ошибка загрузки PDF");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `variant-${variantId}-spring.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (err) {
      const a = document.createElement("a");
      a.href = `/api/${level}/${subject}/variant/${variantId}/pdf/?theme=spring`;
      a.download = `variant-${variantId}-spring.pdf`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setPdfLoading(null);
    }
  };

  return (
    <div className="main-wrapper exam-page" id="main-wrapper">
      {/* Фиксированный блок: таймер и баллы — остаётся в углу при прокрутке */}
      <div className="exam-fixed-corner">
        <div className="variant-timer exam-fixed-timer">
          <div className="variant-timer-display">{formatTimer(timerSeconds)}</div>
          <div className="variant-timer-actions">
            {(timerStatus === "idle" || timerStatus === "paused") && (
              <button
                type="button"
                className="variant-timer-btn variant-timer-btn-start"
                onClick={() => setTimerStatus("running")}
                title="Старт"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
            )}
            {timerStatus === "running" && (
              <button
                type="button"
                className="variant-timer-btn variant-timer-btn-pause"
                onClick={() => setTimerStatus("paused")}
                title="Пауза"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="variant-timer-btn variant-timer-btn-stop"
              onClick={() => { setTimerStatus("idle"); setTimerSeconds(0); }}
              title="Стоп"
              disabled={timerStatus === "idle" && timerSeconds === 0}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="variant-score-block">
          <div className="variant-score-row">
            <span className="variant-score-label">
              {part2Tasks.length > 0 ? "Баллов" : "Правильных"}
            </span>
            <span className="variant-score-val">
              {totalScore} <span className="variant-score-total">/ {maxScore}</span>
            </span>
          </div>
        </div>
      </div>
      {pdfLoading && (
        <div className="pdf-loading-overlay" role="status" aria-live="polite">
          <div className="pdf-loading-toast">
            <span className="pdf-loading-spinner" aria-hidden="true" />
            <span>Подождите немного, файл создаётся…</span>
          </div>
        </div>
      )}
      <div className="content-area">
        <div className="container exam-page-container">
          <div className="page">
            {/* ===== HEADER ===== */}
            <div className="variant-hero">
              <div className="variant-hero-bg" />
              <div className="variant-hero-content">
                <div className="variant-hero-left">
                  <div className="variant-label">
                    {mode === "test" ? `Тестирование по ${subjectLabel} ${levelLabel}` : `${subjectLabel} ${levelLabel}`}
                  </div>
                  <div className="variant-number">
                    {mode === "test" ? (() => {
                      const labels = testTaskLabels.length > 0
                        ? testTaskLabels
                        : [...new Set(variant.tasks.map((t) => t.number).filter(Boolean))].sort((a, b) => a - b).map(String);
                      if (labels.length === 0) return `№ ${variant.id}`;
                      if (labels.length === 1) return `Задание ${labels[0]}`;
                      return `Задания ${labels.join(", ")}`;
                    })() : mode === "part1" ? `Вариант № ${variant.id} / Часть 1`
                      : mode === "part2" ? `Вариант № ${variant.id} / Часть 2`
                      : `Вариант № ${variant.id}`}
                  </div>
                </div>

                <div className="variant-hero-right">
                  <div className="variant-hero-actions">
                    <button className="variant-btn-danger" onClick={resetAllAnswers}>
                      ↺ Сбросить всё
                    </button>
                    <button
                      className="variant-btn-primary"
                      onClick={() => openPdf(variant.id)}
                      disabled={!!pdfLoading}
                    >
                      ⬇ Скачать PDF
                    </button>
                    <button
                      className="variant-btn-spring"
                      onClick={() => openPdfSpring(variant.id)}
                      disabled={!!pdfLoading}
                    >
                      🌸 Весенний вариант
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ===== ЧАСТЬ 1 ===== */}
            {part1Tasks.length > 0 && (
              <>
                <div className="part-divider part-divider-1">
                  <h2>Часть 1</h2>
                  <p>Краткий ответ</p>
                </div>

                {part1Tasks.map((task) => {
              const useTable = isTableAnswerTask(subject, task.number);
              const rows = useTable ? INF_TABLE_ROWS : 0;
              const cols = useTable ? INF_TABLE_COLS : 0;

              return (
                <section key={task.id} className="task">
                  <aside className="task-left">
                    <div className="task-number">{task.number}</div>
                    <div className="task-id">{task.id}</div>
                  </aside>

                  <article className="task-content">
                    <MathContent html={task.text} className="task-text" />
                    {task.author && <div className="task-author">{task.author}</div>}

                    {task.file && (
                      <div className="task-files">
                        <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                          <span className="task-file-icon">📎</span>
                          <span className="task-file-label">Скачать файл</span>
                        </a>
                      </div>
                    )}

                    <div className="answer-section">
                      {useTable && rows > 0 && cols > 0 ? (
                        <>
                          <div className="answer-table-wrap">
                            <table className="answer-table">
                              <tbody>
                                {Array.from({ length: rows }, (_, r) => (
                                  <tr key={r}>
                                    {Array.from({ length: cols }, (_, c) => (
                                      <td key={c}>
                                        <input
                                          type="text"
                                          className={`answer-input answer-table-input${
                                            checkedTasks[task.id] !== undefined
                                              ? checkedTasks[task.id]
                                                ? " correct"
                                                : " incorrect"
                                              : ""
                                          }`}
                                          placeholder=""
                                          value={getTableAnswerString(task.id, rows, cols)[r][c] || ""}
                                          disabled={checkedTasks[task.id] !== undefined}
                                          onChange={(e) =>
                                            setTableCell(
                                              task.id,
                                              r,
                                              c,
                                              e.target.value.replace(/\t/g, " "),
                                              rows,
                                              cols
                                            )
                                          }
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="answer-actions">
                            <span
                              className={`answer-status${
                                checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                            >
                              {checkedTasks[task.id] !== undefined ? (checkedTasks[task.id] ? "✓" : "✗") : ""}
                            </span>

                            <button
                              className="add-button"
                              style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                              onClick={() =>
                                checkedTasks[task.id] !== undefined
                                  ? resetTask(task.id)
                                  : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rows, cols))
                              }
                            >
                              {checkedTasks[task.id] !== undefined ? "Сбросить" : "Проверить"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="answer-input-row" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <input
                              type="text"
                              className={`answer-input${
                                checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                              placeholder="Введите ответ"
                              value={userAnswers[task.id] || ""}
                              disabled={checkedTasks[task.id] !== undefined}
                              onChange={(e) => setUserAnswers((prev) => ({ ...prev, [task.id]: e.target.value }))}
                              style={{ flex: "1", minWidth: 0 }}
                            />

                            <span
                              className={`answer-status${
                                checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                            >
                              {checkedTasks[task.id] !== undefined ? (checkedTasks[task.id] ? "✓" : "✗") : ""}
                            </span>

                            <button
                              className="add-button"
                              style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap", flexShrink: 0 }}
                              onClick={() =>
                                checkedTasks[task.id] !== undefined ? resetTask(task.id) : checkTask(task.id, task.answer)
                              }
                            >
                              {checkedTasks[task.id] !== undefined ? "Сбросить" : "Проверить"}
                            </button>
                          </div>
                        </>
                      )}

                      <div
                        className={`correct-answer-display${
                          checkedTasks[task.id] !== undefined && !checkedTasks[task.id] ? " visible" : ""
                        }`}
                      >
                        <span className="correct-answer-label">Правильный ответ: </span>
                        <MathContent html={task.answer || ""} className="correct-answer-content" />
                      </div>
                    </div>
                  </article>
                </section>
              );
            })}
              </>
            )}

            {/* ===== ЧАСТЬ 2 ===== */}
            {part2Tasks.length > 0 && (
              <>
                <div className="part-divider part-divider-2">
                  <h2>Часть 2</h2>
                  <p>Развернутый ответ</p>
                </div>

                {/* Связанные задания 19–21 — один общий блок */}
                {showLinkedGroup && (
                  <div className="task-group task-group-19-21">
                    <h3 className="task-group-title">Задания 19–21</h3>
                    <p className="task-group-desc">Общий сценарий, три задания по одному условию.</p>

                    {part2Linked1921.map((task) => {
                      const useTableHere = isTableAnswerTask(subject, task.number);
                      const rowsHere = useTableHere ? INF_TABLE_ROWS : 0;
                      const colsHere = useTableHere ? INF_TABLE_COLS : 0;

                      return (
                        <section key={task.id} className="task task-in-group">
                          <aside className="task-left">
                            <div className="task-number">{task.number}</div>
                            <div className="task-id">{task.id}</div>
                          </aside>

                          <article className="task-content">
                            <MathContent html={task.text} className="task-text" />
                            {task.author && <div className="task-author">{task.author}</div>}

                            {task.file && (
                              <div className="task-files">
                                <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                                  <span className="task-file-icon">📎</span>
                                  <span className="task-file-label">Скачать файл</span>
                                </a>
                              </div>
                            )}

                            <div className="answer-section">
                              {useTableHere && rowsHere > 0 && colsHere > 0 ? (
                                <>
                                  <div className="answer-table-wrap">
                                    <table className="answer-table">
                                      <tbody>
                                        {Array.from({ length: rowsHere }, (_, r) => (
                                          <tr key={r}>
                                            {Array.from({ length: colsHere }, (_, c) => (
                                              <td key={c}>
                                                <input
                                                  type="text"
                                                  className={`answer-input answer-table-input${
                                                    checkedTasks[task.id] !== undefined
                                                      ? checkedTasks[task.id]
                                                        ? " correct"
                                                        : " incorrect"
                                                      : ""
                                                  }`}
                                                  placeholder=""
                                                  value={getTableAnswerString(task.id, rowsHere, colsHere)[r][c] || ""}
                                                  disabled={checkedTasks[task.id] !== undefined}
                                                  onChange={(e) =>
                                                    setTableCell(
                                                      task.id,
                                                      r,
                                                      c,
                                                      e.target.value.replace(/\t/g, " "),
                                                      rowsHere,
                                                      colsHere
                                                    )
                                                  }
                                                />
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>

                                  <div className="answer-actions">
                                    <span
                                      className={`answer-status${
                                        checkedTasks[task.id] !== undefined
                                          ? checkedTasks[task.id]
                                            ? " correct"
                                            : " incorrect"
                                          : ""
                                      }`}
                                    >
                                      {checkedTasks[task.id] !== undefined ? (checkedTasks[task.id] ? "✓" : "✗") : ""}
                                    </span>

                                    <button
                                      className="add-button"
                                      style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                      onClick={() =>
                                        checkedTasks[task.id] !== undefined
                                          ? resetTask(task.id)
                                          : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rowsHere, colsHere))
                                      }
                                    >
                                      {checkedTasks[task.id] !== undefined ? "Сбросить" : "Проверить"}
                                    </button>
                                  </div>

                                  <div
                                    className={`correct-answer-display${
                                      checkedTasks[task.id] !== undefined && !checkedTasks[task.id] ? " visible" : ""
                                    }`}
                                  >
                                    <span className="correct-answer-label">Правильный ответ: </span>
                                    <MathContent html={task.answer || ""} className="correct-answer-content" />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="score-label">Выставьте баллы за решение:</div>
                                  <div className="score-controls">
                                    <button onClick={() => changeScore(task.id, -1)} disabled={(scores[task.id] || 0) <= 0}>
                                      −
                                    </button>
                                    <span className="score-display">{scores[task.id] || 0}</span>
                                    <button onClick={() => changeScore(task.id, 1)} disabled={(scores[task.id] || 0) >= 3}>
                                      +
                                    </button>
                                  </div>
                                </>
                              )}

                              {task.answer != null && task.answer !== "" && (
                                <>
                                  <button
                                    type="button"
                                    className="add-button"
                                    style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                    onClick={() => togglePart2Answer(task.id)}
                                  >
                                    {visibleAnswers[task.id] ? "Скрыть ответ" : "Ответ"}
                                  </button>
                                  {visibleAnswers[task.id] && (
                                    <div className="part2-answer-reveal">
                                      <span className="part2-answer-label">Правильный ответ:</span>
                                      <MathContent html={task.answer} className="part2-answer-content" />
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </article>
                        </section>
                      );
                    })}
                  </div>
                )}

                {/* Остальные задания части 2 */}
                {part2Regular.map((task) => (
                  <section key={task.id} className="task">
                    <aside className="task-left">
                      <div className="task-number">{task.number}</div>
                      <div className="task-id">{task.id}</div>
                    </aside>

                    <article className="task-content">
                      <MathContent html={task.text} className="task-text" />
                      {task.author && <div className="task-author">{task.author}</div>}

                      {task.file && (
                        <div className="task-files">
                          <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                            <span className="task-file-icon">📎</span>
                            <span className="task-file-label">Скачать файл</span>
                          </a>
                        </div>
                      )}

                      <div className="answer-section">
                        <div className="score-label">Выставьте баллы за решение:</div>
                        <div className="score-controls">
                          <button onClick={() => changeScore(task.id, -1)} disabled={(scores[task.id] || 0) <= 0}>
                            −
                          </button>
                          <span className="score-display">{scores[task.id] || 0}</span>
                          <button onClick={() => changeScore(task.id, 1)} disabled={(scores[task.id] || 0) >= 3}>
                            +
                          </button>
                        </div>

                        {task.answer != null && task.answer !== "" && (
                          <>
                            <button
                              type="button"
                              className="add-button"
                              style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                              onClick={() => togglePart2Answer(task.id)}
                            >
                              {visibleAnswers[task.id] ? "Скрыть ответ" : "Ответ"}
                            </button>
                            {visibleAnswers[task.id] && (
                              <div className="part2-answer-reveal">
                                <span className="part2-answer-label">Правильный ответ:</span>
                                <MathContent html={task.answer} className="part2-answer-content" />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== КНОПКА ДОСКИ ===== */}
      <button id="open-board-btn" onClick={() => setBoardOpen(true)} style={{ display: boardOpen ? "none" : undefined }}>
          <svg
            className="board-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
          </svg>
          <span>Открыть доску</span>
        </button>

      {/* ===== ДОСКА ===== */}
      <div id="board-container" className={boardOpen ? "active" : ""}>
          <div id="board-toolbar">
            <button
              id="penBtn"
              className={tool === "pen" ? "active" : ""}
              onClick={() => setTool("pen")}
              title="Карандаш"
            >
              <svg
                className="board-toolbar-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              </svg>
            </button>

            <button
              id="eraserBtn"
              className={tool === "eraser" ? "active" : ""}
              onClick={() => setTool("eraser")}
              title="Ластик"
            >
              {/* НОРМАЛЬНАЯ ИКОНКА ЛАСТИКА (24x24 outline) */}
              <svg
                className="board-toolbar-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 20H11" />
                <path d="M5.5 13.5 14 5a2.8 2.8 0 0 1 4 4l-8.5 8.5" />
                <path d="M7.5 21 3 16.5a2 2 0 0 1 0-2.8l4.2-4.2 6.8 6.8-4.2 4.2a2 2 0 0 1-2.8 0Z" />
              </svg>
            </button>

            <button
              className={tool === "line" ? "active" : ""}
              onClick={() => setTool("line")}
              title="Линия"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="19" x2="19" y2="5" />
              </svg>
            </button>

            <button
              className={tool === "triangle" ? "active" : ""}
              onClick={() => setTool("triangle")}
              title="Треугольник"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 22h20L12 2z" />
              </svg>
            </button>

            <button
              className={tool === "circle" ? "active" : ""}
              onClick={() => setTool("circle")}
              title="Круг"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
              </svg>
            </button>

            <button
              className={tool === "square" ? "active" : ""}
              onClick={() => setTool("square")}
              title="Квадрат"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="1" />
              </svg>
            </button>

            <div className="board-divider" />

            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`board-color-btn${color === c.value && ["pen", "line", "triangle", "circle", "square"].includes(tool) ? " active" : ""}`}
                  style={{ background: c.value }}
                  onClick={() => {
                    setColor(c.value);
                    if (tool === "eraser") setTool("pen");
                  }}
                  title={c.label}
                />
              ))}
            </div>

            <div className="board-divider" />

            <button
              onClick={undoBoard}
              disabled={!canUndo}
              title="Отменить (Ctrl+Z)"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 10h10a5 5 0 0 1 5 5v2" />
                <path d="M3 10l4-4" />
                <path d="M3 10l4 4" />
              </svg>
            </button>

            <button
              onClick={redoBoard}
              disabled={!canRedo}
              title="Вернуть (Ctrl+Shift+Z)"
            >
              <svg className="board-toolbar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 10h-10a5 5 0 0 0-5 5v2" />
                <path d="M21 10l-4-4" />
                <path d="M21 10l-4 4" />
              </svg>
            </button>

            <div className="board-divider" />

            <button id="clear-board-btn" onClick={clearBoard} title="Очистить">
              <svg
                className="board-toolbar-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>

            <button id="close-board-btn" onClick={() => setBoardOpen(false)} title="Закрыть">
              <svg
                className="board-toolbar-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <canvas ref={canvasRef} id="board" style={{ cursor: tool === "eraser" ? "pointer" : "crosshair" }} />
        </div>
    </div>
  );
}

export default ExamPage;