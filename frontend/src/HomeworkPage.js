import { useState, useEffect, useRef, useCallback } from 'react';
import API from './api';
import {
  openHomeworkOnGenerator,
  buildHomeworkReviewPlayUrl,
  cabinetSpaBasePathname,
  cabinetSpaPlayerOrigin,
} from './homeworkGeneratorNav';
import ImageAnnotationCanvas from './ImageAnnotationCanvas';
import { ResponsivePageHeader, MobileStickyActions } from './components/ResponsiveUi';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

/** URL текущего приложения с ?variant_play= — полноэкранная страница варианта (см. App.js). */
export function buildVariantPlayUrl(assignmentId) {
  if (typeof window === 'undefined') return '';
  const u = new URL(window.location.href);
  u.searchParams.set('variant_play', String(assignmentId));
  return u.toString();
}

/** Ученик: сразу на генератор (join-url); при ошибке — встроенный плеер ЛК. */
async function openStudentAssignmentOnGenerator(a) {
  if (!a?.id) return;
  try {
    await openHomeworkOnGenerator(a.id);
  } catch {
    const u = new URL(cabinetSpaBasePathname(), cabinetSpaPlayerOrigin());
    u.searchParams.set('variant_play', String(a.id));
    u.searchParams.set('hw_local', '1');
    u.searchParams.delete('homework_room');
    window.location.assign(u.toString());
  }
}

/** Текст ошибки из ответа DRF (detail / error / поля формы). */
async function parseApiErrorResponse(res, fallback) {
  try {
    const data = await res.json();
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((x) => (typeof x === 'string' ? x : x?.string || String(x))).join(' ');
    }
    if (typeof data.error === 'string') return data.error;
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length) return v.map(String).join(' ');
      if (typeof v === 'string') return v;
    }
  } catch { /* empty */ }
  return fallback || `Ошибка (${res.status})`;
}

const STATUS_LABEL = {
  sent:      'Задано',
  submitted: 'Сдано',
  reviewing: 'На проверке',
  reviewed:  'Проверено',
  revision:  'На доработке',
  overdue:   'Просрочено',
  cancelled: 'Отменено',
};

const STATUS_COLOR = {
  sent:      { bg: '#EFF6FF', color: '#1D4ED8' },
  submitted: { bg: '#F0FDF4', color: '#15803D' },
  reviewing: { bg: '#FFFBEB', color: '#B45309' },
  reviewed:  { bg: '#F0FDF4', color: '#15803D' },
  revision:  { bg: '#FEF2F2', color: '#B91C1C' },
  overdue:   { bg: '#FEF2F2', color: '#B91C1C' },
  cancelled: { bg: '#F1F5F9', color: '#94A3B8' },
};

const FILE_ICONS = {
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  file:  '📄',
};

function fmtDate(str) {
  if (!str) return '—';
  try {
    return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return str; }
}

