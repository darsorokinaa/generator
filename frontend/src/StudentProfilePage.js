import { useState, useEffect } from 'react';
import API from './api';

const SUBJECT_COLOR = {
  'Математика': 'math', 'Алгебра': 'math', 'Геометрия': 'math',
  'Информатика': 'cs', 'Физика': 'physics',
};
const LEVEL_COLOR = { 'ОГЭ': 'oge', 'ЕГЭ': 'ege' };
const STATUS_LABELS = { '1': 'Активный', '2': 'На паузе', '3': 'Завершил', '4': 'Пробный урок' };
const STATUS_CLASS = { '1': 'active', '2': 'warning', '3': 'danger', '4': 'warning' };

const GRADE_CHOICES = [
  { value: '7', label: '7 класс' },
  { value: '8', label: '8 класс' },
  { value: '9', label: '9 класс' },
  { value: '10', label: '10 класс' },
  { value: '11', label: '11 класс' },
];
const ST_STATUS_CHOICES = [
  { value: '1', label: 'Активный' },
  { value: '2', label: 'На паузе' },
  { value: '3', label: 'Завершил обучение' },
  { value: '4', label: 'Пробный урок' },
];
const GENDER_CHOICES = [
  { value: 'female', label: 'Женский' },
  { value: 'male', label: 'Мужской' },
  { value: 'other', label: 'Не указан' },
];

function mapFromStudent(st) {
  return {
    student_name: st.student_name || '',
    student_surname: st.student_surname || '',
    student_email: st.student_email || '',
    student_phone: st.student_phone || '',
    gender: st.gender || 'other',
    birth_date: st.birth_date || '',
    subject: st.subject != null ? String(st.subject) : '',
    level: st.level != null ? String(st.level) : '',
    grade: st.grade || '9',
    goal: st.goal || '',
    status: String(st.status || '1'),
  };
}

