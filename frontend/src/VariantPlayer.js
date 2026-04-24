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
 *   cabinetHomework — ДЗ из ЛК: часть 1 «Сохранить» без проверки, без счёта/эталона до сдачи; внизу «Отправить на проверку»
 *   homeworkCabinetStatus — статус назначения (sent, submitted, …) для полоски exam-homework-bar
 *   homeworkStudentLabel — ФИ ученика в полоске при проверке учителем
 *   cabinetHomeHref — ссылка «в кабинет» в полоске (по умолчанию PUBLIC_URL)
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import API from './api';
import { cabinetSpaBasePathname } from './homeworkGeneratorNav';
import { ensureMathJax, escapeHtmlText } from './mathJaxUtils';
import MathContent from './MathContent';
import VariantWhiteboard from './VariantWhiteboard';
import TeacherTaskReviewBlock from './TeacherTaskReviewBlock';
import {
  SubjectExamCountdownProvider,
  SubjectExamCountdownCard,
} from './SubjectExamCountdowns';
import { generatorPublicBaseUrl } from './generatorVariantUrl';
import './variantPlayerExam.css';
/** Оформление как ExamPage в 01 generator (scoped .vp-exam) */
import './examGeneratorScoped.css';
import './examPageParityScoped.css';
import './variantPlayerCompact.css';
/* После всех стилей vp-exam — отступы блока проверки не перебиваются */
import './teacherTaskReviewBlock.css';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

const EXAM_CORNER_POS_KEY = 'exam_fixed_corner_pos';

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

const LEVEL_NAMES = { ege: 'ЕГЭ', oge: 'ОГЭ' };

const SUBJECT_NAMES = {
  inf: 'информатике',
  history: 'истории',
};

/** Подпись предмета для шапки варианта (как ExamPage.jsx в 01 generator). */
function examPageSubjectLabel(level, subjectKey) {
  const lv = String(level || '').toLowerCase();
  const sub = String(subjectKey || '').toLowerCase();
  if (sub === 'math') return lv === 'ege' ? 'профильной математике' : 'математике';
  if (sub === 'math_base') return lv === 'ege' ? 'базовой математике' : 'математике';
  return SUBJECT_NAMES[subjectKey] || subjectKey;
}

