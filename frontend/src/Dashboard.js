import { useState, useEffect, useRef } from 'react';
import './Dashboard.css';
import StudentsPage from './StudentsPage';
import HomeworkPage from './HomeworkPage';
import StudentProfilePage from './StudentProfilePage';
import API from './api';

const GENURОК_URL = 'https://genurok.tw1.ru';

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Дашборд',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    id: 'students',
    label: 'Мои ученики',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    id: 'homework',
    label: 'Домашние задания',
    badge: null,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: 'generator',
    label: 'Генератор',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 4H6l6 8-6 8h12" />
      </svg>
    ),
  },
];

const METRICS = [
  {
    label: 'Всего учеников',
    value: '24',
    sub: '+2 за месяц',
    color: 'blue',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: 'Заданий на проверке',
    value: '8',
    sub: '3 просрочено',
    color: 'accent',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
      </svg>
    ),
  },
  {
    label: 'Уроков проведено',
    value: '312',
    sub: '4 на этой неделе',
    color: 'blue',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
      </svg>
    ),
  },
  {
    label: 'Дней на платформе',
    value: '127',
    sub: '🔥 14 дней подряд',
    color: 'streak',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
];


const HOMEWORKS = [
  { student: 'Анна Козлова',   subject: 'Математика', task: 'Квадратные уравнения §5',   submitted: '2 ч назад',  urgent: false },
  { student: 'Иван Петров',    subject: 'Физика',      task: 'Законы Ньютона',             submitted: '5 ч назад',  urgent: false },
  { student: 'Дмитрий Волков', subject: 'Математика', task: 'Тригонометрия §12',          submitted: 'вчера',       urgent: true  },
  { student: 'Елена Новикова', subject: 'Алгебра',    task: 'Степени и логарифмы',        submitted: '2 дня назад', urgent: true  },
];

const NOTIFICATIONS = [
  { text: 'Анна Козлова сдала задание',       time: '10 мин', type: 'hw' },
  { text: 'Иван Петров не сдал в срок',       time: '1 ч',    type: 'warn' },
  { text: 'Новое сообщение от Марии',         time: '3 ч',    type: 'msg' },
];

const CALENDAR_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAY_NAMES   = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

function buildCalendarWeeks(year, month) {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // convert Sunday=0 → Mon-based offset
  const offset = (firstDay + 6) % 7;
  const cells = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const STATUS_LABELS = { active: 'Активен', warning: 'Пассивен', danger: 'Отстаёт' };

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2);
}

const SUBJECT_COLOR = {
  'Математика':  'math',
  'Алгебра':     'math',
  'Геометрия':   'math',
  'Информатика': 'cs',
  'Физика':      'physics',
};

const LEVEL_COLOR = {
  'ОГЭ': 'oge',
  'ЕГЭ': 'ege',
};

const LEVEL_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'ОГЭ', label: 'ОГЭ' },
  { id: 'ЕГЭ', label: 'ЕГЭ' },
];


