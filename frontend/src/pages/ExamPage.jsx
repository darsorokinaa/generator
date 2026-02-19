import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

const COLORS = [
  { value: "#000000", label: "Чёрный" },
  { value: "#2196F3", label: "Синий" },
  { value: "#F44336", label: "Красный" },
];

function isPointOnStroke(px, py, obj, hitRadius = 8) {
  const pts = obj.points;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, ay = pts[i - 1].y;
    const bx = pts[i].x, by = pts[i].y;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      if (Math.hypot(px - ax, py - ay) <= hitRadius) return true;
      continue;
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    const cx = ax + t * dx, cy = ay + t * dy;
    if (Math.hypot(px - cx, py - cy) <= hitRadius) return true;
  }
  return false;
}

function ExamPage() {
  const { level, subject, variant_id } = useParams();

  const [variant, setVariant] = useState(null);
  const [error, setError] = useState(null);

  // Ответы части 1
  const [userAnswers, setUserAnswers] = useState({});   // { taskId: "текст" }
  const [checkedTasks, setCheckedTasks] = useState({}); // { taskId: true/false } — какие проверены

  // Баллы части 2 — { taskId: число }
  const [scores, setScores] = useState({});

  // Доска
  const [boardOpen, setBoardOpen] = useState(false);
  const [tool, setTool] = useState("pen");   // "pen" | "eraser"
  const [color, setColor] = useState("#000000");

  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const objectsRef = useRef([]);
  const currentLineRef = useRef(null);
  const drawingRef = useRef(false);
  const erasingRef = useRef(false);

  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);

  /* =========================
     Загрузка варианта
  ========================== */
  useEffect(() => {
    fetch(`/api/${level}/${subject}/variant/${variant_id}/`)
      .then(res => {
        if (!res.ok) throw new Error("Ошибка загрузки варианта");
        return res.json();
      })
      .then(data => setVariant(data))
      .catch(err => setError(err.message));
  }, [level, subject, variant_id]);

  /* =========================
     MathJax
  ========================== */
  useEffect(() => {
    if (variant && window.MathJax) {
      window.MathJax.typesetPromise();
    }
  }, [variant]);


  /* =========================
     Canvas + WebSocket
  ========================== */
  useEffect(() => {
    if (!boardOpen) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const toolbar = document.getElementById("board-toolbar");

    const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const socket = new WebSocket(protocol + window.location.host + "/ws/board/test/");
    socketRef.current = socket;

    function resizeCanvas() {
      const toolbarHeight = document.getElementById("board-toolbar").offsetHeight;
      const fullHeight = document.documentElement.scrollHeight;

      canvas.width = document.documentElement.scrollWidth;
      canvas.height = fullHeight - toolbarHeight;

      canvas.style.top = toolbarHeight + "px";

      redraw();
    }


    function getPos(e) {
      const rect = canvas.getBoundingClientRect();

      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }



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
      objectsRef.current.forEach(obj => {
        if (obj.type === "line") drawSmoothLine(obj.points, obj.color, obj.width);
      });
      if (currentLineRef.current) {
        drawSmoothLine(currentLineRef.current.points, currentLineRef.current.color, currentLineRef.current.width);
      }
    }

    function eraseAt(x, y) {
      const radius = 8;
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];
        if (obj.type !== "line") continue;
        const hit = obj.points.some(pt => Math.hypot(pt.x - x, pt.y - y) < radius);
        if (hit) {
          objectsRef.current.splice(i, 1);
          socket.send(JSON.stringify({ action: "remove_object", index: i }));
          redraw();
          return;
        }
      }
    }

    function onMouseDown(e) {
      e.preventDefault();
      const pos = getPos(e);
      if (toolRef.current === "eraser") {
        erasingRef.current = true;
        eraseAt(pos.x, pos.y);
        return;
      }
      drawingRef.current = true;
      currentLineRef.current = { type: "line", color: colorRef.current, width: 3, points: [pos] };
      redraw();
    }

    function onMouseMove(e) {
      e.preventDefault();
      const pos = getPos(e);
      if (toolRef.current === "eraser" && erasingRef.current) {
        eraseAt(pos.x, pos.y);
        return;
      }
      if (!drawingRef.current || !currentLineRef.current) return;
      currentLineRef.current.points.push(pos);
      redraw();
    }

    function onMouseUp(e) {
      if (e && e.preventDefault) e.preventDefault();
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

    socket.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.action === "add_object") { objectsRef.current.push(data.object); redraw(); }
      if (data.action === "remove_object") { objectsRef.current.splice(data.index, 1); redraw(); }
      if (data.action === "clear_all") { objectsRef.current = []; redraw(); }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", resizeCanvas);

    resizeCanvas();

    return () => {
      socket.close();
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [boardOpen]);

  /* =========================
     Проверка ответов
  ========================== */
  function normalize(str) {
    return String(str).trim().toLowerCase().replace(/\s+/g, "");
  }

  function checkTask(taskId, correctAnswer) {
    const isCorrect = normalize(userAnswers[taskId] || "") === normalize(correctAnswer || "");
    setCheckedTasks(prev => ({ ...prev, [taskId]: isCorrect }));
  }

  function resetTask(taskId) {
    setUserAnswers(prev => {
      const updated = { ...prev };
      delete updated[taskId];
      return updated;
    });
    setCheckedTasks(prev => {
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
    setScores(prev => {
      const cur = prev[taskId] || 0;
      const next = Math.max(0, Math.min(max, cur + delta));
      return { ...prev, [taskId]: next };
    });
  }

  if (error) return <div style={{ padding: 20 }}>Ошибка: {error}</div>;
  if (!variant) return <div style={{ padding: 20 }}>Загрузка...</div>;

  const part1Tasks = variant.tasks.filter(t => t.part === 1);
  const part2Tasks = variant.tasks.filter(t => t.part === 2);

  const correctCount = Object.values(checkedTasks).filter(Boolean).length;
  const totalScore = correctCount + Object.values(scores).reduce((a, b) => a + b, 0);
  const openPdf = (variantId) => {
    window.open(
      `/api/${level}/${subject}/variant/${variantId}/pdf/`,
      "_blank"
    );
  };
  const openPdfSpring = (variantId) => {
    window.open(
      `/api/${level}/${subject}/variant/${variantId}/pdf/spring`,
      "_blank"
    );
  };
  

  return (
    <div className="main-wrapper" id="main-wrapper">
      <div className="content-area">
        <div className="container">
          <div className="page">

            {/* ===== HEADER ===== */}
            <div className="variant-hero">
              <div className="variant-hero-bg" />
              <div className="variant-hero-content">
                <div className="variant-hero-left">
                  <div className="variant-label">Вариант</div>
                  <div className="variant-number">№ {variant.id}</div>
                  <div className="variant-meta">
                    <span className="variant-meta-item">📝 Часть 1: {part1Tasks.length} заданий</span>
                    <span className="variant-meta-sep">·</span>
                    <span className="variant-meta-item">✍️ Часть 2: {part2Tasks.length} заданий</span>
                  </div>
                </div>
                <div className="variant-hero-right">
                  <div className="variant-score-block">
                    <div className="variant-score-row">
                      <span className="variant-score-label">Правильных</span>
                      <span className="variant-score-val">{correctCount} <span className="variant-score-total">/ {part1Tasks.length}</span></span>
                    </div>
                    <div className="variant-score-divider" />
                    <div className="variant-score-row">
                      <span className="variant-score-label">Всего баллов</span>
                      <span className="variant-score-val accent">{totalScore}</span>
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
            <div className="part-divider">
              <h2>Часть 1</h2>
              <p>Краткий ответ</p>
            </div>

            {part1Tasks.map(task => (
              <section key={task.id} className="task">
                <aside className="task-left">
                  <div className="task-number">{task.number}</div>
                  <div className="task-id">{task.id}</div>
                </aside>
                <article className="task-content">
                  <div
                    className="task-text"
                    dangerouslySetInnerHTML={{ __html: task.text }}
                  />
                  {task.file && (
                    <div className="task-files">
                      <a href={task.file} target="_blank" rel="noreferrer">📎 Скачать файл</a>
                    </div>
                  )}
                  <div className="answer-section">
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="text"
                        className={`answer-input${checkedTasks[task.id] !== undefined
                            ? checkedTasks[task.id] ? " correct" : " incorrect"
                            : ""
                          }`}
                        placeholder="Введите ответ"
                        value={userAnswers[task.id] || ""}
                        disabled={checkedTasks[task.id] !== undefined}
                        onChange={e =>
                          setUserAnswers(prev => ({ ...prev, [task.id]: e.target.value }))
                        }
                        style={{ flex: "1", minWidth: 0 }}
                      />
                      <span className={`answer-status${checkedTasks[task.id] !== undefined
                          ? checkedTasks[task.id] ? " correct" : " incorrect"
                          : ""
                        }`}>
                        {checkedTasks[task.id] !== undefined ? (checkedTasks[task.id] ? "✓" : "✗") : ""}
                      </span>
                      <button
                        className="add-button"
                        style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap", flexShrink: 0 }}
                        onClick={() =>
                          checkedTasks[task.id] !== undefined
                            ? resetTask(task.id)
                            : checkTask(task.id, task.answer)
                        }
                      >
                        {checkedTasks[task.id] !== undefined ? "Сбросить" : "Проверить"}
                      </button>
                    </div>

                    <div className={`correct-answer-display${checkedTasks[task.id] !== undefined && !checkedTasks[task.id] ? " visible" : ""
                      }`}>
                      Правильный ответ: {task.answer}
                    </div>
                  </div>
                </article>
              </section>
            ))}

            {/* ===== ЧАСТЬ 2 ===== */}
            {part2Tasks.length > 0 && (
              <>
                <div className="part-divider">
                  <h2>Часть 2</h2>
                  <p>Развернутый ответ</p>
                </div>

                {part2Tasks.map(task => (
                  <section key={task.id} className="task">
                    <aside className="task-left">
                      <div className="task-number">{task.number}</div>
                      <div className="task-id">{task.id}</div>
                    </aside>
                    <article className="task-content">
                      <div
                        className="task-text"
                        dangerouslySetInnerHTML={{ __html: task.text }}
                      />
                      <div className="answer-section">
                        <div className="score-label">Выставьте баллы за решение:</div>
                        <div className="score-controls">
                          <button
                            onClick={() => changeScore(task.id, -1)}
                            disabled={(scores[task.id] || 0) <= 0}
                          >−</button>
                          <span className="score-display">
                            {scores[task.id] || 0}
                          </span>
                          <button
                            onClick={() => changeScore(task.id, 1)}
                            disabled={(scores[task.id] || 0) >= 3}
                          >+</button>
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
          ✏️ Открыть доску
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
            >✏️</button>

            <button
              id="eraserBtn"
              className={tool === "eraser" ? "active" : ""}
              onClick={() => setTool("eraser")}
            >🧽</button>

            <div className="divider" />

            <div className="color-picker">
              {COLORS.map(c => (
                <div
                  key={c.value}
                  className={`color-btn${color === c.value && tool === "pen" ? " active" : ""}`}
                  style={{ background: c.value }}
                  onClick={() => { setColor(c.value); setTool("pen"); }}
                />
              ))}
            </div>

            <div className="divider" />

            <button id="clear-board-btn" onClick={clearBoard}>🗑️</button>

            <button id="close-board-btn" onClick={() => setBoardOpen(false)}>✕</button>
          </div>

          <canvas
            ref={canvasRef}
            id="board"
            style={{ cursor: tool === "eraser" ? "pointer" : "crosshair" }}
          />
        </div>
      )}
    </div>
  );
}

export default ExamPage;