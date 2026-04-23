import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import MathContent from "../components/MathContent";
import ImageLightbox from "../components/ImageLightbox";
import SupportInfoModal from "../components/SupportInfoModal";
import ResultsModal from "../components/ResultsModal";
import ReportErrorModal from "../components/ReportErrorModal";
import {
  SubjectExamCountdownProvider,
  SubjectExamCountdownCard,
} from "../components/SubjectExamCountdowns";
import { readPersistedTheme } from "../utils/themeStorage";
import {
  parseHomeworkFromSearchForExam,
  getLkPublicBase,
  fetchHomeworkAssignment,
  pickHomeworkFields,
  homeworkResultToUiState,
  buildHomeworkResultPayload,
  saveHomeworkDraft,
  submitHomework,
  homeworkApiUserMessage,
  homeworkTaskNumberEditable,
  homeworkIsReadonly,
  homeworkShowSolutions,
} from "../utils/cabinetHomework";

const COLORS = ["#000000", "#ffffff", "#ef4444", "#3b82f6", "#22c55e"];

const SUBJECT_NAMES = {
  inf: "информатике",
  history: "истории",
};

/** Подпись для шапки «Тестирование по …»: профиль/база только ЕГЭ, ОГЭ — просто «математике». */
function examPageSubjectLabel(level, subjectKey) {
  const lv = String(level || "").toLowerCase();
  const sub = String(subjectKey || "").toLowerCase();
  if (sub === "math") return lv === "ege" ? "профильной математике" : "математике";
  if (sub === "math_base") return lv === "ege" ? "базовой математике" : "математике";
  return SUBJECT_NAMES[subjectKey] || subjectKey;
}

function isMathLikeSubject(subject) {
  const s = String(subject || "").toLowerCase();
  return s === "math" || s === "math_base";
}

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

