/**
 * Полноэкранная страница варианта — открывается по ?variant_play=<assignmentId>.
 * Рендерится вместо Dashboard в App.js.
 */
import { useState, useEffect, useCallback } from 'react';
import API from './api';
import VariantPlayer from './VariantPlayer';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

export default function VariantPlayPage({ assignmentId }) {
  const [assignment, setAssignment] = useState(null);
  const [profile,    setProfile]    = useState(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [saved, setSaved]           = useState(false);

  useEffect(() => {
    if (!assignmentId) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/homework/assignment/${assignmentId}/`, { credentials: 'include' })
        .then((r) => {
          if (r.status === 403) throw new Error('Нет доступа — войдите в личный кабинет.');
          if (r.status === 404) throw new Error('Назначение ДЗ не найдено.');
          if (!r.ok) throw new Error(`Ошибка сервера: ${r.status}`);
          return r.json();
        }),
      fetch(`${API}/api/me/`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([asgn, prof]) => { setAssignment(asgn); setProfile(prof); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [assignmentId]);

  const handleSubmit = useCallback(async (result, score) => {
    if (!assignment) return;
    const res = await fetch(
      `${API}/api/homework/assignment/${assignment.id}/submit/`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({ result, score }),
      },
    );
    if (res.ok) {
      const updated = await res.json();
      setAssignment((prev) => ({ ...prev, ...updated }));
      setSaved(true);
    }
  }, [assignment]);

  const handleMetaUpdated = useCallback((data) => {
    setAssignment((prev) => (prev ? { ...prev, ...data } : prev));
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: 'Montserrat, sans-serif',
      }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', margin: '0 auto 16px',
            border: '3px solid #e2e8f0', borderTopColor: '#4F6EF7',
            animation: 'spin .7s linear infinite',
          }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Загрузка задания…
        </div>
      </div>
    );
  }

  if (error || !assignment) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: 'Montserrat, sans-serif', padding: 24,
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '32px 40px', maxWidth: 480, width: '100%',
          boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginBottom: 8 }}>
            Не удалось открыть вариант
          </div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
            {error || 'Назначение не найдено.'}
          </div>
          <a
            href="/app/"
            style={{
              display: 'inline-block', marginTop: 24, padding: '10px 24px',
              borderRadius: 10, background: '#4F6EF7', color: '#fff',
              fontWeight: 700, fontSize: 13, textDecoration: 'none',
            }}
          >
            Перейти в личный кабинет
          </a>
        </div>
      </div>
    );
  }

  const isTeacher = profile?.role && profile.role !== 'student';
  // Teacher always sees as readonly; student — readonly after submission
  const readOnly = isTeacher || ['submitted', 'reviewing', 'reviewed'].includes(assignment.status);
  const showCorrectAnswers = isTeacher || assignment.status === 'reviewed';

  if (!assignment.variant_id) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f1f5f9', fontFamily: 'Montserrat, sans-serif', padding: 24,
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '32px 40px', maxWidth: 480, textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,.08)',
        }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            У этого задания нет варианта для отображения.
          </div>
          <a href="/app/" style={{ display: 'inline-block', marginTop: 16, color: '#4F6EF7', fontSize: 13, fontWeight: 600 }}>
            ← Назад
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f1f5f9',
      fontFamily: 'Montserrat, sans-serif',
    }}>
      {/* Top bar */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 1px 8px rgba(0,0,0,.05)',
      }}>
        <a
          href="/app/"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            color: '#64748b', textDecoration: 'none', fontSize: 13, fontWeight: 600,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Личный кабинет
        </a>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#1e293b', fontFamily: 'Unbounded, sans-serif', truncate: 'ellipsis' }}>
            {assignment.homework_title || `Вариант ${assignment.variant_id}`}
          </div>
          {assignment.subject && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{assignment.subject}</div>
          )}
        </div>
        {saved && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
            color: '#15803d', background: '#f0fdf4', padding: '6px 12px', borderRadius: 20,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Сохранено
          </div>
        )}
      </div>

      {/* Variant */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px 48px' }}>
        <VariantPlayer
          key={assignment.id}
          variantId={assignment.variant_id}
          readOnly={readOnly}
          savedResult={assignment.result || {}}
          showCorrectAnswers={showCorrectAnswers}
          assignmentId={assignment.id}
          answerFiles={assignment.answer_files || []}
          isTeacher={!!isTeacher}
          taskTeacherComments={assignment.task_teacher_comments || {}}
          whiteboardStrokes={assignment.whiteboard_strokes || []}
          onMetaUpdated={handleMetaUpdated}
          standalone
          onSubmit={!readOnly && !saved ? handleSubmit : null}
        />
      </div>
    </div>
  );
}