function formatExamTimer(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Подписи статуса назначения ДЗ — как мета в exam-homework-bar на ExamPage (01 generator). */
function homeworkCabinetStatusRu(status) {
  const s = String(status || '');
  if (s === 'sent') return 'Черновик';
  if (s === 'submitted') return 'На проверке';
  if (s === 'reviewing') return 'Проверяется';
  if (s === 'revision') return 'На доработке';
  if (s === 'reviewed') return 'Проверено';
  if (s === 'overdue') return 'Просрочено';
  if (s === 'cancelled') return 'Отменено';
  return '';
}

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

/** Вердикт части 1 для блока проверки учителя */
function teacherReviewPart1Verdict(task, savedEntry) {
  const raw = stripHtml(savedEntry?.answer || '').trim();
  if (!raw) return 'empty';
  const st = savedEntry?.state;
  if (st === 'correct') return 'correct';
  if (st === 'wrong') return 'wrong';
  const auto = checkAnswer(task, String(savedEntry?.answer || ''));
  if (auto === 'correct') return 'correct';
  if (auto === 'wrong') return 'wrong';
  /* Нет эталона в задании / не удалось сравнить — ответ есть, но не «пусто» */
  if (auto === 'pending') return 'pending';
  return 'empty';
}

/** Часть 2: развёрнутый ответ, баллы по критериям */
function teacherReviewPart2Verdict(savedEntry, teacherPart2Selection) {
  const raw = stripHtml(savedEntry?.answer || '').trim();
  if (!raw) return 'empty';
  if (teacherPart2Selection?.criterion_id != null) return 'scored';
  return 'pending';
}

function teacherReviewChipLine(s, max = 48) {
  const t = stripHtml(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '—';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

// ── Вложения к заданию (фото / голос / файл) ─────────────────────────────────

const ATT_FILE_ICONS = { image: '🖼', video: '🎬', audio: '🎵', file: '📄' };

function TaskAnswerUploads({
  taskNum, assignmentId, readOnly, files, onFileAdded, onImageClick,
  /** false — без подписи (блок внутри проверки учителя) */
  showLabel = true,
  /** Подпись секции вложений; по умолчанию «Материалы к ответу» */
  labelText = 'Материалы к ответу',
}) {
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

  return (
    <div className="lesson-solution-upload" style={{ marginTop: showLabel ? 10 : 0, marginBottom: 4, width: '100%' }}>
      {showLabel ? (
        <div className="task-author" style={{ textAlign: 'left', marginBottom: 4, marginTop: 0 }}>
          {labelText}
        </div>
      ) : null}
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input ref={imgRef} type="file" accept="image/*" className="lesson-solution-file-input" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <input ref={audRef} type="file" accept="audio/*" className="lesson-solution-file-input" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <input ref={anyRef} type="file" className="lesson-solution-file-input" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
          <button type="button" disabled={busy} className="add-button lesson-solution-upload-btn" onClick={() => imgRef.current?.click()}>Фото</button>
          <button type="button" disabled={busy} className="add-button lesson-solution-upload-btn" onClick={() => audRef.current?.click()}>Голос</button>
          <button type="button" disabled={busy} className="add-button lesson-solution-upload-btn" onClick={() => anyRef.current?.click()}>Файл</button>
        </div>
      )}
    </div>
  );
}

// ── Критерии части 2 (API генератора через ЛК) ────────────────────────────────

function TeacherPart2CriteriaPanel({
  level, subject, taskListId, taskNumber, maxScore,
  selectedCriterionId, onSelectCriterion,
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [cmax, setCmax] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !level || !subject || !taskListId) return;
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({
      level: String(level),
      subject: String(subject),
      task_list_id: String(taskListId),
    });
    fetch(`${API}/api/gen/criteria/?${q}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { criteria: [], max_score: null }))
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data.criteria) ? data.criteria : []);
        setCmax(data.max_score != null ? data.max_score : maxScore);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [open, level, subject, taskListId, maxScore]);

  if (!level || !subject || !taskListId) return null;

  return (
    <div className="vp-criteria-wrap" style={{ marginTop: 12 }}>
      <button
        type="button"
        className="add-button vp-btn-compact"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Скрыть критерии' : 'Критерии проверки (часть 2)'}
        {taskNumber != null && (
          <span style={{ marginLeft: 6, opacity: 0.85 }}>· задание {taskNumber}</span>
        )}
      </button>
      {open && (
        <div className="vp-criteria-panel" style={{ marginTop: 10 }}>
          {loading && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Загрузка критериев…</div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Критерии не найдены для этого задания.</div>
          )}
          {!loading && rows.length > 0 && (
            <table className="vp-criteria-table">
              <thead>
                <tr>
                  <th className="vp-criteria-th">Содержание критерия</th>
                  <th className="vp-criteria-th vp-criteria-th-num">Баллы</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="vp-criteria-tr">
                    <td className="vp-criteria-td">
                      <label className="vp-criteria-label">
                        <input
                          type="radio"
                          name={`vp-crit-${taskListId}-${taskNumber}`}
                          checked={selectedCriterionId === c.id}
                          onChange={() => onSelectCriterion && onSelectCriterion(c)}
                        />
                        <MathContent html={c.criteria_text || ''} className="vp-criteria-text" />
                      </label>
                    </td>
                    <td className="vp-criteria-td vp-criteria-score">{c.criteria_score}</td>
                  </tr>
                ))}
              </tbody>
              {cmax != null && (
                <tfoot>
                  <tr>
                    <td className="vp-criteria-tfoot-label">Максимум за задание</td>
                    <td className="vp-criteria-td vp-criteria-score">{cmax}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ── TASK CARD (разметка как ExamPage в «01 generator») ───────────────────────

function TaskCard({
  task, index, readOnly, savedEntry, showCorrectAnswers, onAnswer,
  assignmentId, taskFiles, onAnswerFileAdded, onImageClick,
  isTeacher, teacherCommentForTask, onSaveTeacherComment, teacherNoteForStudent,
  teacherGradingMode = false,
  variantLevel = '',
  variantSubject = '',
  teacherPart2Selection = null,
  onTeacherPart2CriterionSelect = null,
  homeworkDraftPart1 = false,
  /** Ученик: задание в списке на доработку (обводка как «вернуть» у учителя) */
  studentRevisionHighlight = false,
  taskLocked = false,
  homeworkReviewPickRevision = false,
  revisionPickSet = null,
  onToggleRevisionPick = null,
}) {
  const [value,   setValue]   = useState(savedEntry?.answer || '');
  const [checked, setChecked] = useState(!!savedEntry?.state && savedEntry.state !== 'empty');
  const readOnlyForAnswer = readOnly || taskLocked;
  const state = checked
    ? (homeworkDraftPart1 ? 'saved' : (savedEntry?.state || checkAnswer(task, value)))
    : null;

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
    if (homeworkDraftPart1) {
      setChecked(true);
      if (onAnswer) onAnswer(num, value, 'saved');
      return;
    }
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

  const subCls = task.subdivision === 'geom' ? ' task-geom' : task.subdivision === 'alg' ? ' task-alg' : '';
  const partCls = isPart2 ? ' task-part2' : '';

  const inputClass =
    `answer-input${
      checked && state === 'correct' ? ' correct' : ''
    }${checked && state === 'wrong' ? ' incorrect' : ''}${
      checked && state === 'saved' ? ' vp-answer-saved' : ''
    }`;

  const statusClass =
    `answer-status${
      checked && state === 'correct' ? ' correct' : ''
    }${checked && state === 'wrong' ? ' incorrect' : ''}${
      checked && state === 'saved' ? ' vp-answer-saved' : ''
    }`;

  const statusMark = homeworkDraftPart1 && checked
    ? ''
    : (checked
      ? (state === 'correct' ? '✓' : state === 'wrong' ? '✗' : state === 'pending' ? '…' : state === 'saved' ? '✓' : '')
      : '');

  const showTeacherReviewBlock = readOnly && teacherGradingMode && isTeacher;
  const tbVerdict = isPart2
    ? teacherReviewPart2Verdict(savedEntry, teacherPart2Selection)
    : teacherReviewPart1Verdict(task, savedEntry);
  const chipMax = isPart2 ? 96 : 48;
  const tbRef = teacherReviewChipLine(task.answer, chipMax);
  const tbAns = teacherReviewChipLine(savedEntry?.answer, chipMax);
  const shellReturned = !!(homeworkReviewPickRevision && revisionPickSet?.has(String(num)));

  const showPart2Criteria = readOnly && isPart2 && teacherGradingMode && isTeacher && task.task_list_id;
  const part2CriteriaSection = showPart2Criteria ? (
    <div className="tb-part2-criteria">
      {teacherPart2Selection?.score != null && (
        <div className="tb-part2-criteria-score">
          Набрано по критериям: <strong>{teacherPart2Selection.score}</strong> б.
        </div>
      )}
      <TeacherPart2CriteriaPanel
        level={variantLevel}
        subject={variantSubject}
        taskListId={task.task_list_id}
        taskNumber={num}
        maxScore={task.max_score ?? 3}
        selectedCriterionId={teacherPart2Selection?.criterion_id ?? null}
        onSelectCriterion={(c) => onTeacherPart2CriterionSelect && onTeacherPart2CriterionSelect({
          score: c.criteria_score ?? 0,
          criterion_id: c.id,
        })}
      />
    </div>
  ) : null;

  const taskBody = (
    <section className={`task${subCls}${partCls}`}>
      <aside className="task-left">
        <div className="task-number">{num}</div>
        {!homeworkDraftPart1 && (
          <div className="task-id">{task.id != null ? task.id : '—'}</div>
        )}
      </aside>

      <article className="task-content">
        {task.task_title && (
          <div className="task-author" style={{ textAlign: 'left', fontStyle: 'normal', fontWeight: 600, color: '#64748b' }}>
            {task.task_title}
          </div>
        )}

        <MathContent html={content} className="task-text" onImageClick={onImageClick} />

        {task.file && (
          <div className="task-files">
            <a href={task.file} target="_blank" rel="noopener noreferrer" className="task-file-link">
              <span className="task-file-icon">📎</span>
              <span className="task-file-label">Скачать файл</span>
            </a>
          </div>
        )}

        {task.author && !homeworkDraftPart1 && <div className="task-author">{task.author}</div>}

        {!homeworkDraftPart1 && (
          <TaskAnswerUploads
            taskNum={num}
            assignmentId={assignmentId}
            readOnly={readOnlyForAnswer}
            files={taskFiles || []}
            onFileAdded={onAnswerFileAdded}
            onImageClick={onImageClick}
          />
        )}

        {homeworkReviewPickRevision && isTeacher && !showTeacherReviewBlock && (
          <div className="vp-task-revision-card">
            <div className="vp-task-revision-head">
              <span className="vp-task-revision-title">Решение по заданию</span>
            </div>
            <div className="vp-task-revision-row">
              {revisionPickSet?.has(String(num)) ? (
                <span className="vp-task-revision-pill vp-task-revision-pill--warn">
                  На доработку
                </span>
              ) : (
                <span className="vp-task-revision-pill vp-task-revision-pill--ok">
                  Учтётся при приёме
                </span>
              )}
              <button
                type="button"
                className={
                  revisionPickSet?.has(String(num))
                    ? 'vp-task-revision-action vp-task-revision-action--secondary'
                    : 'vp-task-revision-action vp-task-revision-action--primary'
                }
                onClick={() => onToggleRevisionPick && onToggleRevisionPick(String(num))}
              >
                {revisionPickSet?.has(String(num)) ? 'Снять с доработки' : 'Вернуть на доработку'}
              </button>
            </div>
          </div>
        )}

        {teacherNoteForStudent && String(teacherNoteForStudent).trim() && (
          <div className="vp-teacher-note">
            <div className="vp-teacher-note-label">Комментарий учителя к заданию</div>
            <MathContent
              html={escapeHtmlText(String(teacherNoteForStudent))}
              className="task-text"
              style={{ marginBottom: 0, fontSize: '0.95rem', color: '#78350f' }}
            />
          </div>
        )}

        {!readOnlyForAnswer && !isPart2 && (
          <div className="answer-section">
            <div className={`answer-input-row${homeworkDraftPart1 ? ' answer-input-row--student-hw' : ''}`}>
              <input
                type="text"
                className={inputClass}
                value={value}
                onChange={handleInput}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCheck(); } }}
                placeholder="Введите ответ"
                disabled={checked && !homeworkDraftPart1}
              />
              {!homeworkDraftPart1 && <span className={statusClass}>{statusMark}</span>}
              {(!checked || homeworkDraftPart1) && (
                <button type="button" className="add-button vp-btn-compact" onClick={handleCheck}>
                  {homeworkDraftPart1 ? 'Сохранить' : 'Проверить'}
                </button>
              )}
            </div>
            {!homeworkDraftPart1 && (
              <div className={`correct-answer-display${checked && state === 'wrong' ? ' visible' : ''}`}>
                <span className="correct-answer-label">Правильный ответ: </span>
                <MathContent html={task.answer || ''} className="correct-answer-content" onImageClick={onImageClick} />
              </div>
            )}
          </div>
        )}

        {!readOnlyForAnswer && isPart2 && (
          <div className="answer-section">
            <textarea
              className="answer-input"
              value={value}
              onChange={(e) => {
                handleInput(e);
                if (onAnswer) onAnswer(num, e.target.value, 'pending');
              }}
              placeholder="Напишите развёрнутый ответ…"
            />
          </div>
        )}

        {homeworkDraftPart1 && !readOnlyForAnswer && (
          <TaskAnswerUploads
            taskNum={num}
            assignmentId={assignmentId}
            readOnly={false}
            files={taskFiles || []}
            onFileAdded={onAnswerFileAdded}
            onImageClick={onImageClick}
            labelText="Прикрепить решение"
          />
        )}

        {taskLocked && !readOnly && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, fontWeight: 600 }}>
            Это задание уже принято — правки не нужны
          </div>
        )}

        {(readOnly || taskLocked) && ansRaw && (
          <div className="answer-section" style={{ marginTop: '0.5rem' }}>
            <div className="vp-readonly-answer-label">Ответ ученика</div>
            <MathContent
              html={answerLooksHtml ? String(ansRaw) : escapeHtmlText(String(ansRaw))}
              className="task-text"
              style={{
                marginBottom: 0,
                fontWeight: 600,
                wordBreak: 'break-word',
                whiteSpace: answerLooksHtml ? 'normal' : 'pre-wrap',
              }}
              onImageClick={onImageClick}
            />
          </div>
        )}

        {(readOnly || taskLocked) && savedEntry?.state === 'pending' && isPart2 && (
          <div className="task-author" style={{ textAlign: 'left', color: '#92400e', fontWeight: 600 }}>
            ⏳ Ответ части 2 проверит учитель
          </div>
        )}

        {(readOnly || taskLocked) && savedEntry?.state === 'pending' && !isPart2 && (
          <div className="task-author" style={{ textAlign: 'left', color: '#92400e', fontWeight: 600 }}>
            ⏳ На проверке
          </div>
        )}

        {readOnly && showCorrectAnswers && !isPart2 && task.answer && !showTeacherReviewBlock && (
          <div className="correct-answer-display visible" style={{ marginTop: 12 }}>
            <span className="correct-answer-label">Эталон: </span>
            <MathContent html={task.answer} className="correct-answer-content" onImageClick={onImageClick} />
          </div>
        )}

        {readOnly && showCorrectAnswers && isPart2 && task.answer && !showTeacherReviewBlock && (
          <div className="part2-answer-reveal" style={{ marginTop: 12 }}>
            <span className="part2-answer-label">Правильный ответ:</span>
            <MathContent html={task.answer} className="part2-answer-content" onImageClick={onImageClick} />
          </div>
        )}

        {readOnly && isPart2 && !isTeacher && savedEntry?.teacher_score != null && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: '#eef2ff',
              border: '1px solid #c7d2fe',
              fontSize: 13,
              color: '#3730a3',
            }}
          >
            Оценка учителя за это задание:{' '}
            <strong>{savedEntry.teacher_score}</strong> б.
          </div>
        )}

        {homeworkDraftPart1 && readOnlyForAnswer && (
          <TaskAnswerUploads
            taskNum={num}
            assignmentId={assignmentId}
            readOnly
            files={taskFiles || []}
            onFileAdded={onAnswerFileAdded}
            onImageClick={onImageClick}
            labelText="Прикрепить решение"
          />
        )}

        {isTeacher && assignmentId && onSaveTeacherComment && !showTeacherReviewBlock && (
          <div className="vp-teacher-comment-box">
            <div className="vp-readonly-answer-label">Комментарий к заданию {num}</div>
            <textarea
              className="answer-input"
              value={tcDraft}
              onChange={(e) => setTcDraft(e.target.value)}
              rows={3}
              placeholder="Замечание ученику по этому пункту…"
              style={{ minHeight: 72 }}
            />
            <button
              type="button"
              className="add-button vp-btn-compact"
              disabled={tcSaving}
              onClick={async () => {
                setTcSaving(true);
                try {
                  await onSaveTeacherComment(String(num), tcDraft);
                } finally {
                  setTcSaving(false);
                }
              }}
              style={{ marginTop: 8 }}
            >
              {tcSaving ? 'Сохранение…' : 'Сохранить комментарий'}
            </button>
          </div>
        )}
      </article>
    </section>
  );

  if (showTeacherReviewBlock) {
    return (
      <div className={`task-shell${shellReturned ? ' task-shell--returned' : ''}`}>
        {taskBody}
        {part2CriteriaSection}
        <TeacherTaskReviewBlock
          taskNum={num}
          verdict={tbVerdict}
          referenceDisplay={tbRef}
          studentDisplay={tbAns}
          initialComment={teacherCommentForTask || ''}
          markedForReturn={shellReturned}
          saveBusy={tcSaving}
          attachments={
            taskFiles && taskFiles.length > 0 ? (
              <>
                <div className="tb-attachments-label">Вложения к решению</div>
                <TaskAnswerUploads
                  taskNum={num}
                  assignmentId={assignmentId}
                  readOnly
                  files={taskFiles}
                  onFileAdded={undefined}
                  onImageClick={onImageClick}
                  showLabel={false}
                />
              </>
            ) : null
          }
          onSaveComment={async (text) => {
            if (!onSaveTeacherComment) return;
            setTcSaving(true);
            try {
              await onSaveTeacherComment(String(num), text);
            } finally {
              setTcSaving(false);
            }
          }}
          onReturnTask={
            homeworkReviewPickRevision && onToggleRevisionPick
              ? () => { onToggleRevisionPick(String(num)); }
              : undefined
          }
        />
      </div>
    );
  }

  if (homeworkDraftPart1) {
    return (
      <div
        className={
          `task-shell task-shell--student-solve${
            studentRevisionHighlight ? ' task-shell--returned' : ''
          }`
        }
      >
        {taskBody}
      </div>
    );
  }

  return taskBody;
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
  /** Проверка сданной работы: { assignmentStatus, initialTeacherComment, onReview(action, payload), onReviewDone? } */
  homeworkReview = null,
  /** Номера заданий (строки) в частичной доработке — остальные только для чтения */
  revisionTaskIds = null,
  /** Ученик: сохранить черновик на сервер без сдачи */
  onSaveDraft = null,
  /** ДЗ из кабинета: мягкий режим части 1 и финальная кнопка «Отправить на проверку» */
  cabinetHomework = false,
  homeworkCabinetStatus = null,
  homeworkStudentLabel = '',
  cabinetHomeHref = null,
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
  const [teacherPart2Grades, setTeacherPart2Grades] = useState({});
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [revisionPick, setRevisionPick] = useState(() => new Set());
  const [draftBusy, setDraftBusy] = useState(false);
  const wbSaveTimer = useRef(null);
  const containerRef = useRef(null);

  const useExamPageChrome = standalone && !embedded;
  const useCompactChrome = !useExamPageChrome;

  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerStatus, setTimerStatus] = useState('idle');
  const [examFixedPanelOpen, setExamFixedPanelOpen] = useState(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null);
  const [supportInfo, setSupportInfo] = useState({ items: [], open: false });
  const [fixedCornerPos, setFixedCornerPos] = useState(null);
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
  const fixedCornerPosRef = useRef(null);

  const taskComments = taskTeacherComments && typeof taskTeacherComments === 'object' ? taskTeacherComments : {};

  const homeworkReviewActive = !!(homeworkReview
    && isTeacher && readOnly && assignmentId
    && ['submitted', 'reviewing'].includes(homeworkReview.assignmentStatus));
  const showHomeworkBar = cabinetHomework || homeworkReviewActive;
  /** Полный «угол» ExamPage (таймер, до экзамена, баллы) — не для экрана ДЗ */
  const hwExamCorner = useExamPageChrome && !showHomeworkBar;

  useEffect(() => {
    fixedCornerPosRef.current = fixedCornerPos;
  }, [fixedCornerPos]);

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
    if (homeworkReview?.initialTeacherComment != null) {
      setReviewComment(homeworkReview.initialTeacherComment || '');
    }
  }, [homeworkReview?.initialTeacherComment, assignmentId]);

  useEffect(() => {
    setRevisionPick(new Set());
  }, [assignmentId, homeworkReview?.assignmentStatus]);

  useEffect(() => {
    if (!variant?.tasks || !savedResult || typeof savedResult !== 'object') {
      setTeacherPart2Grades({});
      return;
    }
    const next = {};
    variant.tasks.forEach((t) => {
      const isP2 = String(t.part) === '2' || t.part === 2;
      if (!isP2) return;
      const nk = String(t.number ?? '');
      const ent = savedResult[nk];
      if (ent && typeof ent === 'object' && ent.teacher_score != null) {
        next[nk] = {
          score: ent.teacher_score,
          criterion_id: ent.teacher_criterion_id ?? null,
        };
      }
    });
    setTeacherPart2Grades(next);
  }, [assignmentId, variant?.id, savedResult]);

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

  useEffect(() => {
    setTimerSeconds(0);
    setTimerStatus('idle');
  }, [variantId]);

  useEffect(() => {
    if (!hwExamCorner) return;
    try {
      const raw = sessionStorage.getItem(EXAM_CORNER_POS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') {
        setFixedCornerPos({ left: p.left, top: p.top });
      }
    } catch { /* ignore */ }
  }, [hwExamCorner]);

  const cornerPlaced = fixedCornerPos != null;
  useEffect(() => {
    if (!hwExamCorner || !cornerPlaced) return;
    const onResize = () => {
      const el = fixedCornerRef.current;
      if (!el) return;
      setFixedCornerPos((prev) => {
        if (!prev) return prev;
        const c = clampExamCornerToViewport(el, prev.left, prev.top);
        try {
          sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(c));
        } catch { /* ignore */ }
        return c;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hwExamCorner, cornerPlaced]);

  useEffect(() => {
    if (!hwExamCorner) return;
    if (timerStatus !== 'running') return;
    const id = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [hwExamCorner, timerStatus]);

  useEffect(() => {
    if (!hwExamCorner || !variant) return;
    if (timerStatus === 'idle') {
      setTimerStatus('running');
    }
  }, [hwExamCorner, variant, timerStatus]);

  useEffect(() => {
    if (!hwExamCorner || !variant?.level || !variant?.subject) return;
    const lv = encodeURIComponent(String(variant.level).toLowerCase());
    const sj = encodeURIComponent(String(variant.subject).toLowerCase());
    const url = `${generatorPublicBaseUrl()}/api/${lv}/${sj}/support-info/`;
    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setSupportInfo((s) => ({ ...s, items: data.items || [] })))
      .catch(() => setSupportInfo((s) => ({ ...s, items: [] })));
  }, [hwExamCorner, variant?.id, variant?.level, variant?.subject]);

  const onFixedCornerDragStart = useCallback((e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
    } catch { /* ignore */ }
  }, []);

  const onFixedCornerDragMove = useCallback((e) => {
    const d = cornerDragRef.current;
    if (!d.active) return;
    e.preventDefault();
    const el = fixedCornerRef.current;
    if (!el) return;
    const left = d.startLeft + (e.clientX - d.startClientX);
    const top = d.startTop + (e.clientY - d.startClientY);
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
    } catch { /* ignore */ }
    const p = pendingCornerPosRef.current;
    if (p) {
      try {
        sessionStorage.setItem(EXAM_CORNER_POS_KEY, JSON.stringify(p));
      } catch { /* ignore */ }
    }
  }, []);

  const handleAnswer = useCallback((num, value, state) => {
    setAnswers(prev => ({
      ...prev,
      [String(num)]: { answer: value, state },
    }));
  }, []);

  const handleSubmit = async () => {
    if (!variant || !onSubmit) return;
    const part1 = variant.tasks.filter(t => String(t.part) !== '2' && t.part !== 2);
    const finalized = { ...answers };
    part1.forEach((t) => {
      const nk = String(t.number ?? '');
      const cell = finalized[nk];
      if (!cell || !String(cell.answer || '').trim()) return;
      const st = cell.state === 'correct' || cell.state === 'wrong'
        ? cell.state
        : checkAnswer(t, cell.answer);
      finalized[nk] = { ...cell, state: st };
    });
    const score = part1.filter(t => finalized[String(t.number ?? '')]?.state === 'correct').length;
    setSubmitting(true);
    await onSubmit(finalized, score);
    setSubmitting(false);
  };

  const handleSaveDraft = async () => {
    if (!variant || !onSaveDraft || !assignmentId) return;
    const part1 = variant.tasks.filter(t => String(t.part) !== '2' && t.part !== 2);
    const scoreGuess = part1.filter((t) => {
      const c = answers[String(t.number ?? '')];
      if (!c?.answer?.trim()) return false;
      if (c.state === 'correct') return true;
      if (c.state === 'wrong') return false;
      if (c.state === 'saved') return checkAnswer(t, c.answer) === 'correct';
      return checkAnswer(t, c.answer) === 'correct';
    }).length;
    setDraftBusy(true);
    try {
      await onSaveDraft(answers, scoreGuess);
    } finally {
      setDraftBusy(false);
    }
  };

  const answeredCount = variant
    ? variant.tasks.filter(t => {
        const a = answers[String(t.number ?? '')];
        return a?.answer && a.answer.trim();
      }).length
    : 0;

  const part1Tasks = variant
    ? variant.tasks.filter(t => String(t.part) !== '2' && t.part !== 2)
    : [];
  const part2Tasks = variant
    ? variant.tasks.filter(t => String(t.part) === '2' || t.part === 2)
    : [];
  const studentRevisionIds = (!readOnly && !isTeacher && Array.isArray(revisionTaskIds) && revisionTaskIds.length > 0)
    ? new Set(revisionTaskIds.map((x) => String(x)))
    : null;
  const visiblePart1Tasks = studentRevisionIds
    ? part1Tasks.filter((t) => studentRevisionIds.has(String(t.number ?? '')))
    : part1Tasks;
  const visiblePart2Tasks = studentRevisionIds
    ? part2Tasks.filter((t) => studentRevisionIds.has(String(t.number ?? '')))
    : part2Tasks;

  const part1CorrectCount = part1Tasks.filter(
    t => answers[String(t.number ?? '')]?.state === 'correct',
  ).length;
  const homeworkDraftPart1 = !!(
    cabinetHomework && !readOnly && !isTeacher && assignmentId
  );
  const showPart1Score = variant && part1Tasks.length > 0 && (
    readOnly || (!homeworkDraftPart1 && Object.values(answers).some(a => a.state && a.state !== 'empty'))
  );

  const lkHome = cabinetHomeHref || cabinetSpaBasePathname();
  const hwBarStatus = homeworkCabinetStatus
    || (homeworkReviewActive ? homeworkReview?.assignmentStatus : null);

  const part2TeacherSum = part2Tasks.reduce((s, t) => {
    const g = teacherPart2Grades[String(t.number ?? '')];
    return s + (g && g.score != null ? Number(g.score) : 0);
  }, 0);
  const part2GradingIncomplete = homeworkReviewActive && part2Tasks.length > 0 && part2Tasks.some((t) => {
    const g = teacherPart2Grades[String(t.number ?? '')];
    return !g || g.score == null;
  });
  const previewTotalScore = part1CorrectCount + part2TeacherSum;

  const countdownLevel = String(variant?.level || '').toLowerCase() === 'oge' ? 'oge' : 'ege';
  const levelLabel = LEVEL_NAMES[countdownLevel] || String(variant?.level || '').toUpperCase();
  const subjectKeyForExam = String(variant?.subject || '').toLowerCase();
  const subjectLabelExam = examPageSubjectLabel(countdownLevel, subjectKeyForExam);
  const part2MaxScoreSum = part2Tasks.reduce((s, t) => s + (Number(t.max_score) || 3), 0);
  const examMaxScore = part1Tasks.length + part2MaxScoreSum;
  const part2AwardedSum = part2Tasks.reduce((s, t) => {
    const e = answers[String(t.number ?? '')];
    if (e && e.teacher_score != null) return s + Number(e.teacher_score);
    return s;
  }, 0);
  const fixedCornerTotalScore = homeworkReviewActive ? previewTotalScore : (part1CorrectCount + part2AwardedSum);

  const downloadVariantPdf = useCallback(async (themeName) => {
    if (!variant) return;
    setPdfLoading(themeName || 'default');
    const base = generatorPublicBaseUrl();
    const lv = encodeURIComponent(String(variant.level).toLowerCase());
    const sj = encodeURIComponent(String(variant.subject).toLowerCase());
    const id = encodeURIComponent(String(variantId));
    const params = new URLSearchParams();
    if (themeName) params.set('theme', themeName);
    const q = params.toString();
    const url = `${base}/api/${lv}/${sj}/variant/${id}/pdf/${q ? `?${q}` : ''}`;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('pdf');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `variant-${variantId}-${themeName || 'default'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      const a = document.createElement('a');
      a.href = url;
      a.download = `variant-${variantId}.pdf`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setPdfLoading(null);
    }
  }, [variant, variantId]);

  const copyVariantLink = useCallback(async () => {
    const loc = window.location;
    const pathWithQuery = `${loc.pathname}${loc.search}${loc.hash}`;
    const isLocal = loc.hostname === 'localhost'
      || loc.hostname === '127.0.0.1'
      || loc.hostname === '[::1]';
    const url = isLocal ? loc.href : `http://генурок.рф${pathWithQuery}`;
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(url);
        ok = true;
      } catch { /* fallback */ }
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setLinkCopied(ok);
    if (ok) setTimeout(() => setLinkCopied(false), 2000);
  }, []);

  const runHomeworkReview = async (action, extra = {}) => {
    if (!homeworkReview?.onReview) return;
    if (action === 'reviewed' && part2GradingIncomplete) return;
    setReviewBusy(true);
    try {
      const part2_scores = {};
      if (action === 'reviewed') {
        Object.entries(teacherPart2Grades).forEach(([k, v]) => {
          if (v && v.score != null) {
            part2_scores[k] = {
              score: v.score,
              criterion_id: v.criterion_id ?? undefined,
            };
          }
        });
      }
      await homeworkReview.onReview(action, {
        comment: reviewComment,
        part2_scores,
        totalScore: previewTotalScore,
        revision_task_numbers: extra.revision_task_numbers,
      });
      if (homeworkReview.onReviewDone) homeworkReview.onReviewDone(action);
    } finally {
      setReviewBusy(false);
    }
  };

  const toggleRevisionPick = useCallback((numStr) => {
    setRevisionPick((prev) => {
      const next = new Set(prev);
      if (next.has(numStr)) next.delete(numStr);
      else next.add(numStr);
      return next;
    });
  }, []);

  const cardShell = standalone
    ? {
      width: '100%',
      maxWidth: 'none',
      minHeight: 0,
      background: 'transparent',
      boxShadow: 'none',
      borderRadius: 0,
      position: 'relative',
    }
    : {
      background: '#fff',
      borderRadius: embedded ? 12 : 16,
      width: '100%',
      maxWidth: embedded ? '100%' : 920,
      minHeight: 200,
      position: 'relative',
      boxShadow: embedded ? 'inset 0 0 0 1px #e2e8f0' : '0 20px 60px rgba(0,0,0,.25)',
      maxHeight: embedded ? 'min(68vh, 720px)' : undefined,
      overflow: embedded ? 'hidden' : undefined,
      display: embedded ? 'flex' : undefined,
      flexDirection: embedded ? 'column' : undefined,
    };

  const bodyScroll = embedded ? { flex: 1, overflowY: 'auto', minHeight: 0 } : {};

  const renderTaskCard = (task, i) => {
    const num = String(task.number ?? (i + 1));
    const revIds = Array.isArray(revisionTaskIds) ? revisionTaskIds.map(String) : null;
    const taskLocked = !!(revIds && revIds.length > 0 && !readOnly && !isTeacher && !revIds.includes(num));
    return (
      <TaskCard
        key={task.id ?? `t-${i}`}
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
        teacherGradingMode={homeworkReviewActive}
        variantLevel={variant?.level || ''}
        variantSubject={variant?.subject || ''}
        teacherPart2Selection={teacherPart2Grades[num] || null}
        onTeacherPart2CriterionSelect={(sel) => {
          setTeacherPart2Grades((prev) => ({ ...prev, [num]: sel }));
        }}
        homeworkDraftPart1={homeworkDraftPart1}
        studentRevisionHighlight={
          !!(homeworkDraftPart1 && revIds && revIds.length > 0 && revIds.includes(num))
        }
        taskLocked={taskLocked}
        homeworkReviewPickRevision={homeworkReviewActive}
        revisionPickSet={revisionPick}
        onToggleRevisionPick={toggleRevisionPick}
      />
    );
  };

  const mainWrapper = (
      <div
        id={standalone ? 'main-wrapper' : undefined}
        className={`main-wrapper exam-page${showHomeworkBar ? ' exam-page--homework' : ''}`}
        style={embedded ? { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 } : undefined}
        data-level={variant?.level || ''}
        data-subject={variant?.subject || ''}
      >
        {showHomeworkBar && (
          <div className="exam-homework-bar" role="region" aria-label="Домашнее задание">
            <div className="exam-homework-bar__inner">
              <div className="exam-homework-bar__title">
                <span className="exam-homework-bar__badge">Домашнее задание</span>
                {homeworkReviewActive && homeworkStudentLabel ? (
                  <span className="exam-homework-bar__meta">{homeworkStudentLabel}</span>
                ) : null}
                {hwBarStatus ? (
                  <span className="exam-homework-bar__meta">{homeworkCabinetStatusRu(hwBarStatus)}</span>
                ) : null}
              </div>
              {homeworkReviewActive ? (
                <div className="exam-homework-bar__actions">
                  <span className="exam-homework-bar__hint">
                    Просмотр. Проверка и оценки — в личном кабинете.
                  </span>
                  <a className="exam-homework-bar__link" href={lkHome} target="_blank" rel="noreferrer">
                    Открыть кабинет
                  </a>
                </div>
              ) : (
                <div className="exam-homework-bar__actions exam-homework-bar__actions--meta">
                  <span className="exam-homework-bar__notice">
                    Ответы сохраняются в кабинете. Можно вернуться к списку заданий.
                  </span>
                  <a className="exam-homework-bar__link" href={lkHome} target="_blank" rel="noreferrer">
                    Перейти в кабинет
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {useExamPageChrome && pdfLoading && (
          <div className="pdf-loading-overlay" role="status" aria-live="polite">
            <div className="pdf-loading-toast">
              <span className="pdf-loading-spinner" aria-hidden="true" />
              <span>Подождите немного, файл создаётся…</span>
            </div>
          </div>
        )}

        {hwExamCorner && variant && !error && (
          <>
            <div
              ref={fixedCornerRef}
              className={`exam-fixed-corner${examFixedPanelOpen ? '' : ' exam-fixed-corner--all-collapsed'}`}
              style={
                fixedCornerPos
                  ? { left: fixedCornerPos.left, top: fixedCornerPos.top, right: 'auto' }
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
                    <div className="variant-timer-display">{formatExamTimer(timerSeconds)}</div>
                    <div className="variant-timer-actions">
                      {(timerStatus === 'idle' || timerStatus === 'paused') && (
                        <button
                          type="button"
                          className="variant-timer-btn variant-timer-btn-start"
                          onClick={() => setTimerStatus('running')}
                          title="Старт"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        </button>
                      )}
                      {timerStatus === 'running' && (
                        <button
                          type="button"
                          className="variant-timer-btn variant-timer-btn-pause"
                          onClick={() => setTimerStatus('paused')}
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
                        onClick={() => { setTimerStatus('idle'); setTimerSeconds(0); }}
                        title="Стоп"
                        disabled={timerStatus === 'idle' && timerSeconds === 0}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="6" y="6" width="12" height="12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <SubjectExamCountdownCard subjectKey={subjectKeyForExam} />
                  <div className="variant-score-block">
                    <div className="variant-score-row">
                      <span className="variant-score-label">
                        {part2Tasks.length > 0 ? 'Баллов' : 'Правильных'}
                      </span>
                      <span className="variant-score-val">
                        {part2Tasks.length > 0 ? (
                          <>
                            {fixedCornerTotalScore}
                            {' '}
                            <span className="variant-score-total">/ {examMaxScore}</span>
                          </>
                        ) : (
                          <>
                            {part1CorrectCount}
                            {' '}
                            <span className="variant-score-total">/ {part1Tasks.length}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  {supportInfo.items?.length > 0 && (
                    <button
                      type="button"
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
          </>
        )}

        <div ref={containerRef} className="content-area" style={{ paddingBottom: wbOpen ? 82 : undefined, ...bodyScroll }}>
          <div className="container exam-page-container">
            <div className="page">
              {loading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%', margin: '0 auto 12px',
                    border: '3px solid #e2e8f0', borderTopColor: '#667eea',
                    animation: 'vp-spin .7s linear infinite',
                  }} />
                  <style>{`@keyframes vp-spin{to{transform:rotate(360deg)}}`}</style>
                  Загружаем вариант…
                </div>
              )}

              {error && (
                <div style={{
                  background: '#fee2e2', color: '#dc2626', borderRadius: 10, padding: '14px 18px',
                  fontSize: 13, textAlign: 'center',
                }}
                >
                  {error}
                </div>
              )}

              {!loading && !error && variant && (
                <>
                  <div className="variant-hero">
                    <div className="variant-hero-bg" />
                    <div className="variant-hero-content">
                      {useExamPageChrome ? (
                        <>
                          <div className="variant-hero-left">
                            <div className="variant-hero-title-stack">
                              <div className="variant-number">
                                {`Вариант № ${variant.id}`}
                              </div>
                            </div>
                          </div>
                          <div className="variant-hero-right">
                            <div className="variant-hero-actions">
                              {showHomeworkBar ? (
                                // В режиме проверки урока PDF не скачиваем локально:
                                // отчёт сохраняется на сервере и показывается во вкладке "Результаты учеников".
                                (homeworkReviewActive && isTeacher) ? null : (
                                  <button
                                    type="button"
                                    className="variant-btn-primary"
                                    onClick={() => downloadVariantPdf(null)}
                                    disabled={!!pdfLoading}
                                  >
                                    ⬇ Скачать PDF
                                  </button>
                                )
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="variant-btn-primary"
                                    onClick={() => downloadVariantPdf(null)}
                                    disabled={!!pdfLoading}
                                  >
                                    ⬇ Скачать PDF
                                  </button>
                                  <button
                                    type="button"
                                    className="variant-btn-cosmos"
                                    onClick={() => downloadVariantPdf('cosmos')}
                                    disabled={!!pdfLoading}
                                  >
                                    🪐 Космический вариант
                                  </button>
                                  <button
                                    type="button"
                                    className="variant-btn-easter"
                                    onClick={() => downloadVariantPdf('easter')}
                                    disabled={!!pdfLoading}
                                  >
                                    🐣 Пасхальный вариант
                                  </button>
                                  <button
                                    type="button"
                                    className="variant-btn-copy-link"
                                    onClick={copyVariantLink}
                                    title={linkCopied ? 'Скопировано' : 'Скопировать ссылку на вариант'}
                                    aria-label={linkCopied ? 'Скопировано' : 'Скопировать ссылку на вариант'}
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
                                  {assignmentId && (
                                    <button
                                      type="button"
                                      className={`variant-hero-icon-btn${wbOpen ? ' variant-hero-icon-btn--wb-active' : ''}`}
                                      onClick={() => setWbOpen((v) => !v)}
                                    >
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 20h9" />
                                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                      </svg>
                                      Доска
                                    </button>
                                  )}
                                  {!standalone && openVariantPlayUrl && (
                                    <a
                                      href={openVariantPlayUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="variant-hero-icon-btn"
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                        <polyline points="15 3 21 3 21 9" />
                                        <line x1="10" y1="14" x2="21" y2="3" />
                                      </svg>
                                      Новая вкладка
                                    </a>
                                  )}
                                  {!embedded && onClose && (
                                    <button type="button" className="variant-hero-close" onClick={onClose} aria-label="Закрыть">
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="variant-hero-left">
                            <div className="variant-label">Вариант</div>
                            <div className="variant-number">{variantId}</div>
                            <div className="variant-hero-meta">
                              {variant
                                ? `${variant.tasks?.length ?? 0} заданий${!readOnly && variant.tasks?.length ? ` · отвечено: ${answeredCount}` : ''}`
                                : ' '}
                            </div>
                          </div>
                          <div className="variant-hero-right">
                            {showPart1Score && (
                              <div className="variant-score-block">
                                <div className="variant-score-row">
                                  <span className="variant-score-label">Часть 1</span>
                                  <span className="variant-score-val">
                                    {part1CorrectCount}
                                    <span className="variant-score-total"> / {part1Tasks.length}</span>
                                  </span>
                                </div>
                              </div>
                            )}
                            {homeworkReviewActive && (
                              <div className="variant-score-block" style={{ marginTop: 8 }}>
                                <div className="variant-score-row">
                                  <span className="variant-score-label">Часть 2 (учитель)</span>
                                  <span className="variant-score-val">
                                    {part2TeacherSum}
                                    <span className="variant-score-total"> б</span>
                                  </span>
                                </div>
                                <div className="variant-score-row" style={{ marginTop: 4 }}>
                                  <span className="variant-score-label">Итого</span>
                                  <span className="variant-score-val">{previewTotalScore} б</span>
                                </div>
                              </div>
                            )}
                            <div className="variant-hero-actions">
                              {assignmentId && (
                                <button
                                  type="button"
                                  className={`variant-hero-icon-btn${wbOpen ? ' variant-hero-icon-btn--wb-active' : ''}`}
                                  onClick={() => setWbOpen((v) => !v)}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                                  </svg>
                                  Доска
                                </button>
                              )}
                              {!standalone && openVariantPlayUrl && (
                                <a
                                  href={openVariantPlayUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="variant-hero-icon-btn"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                    <polyline points="15 3 21 3 21 9" />
                                    <line x1="10" y1="14" x2="21" y2="3" />
                                  </svg>
                                  Новая вкладка
                                </a>
                              )}
                              {!embedded && onClose && (
                                <button type="button" className="variant-hero-close" onClick={onClose} aria-label="Закрыть">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {orphanFiles.length > 0 && (
                    <div className="vp-orphan-files">
                      <div className="vp-readonly-answer-label" style={{ marginBottom: 8 }}>Вложения к работе</div>
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
                                className="task-file-link"
                                style={{ display: 'inline-flex' }}
                              >
                                {ATT_FILE_ICONS[f.file_type] || '📄'} {f.filename}
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {visiblePart1Tasks.length > 0 && (
                    <>
                      <div className="part-divider part-divider-1">
                        <h2>Часть 1</h2>
                        <p>Краткий ответ</p>
                      </div>
                      {visiblePart1Tasks.map((task, idx) => renderTaskCard(task, idx))}
                    </>
                  )}

                  {visiblePart2Tasks.length > 0 && (
                    <>
                      <div className="part-divider part-divider-2">
                        <h2>Часть 2</h2>
                        <p>Развёрнутый ответ</p>
                      </div>
                      {visiblePart2Tasks.map((task, idx) => renderTaskCard(task, visiblePart1Tasks.length + idx))}
                    </>
                  )}

                  {!readOnly && (onSubmit || (cabinetHomework && onSaveDraft)) && (
                    <div style={{ width: '100%', marginTop: '1.1rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {cabinetHomework && onSaveDraft && (
                        <button
                          type="button"
                          onClick={handleSaveDraft}
                          disabled={draftBusy}
                          className={`add-button vp-submit-bar${draftBusy ? ' vp-submit-bar--muted' : ''}`}
                        >
                          {draftBusy ? 'Сохранение…' : 'Сохранить черновик'}
                        </button>
                      )}
                      {onSubmit && (
                        <button
                          type="button"
                          onClick={handleSubmit}
                          disabled={submitting}
                          className={`add-button vp-submit-bar${submitting ? ' vp-submit-bar--muted' : ' vp-submit-bar--success'}`}
                        >
                          {submitting ? 'Отправка…' : (cabinetHomework ? 'Отправить на проверку' : 'Сохранить')}
                        </button>
                      )}
                      {cabinetHomework && (
                        <div className="vp-submit-hint">
                          Сохраните черновик перед выходом. Отправка — когда все готово.
                        </div>
                      )}
                    </div>
                  )}

                  {homeworkReviewActive && homeworkReview && (
                    <div
                      className="vp-teacher-review-bar"
                      style={{
                        borderTop: '1px solid #e2e8f0',
                        padding: '10px 12px 12px',
                        background: '#f8fafc',
                        borderRadius: embedded ? '0 0 12px 12px' : (standalone ? 0 : '0 0 16px 16px'),
                        marginTop: '1.25rem',
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
                        Завершение проверки
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.42, marginBottom: 8 }}>
                        Выше — ответ ученика, эталон, вложения части 2 и комментарии к заданиям. Отметьте задания для частичного возврата
                        или примите работу целиком.
                      </div>
                      <textarea
                        className="answer-input"
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Общий комментарий ученику (при необходимости)…"
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, minHeight: 56, fontSize: 13 }}
                      />
                      {part2Tasks.length > 0 && part2GradingIncomplete && (
                        <div style={{ fontSize: 11, color: '#b45309', marginBottom: 8, fontWeight: 600 }}>
                          Чтобы принять работу, выставьте баллы по критериям для каждого задания части 2.
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <button
                            type="button"
                            className="add-button vp-submit-bar vp-submit-bar--success"
                            disabled={reviewBusy}
                            onClick={() => runHomeworkReview('reviewed')}
                            style={{ opacity: reviewBusy || part2GradingIncomplete ? 0.55 : 1 }}
                          >
                            {reviewBusy ? '…' : 'Принять работу и выставить оценку'}
                          </button>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b' }}>
                          Частичный возврат: отметьте задания галочками выше, затем:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <button
                            type="button"
                            className="add-button vp-submit-bar"
                            disabled={reviewBusy || revisionPick.size === 0}
                            onClick={() => runHomeworkReview('revision', { revision_task_numbers: Array.from(revisionPick) })}
                            style={{ background: '#d97706', color: '#fff', opacity: revisionPick.size === 0 ? 0.5 : 1 }}
                          >
                            {reviewBusy ? '…' : 'Вернуть на доработку только отмеченные'}
                          </button>
                          <button
                            type="button"
                            className="add-button vp-submit-bar"
                            disabled={reviewBusy}
                            onClick={() => runHomeworkReview('revision', { revision_task_numbers: [] })}
                            style={{ background: '#b45309', color: '#fff' }}
                          >
                            {reviewBusy ? '…' : 'Вернуть всю работу'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
  );

  const inner = (
    <div className={`vp-exam${embedded ? ' vp-exam--embedded' : ''}${standalone ? ' vp-exam--standalone' : ''}${useCompactChrome ? ' vp-exam--compact' : ''}`} style={cardShell}>
      {useExamPageChrome && !showHomeworkBar ? (
        <SubjectExamCountdownProvider level={countdownLevel}>{mainWrapper}</SubjectExamCountdownProvider>
      ) : (
        mainWrapper
      )}
      {useExamPageChrome && showHomeworkBar && !cabinetHomework && assignmentId && variant && !error && !loading && (
        <button
          type="button"
          className={`vp-hw-wb-fab${wbOpen ? ' vp-hw-wb-fab--active' : ''}`}
          style={{ bottom: homeworkReviewActive ? '6.75rem' : undefined }}
          onClick={() => setWbOpen((v) => !v)}
          aria-label={wbOpen ? 'Закрыть доску' : 'Доска'}
          title="Доска"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      )}
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
        containerRef={containerRef}
      />
      {supportInfo.open && supportInfo.items?.length > 0 && (
        <div
          className="vp-exam-support-modal-backdrop"
          role="presentation"
          onClick={() => setSupportInfo((s) => ({ ...s, open: false }))}
        >
          <div
            className="vp-exam-support-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vp-exam-support-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="vp-exam-support-title" style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>
              Справочная информация
            </h2>
            {supportInfo.items.map((it, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: it.html || '' }} />
            ))}
            <button
              type="button"
              className="vp-exam-support-modal-close"
              onClick={() => setSupportInfo((s) => ({ ...s, open: false }))}
            >
              Закрыть
            </button>
          </div>
        </div>
      )}
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
