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
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import API from './api';

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

// inject MathJax once; дождаться startup перед typeset (иначе LaTeX не везде)
let mathJaxInjected = false;
function ensureMathJax() {
  if (document.getElementById('mathjax-script')) return;
  if (mathJaxInjected) return;
  mathJaxInjected = true;
  window.MathJax = {
    tex: { inlineMath: [['\\(', '\\)'], ['$', '$']], displayMath: [['\\[', '\\]'], ['$$', '$$']] },
    options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'] },
    startup: { typeset: false },
  };
  const s = document.createElement('script');
  s.id = 'mathjax-script';
  s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
  s.async = true;
  document.head.appendChild(s);
}

function typesetContainer(el) {
  if (!el) return;
  const run = () => {
    if (!window.MathJax?.typesetPromise) return;
    window.MathJax.typesetPromise([el]).catch(() => {});
  };
  if (window.MathJax?.startup?.promise) {
    window.MathJax.startup.promise.then(run).catch(run);
  } else {
    run();
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (window.MathJax?.startup?.promise) {
        clearInterval(id);
        window.MathJax.startup.promise.then(run).catch(run);
      } else if (n > 200) clearInterval(id);
    }, 50);
  }
}

// ── Вложения к заданию (фото / голос / файл) ─────────────────────────────────

const ATT_FILE_ICONS = { image: '🖼', video: '🎬', audio: '🎵', file: '📄' };

function TaskAnswerUploads({ taskNum, assignmentId, readOnly, files, onFileAdded }) {
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {files.map(f => (
            <a
              key={f.id}
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all' }}
            >
              <span style={{ marginRight: 6 }}>{ATT_FILE_ICONS[f.file_type] || '📄'}</span>
              {f.filename}
            </a>
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
  assignmentId, taskFiles, onAnswerFileAdded,
}) {
  const [value,   setValue]   = useState(savedEntry?.answer || '');
  const [checked, setChecked] = useState(!!savedEntry?.state && savedEntry.state !== 'empty');
  const state = checked ? (savedEntry?.state || checkAnswer(task, value)) : null;

  const num      = task.number ?? (index + 1);
  const isPart2  = task.part === 2 || String(task.part) === '2';
  const content  = task.text || task.task_template || '';
  const contentRef = useRef(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    typesetContainer(el);
    let cancelled = false;
    let id;
    if (!window.MathJax?.typesetPromise) {
      id = setInterval(() => {
        if (cancelled) return;
        if (window.MathJax?.typesetPromise) {
          clearInterval(id);
          typesetContainer(el);
        }
      }, 80);
    }
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [content]);

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

      <div
        ref={contentRef}
        style={{ fontSize: 14, lineHeight: 1.7, color: '#1a1a2e', marginBottom: 12 }}
        dangerouslySetInnerHTML={{ __html: content }}
      />

      <TaskAnswerUploads
        taskNum={num}
        assignmentId={assignmentId}
        readOnly={readOnly}
        files={taskFiles || []}
        onFileAdded={onAnswerFileAdded}
      />

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

      {/* Readonly: show student answer with state */}
      {readOnly && savedEntry?.answer && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 12, color: '#64748b' }}>Ответ: </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a2e' }}>
            {savedEntry.answer}
          </span>
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
}) {
  const [variant,   setVariant]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [answers,   setAnswers]   = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [answerFilesState, setAnswerFilesState] = useState(() => (Array.isArray(answerFiles) ? answerFiles : []));

  useEffect(() => { ensureMathJax(); }, []);

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

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 2000, padding: '20px 16px', overflowY: 'auto',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: '#f8fafc', borderRadius: 16, width: '100%', maxWidth: 760,
        minHeight: 200, position: 'relative', fontFamily: 'Montserrat, sans-serif',
        boxShadow: '0 20px 60px rgba(0,0,0,.25)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 14px', borderBottom: '1.5px solid #e2e8f0',
          background: '#fff', borderRadius: '16px 16px 0 0', position: 'sticky', top: 0, zIndex: 1,
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1a1a2e' }}>
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
          <button
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
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px' }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {orphanFiles.map(f => (
                      <a
                        key={f.id}
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 12, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all' }}
                      >
                        {ATT_FILE_ICONS[f.file_type] || '📄'} {f.filename}
                      </a>
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
    </div>
  );
}