export default function Dashboard() {
  const [page, setPage] = useState('dashboard');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [levelFilter, setLevelFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('Все');
  const [search, setSearch] = useState('');
  const [notifIdx, setNotifIdx] = useState(0);
  const [notifDir, setNotifDir] = useState('next');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [lessonTarget, setLessonTarget] = useState('student');
  const [groups, setGroups] = useState([]);
  // { roomId, targetName, type, tab } — tab = ссылка на открытую вкладку урока
  const [call, setCall] = useState(null);
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const notifTimer = useRef(null);
  const [subject, setSubject] = useState([]);

  function goNotif(dir) {
    setNotifDir(dir);
    setNotifIdx(i =>
      dir === 'next'
        ? (i + 1) % NOTIFICATIONS.length
        : (i - 1 + NOTIFICATIONS.length) % NOTIFICATIONS.length
    );
  }

  function resetNotifTimer() {
    if (notifTimer.current) clearInterval(notifTimer.current);
    notifTimer.current = setInterval(() => goNotif('next'), 10000);
  }

  useEffect(() => {
    resetNotifTimer();
    return () => clearInterval(notifTimer.current);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/students/`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => { setStudents(data); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${API}/api/groups/`, { credentials: 'include' })
      .then(r => r.json()).then(setGroups).catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API}/api/me/`, { credentials: 'include' })
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          window.location.href = `${API}/login/`;
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (data) setUser(data);
        setAuthChecked(true);
      })
      .catch(() => {
        window.location.href = `${API}/login/`;
      });
  }, []);

  useEffect(() => {
    fetch(`${API}/api/subject/`, { credentials: 'include' })
      .then(r => r.json())
      .then(data => setUser(data))
      .catch(() => {});
  }, []);

  const filtered = students.filter(s => {
    const byLevel = levelFilter === 'all' || s.level_name === levelFilter;
    const bySubject = subjectFilter === 'Все' || s.subject_name === subjectFilter;
    const fullName = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
    const bySearch = fullName.toLowerCase().includes(search.toLowerCase());
    return byLevel && bySubject && bySearch;
  });

  const availableSubjects = ['Все', ...Array.from(new Set(
    (levelFilter === 'all' ? students : students.filter(s => s.level_name === levelFilter)).map(s => s.subject_name)
  ))];

  if (loading) return (
    <div className="page-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Загрузка…</span>
    </div>
  );

  if (!authChecked) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#F0F2FA', flexDirection: 'column', gap: 16,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          border: '3px solid #E5E7EB', borderTopColor: '#4F6EF7',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: '#9CA3AF', fontFamily: 'Montserrat, sans-serif', fontSize: 14, margin: 0 }}>
          Проверка авторизации…
        </p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="page-bg">
      <div className="dashboard-card">

        {/* ── MOBILE TOPBAR ── */}
        <header className="mobile-topbar">
          <div className="mobile-logo">
            <div className="logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="mobile-logo-text">Кабинет</span>
          </div>
          <div className="mobile-user">
            <button className="icon-btn notif-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="notif-dot" />
            </button>
            <div className="user-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
              {user ? (user.role[0] || '') + (user.surname[0] || '') : '??'}
            </div>
          </div>
        </header>

        {/* ── LEFT SIDEBAR ── */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="logo-text">Кабинет</span>
          </div>

          <nav className="sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.label}
                href="#"
                className={`nav-item${page === item.id ? ' nav-item--active' : ''}`}
                onClick={e => { e.preventDefault(); setPage(item.id); }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.id === 'homework'
                  ? <span className="nav-badge">{HOMEWORKS.length}</span>
                  : item.badge && <span className="nav-badge">{item.badge}</span>
                }
              </a>
            ))}
          </nav>
        </aside>

        {/* ── MAIN ── */}
        <main className="main-content">
          {page === 'student-profile' && selectedStudent && (
            <StudentProfilePage
              student={selectedStudent}
              onBack={() => { setPage('students'); setSelectedStudent(null); }}
            />
          )}
          {page === 'students' && (
            <StudentsPage
              onOpenProfile={s => { setSelectedStudent(s); setPage('student-profile'); }}
            />
          )}
          {page === 'homework' && <HomeworkPage />}
          {(page === 'dashboard' || page === 'generator') && <>

          {/* Search at top */}
          <div className="topbar">
            <div className="search-box">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="search-input"
                type="text"
                placeholder="Поиск ученика по имени…"
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

          </div>

          {/* Metrics */}
          <div className="metrics-row">
            {METRICS.map((m) => (
              <div key={m.label} className={`metric-card metric-card--${m.color}`}>
                <div className="metric-icon-wrap">{m.icon}</div>
                <div className="metric-body">
                  <span className="metric-value">{m.value}</span>
                  <span className="metric-label">{m.label}</span>
                  <span className="metric-sub">{m.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Banner */}
          <div className="welcome-banner">
            <div className="welcome-text">
              <p className="welcome-greeting">Добро пожаловать,</p>
              <h1 className="welcome-name">{user ? `${user.name} ${user.surname}` : '...'}</h1>
              <p className="welcome-role">Преподаю: {user ? (user.subjects?.map(s => s.toLowerCase()).join(', ') || '—') : '...'}</p>
              {call ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* Индикатор + переход на платформу */}
                  <button
                    className="welcome-link welcome-link--active"
                    onClick={() => call.tab && !call.tab.closed
                      ? call.tab.focus()
                      : window.open(`${GENURОК_URL}`, '_blank', 'noopener,noreferrer')
                    }
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: '#4ADE80', boxShadow: '0 0 6px #4ADE80',
                      flexShrink: 0, animation: 'pulse 1.5s ease-in-out infinite',
                    }} />
                    Урок идёт · {call.targetName}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                      <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                  </button>
                  {/* Завершить урок */}
                  <button
                    className="welcome-link"
                    style={{ background: 'rgba(239,68,68,.15)', border: '1.5px solid rgba(239,68,68,.3)', color: '#fca5a5' }}
                    onClick={() => { call.tab?.close(); setCall(null); }}
                  >
                    Завершить урок
                  </button>
                </div>
              ) : (
                <button className="welcome-link" onClick={() => setLessonModalOpen(true)}>
                  Начать урок
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              )}
            </div>
            <div className="photo-placeholder-wrap">
              <div className="photo-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="photo-placeholder-text">Добавить фото</span>
              </div>
            </div>
          </div>

          {/* Homework pending */}
          <div className="section-block">
            <div className="section-header">
              <div className="section-title-wrap">
                <h3 className="section-title">Домашние задания</h3>
                <span className="hw-count-badge">На проверке: {HOMEWORKS.length}</span>
              </div>
              <a href="#" className="section-link" onClick={e => { e.preventDefault(); setPage('homework'); }}>Все задания →</a>
            </div>
            <div className="table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Задание</th>
                    <th className="col-hide-sm">Предмет</th>
                    <th className="col-hide-sm">Сдано</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {HOMEWORKS.map((hw, i) => (
                    <tr key={i}>
                      <td>
                        <div className="student-cell">
                          <div className="hw-student-avatar">{initials(hw.student)}</div>
                          <div className="student-info">
                            <span className="student-name">{hw.student}</span>
                            <span className="student-meta-sm">{hw.subject} · {hw.submitted}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="hw-task-cell">{hw.task}</span>
                      </td>
                      <td className="col-hide-sm">
                        <span className={`subject-badge subject-badge--${SUBJECT_COLOR[hw.subject] || 'default'}`}>
                          {hw.subject}
                        </span>
                      </td>
                      <td className="col-hide-sm">
                        <span className="cell-plain">{hw.submitted}</span>
                      </td>
                      <td>
                        {hw.urgent
                          ? <span className="status-badge status-badge--danger">Просрочено</span>
                          : <span className="status-badge status-badge--active">В срок</span>
                        }
                      </td>
                      <td>
                        <button className="hw-btn">Проверить</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Students Table */}
          <div className="section-block">
            <div className="section-header">
              <h3 className="section-title">Мои ученики</h3>
            </div>

            {/* Level filters */}
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

            {/* Subject filters — second level */}
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

            <div className="table-above-row">
              <span className="table-count">{filtered.length} учеников</span>
              <a href="#" className="section-link" onClick={e => { e.preventDefault(); setPage('students'); }}>Все ученики →</a>
            </div>

            <div className="table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Класс</th>
                    <th className="col-hide-sm">Предмет</th>
                    <th className="col-hide-sm">Уровень</th>
                    <th>Балл</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="table-empty">Ученики не найдены</td>
                    </tr>
                  ) : filtered.map((s) => (
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
                      <td className="col-hide-sm">
                        <span className="cell-plain">{s.grade} класс</span>
                      </td>
                      <td className="col-hide-sm">
                        <span className={`subject-badge subject-badge--${SUBJECT_COLOR[s.subject_name] || 'default'}`}>
                          {s.subject_name}
                        </span>
                      </td>
                      <td className="col-hide-sm">
                        <span className={`level-badge level-badge--${LEVEL_COLOR[s.level_name] || 'default'}`}>
                          {s.level_name}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge status-badge--${s.status === '1' ? 'active' : s.status === '3' ? 'danger' : 'warning'}`}>
                          {{'1':'Активный','2':'На паузе','3':'Завершил','4':'Пробный'}[s.status] || s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
          </>}
        </main>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="right-sidebar">
          {/* User + actions */}
          <div className="user-block">
            <div className="user-actions">
              <button className="icon-btn notif-btn" title="Уведомления">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span className="notif-dot" />
              </button>
              <a href="http://localhost:8000/settings/" className="icon-btn" title="Настройки">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </a>
              <a href="http://localhost:8000/logout/" className="icon-btn icon-btn--logout" title="Выйти">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </a>
            </div>
            
            <div className="user-info">
              <div className="user-details">
                <span className="user-name">{user ? `${user.name} ${user.surname}` : '…'}</span>
                <span className="user-email">Учитель · {user?.email || '…'}</span>
              </div>
              <div className="user-avatar">
                {user ? (user.name[0] || '') + (user.surname[0] || '') : '??'}
              </div>
            </div>
          </div>

          <div className="divider" />

          {/* Notifications */}
          <div className="notif-section">
            <div className="notif-header">
              <span className="notif-label">Уведомления</span>
              <div className="notif-nav">
                <button
                  className="notif-arrow"
                  onClick={() => { goNotif('prev'); resetNotifTimer(); }}
                  disabled={notifIdx === 0}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span className="notif-counter">{notifIdx + 1}/{NOTIFICATIONS.length}</span>
                <button
                  className="notif-arrow"
                  onClick={() => { goNotif('next'); resetNotifTimer(); }}
                  disabled={notifIdx === NOTIFICATIONS.length - 1}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="notif-slide-wrap">
              {(() => {
                const n = NOTIFICATIONS[notifIdx];
                return (
                  <div key={notifIdx} className={`notif-item notif-item--${notifDir}`}>
                    <div className={`notif-dot-type notif-dot-type--${n.type}`} />
                    <div className="notif-body">
                      <span className="notif-text">{n.text}</span>
                      <span className="notif-time">{n.time} назад</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="divider" />

          {/* Calendar */}
          <div className="calendar">
            <div className="cal-header">
              <div className="cal-month-info">
                <span className="cal-month">{MONTH_NAMES[calMonth]} {calYear}</span>
                <span className="cal-date-line">
                  {today.getDate()} · {DAY_NAMES[today.getDay()]}
                </span>
              </div>
              <div className="cal-nav">
                <button className="cal-nav-btn" onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                  else setCalMonth(m => m - 1);
                }}>‹</button>
                <button
                  className="cal-today-btn"
                  onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()); }}
                >Сегодня</button>
                <button className="cal-nav-btn" onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); }
                  else setCalMonth(m => m + 1);
                }}>›</button>
              </div>
            </div>
            <div className="cal-grid">
              {CALENDAR_DAYS.map((d) => (
                <div key={d} className="cal-weekday-label">{d}</div>
              ))}
              {buildCalendarWeeks(calYear, calMonth).map((week, wi) =>
                week.map((day, di) => {
                  const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear();
                  return (
                    <div key={`${wi}-${di}`} className={`cal-day${isToday ? ' cal-day--today' : ''}${!day ? ' cal-day--empty' : ''}`}>
                      {day ?? ''}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="divider" />

          {/* Quote */}
          <div className="quote-block">
            <div className="quote-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
              </svg>
            </div>
            <p className="quote-text">
              Хороший учитель — тот, кто помогает ученику обнаружить в себе то, что он уже знает.
            </p>
            <span className="quote-author">— Тимоти Голлвей</span>
          </div>
        </aside>

      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-bottom-nav">
        <div className="bottom-nav-inner">
          {NAV_ITEMS.map((item) => (
            <a key={item.label} href="#" className={`bottom-nav-item${item.active ? ' bottom-nav-item--active' : ''}`}>
              {item.badge && <span className="bottom-nav-badge">{item.badge}</span>}
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* ── LESSON START MODAL ── */}
      {lessonModalOpen && (() => {
        const GEOK_URL = 'https://ГенУрок.рф/lesson/start/';
        const activeStudents = students.filter(s => s.lesson_type === 'individual');

        async function startLesson(type, id, name) {
          const roomId = `${type}_${id}_${Date.now()}`;

          try {
            // Получаем подписанный URL с токеном от кабинета
            const res = await fetch(`${API}/api/lesson/token/`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
              body: JSON.stringify({
                room_id:     roomId,
                type,
                target_id:   id,
                target_name: name,
              }),
            });

            if (!res.ok) throw new Error('token error');
            const { url } = await res.json();

            const tab = window.open(url, '_blank', 'noopener,noreferrer');
            setCall({ roomId, targetName: name, type, tab });
          } catch {
            alert('Не удалось создать урок. Попробуйте снова.');
          }

          setLessonModalOpen(false);
        }

        return (
          <div className="modal-overlay" onClick={() => setLessonModalOpen(false)}>
            <div className="modal modal--lesson" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">Начать урок</span>
                <button className="modal-close" onClick={() => setLessonModalOpen(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className="lesson-modal-body">
                {/* Tabs */}
                <div className="lesson-tabs">
                  <button
                    className={`lesson-tab${lessonTarget === 'student' ? ' lesson-tab--active' : ''}`}
                    onClick={() => setLessonTarget('student')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                    </svg>
                    Индивидуальный
                  </button>
                  <button
                    className={`lesson-tab${lessonTarget === 'group' ? ' lesson-tab--active' : ''}`}
                    onClick={() => setLessonTarget('group')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Групповой
                  </button>
                </div>

                {lessonTarget === 'student' && (
                  <div className="lesson-list">
                    {activeStudents.length === 0 && (
                      <p className="lesson-empty">Нет индивидуальных учеников</p>
                    )}
                    {activeStudents.map(s => (
                      <button
                        key={s.id}
                        className="lesson-item"
                        onClick={() => startLesson('student', s.id, `${s.student_name} ${s.student_surname || ''}`.trim())}
                      >
                        <div className="lesson-item-avatar">
                          {(s.student_name?.[0] || '?').toUpperCase()}{(s.student_surname?.[0] || '').toUpperCase()}
                        </div>
                        <div className="lesson-item-info">
                          <span className="lesson-item-name">{s.student_name} {s.student_surname}</span>
                          <span className="lesson-item-sub">{s.subject_name} · {s.level_name}</span>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lesson-item-arrow">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )}

                {lessonTarget === 'group' && (
                  <div className="lesson-list">
                    {groups.length === 0 && (
                      <p className="lesson-empty">Нет созданных групп</p>
                    )}
                    {groups.map(g => (
                      <button
                        key={g.id}
                        className="lesson-item"
                        onClick={() => startLesson('group', g.id, g.group_name)}
                      >
                        <div className="lesson-item-avatar lesson-item-avatar--group">
                          {g.group_name[0]?.toUpperCase()}
                        </div>
                        <div className="lesson-item-info">
                          <span className="lesson-item-name">{g.group_name}</span>
                          <span className="lesson-item-sub">{g.subject_name} · {g.level_name}</span>
                        </div>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lesson-item-arrow">
                          <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )}

                <p className="lesson-hint">
                  После выбора вы будете перенаправлены на платформу ГенУрок.рф для проведения урока.
                </p>
              </div>
            </div>
          </div>
        );
      })()}


    </div>
  );
}

