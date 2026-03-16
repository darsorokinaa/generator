import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useLocation } from "react-router-dom";
import MathContent from "../components/MathContent";
import ImageLightbox from "../components/ImageLightbox";
import SupportInfoModal from "../components/SupportInfoModal";
import ResultsModal from "../components/ResultsModal";
import ReportErrorModal from "../components/ReportErrorModal";

const COLORS = ["#000000", "#ffffff", "#ef4444", "#3b82f6", "#22c55e"];

const SUBJECT_NAMES = {
  math: "математике",
  inf: "информатике",
};

function TaskReportErrorButton({ taskId, taskNumber, onClick }) {
  return (
    <button
      type="button"
      className="task-report-error-btn"
      title="Сообщить об ошибке"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(taskId, taskNumber);
      }}
      aria-label="Сообщить об ошибке"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
      <span className="task-report-error-label">Сообщить об ошибке</span>
    </button>
  );
}

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

  // Lightbox для увеличения изображений
  const [lightbox, setLightbox] = useState({ open: false, src: "" });
  const handleImageClick = useCallback((src) => setLightbox({ open: true, src }), []);
  const mainRef = useRef(null);

  // Справочная информация (items = массив {html})
  const [supportInfo, setSupportInfo] = useState({ items: [], open: false });

  // Результаты (всплывающее окно по кнопке «Завершить»)
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsData, setResultsData] = useState(null);

  // Сообщить об ошибке
  const [reportErrorOpen, setReportErrorOpen] = useState(false);
  const [reportErrorTask, setReportErrorTask] = useState(null);

  // Фильтр по автору (на странице сгенерированного варианта)
  const [authorFilter, setAuthorFilter] = useState("");

  // Время на каждое задание (секунды)
  const taskTimesRef = useRef({});
  const currentTaskIdRef = useRef(null);
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);

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
     Справочная информация
  ========================== */
  useEffect(() => {
    fetch(`/api/${level}/${subject}/support-info/`)
      .then((res) => res.ok ? res.json() : { items: [] })
      .then((data) => setSupportInfo((s) => ({ ...s, items: data.items || [] })))
      .catch(() => setSupportInfo((s) => ({ ...s, items: [] })));
  }, [level, subject]);

  /* =========================
     Таймер
  ========================== */
  useEffect(() => {
    if (timerStatus !== "running") return;
    const id = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [timerStatus]);

  /* Время на каждое задание: каждую секунду добавляем к текущему заданию */
  useEffect(() => {
    if (timerStatus !== "running" || !variant) return;
    const id = setInterval(() => {
      const tid = currentTaskIdRef.current;
      if (tid) {
        taskTimesRef.current[tid] = (taskTimesRef.current[tid] || 0) + 1;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timerStatus, variant]);

  /* Инициализация текущего задания при загрузке варианта */
  useEffect(() => {
    if (!variant?.tasks?.length) return;
    const first = variant.tasks[0];
    if (first && !currentTaskIdRef.current) currentTaskIdRef.current = first.id;
  }, [variant]);

  /* Автозапуск таймера при загрузке варианта — время решения считается с момента открытия */
  useEffect(() => {
    if (variant && timerStatus === "idle") {
      startTimeRef.current = new Date().toISOString();
      setTimerStatus("running");
    }
  }, [variant, timerStatus]);

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
     Лайтбокс: клик по картинке
  ========================== */
  useEffect(() => {
    const handler = (e) => {
      const img = e.target.closest("img");
      if (!img) return;
      const container = img.closest(".task-text, .correct-answer-content, .part2-answer-content, .task-content, .exam-page-container");
      if (!container) return;
      e.preventDefault();
      e.stopPropagation();
      setLightbox({ open: true, src: img.src });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);

  /* =========================
     Canvas + WebSocket
  ========================== */
  useEffect(() => {
    if (!boardOpen) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    canvas.style.touchAction = "none";

    const storageKey = `board_${level}_${subject}_${variant_id}_doc`;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) objectsRef.current = arr;
      }
    } catch (_) {}

    function saveBoard() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(objectsRef.current));
      } catch (_) {}
    }

    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsHost = import.meta.env.DEV ? "localhost:8000" : window.location.host;
    let socket;
    try {
      socket = new WebSocket(protocol + wsHost + "/ws/board/test/");
    } catch (err) {
      console.warn("WebSocket unavailable, board will work offline:", err);
      socket = { readyState: 3, send: () => {}, close: () => {} }; // CLOSED mock
    }
    socketRef.current = socket;
    socket.onerror = () => {}; // Тихо игнорируем (prod на Gunicorn не поддерживает WS)
    socket.onclose = () => {};

    const rectRef = { current: null };
    const geomRef = { current: { w: 1, h: 1, dpr: 1 } };
    const PEN_WIDTH = 3;
    const POINT_STEP = 2;

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewportW = window.innerWidth || document.documentElement.clientWidth;
      const viewportH = window.innerHeight || document.documentElement.clientHeight;

      canvas.width = Math.round(viewportW * dpr);
      canvas.height = Math.max(1, Math.round(viewportH * dpr));
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      geomRef.current = { w: viewportW, h: viewportH, dpr };
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
      const rawX = ((e.clientX ?? e.touches?.[0]?.clientX ?? 0) - rect.left) * sx;
      const rawY = ((e.clientY ?? e.touches?.[0]?.clientY ?? 0) - rect.top) * sy;
      const scrollX = window.scrollX ?? document.documentElement.scrollLeft ?? 0;
      const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;
      return { x: rawX + scrollX, y: rawY + scrollY };
    }

    function drawPath(points, color, width) {
      if (points.length < 1) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      if (points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
      } else {
        for (let i = 1; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const endX = (p1.x + p2.x) / 2;
          const endY = (p1.y + p2.y) / 2;
          ctx.quadraticCurveTo(p1.x, p1.y, endX, endY);
        }
        ctx.quadraticCurveTo(
          points[points.length - 2].x,
          points[points.length - 2].y,
          points[points.length - 1].x,
          points[points.length - 1].y
        );
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
      const scrollX = window.scrollX ?? document.documentElement.scrollLeft ?? 0;
      const scrollY = window.scrollY ?? document.documentElement.scrollTop ?? 0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(-scrollX, -scrollY);

      objectsRef.current.forEach((obj) => {
        if (obj.type === "line") drawPath(obj.points, obj.color, obj.width);
        else drawShape(obj);
      });
      if (currentLineRef.current) drawPath(currentLineRef.current.points, currentLineRef.current.color, currentLineRef.current.width);
      if (currentShapeRef.current) drawShape(currentShapeRef.current);

      ctx.restore();
      saveBoard();
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
            x: last.x + (pos.x - last.x) * t,
            y: last.y + (pos.y - last.y) * t,
          });
        }
      }
      line.points.push({ x: pos.x, y: pos.y });
      redraw();
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
    window.addEventListener("scroll", redraw, { passive: true });

    resizeCanvas();
    const rafId = requestAnimationFrame(() => {
      resizeCanvas();
    });

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", redraw);
      redrawRef.current = null;
      try {
        if (socket && socket.readyState !== 2 && socket.readyState !== 3) socket.close();
      } catch (_) {}
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [boardOpen, level, subject, variant_id]);

  /* =========================
     Проверка ответов
  ========================== */
  // Для математики и информатики: убираем пробелы, нормализуем юникод, без учёта регистра
  function normalize(str) {
    return String(str ?? "")
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "") // zero-width, BOM, soft hyphen
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  // Ответ из API может быть HTML (process_latex) — извлекаем текст для сравнения
  function getTextFromHtml(html) {
    if (!html || typeof html !== "string") return "";
    try {
      const div = document.createElement("div");
      div.innerHTML = html;
      return (div.textContent || div.innerText || "").trim();
    } catch {
      return String(html).replace(/<[^>]+>/g, "");
    }
  }

  function checkTask(taskId, correctAnswer, userValue = null) {
    const raw = userValue !== null ? userValue : userAnswers[taskId] || "";
    const correctText = getTextFromHtml(correctAnswer || "");
    const isCorrect = normalize(raw) === normalize(correctText);
    setCheckedTasks((prev) => ({ ...prev, [taskId]: isCorrect }));
  }

  /** Вычислить правильность ответа без обновления state (для авто-проверки при завершении) */
  function computeTaskCorrectness(task) {
    const useTable = isTableAnswerTask(subject, task.number);
    const userValue = useTable
      ? getTableAnswerForCheck(task.id, INF_TABLE_ROWS, INF_TABLE_COLS)
      : (userAnswers[task.id] || "");
    const correctText = getTextFromHtml(task.answer || "");
    return normalize(userValue) === normalize(correctText);
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

  /** Парсинг эталонного ответа из HTML в матрицу rows×cols (таб/перенос строки). */
  function parseCorrectTableAnswer(correctAnswerHtml, rows, cols) {
    const text = getTextFromHtml(correctAnswerHtml || "");
    const lines = text.split(/\r?\n/);
    const matrix = [];
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || "";
      matrix.push(line.split(/\t/).slice(0, cols).map((s) => s.trim()));
      while (matrix[r].length < cols) matrix[r].push("");
    }
    return matrix;
  }

  /** Информатика, задание 26: 2 ответа в одной строке. Оба верны → 2, один верный → 1, иначе 0. */
  function getInfTask26Score(userMatrix, correctMatrix) {
    const u = (userMatrix[0] || []).map((c) => normalize(c));
    const c = (correctMatrix[0] || []).map((cell) => normalize(cell));
    let match = 0;
    if (u[0] === c[0]) match++;
    if (u[1] === c[1]) match++;
    return match === 2 ? 2 : match === 1 ? 1 : 0;
  }

  /** Информатика, задание 27: 4 числа в двух строках (2 столбца). Обе строки верны → 2, одна строка верна → 1, иначе 0. */
  function getInfTask27Score(userMatrix, correctMatrix) {
    const rowMatch = (r) => {
      const u = (userMatrix[r] || []).map((cell) => normalize(cell));
      const c = (correctMatrix[r] || []).map((cell) => normalize(cell));
      return u[0] === c[0] && u[1] === c[1];
    };
    const r0 = rowMatch(0);
    const r1 = rowMatch(1);
    if (r0 && r1) return 2;
    if (r0 || r1) return 1;
    return 0;
  }

  /** Проверка задания 26 или 27 по информатике: выставляет баллы 0/1/2 и помечает задание проверенным. */
  function checkInfTask26Or27(task, rows, cols) {
    const userMatrix = getTableAnswerString(task.id, rows, cols);
    const correctMatrix = parseCorrectTableAnswer(task.answer, rows, cols);
    const score =
      task.number === 26
        ? getInfTask26Score(userMatrix, correctMatrix)
        : task.number === 27
          ? getInfTask27Score(userMatrix, correctMatrix)
          : 0;
    setScores((prev) => ({ ...prev, [task.id]: score }));
    setCheckedTasks((prev) => ({ ...prev, [task.id]: score > 0 }));
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

  const variantAuthors = [...new Set(variant.tasks.map((t) => (t.author || "").trim()).filter(Boolean))].sort();
  const showAuthorFilter = mode === "test" && variantAuthors.length > 0;
  const tasksFilteredByAuthor =
    showAuthorFilter && authorFilter
      ? variant.tasks.filter((t) => (t.author || "").trim() === authorFilter)
      : variant.tasks;
  const part1Tasks = tasksFilteredByAuthor.filter((t) => t.part === 1);
  const part2Tasks = tasksFilteredByAuthor.filter((t) => t.part === 2);

  // Связанные задания 19–21 — только для ЕГЭ информатика; для математики всё как обычные задания
  const LINKED_19_21 = [19, 20, 21];
  const part2Linked1921 = part2Tasks.filter((t) => LINKED_19_21.includes(t.number));
  const part2Rest = part2Tasks.filter((t) => !LINKED_19_21.includes(t.number));
  const showLinkedGroup = subject === "inf" && part2Linked1921.length === 3;
  // Для математики или если не все три — показываем 19/20/21 как обычные задания
  const part2Regular = showLinkedGroup ? part2Rest : [...part2Linked1921, ...part2Rest].sort((a, b) => a.number - b.number);

  const getTaskMaxScore = (task) => task.max_score ?? 3;
  const part2ScoreSum = part2Tasks.reduce((sum, t) => sum + (scores[t.id] || 0), 0);
  // ЕГЭ информатика: макс. первичный балл 29 (часть 1 + 26 и 27 по 2 балла и др.)
  const maxScore =
    String(subject).toLowerCase() === "inf" && String(level).toLowerCase() === "ege"
      ? 29
      : part1Tasks.length + part2Tasks.reduce((sum, t) => sum + getTaskMaxScore(t), 0);

  /** При завершении: авто-проверка непроверенных заданий части 1, подсчёт эффективных баллов */
  function getEffectiveResults() {
    const effectiveCheckedTasks = {};
    for (const task of part1Tasks) {
      effectiveCheckedTasks[task.id] =
        checkedTasks[task.id] !== undefined ? checkedTasks[task.id] : computeTaskCorrectness(task);
    }
    const correctCount = part1Tasks.filter((t) => effectiveCheckedTasks[t.id]).length;
    const effectiveScores = {};
    for (const task of variant.tasks) {
      if (task.part === 2) {
        effectiveScores[task.id] = scores[task.id] ?? 0;
      } else {
        effectiveScores[task.id] = effectiveCheckedTasks[task.id] ? 1 : 0;
      }
    }
    const totalScore = correctCount + part2ScoreSum;
    // Кол-во верно решённых задач геометрии (subdivision === "geom")
    const geoCorrectCount =
      Array.isArray(variant.tasks)
        ? variant.tasks.filter((t) => t.subdivision === "geom" && (effectiveScores[t.id] || 0) > 0).length
        : 0;
    return { effectiveCheckedTasks, effectiveScores, correctCount, totalScore, geoCorrectCount };
  }

  const { correctCount, totalScore } = getEffectiveResults();

  const handleTaskFocus = (taskId) => {
    currentTaskIdRef.current = taskId;
  };

  const handleReportErrorClick = (taskId, taskNumber) => {
    setReportErrorTask({ taskId, taskNumber });
    setReportErrorOpen(true);
  };

  const handleReportErrorSubmit = async ({ errorType, comment }) => {
    if (!reportErrorTask) return;
    const res = await fetch(`/api/${level}/${subject}/report-error/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        taskId: reportErrorTask.taskId,
        taskNumber: reportErrorTask.taskNumber,
        variantId: variant?.id,
        errorType,
        comment: comment || "",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Ошибка отправки");
    }
  };

  const handleFinish = async () => {
    setTimerStatus("paused");
    endTimeRef.current = new Date().toISOString();
    const totalTimeFormatted = formatTimer(timerSeconds);
    const taskTimes = { ...taskTimesRef.current };
    const {
      effectiveCheckedTasks,
      effectiveScores,
      correctCount: effCorrectCount,
      totalScore: effTotalScore,
      geoCorrectCount,
    } = getEffectiveResults();
    const isOgeMath = String(level).toLowerCase() === "oge" && String(subject).toLowerCase() === "math";
    const geoParam = isOgeMath ? `&geo_correct=${geoCorrectCount}` : "";
    const res = await fetch(
      `/api/${level}/${subject}/score-conversion/?score=${effTotalScore}${geoParam}`,
      { credentials: "same-origin" }
    );
    let scoreExam = null;
    let scoreComment = null;
    let markLevel = null;
    try {
      if (res.ok) {
        const data = await res.json();
        scoreExam = data.score_exam !== undefined ? data.score_exam : null;
        scoreComment = data.comment ?? null;
        markLevel = data.mark_level ?? null;
      }
    } catch (_) {}
    setResultsData({
      totalTimeFormatted,
      taskTimes,
      correctCount: effCorrectCount,
      totalScore: effTotalScore,
      maxScore,
      scoreExam,
      scoreComment,
      markLevel,
      tasks: variant.tasks,
      startTime: startTimeRef.current,
      endTime: endTimeRef.current,
      checkedTasks: effectiveCheckedTasks,
      scores: effectiveScores,
      variantId: variant.id,
      level,
      subject,
    });
    setResultsOpen(true);
  };

  const pdfAuthorParam = showAuthorFilter && authorFilter ? `author=${encodeURIComponent(authorFilter)}` : "";

  const openPdf = async (variantId) => {
    setPdfLoading("default");
    const url = `/api/${level}/${subject}/variant/${variantId}/pdf/${pdfAuthorParam ? `?${pdfAuthorParam}` : ""}`;
    try {
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
      a.href = url;
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
    const url = `/api/${level}/${subject}/variant/${variantId}/pdf/?theme=spring${pdfAuthorParam ? `&${pdfAuthorParam}` : ""}`;
    try {
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
      a.href = url;
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
    <div ref={mainRef} className="main-wrapper exam-page" id="main-wrapper">
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
        {supportInfo.items?.length > 0 && (
          <button
            id="support-info-btn"
            className="exam-fixed-support-btn"
            onClick={() => setSupportInfo((s) => ({ ...s, open: true }))}
            title="Справочная информация"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v6M12 15.5v1" />
            </svg>
            <span>Справочная информация</span>
          </button>
        )}
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

            {showAuthorFilter && (
              <div className="variant-author-bar">
                <label className="variant-author-filter">
                  <span className="variant-author-label">Автор:</span>
                  <select
                    className="variant-author-select"
                    value={authorFilter}
                    onChange={(e) => setAuthorFilter(e.target.value)}
                  >
                    <option value="">Все</option>
                    {variantAuthors.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}

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
                <section key={task.id} className="task" onClick={() => handleTaskFocus(task.id)}>
                  <aside className="task-left">
                    <div className="task-number">{task.number}</div>
                    <div className="task-id">{task.id}</div>
                  </aside>

                  <article className="task-content">
                    <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
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

                            {checkedTasks[task.id] === undefined && (
                              <button
                                className="add-button"
                                style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                onClick={() =>
                                  subject === "inf" && (task.number === 26 || task.number === 27)
                                    ? checkInfTask26Or27(task, rows, cols)
                                    : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rows, cols))
                                }
                              >
                                Проверить
                              </button>
                            )}
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

                            {checkedTasks[task.id] === undefined && (
                              <button
                                className="add-button"
                                style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap", flexShrink: 0 }}
                                onClick={() => checkTask(task.id, task.answer)}
                              >
                                Проверить
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      <div
                        className={`correct-answer-display${
                          checkedTasks[task.id] !== undefined && !checkedTasks[task.id] ? " visible" : ""
                        }`}
                      >
                        <span className="correct-answer-label">Правильный ответ: </span>
                        <MathContent html={task.answer || ""} className="correct-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                      </div>
                    </div>
                    <div className="task-report-error-wrap">
                      <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
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
                        <section key={task.id} className="task task-in-group" onClick={() => handleTaskFocus(task.id)}>
                          <aside className="task-left">
                            <div className="task-number">{task.number}</div>
                            <div className="task-id">{task.id}</div>
                          </aside>

                          <article className="task-content">
                            <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
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

                                    {checkedTasks[task.id] === undefined && (
                                      <button
                                        className="add-button"
                                        style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                        onClick={() =>
                                          subject === "inf" && (task.number === 26 || task.number === 27)
                                            ? checkInfTask26Or27(task, rowsHere, colsHere)
                                            : checkTask(task.id, task.answer, getTableAnswerForCheck(task.id, rowsHere, colsHere))
                                        }
                                      >
                                        Проверить
                                      </button>
                                    )}
                                  </div>

                                  <div
                                    className={`correct-answer-display${
                                      checkedTasks[task.id] !== undefined && !checkedTasks[task.id] ? " visible" : ""
                                    }`}
                                  >
                                    <span className="correct-answer-label">Правильный ответ: </span>
                                    <MathContent html={task.answer || ""} className="correct-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="score-label">Выставьте баллы за решение:</div>
                                  <div className="score-controls">
                                    <button onClick={() => changeScore(task.id, -1, getTaskMaxScore(task))} disabled={(scores[task.id] || 0) <= 0}>
                                      −
                                    </button>
                                    <span className="score-display">{scores[task.id] || 0}</span>
                                    <button onClick={() => changeScore(task.id, 1, getTaskMaxScore(task))} disabled={(scores[task.id] || 0) >= getTaskMaxScore(task)}>
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
                                      <MathContent html={task.answer} className="part2-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="task-report-error-wrap">
                              <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
                            </div>
                          </article>
                        </section>
                      );
                    })}
                  </div>
                )}

                {/* Остальные задания части 2 */}
                {part2Regular.map((task) => (
                  <section key={task.id} className="task" onClick={() => handleTaskFocus(task.id)}>
                    <aside className="task-left">
                      <div className="task-number">{task.number}</div>
                      <div className="task-id">{task.id}</div>
                    </aside>

                    <article className="task-content">
                      <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
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
                          <button onClick={() => changeScore(task.id, -1, getTaskMaxScore(task))} disabled={(scores[task.id] || 0) <= 0}>
                            −
                          </button>
                          <span className="score-display">{scores[task.id] || 0}</span>
                          <button onClick={() => changeScore(task.id, 1, getTaskMaxScore(task))} disabled={(scores[task.id] || 0) >= getTaskMaxScore(task)}>
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
                                <MathContent html={task.answer} className="part2-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <div className="task-report-error-wrap">
                        <TaskReportErrorButton taskId={task.id} taskNumber={task.number} onClick={handleReportErrorClick} />
                      </div>
                    </article>
                  </section>
                ))}
              </>
            )}

            {/* Кнопка Завершить — в конце варианта после всех задач */}
            <div className="exam-finish-section">
              <button
                id="finish-btn"
                className="exam-finish-btn exam-finish-btn-inline"
                onClick={handleFinish}
              >
                Завершить
              </button>
            </div>
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

      {/* ===== ДОСКА (portal в body для полного экрана) ===== */}
      {boardOpen &&
        createPortal(
          <div id="board-container" className="active">
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
                <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
                <path d="M22 21H7" />
                <path d="m5 11 9 9" />
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

            <div className="board-color-palette">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`board-color-btn${color === c && ["pen", "line", "triangle", "circle", "square"].includes(tool) ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    if (tool === "eraser") setTool("pen");
                  }}
                  title={c}
                />
              ))}
            </div>

            <div className="board-divider" />

            <div className="board-undo-redo-group">
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
            </div>

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
        </div>,
          document.body
        )}

      <ImageLightbox
        src={lightbox.src}
        open={lightbox.open}
        onClose={() => setLightbox((s) => ({ ...s, open: false }))}
      />
      <SupportInfoModal
        open={supportInfo.open}
        items={supportInfo.items}
        onClose={() => setSupportInfo((s) => ({ ...s, open: false }))}
      />
      <ResultsModal
        open={resultsOpen}
        onClose={() => setResultsOpen(false)}
        results={resultsData}
      />
      <ReportErrorModal
        open={reportErrorOpen}
        onClose={() => {
          setReportErrorOpen(false);
          setReportErrorTask(null);
        }}
        onSubmit={handleReportErrorSubmit}
        taskNumber={reportErrorTask?.taskNumber}
      />
    </div>
  );
}

export default ExamPage;