function isOverdue(deadline) {
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

function initials(name = '', surname = '') {
  return ((name[0] || '') + (surname[0] || '')).toUpperCase();
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS_COLOR[status] || { bg: '#f1f5f9', color: '#64748b' };
  return (
    <span style={{
      display: 'inline-block', borderRadius: 20, padding: '3px 10px',
      fontSize: 11, fontWeight: 700, background: s.bg, color: s.color,
    }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

// ── FileList (teacher attachments or student answers) ─────────────────────────
const answerFileCard = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  overflow: 'hidden',
  background: '#fff',
};

function FileList({
  files,
  showAnnotations,
  layout = 'list',
  assignmentId,
  onAnnotationsSaved,
  teacherCanAttachAnnotationToComment,
  onTeacherFeedbackUploaded,
}) {
  const [annotating, setAnnotating] = useState(null);
  const [pendingAnnotations, setPending] = useState({});
  const annotateCanvasRef = useRef(null);
  const canvasRefsByFile = useRef({});

  const saveAnnotations = async (fileId, data) => {
    try {
      const res = await fetch(`${API}/api/homework/answer/${fileId}/annotate/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({ annotations: data }),
      });
      if (res.ok && onAnnotationsSaved) onAnnotationsSaved(await res.json());
    } catch {}
  };

  const attachMarkupForFile = async (f) => {
    const canvas = canvasRefsByFile.current[f.id] ?? annotateCanvasRef.current;
    const blob = await canvas?.exportPng();
    if (!blob || !assignmentId) return;
    const base = (f.filename || 'image').replace(/\.[^.]+$/i, '');
    const fd = new FormData();
    fd.append('file', blob, `разметка_${base}.png`);
    fd.append('source_answer_file_id', String(f.id));
    try {
      const res = await fetch(
        `${API}/api/homework/assignment/${assignmentId}/upload-teacher-feedback/`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-CSRFToken': getCookie('csrftoken') },
          body: fd,
        },
      );
      if (res.ok && onTeacherFeedbackUploaded) {
        onTeacherFeedbackUploaded(await res.json());
      }
    } catch { /* ignore */ }
  };

  if (!files || files.length === 0) {
    return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  }

  const useCardLayout = layout === 'cards' && showAnnotations;

  if (useCardLayout) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {files.map((f) => (
          f.file_type === 'image' ? (
            <div key={f.id} style={answerFileCard}>
              <div style={{
                padding: '12px 14px',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                background: '#fafbfc',
              }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{FILE_ICONS.image}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', wordBreak: 'break-all' }}>
                      {f.filename}
                    </div>
                    {f.task_number != null && f.task_number !== '' && (
                      <span style={{
                        display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 700,
                        color: '#4338ca', background: '#eef2ff', padding: '2px 8px', borderRadius: 20,
                      }}
                      >
                        Задание {f.task_number}
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 12, fontWeight: 600, color: '#4F6EF7', textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Открыть оригинал
                </a>
              </div>
              <div style={{ padding: 12, background: '#f8fafc' }}>
                <ImageAnnotationCanvas
                  ref={(el) => {
                    if (el) canvasRefsByFile.current[f.id] = el;
                    else delete canvasRefsByFile.current[f.id];
                  }}
                  imageUrl={f.url}
                  annotations={pendingAnnotations[f.id] ?? f.annotations ?? []}
                  readOnly={false}
                  onChange={(data) => {
                    setPending((prev) => ({ ...prev, [f.id]: data }));
                  }}
                />
              </div>
              <div style={{
                padding: '10px 14px',
                borderTop: '1px solid #f1f5f9',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                background: '#fff',
              }}
              >
                <button
                  type="button"
                  onClick={() => saveAnnotations(f.id, pendingAnnotations[f.id] ?? f.annotations ?? [])}
                  style={{
                    padding: '8px 16px', borderRadius: 8,
                    background: '#4F6EF7', color: '#fff', border: 'none',
                    cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    fontFamily: 'Montserrat, sans-serif',
                  }}
                >
                  Сохранить разметку
                </button>
                {teacherCanAttachAnnotationToComment && assignmentId && (
                  <button
                    type="button"
                    onClick={() => attachMarkupForFile(f)}
                    style={{
                      padding: '8px 16px', borderRadius: 8,
                      background: '#15803d', color: '#fff', border: 'none',
                      cursor: 'pointer', fontWeight: 700, fontSize: 12,
                      fontFamily: 'Montserrat, sans-serif',
                    }}
                  >
                    Прикрепить к комментарию
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div
              key={f.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff',
              }}
            >
              <span style={{ fontSize: 16 }}>{FILE_ICONS[f.file_type] || '📄'}</span>
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 13, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all', fontWeight: 600 }}
                download
              >
                {f.task_number != null && f.task_number !== '' ? `[Зад. ${f.task_number}] ` : ''}
                {f.filename}
              </a>
            </div>
          )
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {files.map(f => (
        <div key={f.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{FILE_ICONS[f.file_type] || '📄'}</span>
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: '#4F6EF7', textDecoration: 'none', wordBreak: 'break-all' }}
              download
            >
              {f.task_number != null && f.task_number !== '' ? `[Зад. ${f.task_number}] ` : ''}
              {f.filename}
            </a>
            {showAnnotations && f.file_type === 'image' && (
              <button
                type="button"
                onClick={() => setAnnotating(annotating === f.id ? null : f.id)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid #e2e8f0',
                  background: annotating === f.id ? '#4F6EF7' : '#fff',
                  color: annotating === f.id ? '#fff' : '#64748b',
                  cursor: 'pointer', fontWeight: 600,
                }}
              >
                {annotating === f.id ? 'Закрыть' : '✏️ Аннотация'}
              </button>
            )}
          </div>
          {annotating === f.id && f.file_type === 'image' && (
            <div style={{ marginTop: 8 }}>
              <ImageAnnotationCanvas
                ref={annotateCanvasRef}
                imageUrl={f.url}
                annotations={pendingAnnotations[f.id] ?? f.annotations ?? []}
                readOnly={!showAnnotations}
                onChange={(data) => {
                  setPending(prev => ({ ...prev, [f.id]: data }));
                }}
              />
              {showAnnotations && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => saveAnnotations(f.id, pendingAnnotations[f.id] ?? f.annotations ?? [])}
                    style={{
                      padding: '6px 16px', borderRadius: 8,
                      background: '#4F6EF7', color: '#fff', border: 'none',
                      cursor: 'pointer', fontWeight: 700, fontSize: 12,
                    }}
                  >
                    Сохранить аннотации
                  </button>
                  {teacherCanAttachAnnotationToComment && assignmentId && (
                    <button
                      type="button"
                      onClick={() => attachMarkupForFile(f)}
                      style={{
                        padding: '6px 16px', borderRadius: 8,
                        background: '#15803d', color: '#fff', border: 'none',
                        cursor: 'pointer', fontWeight: 700, fontSize: 12,
                      }}
                    >
                      Прикрепить к комментарию
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── CreateHomeworkModal ───────────────────────────────────────────────────────
function CreateHomeworkModal({ students, onClose, onCreated }) {
  const [variantId, setVariantId] = useState('');
  const [title,     setTitle]     = useState('');
  const [subject,   setSubject]   = useState('');
  const [text,      setText]      = useState('');
  const [deadline,  setDeadline]  = useState('');
  const [files,     setFiles]     = useState([]);
  const [selStudents, setSelStudents] = useState([]);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const fileRef = useRef(null);

  const submit = async () => {
    if (!variantId) { setError('Укажите номер варианта'); return; }
    const vid = parseInt(String(variantId), 10);
    if (!Number.isFinite(vid) || vid < 1) { setError('Укажите корректный номер варианта (целое число ≥ 1)'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(`${API}/api/homework/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({ variant_id: vid, title, subject, text, deadline: deadline || undefined }),
      });
      if (!res.ok) {
        setError(await parseApiErrorResponse(res, 'Не удалось создать задание'));
        setSaving(false);
        return;
      }
      const hw = await res.json();

      // Upload attachments
      for (const f of files) {
        const fd = new FormData();
        fd.append('homework_id', hw.id);
        fd.append('file', f);
        await fetch(`${API}/api/homework/upload-attachment/`, {
          method: 'POST', credentials: 'include',
          headers: { 'X-CSRFToken': getCookie('csrftoken') },
          body: fd,
        });
      }

      // Assign to students
      if (selStudents.length > 0) {
        await fetch(`${API}/api/homework/${hw.id}/assign/`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify({ student_ids: selStudents }),
        });
      }

      onCreated(hw);
    } catch (e) {
      setError('Ошибка: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStudent = (id) =>
    setSelStudents(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Новое домашнее задание</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && <div style={{ color: '#dc2626', fontSize: 12, background: '#fef2f2', padding: '8px 12px', borderRadius: 8 }}>{error}</div>}

          <div style={fieldWrap}>
            <label style={labelStyle}>Номер варианта *</label>
            <input style={inputStyle} type="number" min="1" placeholder="Например: 42" value={variantId} onChange={e => setVariantId(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Название задания</label>
            <input style={inputStyle} type="text" placeholder="Квадратные уравнения §5" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Предмет</label>
            <input style={inputStyle} type="text" placeholder="Математика" value={subject} onChange={e => setSubject(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Комментарий (необязательно)</label>
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder="Прочитать §5, решить задачи 1–10" value={text} onChange={e => setText(e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Срок сдачи</label>
            <input style={inputStyle} type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>Прикрепить файлы</label>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files))} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ ...outlineBtn, alignSelf: 'flex-start' }}
            >
              📎 Выбрать файлы
            </button>
            {files.length > 0 && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {files.map((f, i) => (
                  <span key={i} style={{ fontSize: 11, background: '#f1f5f9', padding: '2px 8px', borderRadius: 12, color: '#475569' }}>
                    {f.name}
                    <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', marginLeft: 4, fontSize: 11 }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {students && students.length > 0 && (
            <div style={fieldWrap}>
              <label style={labelStyle}>Назначить ученикам</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 140, overflowY: 'auto' }}>
                {students.map(s => {
                  const sid = s.student;
                  const selected = selStudents.includes(sid);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleStudent(sid)}
                      style={{
                        padding: '4px 12px', borderRadius: 20, border: '1.5px solid',
                        borderColor: selected ? '#4F6EF7' : '#e2e8f0',
                        background: selected ? '#EFF6FF' : '#fff',
                        color: selected ? '#1D4ED8' : '#475569',
                        fontSize: 12, cursor: 'pointer', fontWeight: selected ? 700 : 400,
                        fontFamily: 'Montserrat, sans-serif',
                      }}
                    >
                      {s.student_name} {s.student_surname}
                    </button>
                  );
                })}
              </div>
              {selStudents.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#64748b' }}>
                  Выбрано: {selStudents.length}
                </div>
              )}
            </div>
          )}

          <button
            onClick={submit}
            disabled={saving}
            style={{
              marginTop: 4, padding: '12px 0', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg, #4F6EF7, #5b7cf7)',
              color: '#fff', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1, fontFamily: 'Montserrat, sans-serif',
            }}
          >
            {saving ? 'Создание…' : 'Создать ДЗ'}
          </button>
        </div>
      </div>
    </div>
  );
}


// Палитры обложек — разные цвета, все приглушённые и сочетаемые
const COVER_PALETTES = [
  { from: '#667eea', to: '#764ba2' },   // индиго → фиолет
  { from: '#43b89c', to: '#2d8f76' },   // изумрудный
  { from: '#f7797d', to: '#c44569' },   // коралловый
  { from: '#f7b733', to: '#e67e22' },   // янтарный
  { from: '#5f72bd', to: '#9b59b6' },   // синий → пурпур
  { from: '#56ccf2', to: '#2f80ed' },   // голубой
  { from: '#eb5757', to: '#b92b27' },   // красный
  { from: '#6fcf97', to: '#219653' },   // мятно-зелёный
];

function coverGradient(id) {
  const p = COVER_PALETTES[(id || 0) % COVER_PALETTES.length];
  return `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)`;
}

// Волнистая SVG-обложка (декоративная)
function CoverWaves({ gradient, cancelled }) {
  return (
    <div style={{
      height: 120, borderRadius: '12px 12px 0 0', overflow: 'hidden',
      background: cancelled ? '#E2E8F0' : gradient,
      position: 'relative', flexShrink: 0,
    }}>
      <svg
        viewBox="0 0 400 120" preserveAspectRatio="none"
        style={{ position: 'absolute', bottom: 0, width: '100%', height: '100%', opacity: 0.25 }}
      >
        <path d="M0,60 C80,100 160,20 240,60 C320,100 360,40 400,60 L400,120 L0,120 Z" fill="#fff" />
        <path d="M0,80 C60,60 140,100 220,75 C300,50 360,90 400,80 L400,120 L0,120 Z" fill="#fff" opacity="0.5" />
      </svg>
      {cancelled && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, opacity: 0.4,
        }}>🚫</div>
      )}
    </div>
  );
}

