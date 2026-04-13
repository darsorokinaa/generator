import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import API from './api';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

const TYPE_ICON = {
  submitted:          '📩',
  homework_assigned:  '📋',
  reviewed:           '✅',
  revision_requested: '🔁',
  check_deadline_soon:'⏰',
  missed:             '❌',
  low_result_alert:   '⚠️',
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}

function placeDropdown(btnEl) {
  if (!btnEl) return { top: 0, left: 8, width: 300 };
  const rect = btnEl.getBoundingClientRect();
  const margin = 8;
  const maxW = 320;
  const width = Math.min(maxW, Math.max(260, window.innerWidth - margin * 2));
  let left = rect.right - width;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const top = rect.bottom + margin;
  return { top, left, width };
}

export default function NotificationBell({ onGoToAssignment }) {
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, width: 320 });
  const btnRef = useRef(null);
  const dropRef = useRef(null);

  const unread = notifs.filter(n => !n.read).length;

  const fetchNotifs = () => {
    fetch(`${API}/api/notifications/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => setNotifs(Array.isArray(data) ? data : []))
      .catch(() => {});
  };

  useEffect(() => {
    fetchNotifs();
    const timer = setInterval(fetchNotifs, 30000);
    return () => clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => setPanelPos(placeDropdown(btnRef.current));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    const onOutsideClick = (e) => {
      if (btnRef.current?.contains(e.target) || dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  const markRead = (id) => {
    fetch(`${API}/api/notifications/${id}/read/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRFToken': getCookie('csrftoken') },
    }).then(() => {
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    });
  };

  const markAll = () => {
    fetch(`${API}/api/notifications/read-all/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRFToken': getCookie('csrftoken') },
    }).then(() => {
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    });
  };

  const handleClick = (n) => {
    if (!n.read) markRead(n.id);
    if (n.assignment_id && onGoToAssignment) {
      onGoToAssignment(n.assignment_id);
      setOpen(false);
    }
  };

  const panel = open && (
    <div
      ref={dropRef}
      className="notif-dropdown-panel"
      style={{
        position: 'fixed',
        top: panelPos.top,
        left: panelPos.left,
        width: panelPos.width,
        maxHeight: 'min(420px, calc(100vh - 24px))',
        overflowY: 'auto',
        background: '#fff',
        borderRadius: 14,
        border: '1px solid var(--border, #E8EBF5)',
        boxShadow: '0 12px 40px rgba(15, 23, 42, 0.18)',
        zIndex: 10050,
        fontFamily: 'Montserrat, sans-serif',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px 8px',
        borderBottom: '1px solid #f1f5f9',
      }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: '#1a1a2e' }}>Уведомления</span>
        {unread > 0 && (
          <button
            type="button"
            onClick={markAll}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#4F6EF7', fontWeight: 600 }}
          >
            Прочитать все
          </button>
        )}
      </div>

      {notifs.length === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          Нет уведомлений
        </div>
      ) : (
        notifs.map(n => (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            onClick={() => handleClick(n)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(n); } }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 16px',
              background: n.read ? 'transparent' : 'rgba(79,110,247,0.05)',
              cursor: n.assignment_id ? 'pointer' : 'default',
              transition: 'background .15s',
            }}
            onMouseEnter={e => { if (n.assignment_id) e.currentTarget.style.background = 'rgba(79,110,247,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(79,110,247,0.05)'; }}
          >
            <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
              {TYPE_ICON[n.notification_type] || '🔔'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: '#1a1a2e', lineHeight: 1.45, fontWeight: n.read ? 400 : 600, wordBreak: 'break-word' }}>
                {n.text}
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                {timeAgo(n.created_at)}
              </div>
            </div>
            {!n.read && (
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#4F6EF7', flexShrink: 0, marginTop: 4,
              }} />
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn notif-btn"
        title="Уведомления"
        onClick={() => setOpen(o => !o)}
        style={{ position: 'relative' }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            width: 14, height: 14, borderRadius: '50%',
            background: '#ef4444', color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  );
}