function GroupPickerModal({ groups, currentGroupId, onClose, onSave }) {
  const [selected, setSelected] = useState(currentGroupId ?? '');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Добавить в группу</span>
          <button type="button" className="modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: selected === '' ? '1.5px solid var(--accent)' : '1.5px solid var(--border)', background: selected === '' ? 'var(--accent-lt)' : 'transparent' }}>
            <input type="radio" name="group" value="" checked={selected === ''} onChange={() => setSelected('')} style={{ accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Без группы (индивидуальные занятия)</span>
          </label>
          {groups.map(g => (
            <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 8, border: String(selected) === String(g.id) ? '1.5px solid var(--accent)' : '1.5px solid var(--border)', background: String(selected) === String(g.id) ? 'var(--accent-lt)' : 'transparent' }}>
              <input type="radio" name="group" value={g.id} checked={String(selected) === String(g.id)} onChange={() => setSelected(g.id)} style={{ accentColor: 'var(--accent)' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>{g.group_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{g.subject_name} · {g.level_name}</div>
              </div>
            </label>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn-page-secondary" onClick={onClose}>Отмена</button>
          <button type="button" className="btn-page-primary" onClick={() => onSave(selected === '' ? null : selected)}>Сохранить</button>
        </div>
      </div>
    </div>
  );
}

function initials(name, surname) {
  return [(name || '')[0], (surname || '')[0]].filter(Boolean).join('').toUpperCase() || '?';
}

function age(birthDate) {
  if (!birthDate) return null;
  const diff = Date.now() - new Date(birthDate).getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  const last = years % 100;
  const rem = years % 10;
  const suffix = (last >= 11 && last <= 14) ? 'лет'
    : rem === 1 ? 'год' : (rem >= 2 && rem <= 4) ? 'года' : 'лет';
  return `${years} ${suffix}`;
}

function getCookie(name) {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith(name + '='))?.split('=')[1] || '';
}

export default function StudentProfilePage({ student: s, groups = [], onBack, backLabel = 'Назад к ученикам', onStudentUpdated }) {
  const [resetBusy, setResetBusy] = useState(false);
  const [resetCreds, setResetCreds] = useState(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [localStudent, setLocalStudent] = useState(s);
  const [edit, setEdit] = useState(() => mapFromStudent(s));
  const [subjects, setSubjects] = useState([]);
  const [levels, setLevels] = useState([]);

  useEffect(() => {
    setLocalStudent(s);
    setEdit(mapFromStudent(s));
  }, [s.id]);

  useEffect(() => {
    fetch(`${API}/api/subjects/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => setSubjects(Array.isArray(data) ? data : []))
      .catch(() => setSubjects([]));
    fetch(`${API}/api/levels/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => setLevels(Array.isArray(data) ? data : []))
      .catch(() => setLevels([]));
  }, []);

  const cur = localStudent;
  const av = initials(edit.student_name, edit.student_surname);
  const fullName = [edit.student_name, edit.student_surname].filter(Boolean).join(' ');
  const statusCls = STATUS_CLASS[edit.status] || 'warning';
  const subjLabel = subjects.find(x => String(x.id) === String(edit.subject))?.subject_name || cur.subject_name || '—';
  const levelLabel = levels.find(x => String(x.id) === String(edit.level))?.level || cur.level_name || '—';

  async function saveProfile() {
    if (!edit.subject || !edit.level) {
      alert('Выберите предмет и уровень');
      return;
    }
    setSaveBusy(true);
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/me/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const body = {
        student_name: edit.student_name.trim(),
        student_surname: edit.student_surname.trim(),
        student_email: edit.student_email.trim(),
        student_phone: edit.student_phone.trim() || null,
        gender: edit.gender,
        birth_date: edit.birth_date || null,
        subject: Number(edit.subject),
        level: Number(edit.level),
        grade: edit.grade,
        goal: edit.goal.trim() || null,
        status: edit.status,
        lesson_type: cur.lesson_type,
        group_id: cur.lesson_type === 'group' && cur.group != null ? cur.group : null,
      };
      const r = await fetch(`${API}/api/students/${cur.id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data) || 'Не удалось сохранить');
        return;
      }
      setLocalStudent(data);
      setEdit(mapFromStudent(data));
      onStudentUpdated && onStudentUpdated(data);
    } catch {
      alert('Нет связи с сервером');
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveGroup(groupId) {
    setGroupBusy(true);
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/me/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const r = await fetch(`${API}/api/students/${cur.id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ group_id: groupId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { alert(data.error || 'Не удалось обновить группу'); return; }
      const updated = {
        ...cur,
        group: data.group != null ? data.group : (groupId || null),
        group_name: data.group_name ?? null,
        lesson_type: data.lesson_type ?? (groupId ? 'group' : 'individual'),
      };
      setLocalStudent(updated);
      onStudentUpdated && onStudentUpdated(updated);
      setShowGroupPicker(false);
    } catch { alert('Нет связи с сервером'); }
    finally { setGroupBusy(false); }
  }

  async function resetPassword() {
    if (!window.confirm('Сгенерировать новый пароль для ученика? Старый перестанет действовать.')) return;
    setResetBusy(true);
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/me/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const r = await fetch(`${API}/api/students/${s.id}/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ action: 'reset_password' }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(data.error || 'Не удалось сбросить пароль');
        return;
      }
      setResetCreds({ login: data.login, password: data.password });
    } catch {
      alert('Нет связи с сервером');
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="page-content">
      <button type="button" className="profile-back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {backLabel}
      </button>

      <div className="sp-hero">
        <div className="sp-avatar">{av}</div>
        <div className="sp-hero-info">
          <h1 className="sp-name">{fullName || '—'}</h1>
          <div className="sp-hero-badges">
            <span className={`status-badge status-badge--${statusCls}`}>{STATUS_LABELS[edit.status] || '—'}</span>
            <span className={`subject-badge subject-badge--${SUBJECT_COLOR[subjLabel] || 'default'}`}>{subjLabel}</span>
            <span className={`level-badge level-badge--${LEVEL_COLOR[levelLabel] || 'default'}`}>{levelLabel}</span>
            {cur.lesson_type === 'group' ? (
              <span className="sp-inline-group">
                <span className="lesson-type-badge lesson-type-badge--group">Группа</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{cur.group_name || '—'}</span>
              </span>
            ) : (
              <span className="lesson-type-badge lesson-type-badge--individual">Индивидуальное</span>
            )}
          </div>
        </div>
      </div>

      <div className="sp-actions-row" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <button
          type="button"
          className="btn-page-primary"
          onClick={saveProfile}
          disabled={saveBusy}
        >
          {saveBusy ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
        <button
          type="button"
          className="btn-page-secondary"
          onClick={resetPassword}
          disabled={resetBusy}
        >
          {resetBusy ? 'Сброс…' : 'Сбросить пароль'}
        </button>
        <button
          type="button"
          className="btn-page-secondary"
          onClick={() => setShowGroupPicker(true)}
          disabled={groupBusy}
        >
          {cur.lesson_type === 'group' && cur.group_name ? `Группа: ${cur.group_name}` : '+ В группу'}
        </button>
        {cur.student_username && (
          <span style={{ marginLeft: 4, color: 'var(--text-3)', fontSize: 13, alignSelf: 'center' }}>
            Логин: <strong style={{ color: 'var(--text-1)' }}>{cur.student_username}</strong>
          </span>
        )}
      </div>

      <div className="sp-grid">
        <div className="sp-card">
          <div className="sp-card-title">Личные данные</div>
          <div className="sp-rows">
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Имя</span>
              <input className="sp-input" value={edit.student_name} onChange={e => setEdit(v => ({ ...v, student_name: e.target.value }))} />
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Фамилия</span>
              <input className="sp-input" value={edit.student_surname} onChange={e => setEdit(v => ({ ...v, student_surname: e.target.value }))} />
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Email</span>
              <input className="sp-input" type="email" value={edit.student_email} onChange={e => setEdit(v => ({ ...v, student_email: e.target.value }))} />
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Телефон</span>
              <input className="sp-input" value={edit.student_phone} onChange={e => setEdit(v => ({ ...v, student_phone: e.target.value }))} />
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Дата рождения</span>
              <input className="sp-input" type="date" value={edit.birth_date || ''} onChange={e => setEdit(v => ({ ...v, birth_date: e.target.value }))} />
            </div>
            {edit.birth_date && (
              <div className="sp-row">
                <span className="sp-row-label">Возраст</span>
                <span className="sp-row-value">{age(edit.birth_date)}</span>
              </div>
            )}
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Пол</span>
              <select className="sp-select" value={edit.gender} onChange={e => setEdit(v => ({ ...v, gender: e.target.value }))}>
                {GENDER_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="sp-card">
          <div className="sp-card-title">Обучение</div>
          <div className="sp-rows">
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Предмет</span>
              <select className="sp-select" value={edit.subject} onChange={e => setEdit(v => ({ ...v, subject: e.target.value }))}>
                <option value="">— выберите —</option>
                {subjects.map(sub => <option key={sub.id} value={sub.id}>{sub.subject_name}</option>)}
              </select>
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Уровень</span>
              <select className="sp-select" value={edit.level} onChange={e => setEdit(v => ({ ...v, level: e.target.value }))}>
                <option value="">— выберите —</option>
                {levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}
              </select>
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Класс</span>
              <select className="sp-select" value={edit.grade} onChange={e => setEdit(v => ({ ...v, grade: e.target.value }))}>
                {GRADE_CHOICES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Тип занятий</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {cur.lesson_type === 'group' ? (
                  <span className="sp-inline-group">
                    <span className="lesson-type-badge lesson-type-badge--group">Группа</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{cur.group_name || '—'}</span>
                  </span>
                ) : (
                  <span className="lesson-type-badge lesson-type-badge--individual">Индивидуальное</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowGroupPicker(true)}
                  disabled={groupBusy}
                  title="Изменить группу"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--accent)', fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 2 }}
                >
                  изменить
                </button>
              </div>
            </div>
            <div className="sp-row sp-row--stack">
              <span className="sp-row-label">Статус</span>
              <select className="sp-select" value={edit.status} onChange={e => setEdit(v => ({ ...v, status: e.target.value }))}>
                {ST_STATUS_CHOICES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="sp-card sp-card--full">
        <div className="sp-card-title">Цель обучения</div>
        <textarea
          className="sp-textarea"
          placeholder="Цель или комментарий для ученика…"
          value={edit.goal}
          onChange={e => setEdit(v => ({ ...v, goal: e.target.value }))}
        />
      </div>

      {showGroupPicker && (
        <GroupPickerModal
          groups={groups}
          currentGroupId={cur.group ?? null}
          onClose={() => setShowGroupPicker(false)}
          onSave={saveGroup}
        />
      )}

      {resetCreds && (
        <div className="modal-overlay" onClick={() => setResetCreds(null)}>
          <div className="modal modal--credentials" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Новый пароль</span>
              <button type="button" className="modal-close" onClick={() => setResetCreds(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="credentials-body">
              <div className="credentials-hint">
                <span className="credentials-hint-icon">⚠️</span>
                <span>Сохраните пароль и передайте ученику — при закрытии окна он не отобразится снова.</span>
              </div>
              <div className="credentials-row">
                <span className="credentials-label">Логин</span>
                <span className="credentials-value">{resetCreds.login}</span>
              </div>
              <div className="credentials-row">
                <span className="credentials-label">Пароль</span>
                <span className="credentials-value credentials-value--password">{resetCreds.password}</span>
              </div>
              <button
                type="button"
                className="credentials-copy-all"
                onClick={() => navigator.clipboard.writeText(`Логин: ${resetCreds.login}\nПароль: ${resetCreds.password}`)}
              >
                Скопировать логин и пароль
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