// ── HomeworkCard ──────────────────────────────────────────────────────────────
function HomeworkCard({ hw, onClick, isTeacher, onCancelAll, cardIndex = 0 }) {
  const isCancelled = hw.status === 'cancelled' || hw.all_cancelled === true;
  const title   = hw.homework_title || hw.title || `Вариант ${hw.variant_id}`;
  const subject = hw.subject || hw.homework?.subject || null;
  const gradient = coverGradient((hw.id || cardIndex) + (isTeacher ? 0 : 3));

  // ── Отменённая карточка (и для ученика, и для учителя) ───────────────────
  if (isCancelled) {
    return (
      <div style={{
        background: '#fff', borderRadius: 14, overflow: 'hidden',
        border: '1.5px solid #E2E8F0', opacity: 0.6,
        cursor: isTeacher ? 'pointer' : 'default', userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,.04)',
        display: 'flex', flexDirection: 'column',
      }}
        onClick={isTeacher ? onClick : undefined}
      >
        <CoverWaves gradient={gradient} cancelled />
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#94A3B8', textDecoration: 'line-through', fontFamily: 'Unbounded, sans-serif' }}>{title}</div>
              {subject && (
                <span style={subjectChip('#E2E8F0', '#94A3B8')}>{subject}</span>
              )}
            </div>
            <span style={{
              ...subjectChip('#F1F5F9', '#94A3B8'),
              border: '1px solid #E2E8F0', whiteSpace: 'nowrap',
            }}>🚫 Отменено</span>
          </div>
          <div style={{ fontSize: 11, color: '#CBD5E1' }}>
            Сдать до: {fmtDate(hw.deadline)}
            {isTeacher && hw.assigned_count > 0 && (
              <span style={{ marginLeft: 8 }}>· {hw.assigned_count} учеников</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Обычная карточка ──────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: '#fff', borderRadius: 14, overflow: 'hidden',
        border: '1.5px solid #E8EBF5', cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(102,126,234,.07)',
        transition: 'box-shadow .2s, transform .2s',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(102,126,234,.16)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 2px 10px rgba(102,126,234,.07)'; e.currentTarget.style.transform = 'none'; }}
    >
      {/* Обложка со статус-бейджем */}
      <div onClick={onClick} style={{ cursor: 'pointer', position: 'relative' }}>
        <CoverWaves gradient={gradient} />
        {!isTeacher && hw.status && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(4px)',
            borderRadius: 20, padding: '4px 10px',
            fontSize: 11, fontWeight: 700,
            color: STATUS_COLOR[hw.status]?.color || '#64748b',
            boxShadow: '0 2px 8px rgba(0,0,0,.10)',
          }}>
            {STATUS_LABEL[hw.status] || hw.status}
          </div>
        )}
        {isTeacher && hw.assigned_count != null && (
          <div style={{
            position: 'absolute', top: 10, right: 10,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(4px)',
            borderRadius: 20, padding: '4px 10px',
            fontSize: 11, fontWeight: 700, color: '#667eea',
            boxShadow: '0 2px 8px rgba(0,0,0,.10)',
          }}>
            👥 {hw.assigned_count}
          </div>
        )}
      </div>

      {/* Контент */}
      <div onClick={onClick} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Строка 1: заголовок */}
        <div style={{ fontWeight: 800, fontSize: 13, color: '#1a1a2e', lineHeight: 1.4, fontFamily: 'Unbounded, sans-serif' }}>
          {title}
        </div>

        {/* Строка 2: чипы */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minHeight: 22 }}>
          {subject && <span style={subjectChip('#EEF0FE', '#667eea')}>{subject}</span>}
          {isTeacher && hw.attachments?.length > 0 && (
            <span style={subjectChip('#F1F5F9', '#94a3b8')}>📎 {hw.attachments.length}</span>
          )}
          {!isTeacher && hw.score != null && (
            <span style={subjectChip('#EEF0FE', '#667eea')}>✦ {hw.score} б</span>
          )}
          {!subject && !hw.score && !hw.attachments?.length && (
            <span style={{ display: 'inline-block', height: 22 }} />
          )}
        </div>

        {/* Разделитель */}
        <div style={{ height: 1, background: '#F1F5F9', margin: '0 -16px' }} />

        {/* Дата */}
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          Сдать до&nbsp;
          <strong style={{ color: isOverdue(hw.deadline) ? '#EF4444' : '#334155', fontWeight: 700 }}>
            {fmtDate(hw.deadline)}
          </strong>
        </div>

        {/* Кнопки */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Учитель — всегда Смотреть */}
          {isTeacher && (
            <button
              onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#3e5bd4', color: '#fff',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Montserrat, sans-serif',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2f4bbf'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3e5bd4'; }}
            >
              Смотреть
            </button>
          )}

          {/* Ученик — зависит от статуса */}
          {!isTeacher && ['sent', 'overdue'].includes(hw.status) && (
            <button
              onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#3e5bd4', color: '#fff',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Montserrat, sans-serif',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#2f4bbf'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#3e5bd4'; }}
            >
              Решать
            </button>
          )}
          {!isTeacher && hw.status === 'revision' && (
            <button
              onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
                background: '#D97706', color: '#fff',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Montserrat, sans-serif',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#B45309'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#D97706'; }}
            >
              Перерешать
            </button>
          )}

          {isTeacher && onCancelAll && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancelAll(hw); }}
              title="Отменить ДЗ"
              style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                border: '1.5px solid #FCA5A5',
                background: '#FFF5F5', color: '#EF4444',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#FEE2E2'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#FFF5F5'; }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function subjectChip(bg, color) {
  return {
    display: 'inline-block', borderRadius: 20, padding: '3px 10px',
    fontSize: 11, fontWeight: 600, background: bg, color,
    lineHeight: 1.4,
  };
}


