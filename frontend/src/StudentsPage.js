import { useState, useEffect, useCallback } from 'react';
import API from './api';

const SUBJECT_COLOR = {
  'Математика': 'math', 'Алгебра': 'math', 'Геометрия': 'math',
  'Информатика': 'cs',  'Физика': 'physics',
};
const LEVEL_COLOR = { 'ОГЭ': 'oge', 'ЕГЭ': 'ege' };
const STATUS_LABELS = { '1': 'Активный', '2': 'На паузе', '3': 'Завершил', '4': 'Пробный урок' };

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2);
}

const LEVEL_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'ОГЭ', label: 'ОГЭ' },
  { id: 'ЕГЭ', label: 'ЕГЭ' },
];
const STATUS_FILTERS = [
  { id: 'all',     label: 'Все статусы' },
  { id: 'active',  label: 'Активные' },
  { id: 'warning', label: 'Пассивные' },
  { id: 'danger',  label: 'Отстают' },
];

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
const LESSON_TYPE_CHOICES = [
  { value: 'individual', label: 'Индивидуальное' },
  { value: 'group', label: 'Групповое' },
];
const GENDER_CHOICES = [
  { value: 'female', label: 'Женский' },
  { value: 'male',   label: 'Мужской' },
  { value: 'other',  label: 'Не указан' },
];
const EMPTY_FORM = {
  name: '', surname: '', email: '', phone: '',
  subject: '', level: '', grade: '9', goal: '', status: '1',
  lesson_type: 'individual', group: '',
  gender: 'other', birth_date: '',
};

