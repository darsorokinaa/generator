/**
 * Полноэкранная страница варианта — открывается по ?variant_play=<assignmentId>.
 * Рендерится вместо Dashboard в App.js.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import API from './api';
import { fetchHomeworkGeneratorJoinUrl, cabinetSpaBasePathname } from './homeworkGeneratorNav';
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
  const [forbidden, setForbidden]   = useState(false);
  const [saved, setSaved]           = useState(false);
  const [redirectBusy, setRedirectBusy] = useState(false);
  const [useLocalPlayer, setUseLocalPlayer] = useState(false);
  const homeworkRedirectStartedRef = useRef(false);

  useEffect(() => {
    if (!assignmentId) return;
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/homework/assignment/${assignmentId}/`, { credentials: 'include' })
        .then((r) => {
          if (r.status === 403) {
            const e = new Error('Вход сюда запрещен');
            e.status = 403;
            throw e;
          }
          if (r.status === 404) throw new Error('Назначение ДЗ не найдено.');
          if (!r.ok) throw new Error(`Ошибка сервера: ${r.status}`);
          return r.json();
        }),
      fetch(`${API}/api/me/`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([asgn, prof]) => {
        setForbidden(false);
        setAssignment(asgn);
        setProfile(prof);
        setLoading(false);
      })
      .catch((e) => {
        const isForbidden = Number(e?.status) === 403;
        setForbidden(isForbidden);
        setError(isForbidden ? 'Вход сюда запрещен' : e.message);
        setLoading(false);
      });
  }, [assignmentId]);

  // Ученик: не остаёмся на «голом» variant_play — сразу join-url → генератор (без страницы ?homework_room= в ЛК).
  useEffect(() => {
    if (loading || !assignment?.id) return;
    let sp;
    try {
      sp = new URLSearchParams(window.location.search);
    } catch {
      sp = new URLSearchParams();
    }
    if (sp.get('hw_review') === '1') {
      setUseLocalPlayer(true);
      setRedirectBusy(false);
      return;
    }
    // Пока роль не «student» (учитель / не загрузилось) — никогда не уводим на join-url (иначе :8001).
    if (profile?.role !== 'student') return;
    if (useLocalPlayer) return;
    if (sp.get('hw_local') === '1') {
      setUseLocalPlayer(true);
      setRedirectBusy(false);
      return;
    }
    if (homeworkRedirectStartedRef.current) return;
    homeworkRedirectStartedRef.current = true;
    setRedirectBusy(true);
    (async () => {
      try {
        const { url } = await fetchHomeworkGeneratorJoinUrl(assignment.id);
        window.location.replace(url);
      } catch {
        homeworkRedirectStartedRef.current = false;
        setRedirectBusy(false);
        setUseLocalPlayer(true);
      }
    })();
  }, [loading, assignment, profile, useLocalPlayer]);

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

  const handleSaveDraft = useCallback(async (result, score) => {
    if (!assignment) return;
    const res = await fetch(
      `${API}/api/homework/assignment/${assignment.id}/save-draft/`,
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
    }
  }, [assignment]);

  const handleMetaUpdated = useCallback((data) => {
    setAssignment((prev) => (prev ? { ...prev, ...data } : prev));
  }, []);

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
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
    if (forbidden) {
      return (
        <div style={{
          minHeight: '100vh',
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '32px 40px', maxWidth: 480, width: '100%',
            boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🚫</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginBottom: 8 }}>
              Вход сюда запрещен
            </div>
            <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
              У вас нет доступа к этой странице.
            </div>
            <a
              href={`${API}/login/`}
              style={{
                display: 'inline-block', marginTop: 24, padding: '10px 24px',
                borderRadius: 10, background: '#4F6EF7', color: '#fff',
                fontWeight: 700, fontSize: 13, textDecoration: 'none',
              }}
            >
              Перейти ко входу
            </a>
          </div>
        </div>
      );
    }
    return (
      <div style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
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
            href={cabinetSpaBasePathname()}
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
  // Teacher always sees as readonly; student — readonly after submission (локальный плеер / сбой редиректа)
  const readOnly = isTeacher || ['submitted', 'reviewing', 'reviewed'].includes(assignment.status);
  const showCorrectAnswers = isTeacher || assignment.status === 'reviewed';

  if (!assignment.variant_id) {
    return (
      <div style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{
          background: '#fff', borderRadius: 16, padding: '32px 40px', maxWidth: 480, textAlign: 'center',
          boxShadow: '0 4px 24px rgba(0,0,0,.08)',
        }}>
          <div style={{ fontSize: 13, color: '#64748b' }}>
            У этого задания нет варианта для отображения.
          </div>
          <a href={cabinetSpaBasePathname()} style={{ display: 'inline-block', marginTop: 16, color: '#4F6EF7', fontSize: 13, fontWeight: 600 }}>
            ← Назад
          </a>
        </div>
      </div>
    );
  }

  if (!isTeacher && redirectBusy && !useLocalPlayer) {
    return (
      <div style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%', margin: '0 auto 16px',
            border: '3px solid #e2e8f0', borderTopColor: '#4F6EF7',
            animation: 'spin .7s linear infinite',
          }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Открываем комнату ДЗ…
        </div>
      </div>
    );
  }

  const appHome = cabinetSpaBasePathname();
  const homeworkStudentLine = [assignment.student_name, assignment.student_surname].filter(Boolean).join(' ').trim();

  const variantPlayer = (
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
      revisionTaskIds={Array.isArray(assignment.revision_task_ids) ? assignment.revision_task_ids : []}
      cabinetHomework={!isTeacher}
      homeworkCabinetStatus={assignment.status}
      homeworkStudentLabel={homeworkStudentLine}
      cabinetHomeHref={appHome}
      onMetaUpdated={handleMetaUpdated}
      standalone
      onSaveDraft={
        !readOnly && !saved && !isTeacher && ['sent', 'revision'].includes(assignment.status)
          ? handleSaveDraft
          : null
      }
      onSubmit={!readOnly && !saved ? handleSubmit : null}
      homeworkReview={
        isTeacher && ['submitted', 'reviewing'].includes(assignment.status)
          ? {
            assignmentStatus: assignment.status,
            initialTeacherComment: assignment.teacher_comment || '',
            onReview: async (action, payload) => {
              const body = {
                action,
                comment: payload.comment,
                part2_scores: payload.part2_scores,
                score: payload.totalScore,
              };
              if (action === 'revision') {
                body.revision_task_numbers = payload.revision_task_numbers ?? [];
              }
              const res = await fetch(
                `${API}/api/homework/assignment/${assignment.id}/review/`,
                {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                  body: JSON.stringify(body),
                },
              );
              if (!res.ok) throw new Error('review');
              const updated = await res.json();
              setAssignment(updated);
            },
          }
          : null
      }
    />
  );

  /* Разметка как ExamPage.jsx (01 generator): только VariantPlayer, без отдельной шапки ЛК */
  return variantPlayer;
}