// ── Main HomeworkPage ─────────────────────────────────────────────────────────
const TAB_PALETTE = {
  all:       { activeBg: 'linear-gradient(135deg,#667eea,#586fd7)', activeColor: '#fff',    border: '#667eea' },
  pending:   { activeBg: '#FEF3C7',  activeColor: '#B45309', border: '#FCD34D' },
  overdue:   { activeBg: '#FEE2E2',  activeColor: '#B91C1C', border: '#FCA5A5' },
  cancelled: { activeBg: '#F1F5F9',  activeColor: '#64748B', border: '#CBD5E1' },
  submitted: { activeBg: '#DCFCE7',  activeColor: '#15803D', border: '#86EFAC' },
  reviewed:  { activeBg: '#EEF0FE',  activeColor: '#4338CA', border: '#A5B4FC' },
  revision:  { activeBg: '#FEF3C7',  activeColor: '#B45309', border: '#FCD34D' },
  default:   { activeBg: 'linear-gradient(135deg,#667eea,#586fd7)', activeColor: '#fff',    border: '#667eea' },
};

const TAB_TEACHER = [
  { id: 'all',       label: 'Активные' },
  { id: 'pending',   label: 'На проверке' },
  { id: 'overdue',   label: 'Просрочено' },
  { id: 'cancelled', label: 'Отменённые' },
];