export default function StudentsPage({ onOpenProfile }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('Все');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lessonFilter, setLessonFilter] = useState('all');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [subjects, setSubjects] = useState([]);
  const [levels, setLevels] = useState([]);
  const [credentials, setCredentials] = useState(null);

  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ group_name: '', subject: '', level: '' });
  const [groupError, setGroupError] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);
  const [groups, setGroups] = useState([]);

  const loadStudents = useCallback(() => {
    fetch(`${API}/api/students/`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setStudents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadStudents();
    fetch(`${API}/api/subjects/`, { credentials: 'include' })
      .then(r => r.json()).then(setSubjects).catch(() => {});
    fetch(`${API}/api/levels/`, { credentials: 'include' })
      .then(r => r.json()).then(setLevels).catch(() => {});
    fetch(`${API}/api/groups/`, { credentials: 'include' })
      .then(r => r.json()).then(setGroups).catch(() => {});
  }, [loadStudents]);

  function openModal() {
    setForm({ ...EMPTY_FORM, subject: subjects[0]?.id || '', level: levels[0]?.id || '' });
    setFormError('');
    setModalOpen(true);
  }

  function closeModal() { setModalOpen(false); }

  function handleField(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Введите имя ученика'); return; }
    if (!form.subject)      { setFormError('Выберите предмет'); return; }
    if (!form.level)        { setFormError('Выберите уровень'); return; }
    setSaving(true);
    setFormError('');
    try {
      // Получаем свежий CSRF-токен если его нет
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/students/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const r = await fetch(`${API}/api/students/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({
          ...form,
          subject: Number(form.subject),
          level: Number(form.level),
          group: form.lesson_type === 'group' && form.group ? Number(form.group) : null,
        }),
      });
      if (r.ok) {
        const created = await r.json();
        closeModal();
        setLoading(true);
        loadStudents();
        if (created.credentials) setCredentials(created.credentials);
      } else {
        const err = await r.json();
        setFormError(err.error || 'Ошибка при сохранении');
      }
    } catch {
      setFormError('Нет связи с сервером');
    } finally {
      setSaving(false);
    }
  }

  function getCookie(name) {
    return document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith(name + '='))?.split('=')[1] || '';
  }

  async function handleDelete(studentId) {
    if (!window.confirm('Удалить ученика? Это действие необратимо.')) return;
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/students/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const r = await fetch(`${API}/api/students/${studentId}/`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRFToken': csrf },
      });
      if (r.ok || r.status === 204) {
        setStudents(prev => prev.filter(s => s.id !== studentId));
      }
    } catch {
      alert('Не удалось удалить ученика');
    }
  }

  async function handleGroupSubmit(e) {
    e.preventDefault();
    if (!groupForm.group_name.trim()) { setGroupError('Введите название группы'); return; }
    if (!groupForm.subject)           { setGroupError('Выберите предмет'); return; }
    if (!groupForm.level)             { setGroupError('Выберите уровень'); return; }
    setGroupSaving(true);
    setGroupError('');
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) {
        await fetch(`${API}/api/groups/`, { credentials: 'include' });
        csrf = getCookie('csrftoken');
      }
      const r = await fetch(`${API}/api/groups/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ ...groupForm, subject: Number(groupForm.subject), level: Number(groupForm.level) }),
      });
      if (r.ok) {
        setGroupModalOpen(false);
        setGroupForm({ group_name: '', subject: '', level: '' });
        fetch(`${API}/api/groups/`, { credentials: 'include' })
          .then(res => res.json()).then(setGroups).catch(() => {});
      } else {
        const err = await r.json();
        setGroupError(err.error || 'Ошибка при сохранении');
      }
    } catch {
      setGroupError('Нет связи с сервером');
    } finally {
      setGroupSaving(false);
    }
  }

  const availableSubjects = ['Все', ...Array.from(new Set(
    (levelFilter === 'all' ? students : students.filter(s => s.level_name === levelFilter)).map(s => s.subject_name)
  ))];

  const filtered = students
    .filter(s => {
      const fullName  = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
      const bySearch  = fullName.toLowerCase().includes(search.toLowerCase());
      const byLevel   = levelFilter === 'all' || s.level_name === levelFilter;
      const bySubject = subjectFilter === 'Все' || s.subject_name === subjectFilter;
      const byStatus  = statusFilter === 'all' || s.status === statusFilter;
      const byLesson  = lessonFilter === 'all'
        || (lessonFilter === 'individual' && s.lesson_type === 'individual')
        || (lessonFilter === 'group' && s.lesson_type === 'group');
      return bySearch && byLevel && bySubject && byStatus && byLesson;
    })
    .sort((a, b) => {
      if (sortKey === 'student_name') {
        return (`${a.student_name} ${a.student_surname}`).localeCompare(`${b.student_name} ${b.student_surname}`) * sortDir;
      }
      return String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? '')) * sortDir;
    });

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d * -1);
    else { setSortKey(key); setSortDir(1); }
  }

  function SortIcon({ k }) {
    if (sortKey !== k) return <span className="sort-icon sort-icon--neutral">↕</span>;
    return <span className="sort-icon">{sortDir === 1 ? '↑' : '↓'}</span>;
  }

  return (
    <div className="page-content">
      {loading && (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-3)', fontWeight: 600 }}>
          Загрузка…
        </div>
      )}
      {!loading && (<>
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Мои ученики</h2>
          <p className="page-subtitle">Управление и мониторинг учеников</p>
        </div>
        <div className="page-header-actions">
          <button className="btn-page-secondary" onClick={() => { setGroupForm({ group_name: '', subject: subjects[0]?.id || '', level: levels[0]?.id || '' }); setGroupError(''); setGroupModalOpen(true); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Создать группу
          </button>
          <button className="btn-page-primary" onClick={openModal}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Добавить ученика
          </button>
        </div>
      </div>

      {/* Search + status filter */}
      <div className="page-toolbar">
        <div className="search-box search-box--wide">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Поиск по имени…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="search-clear" onClick={() => setSearch('')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <select
          className="select-filter"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Level + subject filters */}
      <div className="filter-bar">
        {LEVEL_FILTERS.map(f => (
          <button
            key={f.id}
            className={`filter-pill${levelFilter === f.id ? ' filter-pill--active' : ''}`}
            onClick={() => { setLevelFilter(f.id); setSubjectFilter('Все'); }}
          >
            {f.label}
            {f.id !== 'all' && (
              <span className="filter-count">
                {students.filter(s => s.level_name === f.id).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="filter-bar filter-bar--sub">
        {availableSubjects.map(subj => (
          <button
            key={subj}
            className={`filter-chip${subjectFilter === subj ? ' filter-chip--active' : ''}`}
            onClick={() => setSubjectFilter(subj)}
          >
            {subj !== 'Все' && (
              <span className={`chip-dot chip-dot--${SUBJECT_COLOR[subj] || 'default'}`} />
            )}
            {subj}
          </button>
        ))}
      </div>

      {/* Lesson type filter */}
      <div className="filter-bar filter-bar--sub">
        <button
          className={`filter-chip${lessonFilter === 'all' ? ' filter-chip--active' : ''}`}
          onClick={() => setLessonFilter('all')}
        >
          Все
        </button>
        <button
          className={`filter-chip${lessonFilter === 'individual' ? ' filter-chip--active' : ''}`}
          onClick={() => setLessonFilter('individual')}
        >
          <span className="chip-dot" style={{ background: '#93C5FD' }} />
          Индивидуальные
          <span className="chip-count">{students.filter(s => s.lesson_type === 'individual').length}</span>
        </button>
        <button
          className={`filter-chip${lessonFilter === 'group' ? ' filter-chip--active' : ''}`}
          onClick={() => setLessonFilter('group')}
        >
          <span className="chip-dot" style={{ background: '#b69eff' }} />
          Групповые
          <span className="chip-count">{students.filter(s => s.lesson_type === 'group').length}</span>
        </button>
      </div>

      {/* Table */}
      <div className="table-above-row">
        <span className="table-count">{filtered.length} учеников</span>
      </div>

      <div className="table-wrap">
        <table className="students-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('student_name')} className="th-sort">
                Ученик <SortIcon k="student_name" />
              </th>
              <th style={{ textAlign: 'center' }}>Класс</th>
              <th>Предмет</th>
              <th>Уровень</th>
              <th>Тип занятий</th>
              <th>Цель</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">Ученики не найдены</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="student-cell">
                    <div className="student-avatar-sm">{initials(`${s.student_name || '?'} ${s.student_surname || ''}`)}</div>
                    <div className="student-info">
                      <span className="student-name">{s.student_name} {s.student_surname}</span>
                      <span className="student-meta-sm">{s.subject_name} · {s.grade} класс</span>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}><span className="cell-plain">{s.grade}</span></td>
                <td>
                  <span className={`subject-badge subject-badge--${SUBJECT_COLOR[s.subject_name] || 'default'}`}>
                    {s.subject_name}
                  </span>
                </td>
                <td>
                  <span className={`level-badge level-badge--${LEVEL_COLOR[s.level_name] || 'default'}`}>
                    {s.level_name}
                  </span>
                </td>
                <td>
                  {s.lesson_type === 'group'
                    ? <span className="lesson-type-badge lesson-type-badge--group" title={s.group_name || ''}>{s.group_name ? ` ${s.group_name}` : ''}</span>
                    : <span className="lesson-type-badge lesson-type-badge--individual">Индивидуальное</span>
                  }
                </td>
                <td><span className="cell-plain" style={{ maxWidth: 180, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.goal || '—'}</span></td>
                <td>
                  <span className={`status-badge status-badge--${s.status === '1' ? 'active' : s.status === '3' ? 'danger' : 'warning'}`}>
                    {STATUS_LABELS[s.status] || s.status}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="row-btn" onClick={() => onOpenProfile && onOpenProfile(s)}>Профиль</button>
                    <button
                      className="row-btn row-btn--delete"
                      title="Удалить ученика"
                      onClick={() => handleDelete(s.id)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </>)}

      {/* ── MODAL ── */}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Новый ученик</span>
              <button className="modal-close" onClick={closeModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form className="modal-form" onSubmit={handleSubmit}>
              <div className="modal-section-label">Личные данные</div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Имя <span className="modal-required">*</span></label>
                  <input name="name" value={form.name} onChange={handleField} placeholder="Анна" autoFocus />
                </div>
                <div className="modal-field">
                  <label>Фамилия</label>
                  <input name="surname" value={form.surname} onChange={handleField} placeholder="Козлова" />
                </div>
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Пол</label>
                  <select name="gender" value={form.gender} onChange={handleField}>
                    {GENDER_CHOICES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Дата рождения</label>
                  <input name="birth_date" type="date" value={form.birth_date} onChange={handleField} />
                </div>
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Email</label>
                  <input name="email" type="email" value={form.email} onChange={handleField} placeholder="anna@mail.ru" />
                </div>
                <div className="modal-field">
                  <label>Телефон</label>
                  <input name="phone" value={form.phone} onChange={handleField} placeholder="+7 900 000-00-00" />
                </div>
              </div>

              <div className="modal-section-label" style={{ marginTop: 16 }}>Обучение</div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Предмет <span className="modal-required">*</span></label>
                  <select name="subject" value={form.subject} onChange={handleField}>
                    <option value="">— выберите —</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Уровень <span className="modal-required">*</span></label>
                  <select name="level" value={form.level} onChange={handleField}>
                    <option value="">— выберите —</option>
                    {levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Класс</label>
                  <select name="grade" value={form.grade} onChange={handleField}>
                    {GRADE_CHOICES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Статус</label>
                  <select name="status" value={form.status} onChange={handleField}>
                    {ST_STATUS_CHOICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="modal-section-label" style={{ marginTop: 16 }}>Тип занятий</div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Тип <span className="modal-required">*</span></label>
                  <select name="lesson_type" value={form.lesson_type} onChange={handleField}>
                    {LESSON_TYPE_CHOICES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {form.lesson_type === 'group' && (
                  <div className="modal-field">
                    <label>Группа</label>
                    <select name="group" value={form.group} onChange={handleField}>
                      <option value="">— выберите группу —</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div className="modal-field" style={{ gridColumn: '1 / -1' }}>
                <label>Цель обучения</label>
                <textarea name="goal" value={form.goal} onChange={handleField} rows={3} placeholder="Сдать ОГЭ на 5, подтянуть алгебру…" style={{ width: '100%', resize: 'none' }} />
              </div>

              {formError && <div className="modal-error">{formError}</div>}

              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={closeModal}>Отмена</button>
                <button type="submit" className="modal-btn modal-btn--save" disabled={saving}>
                  {saving ? 'Сохранение…' : 'Добавить ученика'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── CREDENTIALS MODAL ── */}
      {credentials && (() => {
        const isFemale = credentials.gender === 'female';
        const isMale   = credentials.gender === 'male';
        const added2 = isFemale ? 'зарегистрировала' : isMale ? 'зарегистрировал' : 'зарегистрировал(а)';
        const glad   = isFemale ? 'буду рада тебя видеть' : isMale ? 'буду рад тебя видеть' : 'буду рад(а) тебя видеть';
        const msg = `Привет! 👋\nЯ ${added2} тебя на платформе ГенУрок.рф — там будут твои домашние задания и статистика с прогрессом. Следи за результатами и отслеживай прогресс!\n\nТвои данные для входа:\n🔑 Логин: ${credentials.login}\n🔒 Пароль: ${credentials.password}\n\n🌐 Войти можно здесь: https://генурок.рф/login/\n\nЗаходи, ${glad}!`;
        return (
          <div className="modal-overlay" onClick={() => setCredentials(null)}>
            <div className="modal modal--credentials" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">Ученик добавлен</span>
                <button className="modal-close" onClick={() => setCredentials(null)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className="credentials-body">
                <div className="credentials-hint">
                  <span className="credentials-hint-icon">⚠️</span>
                  <span>Пароль показывается только один раз — сохраните и передайте ученику.</span>
                </div>
                <div className="credentials-row">
                  <span className="credentials-label">Логин</span>
                  <span className="credentials-value">{credentials.login}</span>
                </div>
                <div className="credentials-row">
                  <span className="credentials-label">Пароль</span>
                  <span className="credentials-value credentials-value--password">{credentials.password}</span>
                </div>
                <div className="credentials-message">
                  <span className="credentials-message-label">Сообщение для ученика:</span>
                  <pre className="credentials-message-text">{msg}</pre>
                </div>
                <button
                  className="credentials-copy-all"
                  onClick={() => navigator.clipboard.writeText(msg)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Скопировать сообщение
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── GROUP MODAL ── */}
      {groupModalOpen && (
        <div className="modal-overlay" onClick={() => setGroupModalOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Новая группа</span>
              <button className="modal-close" onClick={() => setGroupModalOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <form className="modal-form" onSubmit={handleGroupSubmit}>
              <div className="modal-field">
                <label>Название группы <span className="modal-required">*</span></label>
                <input
                  name="group_name"
                  value={groupForm.group_name}
                  onChange={e => setGroupForm(f => ({ ...f, group_name: e.target.value }))}
                  placeholder="9А — Математика ОГЭ"
                  autoFocus
                />
              </div>
              <div className="modal-row">
                <div className="modal-field">
                  <label>Предмет <span className="modal-required">*</span></label>
                  <select
                    name="subject"
                    value={groupForm.subject}
                    onChange={e => setGroupForm(f => ({ ...f, subject: e.target.value }))}
                  >
                    <option value="">— выберите —</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                  </select>
                </div>
                <div className="modal-field">
                  <label>Уровень <span className="modal-required">*</span></label>
                  <select
                    name="level"
                    value={groupForm.level}
                    onChange={e => setGroupForm(f => ({ ...f, level: e.target.value }))}
                  >
                    <option value="">— выберите —</option>
                    {levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}
                  </select>
                </div>
              </div>
              {groupError && <div className="modal-error">{groupError}</div>}
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setGroupModalOpen(false)}>Отмена</button>
                <button type="submit" className="modal-btn modal-btn--save" disabled={groupSaving}>
                  {groupSaving ? 'Сохранение…' : 'Создать группу'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
