import React, { useEffect, useMemo, useState } from 'react';
import { fetchHomeworkGeneratorJoinUrl } from './homeworkGeneratorNav';

function buildVariantPlayUrl(assignmentId) {
  if (typeof window === 'undefined' || !assignmentId) return '';
  const u = new URL(window.location.href);
  u.searchParams.set('variant_play', String(assignmentId));
  u.searchParams.set('hw_local', '1');
  u.searchParams.delete('homework_room');
  return u.toString();
}

/**
 * Редирект в «комнату» варианта на генераторе (как урок), с темой ДЗ — query cabinet_session=homework.
 * Открывается по ?homework_room=<assignmentId> (см. App.js) — для старых ссылок; обычный клик ведёт сразу на генератор.
 */
export default function HomeworkRoomPage({ assignmentId }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);

  const fallbackUrl = useMemo(
    () => (assignmentId ? buildVariantPlayUrl(assignmentId) : ''),
    [assignmentId],
  );

  useEffect(() => {
    if (!assignmentId) {
      setErr('Не указано назначение ДЗ.');
      setBusy(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { url: joinUrl } = await fetchHomeworkGeneratorJoinUrl(assignmentId);
        if (!cancelled) window.location.replace(joinUrl);
      } catch (e) {
        if (!cancelled) {
          setErr(e.message || 'Не удалось получить ссылку');
          setBusy(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (err) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f5f7fc',
        fontFamily: 'Montserrat, sans-serif',
        padding: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      >
        <div style={{
          maxWidth: 480,
          background: '#fff',
          borderRadius: 16,
          padding: '28px 32px',
          border: '1px solid #e5e7eb',
          textAlign: 'center',
        }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8, color: '#1e293b' }}>Комната ДЗ</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>{err}</div>
          {fallbackUrl && (
            <a
              href={fallbackUrl}
              style={{
                display: 'inline-block',
                padding: '10px 20px',
                borderRadius: 10,
                background: '#4f46e5',
                color: '#fff',
                fontWeight: 700,
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Открыть вариант в кабинете
            </a>
          )}
          <div style={{ marginTop: 16 }}>
            <a href="/app/" style={{ color: '#64748b', fontSize: 13 }}>← В личный кабинет</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#f5f7fc',
      fontFamily: 'Montserrat, sans-serif',
      padding: '18px 20px 20px',
      boxSizing: 'border-box',
    }}
    >
      <div style={{
        maxWidth: 1320,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
      >
        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Домашнее задание</div>
            <div style={{ fontSize: 16, color: '#111827', fontWeight: 700 }}>Комната как на уроке</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Оформление на стороне заданий (генератор). Назначение #{assignmentId}
            </div>
          </div>
        </div>

        <div style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: '22px 18px',
          minHeight: 120,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 8,
        }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
            {busy ? 'Подключаемся к комнате ДЗ…' : 'Переход…'}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Перенаправление на страницу заданий…
          </div>
        </div>
      </div>
    </div>
  );
}
