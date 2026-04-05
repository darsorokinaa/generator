const SUBJECT_COLOR = {
  'Математика': 'math', 'Алгебра': 'math', 'Геометрия': 'math',
  'Информатика': 'cs',  'Физика': 'physics',
};
const LEVEL_COLOR    = { 'ОГЭ': 'oge', 'ЕГЭ': 'ege' };
const STATUS_LABELS  = { '1': 'Активный', '2': 'На паузе', '3': 'Завершил', '4': 'Пробный урок' };
const STATUS_CLASS   = { '1': 'active', '2': 'warning', '3': 'danger', '4': 'warning' };
const GENDER_LABELS  = { female: 'Женский', male: 'Мужской', other: 'Не указан' };

function initials(name, surname) {
  return [(name || '')[0], (surname || '')[0]].filter(Boolean).join('').toUpperCase() || '?';
}

function age(birthDate) {
  if (!birthDate) return null;
  const diff = Date.now() - new Date(birthDate).getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  const last = years % 100;
  const rem  = years % 10;
  const suffix = (last >= 11 && last <= 14) ? 'лет'
    : rem === 1 ? 'год' : (rem >= 2 && rem <= 4) ? 'года' : 'лет';
  return `${years} ${suffix}`;
}

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}.${m}.${y}`;
}

export default function StudentProfilePage({ student: s, onBack }) {
  const av = initials(s.student_name, s.student_surname);
  const fullName = [s.student_name, s.student_surname].filter(Boolean).join(' ');
  const statusCls = STATUS_CLASS[s.status] || 'warning';

  /* Mock stats — в реальности здесь будет fetch */
  const stats = [
    { label: 'Занятий проведено', value: '—', icon: '📅', color: 'blue' },
    { label: 'Домашних заданий', value: '—', icon: '📝', color: 'purple' },
    { label: 'Выполнено вовремя', value: '—', icon: '✅', color: 'green' },
    { label: 'Средний балл', value: '—', icon: '⭐', color: 'yellow' },
  ];

  return (
    <div className="page-content">
      {/* Back */}
      <button className="profile-back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Назад к ученикам
      </button>

      {/* Hero */}
      <div className="sp-hero">
        <div className="sp-avatar">{av}</div>
        <div className="sp-hero-info">
          <h1 className="sp-name">{fullName || '—'}</h1>
          <div className="sp-hero-badges">
            <span className={`status-badge status-badge--${statusCls}`}>{STATUS_LABELS[s.status] || '—'}</span>
            <span className={`subject-badge subject-badge--${SUBJECT_COLOR[s.subject_name] || 'default'}`}>{s.subject_name}</span>
            <span className={`level-badge level-badge--${LEVEL_COLOR[s.level_name] || 'default'}`}>{s.level_name}</span>
            {s.lesson_type === 'group'
              ? <span className="lesson-type-badge lesson-type-badge--group">{s.group_name ? `Группа: ${s.group_name}` : 'Групповое'}</span>
              : <span className="lesson-type-badge lesson-type-badge--individual">Индивидуальное</span>
            }
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="sp-stats-row">
        {stats.map(st => (
          <div key={st.label} className={`sp-stat-card sp-stat-card--${st.color}`}>
            <span className="sp-stat-icon">{st.icon}</span>
            <span className="sp-stat-value">{st.value}</span>
            <span className="sp-stat-label">{st.label}</span>
          </div>
        ))}
      </div>

      {/* Two-column info */}
      <div className="sp-grid">
        {/* Personal */}
        <div className="sp-card">
          <div className="sp-card-title">Личные данные</div>
          <div className="sp-rows">
            <div className="sp-row">
              <span className="sp-row-label">Email</span>
              <span className="sp-row-value">{s.student_email || '—'}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Телефон</span>
              <span className="sp-row-value">{s.student_phone || '—'}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Дата рождения</span>
              <span className="sp-row-value">{formatDate(s.birth_date)}</span>
            </div>
            {s.birth_date && (
              <div className="sp-row">
                <span className="sp-row-label">Возраст</span>
                <span className="sp-row-value">{age(s.birth_date)}</span>
              </div>
            )}
            <div className="sp-row">
              <span className="sp-row-label">Пол</span>
              <span className="sp-row-value">{GENDER_LABELS[s.gender] || '—'}</span>
            </div>
          </div>
        </div>

        {/* Education */}
        <div className="sp-card">
          <div className="sp-card-title">Обучение</div>
          <div className="sp-rows">
            <div className="sp-row">
              <span className="sp-row-label">Предмет</span>
              <span className={`subject-badge subject-badge--${SUBJECT_COLOR[s.subject_name] || 'default'}`}>{s.subject_name || '—'}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Уровень</span>
              <span className={`level-badge level-badge--${LEVEL_COLOR[s.level_name] || 'default'}`}>{s.level_name || '—'}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Класс</span>
              <span className="sp-row-value">{s.grade ? `${s.grade} класс` : '—'}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Тип занятий</span>
              {s.lesson_type === 'group'
                ? <span className="lesson-type-badge lesson-type-badge--group">{s.group_name ? `Группа: ${s.group_name}` : 'Групповое'}</span>
                : <span className="lesson-type-badge lesson-type-badge--individual">Индивидуальное</span>
              }
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Статус</span>
              <span className={`status-badge status-badge--${statusCls}`}>{STATUS_LABELS[s.status] || '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Goal */}
      {s.goal && (
        <div className="sp-card sp-card--full">
          <div className="sp-card-title">Цель обучения</div>
          <p className="sp-goal-text">{s.goal}</p>
        </div>
      )}

      {/* Placeholder for future homework/lesson history */}
      <div className="sp-card sp-card--full sp-card--placeholder">
        <div className="sp-card-title">История занятий</div>
        <p className="sp-placeholder-text">Здесь будет отображаться история занятий и домашних заданий ученика.</p>
      </div>
    </div>
  );
}
