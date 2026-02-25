import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const COLORS = [
  { value: "#000000", label: "Чёрный" },
  { value: "#2196F3", label: "Синий" },
  { value: "#F44336", label: "Красный" },
];

function ExamPage() {
  const { level, subject, variant_id } = useParams();

  const [variant, setVariant] = useState(null);
  const [error, setError] = useState(null);

  // Ответы части 1
  const [userAnswers, setUserAnswers] = useState({}); // { taskId: "текст" }
  const [checkedTasks, setCheckedTasks] = useState({}); // { taskId: true/false } — какие проверены

  // Баллы части 2 — { taskId: число }
  const [scores, setScores] = useState({});

  // Доска
  const [boardOpen, setBoardOpen] = useState(false);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser"
  const [color, setColor] = useState("#000000");

  // Таймер варианта
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState("idle"); // "idle" | "running" | "paused"

  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const objectsRef = useRef([]);
  const currentLineRef = useRef(null);
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
    if (variant && window.MathJax) {
      window.MathJax.typesetPromise();
    }
  }, [variant, boardOpen, userAnswers, checkedTasks, scores]);

  /* =========================
     Canvas + WebSocket
  ========================== */
  useEffect(() => {
    if (!boardOpen) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });

    // предотвращаем скролл/зум на тач-устройствах во время рисования
    canvas.style.touchAction = "none";

    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsHost = import.meta.env.DEV ? "localhost:8000" : window.location.host;
    const socket = new WebSocket(protocol + wsHost + "/ws/board/test/");
    socketRef.current = socket;

    // кешируем rect/scale — не дергаем getBoundingClientRect на каждый move
    const rectRef = { current: null };
    const scaleRef = { current: { x: 1, y: 1 } };

    const MAX_CANVAS_HEIGHT = 15000;

    function resizeCanvas() {
      const toolbar = document.getElementById("board-toolbar");
      const toolbarHeight = toolbar ? toolbar.offsetHeight : 56;

      const scrollW = document.documentElement.scrollWidth;
      const scrollH = document.documentElement.scrollHeight;
      const canvasH = Math.min(scrollH, MAX_CANVAS_HEIGHT);

      const container = document.getElementById("board-container");
      if (container) container.style.height = scrollH + "px";

      canvas.width = scrollW;
      canvas.height = Math.max(1, canvasH);
      canvas.style.top = "0";
      canvas.style.width = scrollW + "px";
      canvas.style.height = canvasH + "px";

      rectRef.current = canvas.getBoundingClientRect();
      const rect = rectRef.current;
      scaleRef.current = {
        x: rect.width ? canvas.width / rect.width : 1,
        y: rect.height ? canvas.height / rect.height : 1,
      };

      redraw();
    }

    function getPos(e) {
      const rect = rectRef.current || canvas.getBoundingClientRect();
      if (!rectRef.current) {
        rectRef.current = rect;
        scaleRef.current = {
          x: rect.width ? canvas.width / rect.width : 1,
          y: rect.height ? canvas.height / rect.height : 1,
        };
      }

      const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;

      const sx = scaleRef.current.x;
      const sy = scaleRef.current.y;

      return {
        x: (clientX - rect.left) * sx,
        y: (clientY - rect.top) * sy,
      };
    }

    const PEN_WIDTH = 3;

    function drawSmoothLine(points, color, width) {
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
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.stroke();
    }

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      objectsRef.current.forEach((obj) => {
        if (obj.type === "line") drawSmoothLine(obj.points, obj.color, obj.width);
      });
      if (currentLineRef.current) {
        drawSmoothLine(
          currentLineRef.current.points,
          currentLineRef.current.color,
          currentLineRef.current.width
        );
      }
    }

    function eraseAt(x, y) {
      const radius = 8;
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];
        if (obj.type !== "line") continue;
        const hit = obj.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) < radius);
        if (hit) {
          objectsRef.current.splice(i, 1);
          socket.send(JSON.stringify({ action: "remove_object", index: i }));
          redraw();
          return;
        }
      }
    }

    function onPointerDown(e) {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      // на старте жеста обновим геометрию
      rectRef.current = canvas.getBoundingClientRect();
      scaleRef.current = {
        x: rectRef.current.width ? canvas.width / rectRef.current.width : 1,
        y: rectRef.current.height ? canvas.height / rectRef.current.height : 1,
      };

      const pos = getPos(e);

      if (toolRef.current === "eraser") {
        erasingRef.current = true;
        eraseAt(pos.x, pos.y);
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

      if (!drawingRef.current || !currentLineRef.current) return;

      const line = currentLineRef.current;
      const last = line.points[line.points.length - 1];
      const dist = Math.hypot(pos.x - last.x, pos.y - last.y);

      // меньше точек => меньше нагрузки => меньше отставание
      const step = 10;

      if (dist > step) {
        const n = Math.ceil(dist / step);
        for (let i = 1; i < n; i++) {
          const t = i / n;
          line.points.push({
            x: last.x + (pos.x - last.x) * t,
            y: last.y + (pos.y - last.y) * t,
          });
        }
      }

      line.points.push({ x: pos.x, y: pos.y });

      // быстрый рендер текущего сегмента
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
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

      if (drawingRef.current && currentLineRef.current) {
        objectsRef.current.push(currentLineRef.current);
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
        objectsRef.current = objectsRef.current.slice(0, -1);
        redraw();
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

  function resetAllAnswers() {
    setUserAnswers({});
    setCheckedTasks({});
    setScores({});
  }

  function clearBoard() {
    if (!window.confirm("Очистить всю доску?")) return;
    objectsRef.current = [];
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

  // Связанные задания 19–21 (ЕГЭ информатика): один блок с подзаголовком
  const LINKED_19_21 = [19, 20, 21];
  const part2Linked1921 = part2Tasks.filter((t) => LINKED_19_21.includes(t.number));
  const part2Rest = part2Tasks.filter((t) => !LINKED_19_21.includes(t.number));
  const showLinkedGroup = part2Linked1921.length === 3;

  const correctCount = Object.values(checkedTasks).filter(Boolean).length;

  const openPdf = (variantId) => {
    window.open(`/api/${level}/${subject}/variant/${variantId}/pdf/`, "_blank");
  };

  const openPdfSpring = (variantId) => {
    window.open(`/api/${level}/${subject}/variant/${variantId}/pdf/?theme=spring`, "_blank");
  };

  return (
    <div className="main-wrapper exam-page" id="main-wrapper">
      <div className="content-area">
        <div className="container exam-page-container">
          <div className="page">
            {/* ===== HEADER ===== */}
            <div className="variant-hero">
              <div className="variant-hero-bg" />
              <div className="variant-hero-content">
                <div className="variant-hero-left">
                  <div className="variant-label">Вариант</div>
                  <div className="variant-number">№ {variant.id}</div>
                </div>

                <div className="variant-timer">
                  <div className="variant-timer-display">{formatTimer(timerSeconds)}</div>
                  <div className="variant-timer-actions">
                    {(timerStatus === "idle" || timerStatus === "paused") && (
                      <button
                        type="button"
                        className="variant-timer-btn variant-timer-btn-start"
                        onClick={() => setTimerStatus("running")}
                        title="Старт"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
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
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      </button>
                    )}

                    <button
                      type="button"
                      className="variant-timer-btn variant-timer-btn-stop"
                      onClick={() => {
                        setTimerStatus("idle");
                        setTimerSeconds(0);
                      }}
                      title="Стоп"
                      disabled={timerStatus === "idle" && timerSeconds === 0}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="6" y="6" width="12" height="12" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="variant-hero-right">
                  <div className="variant-score-block">
                    <div className="variant-score-row">
                      <span className="variant-score-label">Правильных</span>
                      <span className="variant-score-val">
                        {correctCount} <span className="variant-score-total">/ {part1Tasks.length}</span>
                      </span>
                    </div>
                  </div>

                  <div className="variant-hero-actions">
                    <button className="variant-btn-danger" onClick={resetAllAnswers}>
                      ↺ Сбросить всё
                    </button>
                    <button className="variant-btn-primary" onClick={() => openPdf(variant.id)}>
                      ⬇ Скачать PDF
                    </button>
                    <button className="variant-btn-spring" onClick={() => openPdfSpring(variant.id)}>
                      🌸 Весенний вариант
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ===== ЧАСТЬ 1 ===== */}
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
                    <div className="task-text" dangerouslySetInnerHTML={{ __html: task.text }} />

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
                        Правильный ответ: {task.answer}
                      </div>
                    </div>
                  </article>
                </section>
              );
            })}

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
                            <div className="task-text" dangerouslySetInnerHTML={{ __html: task.text }} />

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
                                    Правильный ответ: {task.answer}
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
                            </div>
                          </article>
                        </section>
                      );
                    })}
                  </div>
                )}

                {/* Остальные задания части 2 */}
                {part2Rest.map((task) => (
                  <section key={task.id} className="task">
                    <aside className="task-left">
                      <div className="task-number">{task.number}</div>
                      <div className="task-id">{task.id}</div>
                    </aside>

                    <article className="task-content">
                      <div className="task-text" dangerouslySetInnerHTML={{ __html: task.text }} />

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
      {!boardOpen && (
        <button id="open-board-btn" onClick={() => setBoardOpen(true)}>
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
      )}

      {/* ===== ДОСКА ===== */}
      {boardOpen && (
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

            <div className="board-divider" />

            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`board-color-btn${color === c.value && tool === "pen" ? " active" : ""}`}
                  style={{ background: c.value }}
                  onClick={() => {
                    setColor(c.value);
                    setTool("pen");
                  }}
                  title={c.label}
                />
              ))}
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
        </div>
      )}
    </div>
  );
}

export default ExamPage;