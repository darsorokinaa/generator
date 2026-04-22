import React, { useEffect, useMemo } from 'react';

const GEN_RAW = (process.env.REACT_APP_GENERATOR_URL || 'https://test.genurok.ru').replace(/\/$/, '');
const GEN = GEN_RAW.replace(/\/api$/, '');

export default function LessonRoomPage({ token, roomId, targetName, variantId }) {
  const lessonJoinUrl = useMemo(() => {
    if (!token) return '';
    return `${GEN}/lesson/join/?token=${encodeURIComponent(token)}&role=teacher`;
  }, [token]);

  useEffect(() => {
    if (!lessonJoinUrl) return;
    // Сразу уходим в комнату урока без промежуточных действий.
    window.location.replace(lessonJoinUrl);
  }, [lessonJoinUrl]);

  if (!token) {
    return (
      <div style={{ padding: 24, fontFamily: 'Montserrat, sans-serif' }}>
        Токен урока не найден.
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
    }}>
      <div style={{
        maxWidth: 1320,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
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
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600 }}>Комната урока</div>
            <div style={{ fontSize: 16, color: '#111827', fontWeight: 700 }}>
              {targetName ? `Урок для ${targetName}` : 'Урок'}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {variantId ? `Вариант #${variantId}` : ''}{variantId && roomId ? ' · ' : ''}{roomId ? `Комната: ${roomId}` : ''}
            </div>
          </div>
          <a
            href={lessonJoinUrl}
            target="_self"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 38,
              padding: '0 14px',
              borderRadius: 10,
              background: '#4f46e5',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Перейти в комнату
          </a>
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
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111827' }}>
            Переход в комнату урока...
          </div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>Если переход не сработал автоматически, нажмите «Перейти в комнату».</div>
        </div>
      </div>
    </div>
  );
}