/** Урок в iframe: ученик прикрепляет изображение решения (часть 2). */
function LessonSolutionUpload({ taskNumber, taskId, lessonToken, enabled }) {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sentPreviews, setSentPreviews] = useState([]);
  
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);

  if (!enabled || !lessonToken) return null;

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Выберите изображение");
      return;
    }
    setErr(null);
    setPendingFile(file);
    setPendingPreview(URL.createObjectURL(file));
  };

  const onCancel = (e) => {
    e.stopPropagation();
    setPendingFile(null);
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    setPendingPreview(null);
    setErr(null);
  };

  const onSend = async (e) => {
    e.stopPropagation();
    if (!pendingFile) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    fd.append("lesson_token", lessonToken);
    fd.append("task_number", String(taskNumber));
    if (taskId != null && String(taskId).trim() !== "") fd.append("task_id", String(taskId));
    fd.append("file", pendingFile);
    try {
      const res = await fetch("/api/lesson/attachment/", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Не удалось загрузить файл");
      }
      const url = String(data.url || "");
      const filename = String(data.filename || pendingFile.name);
      setSentPreviews((prev) => [...prev, { url, filename }]);
      setPendingFile(null);
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
      setPendingPreview(null);
    } catch (ex) {
      setErr(ex.message || "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lesson-solution-upload" onClick={(e) => e.stopPropagation()} style={{ width: "100%" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="lesson-solution-file-input"
        tabIndex={-1}
        onChange={onFileSelect}
      />
      
      {!pendingFile ? (
        <button
          type="button"
          className="add-button lesson-solution-upload-btn"
          disabled={busy}
          style={{ width: "100%" }}
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          {busy ? "Загрузка…" : "Прикрепить решение"}
        </button>
      ) : (
        <div className="lesson-solution-pending" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ position: "relative", display: "inline-block", width: "fit-content" }}>
            <img src={pendingPreview} alt="Preview" style={{ maxWidth: "100%", maxHeight: "200px", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
            <button 
              type="button" 
              onClick={onCancel}
              style={{ position: "absolute", top: "-8px", right: "-8px", background: "#ef4444", color: "white", border: "none", borderRadius: "50%", width: "24px", height: "24px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          </div>
          <button
            type="button"
            className="add-button lesson-solution-send-btn"
            disabled={busy}
            style={{ width: "100%", background: "#10b981", color: "white", borderColor: "#059669" }}
            onClick={onSend}
          >
            {busy ? "Отправка…" : "Отправить"}
          </button>
        </div>
      )}

      {err ? <span className="lesson-solution-upload-error" style={{ display: "block", marginTop: "8px" }}>{err}</span> : null}
      
      {sentPreviews.length > 0 ? (
        <div className="lesson-solution-previews" style={{ marginTop: "12px" }}>
          {sentPreviews.map((p, i) => {
            const src = `${p.url}${p.url.includes("?") ? "&" : "?"}t=${encodeURIComponent(lessonToken)}`;
            return (
              <figure key={`${p.url}-${i}`} className="lesson-solution-preview-fig">
                <img src={src} alt="" className="lesson-solution-thumb" />
                {p.filename ? (
                  <figcaption className="lesson-solution-preview-cap">{p.filename}</figcaption>
                ) : null}
              </figure>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const LEVEL_NAMES = {
  ege: "ЕГЭ",
  oge: "ОГЭ",
};

const EXAM_CORNER_POS_KEY = "exam_fixed_corner_pos";

/** Эталон «a или b» — засчитывается любой вариант после нормализации */
const SUBJECTS_WITH_OR_ALTERNATIVES = ["math", "math_base", "chem", "history"];

function clampExamCornerToViewport(el, left, top) {
  const margin = 8;
  const w = el.offsetWidth || 1;
  const h = el.offsetHeight || 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, vw - w - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, vh - h - margin)),
  };
}

const LESSON_BOARD_PEN = 3;

/** Объект доски → доли от .main-wrapper. Для сохранения пропорций X и Y делятся на scrollWidth. */
function lessonBoardToNormalized(obj, mainEl) {
  if (!obj || !obj.type || !mainEl) return null;
  const pageEl = mainEl.querySelector('.page') || mainEl;
  const sw = Math.max(1, pageEl.offsetWidth || 1);
  const normPt = (p) => ({ nx: p.x / sw, ny: p.y / sw });
  const nw = (obj.width || LESSON_BOARD_PEN) / sw;

  if (obj.type === "line" || obj.type === "segment" || obj.type === "triangle" || obj.type === "rect") {
    return {
      type: obj.type,
      color: obj.color,
      nw,
      points: obj.points.map(normPt),
      _norm: true,
    };
  }
  if (obj.type === "circle") {
    return {
      type: "circle",
      color: obj.color,
      nw,
      center: normPt(obj.center),
      nr: obj.radius / sw,
      _norm: true,
    };
  }
  return null;
}

/** Восстановление штриха на локальном .main-wrapper. */
function lessonBoardFromNormalized(nobj, mainEl) {
  if (!nobj || !nobj.type || !mainEl) return null;
  const pageEl = mainEl.querySelector('.page') || mainEl;
  const sw = Math.max(1, pageEl.offsetWidth || 1);
  const pt = (p) => ({ x: (p.nx || 0) * sw, y: (p.ny || 0) * sw });
  const width = (nobj.nw || (LESSON_BOARD_PEN / 1000)) * sw;

  if (nobj.type === "line" || nobj.type === "segment" || nobj.type === "triangle" || nobj.type === "rect") {
    return {
      type: nobj.type,
      color: nobj.color,
      width,
      points: (nobj.points || []).map(pt),
    };
  }
  if (nobj.type === "circle") {
    return {
      type: "circle",
      color: nobj.color,
      width,
      center: pt(nobj.center || {}),
      radius: (Number(nobj.nr) || 0) * sw,
    };
  }
  return null;
}

function ExamPage() {
  const { level, subject, variant_id } = useParams();
  const location = useLocation();
  const lessonEmbedParams = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    return {
      embed: sp.get("lesson_embed") === "1",
      token: (sp.get("lesson_token") || "").trim(),
      student: sp.get("lesson_student") === "1",
    };
  }, [location.search]);
  const homeworkQuery = useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const embed = sp.get("lesson_embed") === "1";
    return parseHomeworkFromSearchForExam(location.search, embed);
  }, [location.search]);
  const isHomework = homeworkQuery.isHomework;
  const cabinetAssignmentId = homeworkQuery.cabinetAssignment;
  const isTeacherHomeworkView =
    isHomework && lessonEmbedParams.embed && !lessonEmbedParams.student;
  const [hwApiRaw, setHwApiRaw] = useState(null);
  const [hwLoading, setHwLoading] = useState(false);
  const [hwError, setHwError] = useState(null);
  const [hwActionBusy, setHwActionBusy] = useState(false);
  const [hwNotice, setHwNotice] = useState("");
  const hwHydrateKeyRef = useRef("");
  const showLessonSolutionUpload =
    lessonEmbedParams.embed && lessonEmbedParams.student && !!lessonEmbedParams.token;

  /** Синхронизация доски урока: слушатель всегда активен при embed, не только когда доска открыта. */
  useEffect(() => {
    if (!lessonEmbedParams.embed) return;
    const lessonBoardStrokeIds = new Set();
    const trimStrokeIds = () => {
      if (lessonBoardStrokeIds.size <= 500) return;
      const it = lessonBoardStrokeIds.values();
      for (let i = 0; i < 120; i++) {
        const n = it.next();
        if (n.done) break;
        lessonBoardStrokeIds.delete(n.value);
      }
    };
    const onLessonBoardMessage = (ev) => {
      if (ev.source !== window.parent) return;
      const d = ev.data;
      if (!d || d.source !== "exam-embedded-board" || d.type !== "board_apply") return;
      const sid = String(d.stroke_id || "");
      if (sid && lessonBoardStrokeIds.has(sid)) return;
      if (sid) {
        lessonBoardStrokeIds.add(sid);
        trimStrokeIds();
      }
      const tryApply = () => {
        const root =
          mainRef.current ||
          (typeof document !== "undefined" ? document.querySelector(".page") || document.getElementById("main-wrapper") : null);
        const local = lessonBoardFromNormalized(d.object, root, d.ref_board_min);
        if (!local) return false;
        objectsRef.current.push(local);
        setCanUndo(true);
        if (redrawRef.current) redrawRef.current();
        return true;
      };
      if (tryApply()) return;
      requestAnimationFrame(() => {
        tryApply();
      });
    };
    window.addEventListener("message", onLessonBoardMessage);
    return () => window.removeEventListener("message", onLessonBoardMessage);
  }, [lessonEmbedParams.embed]);
  const mode = location.state?.mode || "variant";
  const subjectLabel =
    location.state?.subjectName || examPageSubjectLabel(level, subject);
  const levelLabel =
    LEVEL_NAMES[level] || (level != null && level !== "" ? String(level).toUpperCase() : "");
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

  // Критерии части 2: панель открыта для taskId | null
  const [criteriaOpenForTask, setCriteriaOpenForTask] = useState(null);
  // Кэш критериев по task_list_id
  const [criteriaByTaskList, setCriteriaByTaskList] = useState({});
  // Выбранный критерий: { taskId: criterionId }
  const [selectedCriterionByTask, setSelectedCriterionByTask] = useState({});

  // Доска
  const [boardOpen, setBoardOpen] = useState(false);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser" | "line" | "triangle" | "circle" | "square"
  const [color, setColor] = useState("#000000");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Таймер варианта
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState("idle"); // "idle" | "running" | "paused"

  /** Весь фиксированный блок (таймеры, баллы, справка): развёрнут / свёрнут в полоску */
  const [examFixedPanelOpen, setExamFixedPanelOpen] = useState(true);

  // Загрузка PDF
  const [pdfLoading, setPdfLoading] = useState(null); // null | "default" | "cosmos" | "easter"

  // Копирование ссылки на вариант
  const [linkCopied, setLinkCopied] = useState(false);

  // Lightbox для увеличения изображений
  const [lightbox, setLightbox] = useState({ open: false, src: "" });
  const handleImageClick = useCallback((src) => setLightbox({ open: true, src }), []);
  const mainRef = useRef(null);
  const fixedCornerRef = useRef(null);
  const cornerDragRef = useRef({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const pendingCornerPosRef = useRef(null);

  /** Пользовательская позиция блока таймера (fixed px), null — как в CSS (правый верх) */
  const [fixedCornerPos, setFixedCornerPos] = useState(null);
  const fixedCornerPosRef = useRef(null);
  useEffect(() => {
    fixedCornerPosRef.current = fixedCornerPos;
  }, [fixedCornerPos]);

  // Справочная информация (items = массив {html})
  const [supportInfo, setSupportInfo] = useState({ items: [], open: false });

  // Результаты (всплывающее окно по кнопке «Завершить»)
  const [resultsOpen, setResultsOpen] = useState(false);
  const [resultsData, setResultsData] = useState(null);

  // Сообщить об ошибке
  const [reportErrorOpen, setReportErrorOpen] = useState(false);
  const [reportErrorTask, setReportErrorTask] = useState(null);

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
  const relayLessonBoardAddRef = useRef(/** @type {null | ((obj: object) => void)} */ (null));

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
    if (!level || !subject || !variant_id) {
      setError("Некорректный адрес варианта");
      setVariant(null);
      return undefined;
    }
    setError(null);
    let cancelled = false;
    fetch(
      `/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/variant/${encodeURIComponent(String(variant_id))}/`,
      { credentials: "same-origin" }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Ошибка загрузки варианта (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data || !Array.isArray(data.tasks)) {
          throw new Error("Сервер вернул неполные данные варианта");
        }
        setVariant(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Ошибка загрузки варианта");
      });
    return () => {
      cancelled = true;
    };
  }, [level, subject, variant_id]);

  useEffect(() => {
    if (!isHomework || !cabinetAssignmentId) {
      setHwApiRaw(null);
      setHwError(null);
      setHwLoading(false);
      return undefined;
    }
    if (!getLkPublicBase() && !lessonEmbedParams.token) {
      setHwError("no_lk_env");
      setHwLoading(false);
      return undefined;
    }
    let cancelled = false;
    setHwLoading(true);
    setHwError(null);
    const hwFetchOpts = lessonEmbedParams.token
      ? { lessonToken: lessonEmbedParams.token }
      : undefined;
    fetchHomeworkAssignment(cabinetAssignmentId, hwFetchOpts)
      .then((data) => {
        if (!cancelled) setHwApiRaw(data);
      })
      .catch((err) => {
        if (!cancelled) {
          const code = /** @type {{ status?: number }} */ (err)?.status;
          setHwError(code === 401 ? "unauthorized" : err?.message || "network");
        }
      })
      .finally(() => {
        if (!cancelled) setHwLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isHomework, cabinetAssignmentId, lessonEmbedParams.token]);

  useEffect(() => {
    if (!variant?.tasks || !hwApiRaw) return;
    const cab = cabinetAssignmentId || "";
    const picked = pickHomeworkFields(hwApiRaw, cab);
    const key = `${cab}|${picked.status}|${JSON.stringify(picked.result)}`;
    if (hwHydrateKeyRef.current === key) return;
    hwHydrateKeyRef.current = key;
    const m = new Map();
    for (const t of variant.tasks) m.set(String(t.number), t);
    const { userAnswers: ua, scores: sc, checkedTasks: ch } = homeworkResultToUiState(
      picked.result,
      m
    );
    setUserAnswers((p) => ({ ...p, ...ua }));
    setScores((p) => ({ ...p, ...sc }));
    if (ch && Object.keys(ch).length) setCheckedTasks((p) => ({ ...p, ...ch }));
  }, [variant, hwApiRaw, cabinetAssignmentId]);

  /* =========================
     Справочная информация
  ========================== */
  useEffect(() => {
    if (!level || !subject) return;
    fetch(`/api/${encodeURIComponent(level)}/${encodeURIComponent(subject)}/support-info/`)
      .then((res) => res.ok ? res.json() : { items: [] })
      .then((data) => setSupportInfo((s) => ({ ...s, items: data.items || [] })))
      .catch(() => setSupportInfo((s) => ({ ...s, items: [] })));
  }, [level, subject]);

  /* =========================
     Таймер
  ========================== */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(EXAM_CORNER_POS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.left === "number" && typeof p.top === "number") {
        setFixedCornerPos({ left: p.left, top: p.top });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const cornerPlaced = fixedCornerPos != null;
  useEffect(() => {
    if (!cornerPlaced) return;
    const onResize = () => {
      const el = fixedCornerRef.current;
      if (!el) return;
      setFixedCornerPos((prev) => {
        if (!prev) return prev;
        const c = clampExamCornerToViewport(el, prev.left, prev.top);
        try {
          sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(c));
        } catch {
          /* ignore */
        }
        return c;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [cornerPlaced]);

  const onFixedCornerDragStart = useCallback((e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = fixedCornerRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const pos = fixedCornerPosRef.current;
    const startLeft = pos?.left ?? rect.left;
    const startTop = pos?.top ?? rect.top;
    if (pos == null) {
      setFixedCornerPos({ left: startLeft, top: startTop });
    }
    cornerDragRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLeft,
      startTop,
    };
    pendingCornerPosRef.current = { left: startLeft, top: startTop };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onFixedCornerDragMove = useCallback((e) => {
    const d = cornerDragRef.current;
    if (!d.active) return;
    e.preventDefault();
    const el = fixedCornerRef.current;
    if (!el) return;
    let left = d.startLeft + (e.clientX - d.startClientX);
    let top = d.startTop + (e.clientY - d.startClientY);
    const c = clampExamCornerToViewport(el, left, top);
    pendingCornerPosRef.current = c;
    setFixedCornerPos(c);
  }, []);

  const onFixedCornerDragEnd = useCallback((e) => {
    const d = cornerDragRef.current;
    if (!d.active) return;
    d.active = false;
    try {
      if (d.pointerId != null) e.currentTarget.releasePointerCapture(d.pointerId);
    } catch {
      /* ignore */
    }
    const p = pendingCornerPosRef.current;
    if (p) {
      try {
        sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(p));
      } catch {
        /* ignore */
      }
    }
  }, []);

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

  /* Подсказка «листайте», если блок условия реально переполнен по ширине */
  useEffect(() => {
    const updateScrollHints = () => {
      const nodes = document.querySelectorAll(".exam-page .task-text");
      nodes.forEach((node) => {
        const hasOverflow = node.scrollWidth - node.clientWidth > 4;
        node.classList.toggle("task-text--has-overflow", hasOverflow);
      });
    };
    updateScrollHints();
    const t = setTimeout(updateScrollHints, 120);
    window.addEventListener("resize", updateScrollHints);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", updateScrollHints);
    };
  }, [variant]);

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
    /** Пока не рисуем — разрешаем прокрутку страницы пальцем по холсту (иначе fixed-слой «липнет» к экрану). */
    canvas.style.touchAction = "manipulation";

    /** Для touch: ждём сдвиг, иначе жест = прокрутка, не штрих. */
    let touchScrollGuard = null;
    const TOUCH_DRAG_THRESHOLD = 10;

    function setCanvasTouchAction() {
      canvas.style.touchAction =
        drawingRef.current || erasingRef.current ? "none" : "manipulation";
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

    const geomRef = { current: { vw: 1, vh: 1, dpr: 1 } };
    const PEN_WIDTH = 3;
    const POINT_STEP = 2;
    const lessonEmbed = lessonEmbedParams.embed;

    function relayLessonBoardEvent(type, payload) {
      if (!lessonEmbedParams.embed || !window.parent || window.parent === window) return;
      try {
        window.parent.postMessage({
          source: "exam-embedded-board",
          type: type,
          ...payload
        }, "*");
      } catch (_) {}
    }

    function relayLessonBoardAdd(obj) {
      if (!lessonEmbedParams.embed || !obj) return;
      const main =
        mainRef.current ||
        (typeof document !== "undefined" ? document.querySelector(".page") || document.getElementById("main-wrapper") : null);
      const norm = lessonBoardToNormalized(obj, main);
      if (!norm) return;
      const strokeId = obj.stroke_id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `s_${Date.now()}_${Math.random()}`);
      obj.stroke_id = strokeId;
      relayLessonBoardEvent("board_add", { stroke_id: strokeId, object: norm });
    }
    relayLessonBoardAddRef.current = relayLessonBoardAdd;
    function pressureWidth(ev, base, minK = 0.7, maxK = 2.2) {
      const p = Number(ev?.pressure);
      if (!Number.isFinite(p) || p <= 0) return base;
      const k = Math.max(minK, Math.min(maxK, minK + p * (maxK - minK)));
      return base * k;
    }
    function isPenEraserEvent(ev) {
      if (!ev || ev.pointerType !== "pen") return false;
      const b = Number(ev.buttons || 0);
      const btn = Number(ev.button || 0);
      return b === 32 || btn === 5;
    }

    let rafId2 = null;
    let scrollRaf = null;

    function scheduleRedraw() {
      if (rafId2 != null) return;
      rafId2 = requestAnimationFrame(() => { rafId2 = null; redraw(); });
    }

    function scheduleScrollRedraw() {
      if (scrollRaf != null) return;
      scrollRaf = requestAnimationFrame(() => { scrollRaf = null; redraw(); });
    }

    /** Холст только под окно: иначе clearRect на scrollHeight даёт жёсткий лаг при движении пера. */
    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
      const vh = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));

      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.position = "fixed";
      canvas.style.left = "0";
      canvas.style.top = "0";
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;
      canvas.style.zIndex = "10001";
      if (lessonEmbedParams.embed) canvas.dataset.lessonSkipRasterSync = "1";
      else delete canvas.dataset.lessonSkipRasterSync;

      geomRef.current = { vw, vh, dpr };
      setCanvasTouchAction();
      redraw();
    }

    /** Логические координаты доски = система .main-wrapper (как раньше при полноразмерном canvas). */
    function boardCoordsFromClient(clientX, clientY) {
      const root = mainRef.current;
      if (!root) return { x: 0, y: 0 };
      const pageEl = root.querySelector('.page') || root;
      const mr = pageEl.getBoundingClientRect();
      const sw = pageEl.offsetWidth;
      const sh = pageEl.offsetHeight;
      const sx = mr.width > 0 ? sw / mr.width : 1;
      const sy = mr.height > 0 ? sh / mr.height : 1;
      return {
        x: (clientX - mr.left) * sx,
        y: (clientY - mr.top) * sy,
      };
    }

    function getPos(e) {
      const cx = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const cy = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      return boardCoordsFromClient(cx, cy);
    }

    /** Браузер сливает pointermove; coalesced — все промежуточные позиции за кадр (меньше «отставания»). */
    function pointerSamples(e) {
      if (typeof e.getCoalescedEvents === "function") {
        const c = e.getCoalescedEvents();
        if (c && c.length > 0) return c;
      }
      return [e];
    }

    function appendPenSamples(line, samples) {
      for (let si = 0; si < samples.length; si++) {
        const ev = samples[si];
        const cx = ev.clientX ?? 0;
        const cy = ev.clientY ?? 0;
        const pos = boardCoordsFromClient(cx, cy);
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
      }
      const lastEv = samples[samples.length - 1];
      if (lastEv) {
        line.width = pressureWidth(lastEv, PEN_WIDTH, 0.65, 2.2);
      }
    }

    function drawPath(tc, points, color, width) {
      if (points.length < 1) return;
      tc.strokeStyle = color;
      tc.lineWidth = width;
      tc.lineCap = "round";
      tc.lineJoin = "round";
      if (points.length === 1) {
        tc.beginPath();
        tc.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
        tc.fillStyle = color;
        tc.fill();
        return;
      }
      tc.beginPath();
      tc.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        tc.lineTo(points[i].x, points[i].y);
      }
      tc.stroke();
    }

    function drawShape(tc, obj) {
      const lw = obj.width || PEN_WIDTH;
      tc.strokeStyle = obj.color;
      tc.lineWidth = lw;
      tc.lineCap = "butt";
      tc.lineJoin = "miter";
      if (obj.type === "segment" && obj.points?.length >= 2) {
        tc.beginPath();
        tc.moveTo(obj.points[0].x, obj.points[0].y);
        tc.lineTo(obj.points[1].x, obj.points[1].y);
        tc.stroke();
      } else if (obj.type === "triangle" && obj.points?.length === 3) {
        tc.beginPath();
        tc.moveTo(obj.points[0].x, obj.points[0].y);
        tc.lineTo(obj.points[1].x, obj.points[1].y);
        tc.lineTo(obj.points[2].x, obj.points[2].y);
        tc.closePath();
        tc.stroke();
      } else if (obj.type === "circle") {
        tc.beginPath();
        tc.arc(obj.center.x, obj.center.y, obj.radius, 0, Math.PI * 2);
        tc.stroke();
      } else if (obj.type === "rect" && obj.points?.length === 2) {
        const [a, b] = obj.points;
        tc.strokeRect(
          Math.round(Math.min(a.x, b.x)), Math.round(Math.min(a.y, b.y)),
          Math.round(Math.abs(b.x - a.x)), Math.round(Math.abs(b.y - a.y))
        );
      }
    }

    function redraw() {
      const root = mainRef.current;
      const { vw, vh, dpr } = geomRef.current;
      const pw = canvas.width;
      const ph = canvas.height;
      if (!root || pw < 1 || ph < 1 || vw < 1 || vh < 1) return;
      const pageEl = root.querySelector('.page') || root;
      const mr = pageEl.getBoundingClientRect();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pw, ph);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(mr.left, mr.top);
      ctx.beginPath();
      ctx.rect(-mr.left, -mr.top, vw, vh);
      ctx.clip();
      objectsRef.current.forEach((obj) => {
        if (obj.type === "line") drawPath(ctx, obj.points, obj.color, obj.width);
        else drawShape(ctx, obj);
      });
      if (currentLineRef.current) drawPath(ctx, currentLineRef.current.points, currentLineRef.current.color, currentLineRef.current.width);
      if (currentShapeRef.current) drawShape(ctx, currentShapeRef.current);
      ctx.restore();
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

    function eraseAt(x, y, skipRedraw = false) {
      const radius = 12;
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        if (hitTest(objectsRef.current[i], x, y, radius)) {
          const removed = objectsRef.current.splice(i, 1)[0];
          if (lessonEmbedParams.embed) {
            if (window.parent && window.parent !== window) {
              window.parent.postMessage({
                source: "exam-embedded-board",
                type: "board_remove",
                index: i,
                stroke_id: removed.stroke_id || ""
              }, "*");
            }
          } else if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ action: "remove_object", index: i }));
          }
          setCanUndo(objectsRef.current.length > 0);
          if (!skipRedraw) redraw();
          return;
        }
      }
    }

    function startStrokeFromPos(pos) {
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

    function onPointerDown(e) {
      // Кнопка-ластик на стилусе (например, Wacom/Apple Pencil 2 side switch)
      if (isPenEraserEvent(e)) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        erasingRef.current = true;
        drawingRef.current = false;
        eraseAt(getPos(e).x, getPos(e).y);
        setCanvasTouchAction();
        return;
      }
      if (e.pointerType === "touch") {
        touchScrollGuard = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          initialBoard: getPos(e),
        };
        return;
      }

      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      startStrokeFromPos(getPos(e));
      setCanvasTouchAction();
    }

    function onPointerMove(e) {
      if (isPenEraserEvent(e) && !erasingRef.current) {
        erasingRef.current = true;
        drawingRef.current = false;
        currentLineRef.current = null;
        currentShapeRef.current = null;
      }
      if (touchScrollGuard && e.pointerId === touchScrollGuard.pointerId) {
        const d = Math.hypot(
          e.clientX - touchScrollGuard.startX,
          e.clientY - touchScrollGuard.startY
        );
        if (d < TOUCH_DRAG_THRESHOLD) return;
        const pos0 = touchScrollGuard.initialBoard;
        const pid = touchScrollGuard.pointerId;
        touchScrollGuard = null;
        e.preventDefault();
        try {
          canvas.setPointerCapture(pid);
        } catch (_) {}
        startStrokeFromPos(pos0);
        setCanvasTouchAction();
      }

      const blocking = erasingRef.current || drawingRef.current;
      if (blocking) e.preventDefault();

      if (toolRef.current === "eraser" && erasingRef.current) {
        for (const ev of pointerSamples(e)) {
          const p = boardCoordsFromClient(ev.clientX ?? 0, ev.clientY ?? 0);
          eraseAt(p.x, p.y, true);
        }
        redraw();
        return;
      }

      if (drawingRef.current && currentShapeRef.current) {
        const shape = currentShapeRef.current;
        const samples = pointerSamples(e);
        const ev = samples[samples.length - 1];
        const pos = boardCoordsFromClient(ev.clientX ?? 0, ev.clientY ?? 0);
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
        scheduleRedraw();
        return;
      }

      if (!drawingRef.current || !currentLineRef.current) return;

      appendPenSamples(currentLineRef.current, pointerSamples(e));
      redraw();
    }

    function endTouchGuardIfAny(e) {
      if (touchScrollGuard && e.pointerId === touchScrollGuard.pointerId) {
        touchScrollGuard = null;
        setCanvasTouchAction();
      }
    }

    function onPointerUp(e) {
      endTouchGuardIfAny(e);
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
          relayLessonBoardAdd(shape);
          if (socket.readyState === WebSocket.OPEN && !lessonEmbed) {
            socket.send(JSON.stringify({ action: "add_object", object: shape }));
          }
        }
        currentShapeRef.current = null;
      } else if (drawingRef.current && currentLineRef.current) {
        const line = currentLineRef.current;
        redoStackRef.current = [];
        setCanRedo(false);
        objectsRef.current.push(line);
        setCanUndo(true);
        relayLessonBoardAdd(line);
        if (socket.readyState === WebSocket.OPEN && !lessonEmbed) {
          socket.send(JSON.stringify({ action: "add_object", object: line }));
        }
        currentLineRef.current = null;
      }

      drawingRef.current = false;
      erasingRef.current = false;
      setCanvasTouchAction();
      if (rafId2 != null) { cancelAnimationFrame(rafId2); rafId2 = null; }
      redraw();
    }

    function onKeyDown(e) {
      if (e.key === "Escape") setBoardOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoBoard();
        } else {
          undoBoard();
        }
      }
    }

    socket.onmessage = (e) => {
      if (lessonEmbed) return;
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
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("scroll", scheduleScrollRedraw, { passive: true, capture: true });

    const scrollRoots = new Set();
    const se = document.scrollingElement;
    if (se) scrollRoots.add(se);
    scrollRoots.add(document.documentElement);
    scrollRoots.add(document.body);
    const appShellContent = document.querySelector(".app-shell-content");
    if (appShellContent) scrollRoots.add(appShellContent);
    scrollRoots.forEach((el) => {
      el.addEventListener("scroll", scheduleScrollRedraw, { passive: true });
    });

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("scroll", scheduleScrollRedraw, { passive: true });
      vv.addEventListener("resize", scheduleScrollRedraw, { passive: true });
    }

    let ro;
    const root = mainRef.current;
    const contentArea = root?.querySelector?.(".content-area") ?? null;
    if (root) root.addEventListener("scroll", scheduleScrollRedraw, { passive: true });
    if (contentArea) contentArea.addEventListener("scroll", scheduleScrollRedraw, { passive: true });

    if (root && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => resizeCanvas());
      ro.observe(root);
    }

    resizeCanvas();
    const rafId = requestAnimationFrame(() => {
      resizeCanvas();
    });

    return () => {
      cancelAnimationFrame(rafId);
      if (rafId2 != null) cancelAnimationFrame(rafId2);
      if (scrollRaf != null) cancelAnimationFrame(scrollRaf);
      if (ro) ro.disconnect();
      redrawRef.current = null;
      try {
        if (socket && socket.readyState !== 2 && socket.readyState !== 3) socket.close();
      } catch (_) {}
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("scroll", scheduleScrollRedraw, { capture: true });
      scrollRoots.forEach((el) => {
        el.removeEventListener("scroll", scheduleScrollRedraw);
      });
      if (vv) {
        vv.removeEventListener("scroll", scheduleScrollRedraw);
        vv.removeEventListener("resize", scheduleScrollRedraw);
      }
      if (root) root.removeEventListener("scroll", scheduleScrollRedraw);
      if (contentArea) contentArea.removeEventListener("scroll", scheduleScrollRedraw);
      relayLessonBoardAddRef.current = null;
    };
  }, [boardOpen, level, subject, variant_id, lessonEmbedParams.embed]);

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

  // Математика, химия, история: ответы вида "x или y" — несколько допустимых вариантов
  function isUserAnswerCorrect(rawUserValue, correctAnswerHtml) {
    const userNorm = normalize(rawUserValue);
    const correctText = getTextFromHtml(correctAnswerHtml || "");
    const correctNorm = normalize(correctText);

    if (
      SUBJECTS_WITH_OR_ALTERNATIVES.includes(subject) &&
      /\sили\s/i.test(correctText)
    ) {
      const alternatives = correctText
        .split(/\s+или\s+/i)
        .map((part) => normalize(part))
        .filter(Boolean);
      if (alternatives.length > 0) {
        return alternatives.includes(userNorm);
      }
    }

    return userNorm === correctNorm;
  }

  function checkTask(taskId, correctAnswer, userValue = null) {
    const raw = userValue !== null ? userValue : userAnswers[taskId] || "";
    const isCorrect = isUserAnswerCorrect(raw, correctAnswer);
    setCheckedTasks((prev) => ({ ...prev, [taskId]: isCorrect }));
  }

  /** Вычислить правильность ответа без обновления state (для авто-проверки при завершении) */
  function computeTaskCorrectness(task) {
    const useTable = isTableAnswerTask(subject, task.number);
    const userValue = useTable
      ? getTableAnswerForCheck(task.id, INF_TABLE_ROWS, INF_TABLE_COLS)
      : (userAnswers[task.id] || "");
    return isUserAnswerCorrect(userValue, task.answer || "");
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

  /** Ключ кэша критериев: task_list_id или "num_<task_number>" при поиске по номеру */
  function getCriteriaCacheKey(task) {
    if (task.task_list_id != null) return task.task_list_id;
    if (task.number != null) return `num_${task.number}`;
    return null;
  }

  function toggleCriteriaPanel(task) {
    const tid = task.id;
    const cacheKey = getCriteriaCacheKey(task);
    if (criteriaOpenForTask === tid) {
      setCriteriaOpenForTask(null);
      return;
    }
    setCriteriaOpenForTask(tid);
    if (cacheKey != null && !criteriaByTaskList[cacheKey]?.criteria) {
      const params = new URLSearchParams();
      if (task.task_list_id != null) params.set("task_list_id", task.task_list_id);
      if (task.number != null) params.set("task_number", task.number);
      fetch(`/api/${level}/${subject}/criteria/?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : { criteria: [], max_score: null }))
        .then((data) => setCriteriaByTaskList((prev) => ({
          ...prev,
          [cacheKey]: {
            criteria: data.criteria || [],
            max_score: data.max_score != null ? data.max_score : (task.max_score ?? 3),
          },
        })))
        .catch(() => setCriteriaByTaskList((prev) => ({ ...prev, [cacheKey]: { criteria: [], max_score: task.max_score ?? 3 } })));
    }
  }

  function selectCriterion(taskId, criterion, maxScore) {
    setSelectedCriterionByTask((prev) => ({ ...prev, [taskId]: criterion.id }));
    const score = Math.min(criterion.criteria_score ?? 0, maxScore);
    setScores((prev) => ({ ...prev, [taskId]: Math.max(0, score) }));
  }

  function undoBoard() {
    if (objectsRef.current.length === 0) return;
    const obj = objectsRef.current.pop();
    redoStackRef.current.push(obj);
    redrawRef.current?.();
    setCanUndo(objectsRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
    if (lessonEmbedParams.embed) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: "exam-embedded-board",
          type: "board_remove",
          index: objectsRef.current.length,
          stroke_id: obj.stroke_id || ""
        }, "*");
      }
    } else if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "remove_object", index: objectsRef.current.length }));
    }
  }

  function redoBoard() {
    if (redoStackRef.current.length === 0) return;
    const obj = redoStackRef.current.pop();
    objectsRef.current.push(obj);
    redrawRef.current?.();
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
    if (lessonEmbedParams.embed) {
      relayLessonBoardAddRef.current?.(obj);
    } else if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "add_object", object: obj }));
    }
  }

  function clearBoard() {
    if (!window.confirm("Очистить всю доску?")) return;
    objectsRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    redrawRef.current?.();
    if (lessonEmbedParams.embed) {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: "exam-embedded-board",
          type: "board_clear"
        }, "*");
      }
    } else if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: "clear_all" }));
    }
  }

  const homeworkLkOpts = useMemo(
    () => (lessonEmbedParams.token ? { lessonToken: lessonEmbedParams.token } : undefined),
    [lessonEmbedParams.token]
  );

  const runHomeworkSave = useCallback(async () => {
    if (!isHomework || !cabinetAssignmentId || !variant) return;
    setHwActionBusy(true);
    setHwNotice("");
    try {
      const r = buildHomeworkResultPayload(variant.tasks, userAnswers, scores, checkedTasks);
      await saveHomeworkDraft(cabinetAssignmentId, { result: r }, homeworkLkOpts);
      setHwNotice("Черновик сохранён");
      setTimeout(() => setHwNotice(""), 2400);
    } catch (e) {
      setHwNotice(homeworkApiUserMessage(e) || "Не удалось сохранить");
    } finally {
      setHwActionBusy(false);
    }
  }, [isHomework, cabinetAssignmentId, variant, userAnswers, scores, checkedTasks, homeworkLkOpts]);

  const runHomeworkSubmit = useCallback(async () => {
    if (!isHomework || !cabinetAssignmentId || !variant) return;
    if (!window.confirm("Отправить работу на проверку? После отправки нельзя править, пока не вернут на доработку.")) {
      return;
    }
    setHwActionBusy(true);
    setHwNotice("");
    try {
      const r = buildHomeworkResultPayload(variant.tasks, userAnswers, scores, checkedTasks);
      await saveHomeworkDraft(cabinetAssignmentId, { result: r }, homeworkLkOpts);
      await submitHomework(cabinetAssignmentId, homeworkLkOpts);
      setHwNotice("Отправлено на проверку");
      const j = await fetchHomeworkAssignment(cabinetAssignmentId, homeworkLkOpts);
      setHwApiRaw(j);
    } catch (e) {
      setHwNotice(homeworkApiUserMessage(e) || "Ошибка отправки");
    } finally {
      setHwActionBusy(false);
    }
  }, [isHomework, cabinetAssignmentId, variant, userAnswers, scores, checkedTasks, homeworkLkOpts]);

  if (error) return <div style={{ padding: 20 }}>Ошибка: {error}</div>;
  if (!variant) return <div style={{ padding: 20 }}>Загрузка...</div>;
  if (isHomework && !cabinetAssignmentId) {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <h2 style={{ fontFamily: "Unbounded, sans-serif", marginBottom: 8 }}>Домашнее задание</h2>
        <p>Не передан id назначения. Откройте вариант из личного кабинета по ссылке с параметром cabinet_assignment=…</p>
      </div>
    );
  }
  if (isHomework && !getLkPublicBase() && !lessonEmbedParams.token) {
    return (
      <div style={{ padding: 24, maxWidth: 560 }}>
        <h2 style={{ fontFamily: "Unbounded, sans-serif", marginBottom: 8 }}>Домашнее задание</h2>
        <p>
          Для связи с кабинетом задайте в сборке фронтенда переменную{" "}
          <code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 6 }}>VITE_LK_PUBLIC_URL</code> — тот
          же origin, что и у сессии ЛК (CORS + credentials). В уроке с токеном вариант использует прокси генератор → ЛК
          (без CORS), если открыт из комнаты с <code>lesson_token</code>.
        </p>
      </div>
    );
  }

  const tasksFilteredByAuthor = Array.isArray(variant.tasks) ? variant.tasks : [];
  // Fallback: если part не задан, определяем по номеру (ОГЭ матем: 1–19 ч.1, 20+ ч.2; ЕГЭ матем: 1–11 ч.1; ОГЭ инф: 1–15 ч.1)
  const inferPart = (t) => {
    if (t.part === 1 || t.part === 2) return t.part;
    const n = t.number;
    if (level === "oge" && isMathLikeSubject(subject)) return n <= 19 ? 1 : 2;
    if (level === "ege" && isMathLikeSubject(subject)) return n <= 11 ? 1 : 2;
    if (level === "oge" && subject === "inf") return n <= 15 ? 1 : 2;
    if (level === "ege" && subject === "inf") return n <= 27 ? 1 : 2;
    return n <= 19 ? 1 : 2;
  };
  const part1Tasks = tasksFilteredByAuthor.filter((t) => inferPart(t) === 1);
  const part2Tasks = tasksFilteredByAuthor.filter((t) => inferPart(t) === 2);

  // Связанные задания 19–21 — только для ЕГЭ информатика; для математики всё как обычные задания
  const LINKED_19_21 = [19, 20, 21];
  const part2Linked1921 = part2Tasks.filter((t) => LINKED_19_21.includes(t.number));
  const part2Rest = part2Tasks.filter((t) => !LINKED_19_21.includes(t.number));
  const showLinkedGroup = subject === "inf" && part2Linked1921.length === 3;
  // Для математики или если не все три — показываем 19/20/21 как обычные задания
  const part2Regular = showLinkedGroup ? part2Rest : [...part2Linked1921, ...part2Rest].sort((a, b) => a.number - b.number);

  const hwPicked = isHomework && hwApiRaw ? pickHomeworkFields(hwApiRaw, cabinetAssignmentId) : null;
  const hwSt = hwPicked?.status || "unknown";
  const hwRevisions = hwPicked?.revisionTaskIds || [];
  const hRead = homeworkIsReadonly(hwSt, isTeacherHomeworkView);
  const hSol = homeworkShowSolutions(hwSt);
  const numLocked = (n) =>
    isHomework && !homeworkTaskNumberEditable(hwSt, hwRevisions, n, isTeacherHomeworkView);
  const p1FieldDisabled = (task) => {
    if (!isHomework) return checkedTasks[task.id] !== undefined;
    if (hRead) return true;
    return numLocked(task.number);
  };
  const showP1Check = !isHomework;
  /** В ДЗ: вместо «Проверить» — «Сохранить» (черновик в ЛК), без отображения верно/неверно. */
  const p1ShowHomeworkSave = (task) =>
    isHomework &&
    !isTeacherHomeworkView &&
    !hRead &&
    !hSol &&
    !numLocked(task.number);
  const p1CorrectVisible = (task) => {
    if (!isHomework) return checkedTasks[task.id] !== undefined && !checkedTasks[task.id];
    return hSol;
  };
  const lkBase = getLkPublicBase();
  const showHomeworkBottomActions =
    isHomework &&
    !isTeacherHomeworkView &&
    !hRead &&
    (hwSt === "sent" || hwSt === "revision" || hwSt === "unknown");

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
      if (inferPart(task) === 2) {
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
    /** Полностью верные задания: ч.1 — верный ответ; ч.2 — набран максимум баллов по заданию */
    const fullyCorrectTaskCount = variant.tasks.filter((task) => {
      if (inferPart(task) === 1) {
        const ok =
          checkedTasks[task.id] !== undefined
            ? checkedTasks[task.id]
            : computeTaskCorrectness(task);
        return !!ok;
      }
      return (scores[task.id] ?? 0) >= getTaskMaxScore(task);
    }).length;
    return {
      effectiveCheckedTasks,
      effectiveScores,
      correctCount,
      totalScore,
      geoCorrectCount,
      fullyCorrectTaskCount,
    };
  }

  const { correctCount, totalScore, fullyCorrectTaskCount } = getEffectiveResults();
  const taskCountTotal = variant.tasks.length;

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
      fullyCorrectTaskCount: effFullyCorrect,
    } = getEffectiveResults();

    let scoreExam = null;
    let scoreComment = null;
    let markLevel = null;

    // В режиме тренировки по номерам конвертация в баллы/оценку не нужна
    if (mode !== "test") {
      const isOgeMath =
        String(level).toLowerCase() === "oge" && isMathLikeSubject(subject);
      const geoParam = isOgeMath ? `&geo_correct=${geoCorrectCount}` : "";
      try {
        const res = await fetch(
          `/api/${level}/${subject}/score-conversion/?score=${effTotalScore}${geoParam}`,
          { credentials: "same-origin" }
        );
        if (res.ok) {
          const data = await res.json();
          scoreExam = data.score_exam !== undefined ? data.score_exam : null;
          scoreComment = data.comment ?? null;
          markLevel = data.mark_level ?? null;
        }
      } catch (_) {}
    }

    // Для тренировки maxScore = кол-во задач в тесте (1 балл за задачу), для варианта — как обычно
    const effectiveMaxScore = mode === "test" ? variant.tasks.length : maxScore;

    setResultsData({
      totalTimeFormatted,
      taskTimes,
      correctCount: effCorrectCount,
      totalScore: effTotalScore,
      maxScore: effectiveMaxScore,
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
      examMode: mode,
      fullyCorrectTaskCount: effFullyCorrect,
      taskCountTotal: variant.tasks.length,
    });
    setResultsOpen(true);
  };

  const openPdf = async (variantId) => {
    setPdfLoading("default");
    const url = `/api/${level}/${subject}/variant/${variantId}/pdf/`;
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

  const getThemeWorksheetBg = () => {
    const { themeData } = readPersistedTheme();
    return (themeData?.worksheetBg || "").trim();
  };

  const openThemedPdf = async (variantId, themeName) => {
    setPdfLoading(themeName);
    const bgUrl = getThemeWorksheetBg();
    const params = new URLSearchParams({ theme: themeName });
    if (bgUrl) params.set("bg_url", bgUrl);
    const url = `/api/${level}/${subject}/variant/${variantId}/pdf/?${params}`;
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) throw new Error("Ошибка загрузки PDF");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `variant-${variantId}-${themeName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      const a = document.createElement("a");
      a.href = url;
      a.download = `variant-${variantId}-${themeName}.pdf`;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setPdfLoading(null);
    }
  };

  const copyVariantLink = async () => {
    const loc = window.location;
    const pathWithQuery = `${loc.pathname}${loc.search}${loc.hash}`;
    const isLocal =
      loc.hostname === "localhost" ||
      loc.hostname === "127.0.0.1" ||
      loc.hostname === "[::1]";
    const url = isLocal ? loc.href : `http://генурок.рф${pathWithQuery}`;
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch { /* fallback below */ }
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.cssText = "position:fixed;opacity:0;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
    }
    setLinkCopied(ok);
    if (ok) setTimeout(() => setLinkCopied(false), 2000);
  };

  return (
    <SubjectExamCountdownProvider level={level}>
    <div
      ref={mainRef}
      className={`main-wrapper exam-page${isHomework ? " exam-page--homework" : ""}`}
      id="main-wrapper"
      data-level={level}
      data-subject={subject}
    >
      {isHomework && (
        <div className="exam-homework-bar" role="region" aria-label="Домашнее задание">
          <div className="exam-homework-bar__inner">
            <div className="exam-homework-bar__title">
              <span className="exam-homework-bar__badge">Домашнее задание</span>
              {hwLoading && <span className="exam-homework-bar__meta">загрузка статуса…</span>}
              {!hwLoading && hwPicked && (
                <span className="exam-homework-bar__meta">
                  {hwSt === "sent" && "Черновик"}
                  {hwSt === "submitted" && "На проверке"}
                  {hwSt === "reviewing" && "Проверяется"}
                  {hwSt === "revision" && "На доработке"}
                  {hwSt === "reviewed" && "Проверено"}
                  {hwSt === "unknown" && "Статус неизвестен"}
                </span>
              )}
            </div>
            {isTeacherHomeworkView && (
              <div className="exam-homework-bar__actions">
                <span className="exam-homework-bar__hint">Просмотр. Проверка и оценки — в личном кабинете.</span>
                {lkBase ? (
                  <a className="exam-homework-bar__link" href={lkBase} target="_blank" rel="noreferrer">
                    Открыть кабинет
                  </a>
                ) : null}
              </div>
            )}
            {!isTeacherHomeworkView && (
              <div className="exam-homework-bar__actions exam-homework-bar__actions--meta">
                {hwError && hwError !== "no_lk_env" && (
                  <span className="exam-homework-bar__err" title={String(hwError)}>
                    {hwError === "unauthorized"
                      ? "Войдите в личный кабинет в этой вкладке или откройте задание из кабинета."
                      : "Не удалось загрузить статус из кабинета (сеть или CORS)."}
                    {lkBase ? (
                      <>
                        {" "}
                        <a href={lkBase} target="_blank" rel="noreferrer">
                          Перейти в кабинет
                        </a>
                      </>
                    ) : null}
                  </span>
                )}
                {hwNotice ? <span className="exam-homework-bar__notice">{hwNotice}</span> : null}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Фиксированный блок: таймер решения, до экзамена, баллы, справка — перетаскивание за ручку */}
      <div
        ref={fixedCornerRef}
        className={`exam-fixed-corner${examFixedPanelOpen ? "" : " exam-fixed-corner--all-collapsed"}`}
        style={
          fixedCornerPos
            ? { left: fixedCornerPos.left, top: fixedCornerPos.top, right: "auto" }
            : undefined
        }
      >
        <div className="exam-fixed-corner__header">
          <button
            type="button"
            className="exam-fixed-corner__drag"
            aria-label="Переместить блок с таймером"
            title="Перетащить"
            onPointerDown={onFixedCornerDragStart}
            onPointerMove={onFixedCornerDragMove}
            onPointerUp={onFixedCornerDragEnd}
            onPointerCancel={onFixedCornerDragEnd}
          >
            <span className="exam-fixed-corner__drag-grip" aria-hidden />
          </button>
          {examFixedPanelOpen ? (
            <button
              type="button"
              className="exam-fixed-corner__collapse-all"
              onClick={() => setExamFixedPanelOpen(false)}
              title="Свернуть панель"
              aria-label="Свернуть панель с таймерами"
            >
              <span aria-hidden>−</span>
            </button>
          ) : (
            <button
              type="button"
              className="exam-fixed-corner__expand-all"
              onClick={() => setExamFixedPanelOpen(true)}
              title="Показать таймеры"
              aria-label="Показать панель с таймерами"
            >
              <span aria-hidden>⏱</span>
            </button>
          )}
        </div>
        {examFixedPanelOpen && (
          <>
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
        <SubjectExamCountdownCard subjectKey={subject} />
        <div className="variant-score-block">
          <div className="variant-score-row">
            <span className="variant-score-label">
              {mode === "test"
                ? "Верно"
                : part2Tasks.length > 0
                  ? "Баллов"
                  : "Правильных"}
            </span>
            <span className="variant-score-val">
              {mode === "test" ? (
                <>
                  {fullyCorrectTaskCount}{" "}
                  <span className="variant-score-total">/ {taskCountTotal}</span>
                </>
              ) : (
                <>
                  {totalScore} <span className="variant-score-total">/ {maxScore}</span>
                </>
              )}
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
          </>
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
                      className="variant-btn-cosmos"
                      onClick={() => openThemedPdf(variant.id, "cosmos")}
                      disabled={!!pdfLoading}
                    >
                      🪐 Космический вариант
                    </button>
                    <button
                      className="variant-btn-easter"
                      onClick={() => openThemedPdf(variant.id, "easter")}
                      disabled={!!pdfLoading}
                    >
                      🐣 Пасхальный вариант
                    </button>
                    <button
                      type="button"
                      className="variant-btn-copy-link"
                      onClick={copyVariantLink}
                      title={linkCopied ? "Скопировано" : "Скопировать ссылку на вариант"}
                      aria-label={linkCopied ? "Скопировано" : "Скопировать ссылку на вариант"}
                    >
                      {linkCopied ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20" aria-hidden="true">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                      )}
                      <span className="variant-btn-copy-link-text">Скопировать ссылку на вариант</span>
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
                <section
                  key={task.id}
                  data-task-id={task.id}
                  className={`task${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                  onClick={() => handleTaskFocus(task.id)}
                >
                  <aside className="task-left">
                    <div className="task-number">{task.number}</div>
                    <div className="task-id">{task.id}</div>
                  </aside>

                  <article className="task-content">
                    <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
                    {task.file && (
                      <div className="task-files">
                        <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                          <span className="task-file-icon">📎</span>
                          <span className="task-file-label">Скачать файл</span>
                        </a>
                      </div>
                    )}
                    {task.author && <div className="task-author">{task.author}</div>}

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
                                            !isHomework && checkedTasks[task.id] !== undefined
                                              ? checkedTasks[task.id]
                                                ? " correct"
                                                : " incorrect"
                                              : ""
                                          }`}
                                          placeholder=""
                                          value={getTableAnswerString(task.id, rows, cols)[r][c] || ""}
                                          disabled={p1FieldDisabled(task)}
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
                                !isHomework && checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                            >
                              {!isHomework && checkedTasks[task.id] !== undefined
                                ? (checkedTasks[task.id] ? "✓" : "✗")
                                : ""}
                            </span>

                            {showP1Check && checkedTasks[task.id] === undefined && (
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
                            {p1ShowHomeworkSave(task) && (
                              <button
                                type="button"
                                className="add-button exam-hw-save-btn"
                                style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                disabled={hwActionBusy || hwLoading}
                                onClick={() => runHomeworkSave()}
                              >
                                Сохранить
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
                                !isHomework && checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                              placeholder="Введите ответ"
                              value={userAnswers[task.id] || ""}
                              disabled={p1FieldDisabled(task)}
                              onChange={(e) => setUserAnswers((prev) => ({ ...prev, [task.id]: e.target.value }))}
                              style={{ flex: "1", minWidth: 0 }}
                            />

                            <span
                              className={`answer-status${
                                !isHomework && checkedTasks[task.id] !== undefined
                                  ? checkedTasks[task.id]
                                    ? " correct"
                                    : " incorrect"
                                  : ""
                              }`}
                            >
                              {!isHomework && checkedTasks[task.id] !== undefined
                                ? (checkedTasks[task.id] ? "✓" : "✗")
                                : ""}
                            </span>

                            {showP1Check && checkedTasks[task.id] === undefined && (
                              <button
                                className="add-button"
                                style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap", flexShrink: 0 }}
                                onClick={() => checkTask(task.id, task.answer)}
                              >
                                Проверить
                              </button>
                            )}
                            {p1ShowHomeworkSave(task) && (
                              <button
                                type="button"
                                className="add-button exam-hw-save-btn"
                                style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap", flexShrink: 0 }}
                                disabled={hwActionBusy || hwLoading}
                                onClick={() => runHomeworkSave()}
                              >
                                Сохранить
                              </button>
                            )}
                          </div>
                        </>
                      )}

                      <div
                        className={`correct-answer-display${
                          p1CorrectVisible(task) ? " visible" : ""
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
                        <section
                          key={task.id}
                          data-task-id={task.id}
                          className={`task task-in-group${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                          onClick={() => handleTaskFocus(task.id)}
                        >
                          <aside className="task-left">
                            <div className="task-number">{task.number}</div>
                            <div className="task-id">{task.id}</div>
                          </aside>

                          <article className="task-content">
                            <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
                            {task.file && (
                              <div className="task-files">
                                <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                                  <span className="task-file-icon">📎</span>
                                  <span className="task-file-label">Скачать файл</span>
                                </a>
                              </div>
                            )}
                            {task.author && <div className="task-author">{task.author}</div>}

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
                                                    !isHomework && checkedTasks[task.id] !== undefined
                                                      ? checkedTasks[task.id]
                                                        ? " correct"
                                                        : " incorrect"
                                                      : ""
                                                  }`}
                                                  placeholder=""
                                                  value={getTableAnswerString(task.id, rowsHere, colsHere)[r][c] || ""}
                                                  disabled={p1FieldDisabled(task)}
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
                                        !isHomework && checkedTasks[task.id] !== undefined
                                          ? checkedTasks[task.id]
                                            ? " correct"
                                            : " incorrect"
                                          : ""
                                      }`}
                                    >
                                      {!isHomework && checkedTasks[task.id] !== undefined
                                        ? (checkedTasks[task.id] ? "✓" : "✗")
                                        : ""}
                                    </span>

                                    {showP1Check && checkedTasks[task.id] === undefined && (
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
                                    {p1ShowHomeworkSave(task) && (
                                      <button
                                        type="button"
                                        className="add-button exam-hw-save-btn"
                                        style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
                                        disabled={hwActionBusy || hwLoading}
                                        onClick={() => runHomeworkSave()}
                                      >
                                        Сохранить
                                      </button>
                                    )}
                                  </div>

                                  <div
                                    className={`correct-answer-display${
                                      p1CorrectVisible(task) ? " visible" : ""
                                    }`}
                                  >
                                    <span className="correct-answer-label">Правильный ответ: </span>
                                    <MathContent html={task.answer || ""} className="correct-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                                  </div>
                                </>
                              ) : (
                                <>
                                  {criteriaOpenForTask === task.id ? (
                                    <div className="criteria-panel">
                                      <div className="criteria-table-wrap">
                                        <table className="criteria-table">
                                          <thead>
                                            <tr>
                                              <th className="criteria-th-content">Содержание критерия</th>
                                              <th className="criteria-th-score">Баллы</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {((criteriaByTaskList[getCriteriaCacheKey(task)]?.criteria) ?? []).map((c) => (
                                              <tr key={c.id} className="criteria-row">
                                                <td className="criteria-td-content">
                                                  <label className="criteria-radio-label">
                                                    <input
                                                      type="radio"
                                                      name={`criteria-${task.id}`}
                                                      className="criteria-radio-input"
                                                      checked={selectedCriterionByTask[task.id] === c.id}
                                                      disabled={isHomework && (hRead || numLocked(task.number))}
                                                      onChange={() => {
                                                        if (isHomework && (hRead || numLocked(task.number))) return;
                                                        selectCriterion(task.id, c, (criteriaByTaskList[getCriteriaCacheKey(task)]?.max_score) ?? getTaskMaxScore(task));
                                                      }}
                                                    />
                                                    <span className="criteria-radio-check">{selectedCriterionByTask[task.id] === c.id ? "✓" : ""}</span>
                                                    <MathContent html={c.criteria_text || ""} className="criteria-text" onImageClick={(src) => setLightbox({ open: true, src })} />
                                                  </label>
                                                </td>
                                                <td className="criteria-td-score">{c.criteria_score}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot>
                                            <tr>
                                              <td className="criteria-tfoot-label">Максимальный балл</td>
                                              <td className="criteria-tfoot-score">{(criteriaByTaskList[getCriteriaCacheKey(task)]?.max_score) ?? getTaskMaxScore(task)}</td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>
                                      {((criteriaByTaskList[getCriteriaCacheKey(task)]?.criteria) ?? []).length === 0 && (
                                        <p className="criteria-empty">Критерии не заданы для этого задания</p>
                                      )}
                                    </div>
                                  ) : null}
                                </>
                              )}

                              <div className="part2-answer-criteria-buttons" style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                                {(!isHomework || hSol) && task.answer != null && task.answer !== "" && (
                                  <button
                                    type="button"
                                    className="add-button"
                                    style={{ width: "100%" }}
                                    onClick={() => togglePart2Answer(task.id)}
                                  >
                                    {visibleAnswers[task.id] ? "Скрыть ответ" : "Ответ"}
                                  </button>
                                )}
                                {(task.task_list_id != null || task.number != null) && (
                                  <button
                                    type="button"
                                    className={`add-button criteria-btn${criteriaOpenForTask === task.id ? " active" : ""}`}
                                    style={{ width: "100%" }}
                                    disabled={isHomework && hRead}
                                    onClick={() => {
                                      if (isHomework && hRead) return;
                                      toggleCriteriaPanel(task);
                                    }}
                                  >
                                    {criteriaOpenForTask === task.id ? "Скрыть критерии" : "Критерии"}
                                  </button>
                                )}
                              </div>
                              {(!isHomework || hSol) && task.answer != null && task.answer !== "" && visibleAnswers[task.id] && (
                                <div className="part2-answer-reveal">
                                  <span className="part2-answer-label">Правильный ответ:</span>
                                  <MathContent html={task.answer} className="part2-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                                </div>
                              )}
                            </div>
                            <LessonSolutionUpload
                              taskNumber={task.number}
                              taskId={task.id}
                              lessonToken={lessonEmbedParams.token}
                              enabled={
                                showLessonSolutionUpload && (!isHomework || (!hRead && !numLocked(task.number)))
                              }
                            />
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
                  <section
                    key={task.id}
                    data-task-id={task.id}
                    className={`task${task.subdivision === "geom" ? " task-geom" : task.subdivision === "alg" ? " task-alg" : ""}${((level === "oge" && subject === "inf" && task.number === 13) || (level === "oge" && isMathLikeSubject(subject) && task.number === 1)) ? " task-img-full" : ""}`}
                    onClick={() => handleTaskFocus(task.id)}
                  >
                    <aside className="task-left">
                      <div className="task-number">{task.number}</div>
                      <div className="task-id">{task.id}</div>
                    </aside>

                    <article className="task-content">
                      <MathContent html={task.text} className="task-text" onImageClick={(src) => setLightbox({ open: true, src })} />
                      {task.file && (
                        <div className="task-files">
                          <a href={task.file} target="_blank" rel="noreferrer" className="task-file-link">
                            <span className="task-file-icon">📎</span>
                            <span className="task-file-label">Скачать файл</span>
                          </a>
                        </div>
                      )}
                      {task.author && <div className="task-author">{task.author}</div>}
                      <LessonSolutionUpload
                        taskNumber={task.number}
                        taskId={task.id}
                        lessonToken={lessonEmbedParams.token}
                        enabled={
                          showLessonSolutionUpload && (!isHomework || (!hRead && !numLocked(task.number)))
                        }
                      />

                      <div className="answer-section">
                        {criteriaOpenForTask === task.id ? (
                          <div className="criteria-panel">
                            <div className="criteria-table-wrap">
                              <table className="criteria-table">
                                <thead>
                                  <tr>
                                    <th className="criteria-th-content">Содержание критерия</th>
                                    <th className="criteria-th-score">Баллы</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {((criteriaByTaskList[getCriteriaCacheKey(task)]?.criteria) ?? []).map((c) => (
                                    <tr key={c.id} className="criteria-row">
                                      <td className="criteria-td-content">
                                        <label className="criteria-radio-label">
                                          <input
                                            type="radio"
                                            name={`criteria-${task.id}`}
                                            className="criteria-radio-input"
                                            checked={selectedCriterionByTask[task.id] === c.id}
                                            disabled={isHomework && (hRead || numLocked(task.number))}
                                            onChange={() => {
                                              if (isHomework && (hRead || numLocked(task.number))) return;
                                              selectCriterion(
                                                task.id,
                                                c,
                                                (criteriaByTaskList[getCriteriaCacheKey(task)]?.max_score) ?? getTaskMaxScore(task)
                                              );
                                            }}
                                          />
                                          <span className="criteria-radio-check">{selectedCriterionByTask[task.id] === c.id ? "✓" : ""}</span>
                                          <MathContent html={c.criteria_text || ""} className="criteria-text" onImageClick={(src) => setLightbox({ open: true, src })} />
                                        </label>
                                      </td>
                                      <td className="criteria-td-score">{c.criteria_score}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr>
                                    <td className="criteria-tfoot-label">Максимальный балл</td>
                                    <td className="criteria-tfoot-score">{(criteriaByTaskList[getCriteriaCacheKey(task)]?.max_score) ?? getTaskMaxScore(task)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            {((criteriaByTaskList[getCriteriaCacheKey(task)]?.criteria) ?? []).length === 0 && (
                              <p className="criteria-empty">Критерии не заданы для этого задания</p>
                            )}
                          </div>
                        ) : null}

                              <div className="part2-answer-criteria-buttons" style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                                {(!isHomework || hSol) && task.answer != null && task.answer !== "" && (
                                  <button
                                    type="button"
                                    className="add-button"
                                    style={{ width: "100%" }}
                                    onClick={() => togglePart2Answer(task.id)}
                                  >
                                    {visibleAnswers[task.id] ? "Скрыть ответ" : "Ответ"}
                                  </button>
                                )}
                                {(task.task_list_id != null || task.number != null) && (
                                  <button
                                    type="button"
                                    className={`add-button criteria-btn${criteriaOpenForTask === task.id ? " active" : ""}`}
                                    style={{ width: "100%" }}
                                    disabled={isHomework && hRead}
                                    onClick={() => {
                                      if (isHomework && hRead) return;
                                      toggleCriteriaPanel(task);
                                    }}
                                  >
                                    {criteriaOpenForTask === task.id ? "Скрыть критерии" : "Критерии"}
                                  </button>
                                )}
                              </div>
                        {(!isHomework || hSol) && task.answer != null && task.answer !== "" && visibleAnswers[task.id] && (
                          <div className="part2-answer-reveal">
                            <span className="part2-answer-label">Правильный ответ:</span>
                            <MathContent html={task.answer} className="part2-answer-content" onImageClick={(src) => setLightbox({ open: true, src })} />
                          </div>
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

            {showHomeworkBottomActions && (
              <div className="exam-homework-finish">
                <p className="exam-homework-finish__hint">
                  Сохраните ответы кнопкой «Сохранить» у заданий части 1 или кнопками ниже, затем отправьте работу — до проверки
                  эталон и верность ответа не показываются.
                </p>
                <div className="exam-homework-finish__row">
                  <button
                    type="button"
                    className="exam-homework-finish__btn exam-homework-finish__btn--secondary"
                    disabled={hwActionBusy || hwLoading}
                    onClick={() => runHomeworkSave()}
                  >
                    Сохранить черновик
                  </button>
                  <button
                    type="button"
                    className="exam-homework-finish__btn exam-homework-finish__btn--primary"
                    disabled={hwActionBusy || hwLoading}
                    onClick={() => runHomeworkSubmit()}
                  >
                    Отправить на проверку
                  </button>
                </div>
              </div>
            )}

            {/* Кнопка Завершить — в обычном экзамене, не в ДЗ */}
            {!isHomework && (
            <div className="exam-finish-section">
              <button
                id="finish-btn"
                className="exam-finish-btn exam-finish-btn-inline"
                onClick={handleFinish}
              >
                Завершить
              </button>
            </div>
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

      {/* ===== ДОСКА (внутри main-wrapper, прокручивается вместе со страницей) ===== */}
      {boardOpen && (
        <div id="board-container" className="active">
          <canvas ref={canvasRef} id="board" style={{ cursor: tool === "eraser" ? "pointer" : "crosshair" }} />
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
        </div>
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
    </SubjectExamCountdownProvider>
  );
}

export default ExamPage;