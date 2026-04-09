import { useState } from 'react';

const SUBJECT_COLOR = {
  'Математика': 'math', 'Алгебра': 'math', 'Геометрия': 'math',
  'Информатика': 'cs',  'Физика': 'physics',
};

const ALL_HW = [
  { student: 'Анна Козлова',    subject: 'Математика', task: 'Квадратные уравнения §5',    submitted: '2 ч назад',   deadline: '17.09.2024', urgent: false, reviewed: false },
  { student: 'Иван Петров',     subject: 'Физика',     task: 'Законы Ньютона',             submitted: '5 ч назад',   deadline: '17.09.2024', urgent: false, reviewed: false },
  { student: 'Дмитрий Волков',  subject: 'Математика', task: 'Тригонометрия §12',          submitted: 'вчера',       deadline: '16.09.2024', urgent: true,  reviewed: false },
  { student: 'Елена Новикова',  subject: 'Алгебра',    task: 'Степени и логарифмы',        submitted: '2 дня назад', deadline: '15.09.2024', urgent: true,  reviewed: false },
  { student: 'Мария Сидорова',  subject: 'Математика', task: 'Производная функции §8',     submitted: '1 ч назад',   deadline: '17.09.2024', urgent: false, reviewed: false },
  { student: 'Сергей Орлов',    subject: 'Информатика',task: 'Алгоритмы сортировки',       submitted: '3 ч назад',   deadline: '17.09.2024', urgent: false, reviewed: false },
  { student: 'Ольга Смирнова',  subject: 'Математика', task: 'Системы уравнений §3',       submitted: '3 дня назад', deadline: '14.09.2024', urgent: true,  reviewed: true  },
  { student: 'Артём Кузнецов',  subject: 'Физика',     task: 'Электромагнитные волны',     submitted: '1 день назад',deadline: '16.09.2024', urgent: false, reviewed: true  },
];

const TAB_FILTERS = [
  { id: 'all',      label: 'Все задания',      count: ALL_HW.length },
  { id: 'pending',  label: 'На проверке',      count: ALL_HW.filter(h => !h.reviewed).length },
  { id: 'overdue',  label: 'Просрочено',       count: ALL_HW.filter(h => h.urgent && !h.reviewed).length },
  { id: 'reviewed', label: 'Проверено',        count: ALL_HW.filter(h => h.reviewed).length },
];

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2);
}

const STATS = [
  { label: 'Всего заданий',    value: ALL_HW.length,                                   color: 'blue' },
  { label: 'Ожидают проверки', value: ALL_HW.filter(h => !h.reviewed).length,          color: 'blue' },
  { label: 'Просрочено',       value: ALL_HW.filter(h => h.urgent && !h.reviewed).length, color: 'red' },
  { label: 'Проверено',        value: ALL_HW.filter(h => h.reviewed).length,           color: 'green' },
];

export default function HomeworkPage() {
  const [tab, setTab]     = useState('pending');
  const [search, setSearch] = useState('');

  const filtered = ALL_HW.filter(h => {
    const byTab =
      tab === 'all'      ? true :
      tab === 'pending'  ? !h.reviewed :
      tab === 'overdue'  ? h.urgent && !h.reviewed :
      tab === 'reviewed' ? h.reviewed : true;
    const bySearch = h.student.toLowerCase().includes(search.toLowerCase()) ||
                     h.task.toLowerCase().includes(search.toLowerCase());
    return byTab && bySearch;
  });

  return (
    <div className="page-content">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="page-title">Домашние задания</h2>
          <p className="page-subtitle">Проверка и управление заданиями</p>
        </div>
        <button className="btn-page-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Создать задание
        </button>
      </div>

      {/* Stats */}
      <div className="hw-stats-row">
        {STATS.map(s => (
          <div key={s.label} className={`hw-stat hw-stat--${s.color}`}>
            <span className="hw-stat-value">{s.value}</span>
            <span className="hw-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="page-tabs">
        {TAB_FILTERS.map(t => (
          <button
            key={t.id}
            className={`page-tab${tab === t.id ? ' page-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className={`tab-count${tab === t.id ? ' tab-count--active' : ''}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="page-toolbar">
        <div className="search-box search-box--wide">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Поиск по ученику или заданию…"
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
        <span className="table-count" style={{ marginLeft: 'auto' }}>{filtered.length} заданий</span>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="students-table">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Задание</th>
              <th>Предмет</th>
              <th>Сдано</th>
              <th>Дедлайн</th>
              <th>Статус</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="table-empty">Заданий не найдено</td></tr>
            ) : filtered.map((hw, i) => (
              <tr key={i}>
                <td>
                  <div className="student-cell">
                    <div className="hw-student-avatar">{initials(hw.student)}</div>
                    <span className="student-name">{hw.student}</span>
                  </div>
                </td>
                <td><span className="hw-task-cell">{hw.task}</span></td>
                <td>
                  <span className={`subject-badge subject-badge--${SUBJECT_COLOR[hw.subject] || 'default'}`}>
                    {hw.subject}
                  </span>
                </td>
                <td><span className="cell-plain">{hw.submitted}</span></td>
                <td><span className="cell-plain">{hw.deadline}</span></td>
                <td>
                  {hw.reviewed
                    ? <span className="status-badge status-badge--active">Проверено</span>
                    : hw.urgent
                      ? <span className="status-badge status-badge--danger">Просрочено</span>
                      : <span className="status-badge status-badge--warning">Ожидает</span>
                  }
                </td>
                <td>
                  {!hw.reviewed && (
                    <button className="hw-btn">Проверить</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
