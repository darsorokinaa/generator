/**
 * VariantPlayer — рендерит вариант ЕГЭ/ОГЭ с автопроверкой (как на genurok.ru / в уроке).
 *
 * Props:
 *   variantId   — number, ID варианта
 *   readOnly    — bool, режим просмотра результатов (для учителя)
 *   savedResult — object, ранее сохранённые ответы ученика {taskNum: {answer, state}}
 *   assignmentId — ID назначения ДЗ (для загрузки файлов к заданию)
 *   answerFiles  — уже загруженные файлы [{ id, url, filename, file_type, task_number }, …]
 *   onSubmit    — async (result, score) => void, при нажатии «Сохранить»
 *   onClose     — () => void
 *   embedded    — встроенный режим (без полноэкранного оверлея), для карточки ДЗ у учителя
 *   isTeacher   — комментарий к заданиям, доска (вместе с учеником)
 *   taskTeacherComments — { "13": "…", … }
 *   whiteboardStrokes — штрихи доски (с сервера)
 *   onMetaUpdated — после PATCH /meta/ (обновить родителя)
 *   openVariantPlayUrl — полный URL «открыть эту работу в новой вкладке»
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import API from './api';
import { ensureMathJax, escapeHtmlText } from './mathJaxUtils';
import MathContent from './MathContent';
import VariantWhiteboard from './VariantWhiteboard';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

// ── helpers ───────────────────────────────────────────────────────────────────

function stripHtml(str) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(str || '');
  return (tmp.textContent || tmp.innerText || '').replace(/\u00a0/g, ' ');
}

function normalizeAnswer(input) {
  return stripHtml(input || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function normalizeVariants(rawAnswer) {
  const cleaned = stripHtml(rawAnswer || '');
  return Array.from(new Set(
    cleaned.split(/\s*;\s*|\s*\|\s*|\s+или\s+/i)
      .map(normalizeAnswer)
      .filter(Boolean),
  ));
}

function checkAnswer(task, userInput) {
  if (task.is_part2) return 'pending';
  const keyRaw = task.answer || '';
  const userNorm = normalizeAnswer(userInput);
  if (!keyRaw) return 'pending';
  if (!userNorm) return 'empty';
  const variants = normalizeVariants(keyRaw);
  if (!variants.length) return 'pending';
  return variants.includes(userNorm) ? 'correct' : 'wrong';
}

// ── Вложения к заданию (фото / голос / файл) ─────────────────────────────────

const ATT_FILE_ICONS = { image: '🖼', video: '🎬', audio: '🎵', file: '📄' };

function TaskAnswerUploads({ taskNum, assignmentId, readOnly, files, onFileAdded, onImageClick }) {
  const imgRef = useRef(null);
  const audRef = useRef(null);
  const anyRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file) => {
    if (!file || !assignmentId) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('task_number', String(taskNum));
      const res = await fetch(`${API}/api/homework/assignment/${assignmentId}/upload-answer/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': getCookie('csrftoken') },
        body: fd,
      });
      if (res.ok && onFileAdded) onFileAdded(await res.json());
    } catch { /* ignore */ }
    setBusy(false);
  };

  if (readOnly && (!files || files.length === 0)) return null;
  if (!readOnly && !assignmentId) return null;

  const btnStyle = {
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#475569',
    fontSize: 11,
    fontWeight: 600,
    cursor: busy ? 'wait' : 'pointer',
    fontFamily: 'Montserrat, sans-serif',
  };

  return (
    <div style={{ marginTop: 10, marginBottom: 4 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Материалы к ответу</div>
      {files && files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
          {files.map((f) => (
            <div key={f.id}>
              {f.file_type === 'image' && f.url && (
                <button
                  type="button"
                  onClick={() => onImageClick && onImageClick(f.url)}
                  style={{
                    display: 'block', padding: 0, margin: 0, border: 'none', background: 'none',
                    cursor: 'zoom-in', borderRadius: 10, overflow: 'hidden', maxWidth: '100%',
                  }}
                >
                  <img
                    src={f.url}
                    alt={f.filename || ''}
                    style={{ display: 'block', maxWidth: '100%', height: 'auto', verticalAlign: 'middle' }}
                  />
                </button>
              )}
              {f.file_type === 'audio' && f.url && (
                <audio controls src={f.url} style={{ width: '100%', maxWidth: 420, height: 40 }} preload="metadata">
                  <track kind="captions" />
                </audio>
              )}
              {f.file_type === 'video' && f.url && (
                <video controls src={f.url} style={{ width: '100%', maxWidth: 480, borderRadius: 10, background: '#000' }} preload="metadata" />
              )}
              {(f.file_type === 'file' || !f.file_type || (f.file_type !== 'image' && f.file_type !== 'audio' && f.file_type !== 'video')) && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all' }}
                >
                  <span style={{ marginRight: 6 }}>{ATT_FILE_ICONS[f.file_type] || '📄'}</span>
                  {f.filename}
                </a>
              )}
              {f.file_type === 'image' && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#94a3b8', display: 'inline-block', marginTop: 4 }}
                >
                  Открыть файл
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && assignmentId && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <input ref={audRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <input ref={anyRef} type="file" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <button type="button" disabled={busy} style={btnStyle} onClick={() => imgRef.current?.click()}>Фото</button>
          <button type="button" disabled={busy} style={btnStyle} onClick={() => audRef.current?.click()}>Голос</button>
          <button type="button" disabled={busy} style={btnStyle} onClick={() => anyRef.current?.click()}>Файл</button>
        </div>
      )}
    </div>
  );
}

// ── STATE BADGE ───────────────────────────────────────────────────────────────

const STATE_STYLES = {
  correct: { bg: '#dcfce7', color: '#15803d', label: '✓ Верно' },
  wrong:   { bg: '#fee2e2', color: '#b91c1c', label: '✗ Неверно' },
  pending: { bg: '#fef9c3', color: '#92400e', label: '⏳ Проверит учитель' },
  empty:   { bg: '#f1f5f9', color: '#94a3b8', label: '' },
};

function StateBadge({ state, correctAnswer, showAnswer }) {
  if (!state || state === 'empty') return null;
  const s = STATE_STYLES[state] || STATE_STYLES.pending;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <span style={{
        display: 'inline-block', padding: '3px 10px', borderRadius: 20,
        fontSize: 12, fontWeight: 700, background: s.bg, color: s.color,
      }}>
        {s.label}
      </span>
      {showAnswer && state === 'wrong' && correctAnswer && (
        <span style={{ fontSize: 12, color: '#64748b' }}>
          Правильный ответ: <strong>{stripHtml(correctAnswer)}</strong>
        </span>
      )}
    </div>
  );
}

// ── TASK CARD ─────────────────────────────────────────────────────────────────

function TaskCard({
  task, index, readOnly, savedEntry, showCorrectAnswers, onAnswer,
  assignmentId, taskFiles, onAnswerFileAdded, onImageClick,
  isTeacher, teacherCommentForTask, onSaveTeacherComment, teacherNoteForStudent,
}) {
  const [value,   setValue]   = useState(savedEntry?.answer || '');
  const [checked, setChecked] = useState(!!savedEntry?.state && savedEntry.state !== 'empty');
  const state = checked ? (savedEntry?.state || checkAnswer(task, value)) : null;

  const num      = task.number ?? (index + 1);
  const isPart2  = task.part === 2 || String(task.part) === '2';
  const content  = task.text || task.task_template || '';
  const ansRaw = savedEntry?.answer || '';
  const answerLooksHtml = /<\s*[a-z]/i.test(String(ansRaw));
  const [tcDraft, setTcDraft] = useState(teacherCommentForTask || '');
  const [tcSaving, setTcSaving] = useState(false);

  useEffect(() => {
    setTcDraft(teacherCommentForTask || '');
  }, [teacherCommentForTask, num]);

  useEffect(() => {
    if (savedEntry?.answer !== undefined) setValue(savedEntry.answer);
    if (savedEntry?.state) setChecked(true);
  }, [savedEntry]);

  const handleCheck = () => {
    const st = checkAnswer(task, value);
    setChecked(true);
    if (onAnswer) onAnswer(num, value, st);
  };

  const handleInput = (e) => {
    setValue(e.target.value);
    if (checked) {
      setChecked(false);
      if (onAnswer) onAnswer(num, e.target.value, 'empty');
    }
  };

  const borderColor = !checked ? '#e2e8f0'
    : state === 'correct' ? '#86efac'
    : state === 'wrong'   ? '#fca5a5'
    : '#fde68a';

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: '16px 18px',
      border: `2px solid ${borderColor}`, marginBottom: 12,
      transition: 'border-color .2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: isPart2 ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#4F6EF7,#5b7cf7)',
          color: '#fff', fontWeight: 800, fontSize: 13,
        }}>{num}</span>
        {task.task_title && (
          <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>
            {task.task_title}
          </span>
        )}
        {isPart2 && (
          <span style={{ fontSize: 11, color: '#d97706', fontWeight: 700, background: '#fef9c3', padding: '1px 8px', borderRadius: 20 }}>
            Часть 2
          </span>
        )}
      </div>

      {task.file && (
        <div style={{ marginBottom: 10 }}>
          <a href={task.file} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#4F6EF7', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            📎 Файл к заданию
          </a>
        </div>
      )}

      <MathContent
        html={content}
        style={{ fontSize: 14, lineHeight: 1.7, color: '#1a1a2e', marginBottom: 12 }}
        onImageClick={onImageClick}
      />

      <TaskAnswerUploads
        taskNum={num}
        assignmentId={assignmentId}
        readOnly={readOnly}
        files={taskFiles || []}
        onFileAdded={onAnswerFileAdded}
        onImageClick={onImageClick}
      />

      {teacherNoteForStudent && String(teacherNoteForStudent).trim() && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#b45309', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Комментарий учителя к заданию
          </div>
          <MathContent
            html={escapeHtmlText(String(teacherNoteForStudent))}
            style={{ fontSize: 13, lineHeight: 1.55, color: '#78350f' }}
          />
        </div>
      )}

      {!readOnly && !isPart2 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={value}
            onChange={handleInput}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCheck(); } }}
            placeholder="Введите ответ…"
            style={{
              padding: '8px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0',
              fontSize: 14, outline: 'none', flex: '1 1 180px', maxWidth: 240,
              fontFamily: 'Montserrat, sans-serif', background: '#f8fafc',
            }}
          />
          <button
            onClick={handleCheck}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#4F6EF7', color: '#fff', fontWeight: 700,
              fontSize: 13, cursor: 'pointer', fontFamily: 'Montserrat, sans-serif',
            }}
          >
            Проверить
          </button>
        </div>
      )}

      {!readOnly && isPart2 && (
        <textarea
          value={value}
          onChange={e => { handleInput(e); if (onAnswer) onAnswer(num, e.target.value, 'pending'); }}
          placeholder="Напишите развёрнутый ответ…"
          style={{
            width: '100%', boxSizing: 'border-box', minHeight: 100,
            padding: '10px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0',
            fontSize: 13, resize: 'vertical', fontFamily: 'Montserrat, sans-serif',
          }}
        />
      )}

      {/* Readonly: ответ ученика (в т.ч. LaTeX) */}
      {readOnly && ansRaw && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            Ответ ученика
          </div>
          <MathContent
            html={answerLooksHtml ? String(ansRaw) : escapeHtmlText(String(ansRaw))}
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.6,
              color: '#1a1a2e',
              wordBreak: 'break-word',
              whiteSpace: answerLooksHtml ? 'normal' : 'pre-wrap',
            }}
            onImageClick={onImageClick}
          />
        </div>
      )}

      <StateBadge
        state={readOnly ? savedEntry?.state : (checked ? state : null)}
        correctAnswer={task.answer}
        showAnswer={readOnly && showCorrectAnswers}
      />

      {/* Teacher mode: always show correct answer */}
      {readOnly && showCorrectAnswers && !isPart2 && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>
          Эталон: <strong>{stripHtml(task.answer || '—')}</strong>
        </div>
      )}

      {isTeacher && assignmentId && onSaveTeacherComment && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Комментарий к заданию {num}</div>
          <textarea
            value={tcDraft}
            onChange={(e) => setTcDraft(e.target.value)}
            rows={3}
            placeholder="Замечание ученику по этому пункту…"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1.5px solid #e2e8f0',
              fontSize: 13,
              resize: 'vertical',
              fontFamily: 'Montserrat, sans-serif',
            }}
          />
          <button
            type="button"
            disabled={tcSaving}
            onClick={async () => {
              setTcSaving(true);
              try {
                await onSaveTeacherComment(String(num), tcDraft);
              } finally {
                setTcSaving(false);
              }
            }}
            style={{
              marginTop: 8,
              padding: '6px 14px',
              borderRadius: 8,
              border: 'none',
              background: '#4338ca',
              color: '#fff',
              fontWeight: 700,
              fontSize: 12,
              cursor: tcSaving ? 'wait' : 'pointer',
              fontFamily: 'Montserrat, sans-serif',
            }}
          >
            {tcSaving ? 'Сохранение…' : 'Сохранить комментарий'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── SCORE BAR ─────────────────────────────────────────────────────────────────

function ScoreBar({ result, tasks }) {
  if (!result || !tasks) return null;
  const part1 = tasks.filter(t => String(t.part) !== '2' && t.part !== 2);
  const correct = part1.filter(t => result[String(t.number ?? '')]?.state === 'correct').length;
  const total   = part1.length;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0;
  return (
    <div style={{
      background: 'linear-gradient(135deg,#4F6EF7,#5b7cf7)', borderRadius: 12,
      padding: '14px 20px', color: '#fff', marginBottom: 20,
      display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
    }}>
      <div>
        <div style={{ fontSize: 11, opacity: .8, marginBottom: 2 }}>Результат (Часть 1)</div>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{correct} / {total}</div>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ background: 'rgba(255,255,255,.2)', borderRadius: 20, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#fff', borderRadius: 20, transition: 'width .4s' }} />
        </div>
        <div style={{ fontSize: 11, opacity: .8, marginTop: 4 }}>{pct}%</div>
      </div>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function VariantPlayer({
  variantId,
  readOnly = false,
  savedResult = null,
  showCorrectAnswers = false,
  assignmentId = null,
  answerFiles = null,
  onSubmit,
  onClose,
  embedded = false,
  standalone = false,
  isTeacher = false,
  taskTeacherComments = null,
  whiteboardStrokes: whiteboardStrokesProp = null,
  onMetaUpdated = null,
  openVariantPlayUrl = null,
}) {
  const [variant,   setVariant]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [answers,   setAnswers]   = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [answerFilesState, setAnswerFilesState] = useState(() => (Array.isArray(answerFiles) ? answerFiles : []));
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [wbOpen, setWbOpen] = useState(false);
  const [wbStrokes, setWbStrokes] = useState(() => (Array.isArray(whiteboardStrokesProp) ? whiteboardStrokesProp : []));
  const wbSaveTimer = useRef(null);

  const taskComments = taskTeacherComments && typeof taskTeacherComments === 'object' ? taskTeacherComments : {};

  useEffect(() => { ensureMathJax(); }, []);

  useEffect(() => {
    setWbStrokes(Array.isArray(whiteboardStrokesProp) ? whiteboardStrokesProp : []);
  }, [assignmentId, whiteboardStrokesProp]);

  useEffect(() => () => {
    if (wbSaveTimer.current) clearTimeout(wbSaveTimer.current);
  }, []);

  const persistMeta = useCallback(async (body) => {
    if (!assignmentId) return null;
    try {
      const res = await fetch(`${API}/api/homework/assignment/${assignmentId}/meta/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        if (onMetaUpdated) onMetaUpdated(data);
        return data;
      }
    } catch { /* ignore */ }
    return null;
  }, [assignmentId, onMetaUpdated]);

  const scheduleWbSave = useCallback((strokes) => {
    if (wbSaveTimer.current) clearTimeout(wbSaveTimer.current);
    wbSaveTimer.current = setTimeout(() => {
      persistMeta({ whiteboard_strokes: strokes });
    }, 850);
  }, [persistMeta]);

  const handleWbStrokesChange = useCallback((updater) => {
    setWbStrokes((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      scheduleWbSave(next);
      return next;
    });
  }, [scheduleWbSave]);

  const saveTaskComment = useCallback(async (taskNum, text) => {
    await persistMeta({ task_teacher_comments: { [String(taskNum)]: text } });
  }, [persistMeta]);

  useEffect(() => {
    setAnswerFilesState(Array.isArray(answerFiles) ? answerFiles : []);
  }, [answerFiles, assignmentId]);

  const filesByTask = useMemo(() => {
    const m = {};
    (answerFilesState || []).forEach((f) => {
      const k = f.task_number != null && f.task_number !== '' ? String(f.task_number) : '_';
      if (!m[k]) m[k] = [];
      m[k].push(f);
    });
    return m;
  }, [answerFilesState]);

  const orphanFiles = filesByTask._ || [];

  const handleAnswerFileAdded = useCallback((meta) => {
    setAnswerFilesState((prev) => [...prev, meta]);
  }, []);

  useEffect(() => {
    if (savedResult && typeof savedResult === 'object') {
      setAnswers(savedResult);
    }
  }, [savedResult]);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/api/homework/variant/${variantId}/`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setVariant(data);
        setLoading(false);
      })
      .catch(e => {
        setError(`Не удалось загрузить вариант: ${e.message}`);
        setLoading(false);
      });
  }, [variantId]);

  const handleAnswer = useCallback((num, value, state) => {
    setAnswers(prev => ({
      ...prev,
      [String(num)]: { answer: value, state },
    }));
  }, []);

  const handleSubmit = async () => {
    if (!variant || !onSubmit) return;
    const part1 = variant.tasks.filter(t => String(t.part) !== '2' && t.part !== 2);
    const score = part1.filter(t => answers[String(t.number ?? '')]?.state === 'correct').length;
    setSubmitting(true);
    await onSubmit(answers, score);
    setSubmitting(false);
  };

  const answeredCount = variant
    ? variant.tasks.filter(t => {
        const a = answers[String(t.number ?? '')];
        return a?.answer && a.answer.trim();
      }).length
    : 0;

  const cardShell = {
    background: '#f8fafc',
    borderRadius: embedded ? 12 : (standalone ? 16 : 16),
    width: '100%',
    maxWidth: embedded ? '100%' : 760,
    minHeight: 200,
    position: 'relative',
    fontFamily: 'Montserrat, sans-serif',
    boxShadow: (embedded || standalone) ? 'inset 0 0 0 1px #e2e8f0' : '0 20px 60px rgba(0,0,0,.25)',
    maxHeight: embedded ? 'min(68vh, 720px)' : undefined,
    overflow: embedded ? 'hidden' : undefined,
    display: embedded ? 'flex' : undefined,
    flexDirection: embedded ? 'column' : undefined,
  };

  const bodyScroll = embedded ? { flex: 1, overflowY: 'auto', minHeight: 0 } : {};

  const inner = (
    <div style={cardShell}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
        padding: embedded ? '14px 18px 12px' : '18px 24px 14px',
        borderBottom: '1.5px solid #e2e8f0',
        background: '#fff',
        borderRadius: embedded ? '12px 12px 0 0' : '16px 16px 0 0',
        position: 'sticky', top: 0, zIndex: 1, flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: embedded ? 15 : 16, color: '#1a1a2e' }}>
            Вариант {variantId}
          </div>
          {variant && (
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
              {variant.tasks?.length} заданий
              {!readOnly && variant.tasks?.length > 0 && (
                <> · Отвечено: {answeredCount}</>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          {assignmentId && (
            <button
              type="button"
              onClick={() => setWbOpen((v) => !v)}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: wbOpen ? '1.5px solid #ca8a04' : '1px solid #e2e8f0',
                background: wbOpen ? '#fef9c3' : '#fefce8',
                color: '#854d0e',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'Montserrat, sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              Доска
            </button>
          )}
          {!standalone && openVariantPlayUrl && (
            <a
              href={openVariantPlayUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid #c7d2fe',
                background: '#eef2ff',
                color: '#3730a3',
                fontWeight: 700,
                fontSize: 12,
                textDecoration: 'none',
                fontFamily: 'Montserrat, sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Новая вкладка
            </a>
          )}
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none',
                background: '#f1f5f9', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center', color: '#64748b',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: embedded ? '16px 18px 18px' : '20px 24px 24px', ...bodyScroll }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', margin: '0 auto 12px',
                border: '3px solid #e2e8f0', borderTopColor: '#4F6EF7',
                animation: 'spin .7s linear infinite',
              }} />
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              Загружаем вариант…
            </div>
          )}

          {error && (
            <div style={{
              background: '#fee2e2', color: '#dc2626', borderRadius: 10, padding: '14px 18px',
              fontSize: 13, textAlign: 'center',
            }}>
              {error}
            </div>
          )}

          {!loading && !error && variant && (
            <>
              {/* Score bar (readonly or after submit) */}
              {(readOnly || Object.values(answers).some(a => a.state && a.state !== 'empty')) && (
                <ScoreBar result={answers} tasks={variant.tasks} />
              )}

              {orphanFiles.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: '#f1f5f9', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Вложения к работе</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {orphanFiles.map((f) => (
                      <div key={f.id}>
                        {f.file_type === 'image' && f.url && (
                          <button
                            type="button"
                            onClick={() => setLightboxSrc(f.url)}
                            style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'zoom-in', borderRadius: 8, overflow: 'hidden', maxWidth: 280 }}
                          >
                            <img src={f.url} alt="" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
                          </button>
                        )}
                        {f.file_type === 'audio' && f.url && (
                          <audio controls src={f.url} style={{ width: '100%', maxWidth: 360 }} preload="metadata" />
                        )}
                        {f.file_type === 'video' && f.url && (
                          <video controls src={f.url} style={{ width: '100%', maxWidth: 400, borderRadius: 8 }} preload="metadata" />
                        )}
                        {(!f.file_type || !['image', 'audio', 'video'].includes(f.file_type)) && (
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 12, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all' }}
                          >
                            {ATT_FILE_ICONS[f.file_type] || '📄'} {f.filename}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tasks */}
              {variant.tasks.map((task, i) => {
                const num = String(task.number ?? (i + 1));
                return (
                  <TaskCard
                    key={task.id ?? i}
                    task={task}
                    index={i}
                    readOnly={readOnly}
                    savedEntry={answers[num]}
                    showCorrectAnswers={showCorrectAnswers}
                    onAnswer={handleAnswer}
                    assignmentId={assignmentId}
                    taskFiles={filesByTask[num] || []}
                    onAnswerFileAdded={handleAnswerFileAdded}
                    onImageClick={setLightboxSrc}
                    isTeacher={isTeacher}
                    teacherCommentForTask={taskComments[num] || ''}
                    onSaveTeacherComment={isTeacher && assignmentId ? saveTaskComment : undefined}
                    teacherNoteForStudent={!isTeacher ? (taskComments[num] || '') : ''}
                  />
                );
              })}

              {/* Submit */}
              {!readOnly && onSubmit && (
                <div style={{ width: '100%', marginTop: 24 }}>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '14px 16px',
                      borderRadius: 0,
                      border: 'none',
                      background: submitting ? '#94a3b8' : '#16a34a',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 15,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      fontFamily: 'Montserrat, sans-serif',
                    }}
                  >
                    {submitting ? 'Сохранение…' : 'Сохранить'}
                  </button>
                  <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
                    Можно сохранить даже с пустыми ответами; фото и файлы уже у учителя после загрузки
                  </div>
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );

  const chrome = (
    <>
      {lightboxSrc && (
        <div
          role="presentation"
          onClick={() => setLightboxSrc(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2500,
            background: 'rgba(0,0,0,.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            cursor: 'zoom-out',
          }}
        >
          <img
            src={lightboxSrc}
            alt=""
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '96vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 4 }}
          />
        </div>
      )}
      <VariantWhiteboard
        open={wbOpen}
        onClose={() => setWbOpen(false)}
        strokes={wbStrokes}
        onStrokesChange={handleWbStrokesChange}
      />
    </>
  );

  if (embedded || standalone) {
    return (
      <div style={{ width: '100%', fontFamily: 'Montserrat, sans-serif', position: 'relative' }}>
        {inner}
        {chrome}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 2000, padding: '20px 16px', overflowY: 'auto',
      backdropFilter: 'blur(4px)',
    }}>
      {inner}
      {chrome}
    </div>
  );
}