const TAB_STUDENT = [
  { id: 'all',       label: 'Ожидает решения' },
  { id: 'submitted', label: 'Сдано' },
  { id: 'revision',  label: 'Возвращено' },
  { id: 'reviewed',  label: 'Проверено' },
  { id: 'cancelled', label: 'Отменённые' },
];

export default function HomeworkPage({ isStudent = false }) {
  const [tab,          setTab]          = useState('all');
  const [homeworks,    setHomeworks]    = useState([]);
  const [assignments,  setAssignments]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [createOpen,   setCreateOpen]   = useState(false);
  const [students,     setStudents]     = useState([]);
  const [selectedHwAssignments, setSelectedHwAssignments] = useState([]);
  const [assignView,   setAssignView]   = useState(null);

  /** Учитель: полноэкранная страница варианта в этой же вкладке (как страница урока). */
  const openTeacherAssignmentRoom = useCallback((assignmentId) => {
    if (!assignmentId) return;
    const url = buildHomeworkReviewPlayUrl(assignmentId);
    if (url) window.location.assign(url);
  }, []);

  const fetchData = useCallback(() => {
    setLoading(true);
    if (isStudent) {
      fetch(`${API}/api/homework/my/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .then(data => { setAssignments(Array.isArray(data) ? data : []); })
        .catch(() => setAssignments([]))
        .finally(() => setLoading(false));
    } else {
      fetch(`${API}/api/homework/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .then(data => { setHomeworks(Array.isArray(data) ? data : []); })
        .catch(() => setHomeworks([]))
        .finally(() => setLoading(false));
    }
  }, [isStudent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!isStudent) {
      fetch(`${API}/api/students/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .then(data => setStudents(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [isStudent]);

  const openTeacherHw = async (hw) => {
    const res = await fetch(`${API}/api/homework/${hw.id}/assignments/`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      setSelectedHwAssignments(data);
      setAssignView(hw);
    }
  };

  const cancelAllAssignments = async (hw) => {
    const label = hw.title || `Вариант ${hw.variant_id}`;
    if (!window.confirm(`Отменить ДЗ «${label}» для всех учеников?`)) return;
    try {
      const res = await fetch(`${API}/api/homework/${hw.id}/cancel-all/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': getCookie('csrftoken') },
      });
      if (res.ok) {
        setHomeworks(prev =>
          prev.map(h => h.id === hw.id ? { ...h, all_cancelled: true } : h),
        );
      }
    } catch {}
  };

  const filteredAssignments = assignments.filter(a => {
    if (tab === 'cancelled') return a.status === 'cancelled';
    if (tab === 'submitted') return ['submitted', 'reviewing'].includes(a.status);
    if (tab === 'revision')  return a.status === 'revision';
    if (tab === 'reviewed')  return a.status === 'reviewed';
    // 'all' = ожидает решения
    return ['sent', 'overdue'].includes(a.status);
  });

  const filteredHomeworks = homeworks.filter(hw => {
    const cancelled = hw.all_cancelled === true;
    if (tab === 'cancelled') return cancelled;
    if (tab === 'pending')   return !cancelled && hw.assigned_count > 0;
    if (tab === 'overdue')   return !cancelled && isOverdue(hw.deadline);
    // 'all' = активные (без отменённых)
    return !cancelled;
  });

  const tabs = isStudent ? TAB_STUDENT : TAB_TEACHER;

  /** Подстраница «как урок»: список учеников по выбранному ДЗ, без модального оверлея */
  if (!isStudent && assignView) {
    return (
      <div style={{ fontFamily: 'Montserrat, sans-serif', padding: '0 0 32px' }}>
        <div style={{ marginBottom: 20 }}>
          <button
            type="button"
            onClick={() => setAssignView(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 0', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 700, color: '#64748b', fontFamily: 'Montserrat, sans-serif',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            К списку заданий
          </button>
        </div>

        <div style={{
          background: '#fff',
          borderRadius: 16,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 8px rgba(15,23,42,.06)',
          overflow: 'hidden',
          maxWidth: 920,
          margin: '0 auto',
        }}
        >
          <div style={{
            padding: '20px 24px',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
          }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1e293b', fontFamily: 'Unbounded, sans-serif' }}>
              {assignView.title || `Вариант ${assignView.variant_id}`}
            </h2>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#64748b' }}>
              Назначено ученикам: {selectedHwAssignments.length}. Выберите ученика — откроется страница проверки работы.
            </p>
          </div>

          <div style={{ padding: '16px 24px 28px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            {selectedHwAssignments.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 14 }}>
                Никому не назначено. Назначьте через страницу ученика.
              </div>
            ) : selectedHwAssignments.map((a) => {
              const isCancelled = a.status === 'cancelled';
              return (
                <div
                  key={a.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 16px', borderRadius: 12,
                    border: `1px solid ${isCancelled ? '#E2E8F0' : '#e2e8f0'}`,
                    background: isCancelled ? '#F8FAFC' : '#fff',
                    opacity: isCancelled ? 0.65 : 1,
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={isCancelled ? -1 : 0}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: isCancelled ? 'default' : 'pointer' }}
                    onClick={() => { if (!isCancelled) openTeacherAssignmentRoom(a.id); }}
                    onKeyDown={(e) => { if (!isCancelled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTeacherAssignmentRoom(a.id); } }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: '50%',
                      background: isCancelled ? '#E2E8F0' : 'linear-gradient(135deg,#667eea,#586fd7)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: isCancelled ? '#94A3B8' : '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}
                    >
                      {initials(a.student_name, a.student_surname)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: isCancelled ? '#94A3B8' : '#1a1a2e', textDecoration: isCancelled ? 'line-through' : 'none' }}>
                        {a.student_name} {a.student_surname}
                      </div>
                      {a.submitted_at && !isCancelled && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Сдано {fmtDate(a.submitted_at)}</div>
                      )}
                      {isCancelled && (
                        <div style={{ fontSize: 12, color: '#CBD5E1', marginTop: 2 }}>Задание отменено</div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {!isCancelled && a.score != null && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#667eea' }}>{a.score} б</span>
                    )}
                    {!isCancelled && a.answer_count > 0 && (
                      <span style={{ fontSize: 12, color: '#9ca3af' }}>📎 {a.answer_count}</span>
                    )}
                    <StatusBadge status={a.status} />
                    {!isCancelled && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openTeacherAssignmentRoom(a.id); }}
                        style={{
                          padding: '8px 14px', borderRadius: 10, border: '1px solid #c7d2fe',
                          background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', color: '#3730a3', fontSize: 12, fontWeight: 700,
                          fontFamily: 'Montserrat, sans-serif', whiteSpace: 'nowrap', cursor: 'pointer',
                        }}
                      >
                        Проверить работу
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {createOpen && (
          <CreateHomeworkModal
            students={students}
            onClose={() => setCreateOpen(false)}
            onCreated={(hw) => {
              setHomeworks(prev => [hw, ...prev]);
              setCreateOpen(false);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Montserrat, sans-serif', padding: '0 0 32px' }}>
      {/* Header */}
      <ResponsivePageHeader
        title={isStudent ? 'Мои задания' : 'Домашние задания'}
        subtitle={isStudent
          ? (() => { const n = assignments.filter(a => a.status !== 'cancelled').length; return `${n} активн${n === 1 ? 'ое' : 'ых'}`; })()
          : (() => { const n = homeworks.filter(h => !h.all_cancelled).length; return `${n} активн${n === 1 ? 'ое' : 'ых'}`; })()
        }
        right={!isStudent ? (
          <button
            onClick={() => setCreateOpen(true)}
            style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Создать ДЗ
          </button>
        ) : null}
      />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const isActive = tab === t.id;
          const palette = TAB_PALETTE[t.id] || TAB_PALETTE.default;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '5px 14px', borderRadius: 20,
                border: isActive ? `1.5px solid ${palette.border}` : '1.5px solid transparent',
                cursor: 'pointer',
                background: isActive ? palette.activeBg : '#F0F2FA',
                color: isActive ? palette.activeColor : '#64748b',
                fontWeight: isActive ? 700 : 500, fontSize: 12,
                fontFamily: 'Montserrat, sans-serif',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>
          Загрузка…
        </div>
      ) : isStudent ? (
        filteredAssignments.length === 0 ? (
          <EmptyState isStudent />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filteredAssignments.map((a, i) => (
              <HomeworkCard
                key={a.id}
                hw={a}
                isTeacher={false}
                cardIndex={i}
                onClick={a.status === 'cancelled' ? undefined : () => { openStudentAssignmentOnGenerator(a); }}
              />
            ))}
          </div>
        )
      ) : (
        filteredHomeworks.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {filteredHomeworks.map((hw, i) => (
              <HomeworkCard
                key={hw.id}
                hw={hw}
                isTeacher
                cardIndex={i}
                onClick={() => openTeacherHw(hw)}
                onCancelAll={cancelAllAssignments}
              />
            ))}
          </div>
        )
      )}

      {/* Create modal */}
      {createOpen && (
        <CreateHomeworkModal
          students={students}
          onClose={() => setCreateOpen(false)}
          onCreated={(hw) => {
            setHomeworks(prev => [hw, ...prev]);
            setCreateOpen(false);
          }}
        />
      )}
      {!isStudent && (
        <MobileStickyActions className="hw-mobile-create">
          <button
            onClick={() => setCreateOpen(true)}
            style={{ ...primaryBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Создать ДЗ
          </button>
        </MobileStickyActions>
      )}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
function EmptyState({ isStudent, onCreate }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px', color: '#9ca3af', gap: 12, textAlign: 'center',
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#94a3b8' }}>
        {isStudent ? 'Нет заданий' : 'Нет домашних заданий'}
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1' }}>
        {isStudent ? 'Учитель пока не назначил заданий' : 'Создайте первое домашнее задание'}
      </div>
      {!isStudent && onCreate && (
        <button onClick={onCreate} style={primaryBtn}>
          Создать ДЗ
        </button>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const fieldWrap = {
  display: 'flex', flexDirection: 'column', gap: 5,
};

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: '#475569',
};

const inputStyle = {
  padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0',
  fontSize: 13, outline: 'none', fontFamily: 'Montserrat, sans-serif',
  background: '#fff', color: '#1a1a2e',
};

const primaryBtn = {
  padding: '10px 20px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg,#4F6EF7,#5b7cf7)', color: '#fff',
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
  fontFamily: 'Montserrat, sans-serif',
};

const outlineBtn = {
  padding: '8px 14px', borderRadius: 8, border: '1.5px solid #e2e8f0',
  background: '#fff', color: '#64748b', fontSize: 12,
  cursor: 'pointer', fontFamily: 'Montserrat, sans-serif',
};
