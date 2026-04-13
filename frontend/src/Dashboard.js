import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './Dashboard.css';
import StudentsPage from './StudentsPage';
import HomeworkPage from './HomeworkPage';
import StudentProfilePage from './StudentProfilePage';
import GroupDetailPage from './GroupDetailPage';
import NotificationBell from './NotificationBell';
import API from './api';

// В разработке ссылка ведёт на локальный генератор; в проде — на переменную окружения
const GENUROK_URL = (process.env.REACT_APP_GENERATOR_URL || 'https://genurok.tw1.ru').replace(/\/$/, '');

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


const CALENDAR_DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function timeAgoShort(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}

/** Точка слева: цвет по типу уведомления */
function notifDotKind(notificationType) {
  if (['missed', 'check_deadline_soon', 'low_result_alert'].includes(notificationType)) return 'warn';
  if (['submitted', 'reviewing', 'homework_assigned', 'reviewed', 'revision_requested'].includes(notificationType)) return 'hw';
  return 'msg';
}

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
  const [profileBackPage, setProfileBackPage] = useState('students');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [levelFilter, setLevelFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('Все');
  const [search, setSearch] = useState('');
  const [notifIdx, setNotifIdx] = useState(0);
  const [notifDir, setNotifDir] = useState('next');
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [lessonTarget, setLessonTarget] = useState('student');
  const [groups, setGroups] = useState([]);
  const [call, setCall] = useState(null);
  // Входящий звонок от учителя { teacher, studentUrl, lessonType }
  const [incomingLesson, setIncomingLesson] = useState(null);
  const notifyWsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const incomingRingTimerRef = useRef(null);
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const notifTimer = useRef(null);
  const [dashHomeworks, setDashHomeworks] = useState([]);
  const [dashHwStats, setDashHwStats] = useState({ total: 0, needReview: 0, overdue: 0 });
  const hwPollRef = useRef(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [sidebarNotifs, setSidebarNotifs] = useState([]);
  const unreadNotifs = useMemo(() => sidebarNotifs.filter(n => !n.read), [sidebarNotifs]);
  const unreadNotifsRef = useRef(unreadNotifs);
  unreadNotifsRef.current = unreadNotifs;

  function goNotif(dir) {
    const len = unreadNotifsRef.current.length;
    if (!len) return;
    setNotifDir(dir);
    setNotifIdx(i => (dir === 'next' ? (i + 1) % len : (i - 1 + len) % len));
  }

  function resetNotifTimer() {
    if (notifTimer.current) clearInterval(notifTimer.current);
    notifTimer.current = setInterval(() => {
      if (unreadNotifsRef.current.length > 1) goNotif('next');
    }, 10000);
  }

  useEffect(() => {
    if (unreadNotifs.length <= 1) {
      if (notifTimer.current) clearInterval(notifTimer.current);
      return;
    }
    resetNotifTimer();
    return () => clearInterval(notifTimer.current);
  }, [unreadNotifs.length]);

  useEffect(() => {
    const len = unreadNotifs.length;
    setNotifIdx(i => (len === 0 ? 0 : Math.min(Math.max(0, i), len - 1)));
  }, [unreadNotifs.length]);

  useEffect(() => {
    if (!authChecked || !user || user.role === 'student') return;
    const load = () => {
      fetch(`${API}/api/notifications/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .then(data => setSidebarNotifs(Array.isArray(data) ? data : []))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user) return;
    if (user.role === 'student') {
      setStudents([]);
      setGroups([]);
      return;
    }
    setLoading(true);
    fetch(`${API}/api/students/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => { setStudents(Array.isArray(data) ? data : []); })
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
    fetch(`${API}/api/groups/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => { setGroups(Array.isArray(data) ? data : []); })
      .catch(() => setGroups([]));

  }, [authChecked, user]);

  // Фетч ДЗ-виджета
  const fetchDashHomeworks = useCallback(async () => {
    if (!authChecked || !user || user.role === 'student') return;
    try {
      const r1 = await fetch(`${API}/api/homework/`, { credentials: 'include' });
      if (!r1.ok) return;
      const hws = await r1.json();
      const all = [];
      for (const hw of (Array.isArray(hws) ? hws : [])) {
        const r2 = await fetch(`${API}/api/homework/${hw.id}/assignments/`, { credentials: 'include' });
        if (r2.ok) {
          const asgns = await r2.json();
          asgns.forEach(a => all.push({ ...a, hw_title: hw.title || `Вариант ${hw.variant_id}`, hw_subject: hw.subject, hw_deadline: hw.deadline }));
        }
      }
      const active = all.filter(a => a.status !== 'cancelled');
      const isOverdue = (a) => a.status === 'overdue' || (
        a.hw_deadline
        && new Date(a.hw_deadline) < new Date()
        && !['reviewed', 'submitted', 'reviewing', 'cancelled'].includes(a.status)
      );
      setDashHwStats({
        total: active.length,
        needReview: active.filter(a => ['submitted', 'reviewing'].includes(a.status)).length,
        overdue: active.filter(isOverdue).length,
      });
      setDashHomeworks(
        active.sort((a, b) => {
          const priority = { submitted: 0, reviewing: 1, revision: 2, overdue: 3, sent: 4, reviewed: 5 };
          return (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
        }).slice(0, 6),
      );
    } catch {}
  }, [authChecked, user]);

  // Polling каждые 30 сек
  useEffect(() => {
    fetchDashHomeworks();
    hwPollRef.current = setInterval(fetchDashHomeworks, 30_000);
    return () => clearInterval(hwPollRef.current);
  }, [fetchDashHomeworks]);

  // Обновить при возврате на дашборд
  useEffect(() => {
    if (page === 'dashboard') fetchDashHomeworks();
  }, [page, fetchDashHomeworks]);

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

  // Личный WS-канал уведомлений — для входящих уроков (только ученик)
  useEffect(() => {
    if (!user || user.role !== 'student') return undefined;
    // Строим абсолютный WS-URL: если API пустой (prod, same-origin) — берём текущий host
    const wsBase = API
      ? API.replace(/^https?/, (p) => (p === 'https' ? 'wss' : 'ws'))
      : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
    const ws = new WebSocket(`${wsBase}/ws/notify/`);
    notifyWsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'incoming_lesson') {
          setIncomingLesson(msg);
        }
      } catch {}
    };
    ws.onerror = () => {};
    return () => ws.close();
  }, [user]);

  // Fallback: если WS-сообщение потерялось, подтягиваем pending invite из API.
  useEffect(() => {
    if (!user || user.role !== 'student') return undefined;
    let stopped = false;
    const poll = () => {
      fetch(`${API}/api/lesson/pending/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (stopped) return;
          if (data?.invite?.event === 'incoming_lesson') {
            setIncomingLesson(data.invite);
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [user]);

  // Создаём AudioContext после первого пользовательского жеста (требование браузеров)
  useEffect(() => {
    const unlockAudio = () => {
      if (audioCtxRef.current) return;
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    };
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, []);

  // Звук входящего урока (повторяем, пока окно приглашения открыто)
  useEffect(() => {
    const stopRing = () => {
      if (incomingRingTimerRef.current) {
        clearInterval(incomingRingTimerRef.current);
        incomingRingTimerRef.current = null;
      }
    };

    const playRing = () => {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        // Двухтональный телефонный звонок: две пары тонов 440/480 Гц
        [[0, 440], [0, 480], [0.35, 440], [0.35, 480]].forEach(([offset, freq]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now + offset);
          gain.gain.linearRampToValueAtTime(0.22, now + offset + 0.02);
          gain.gain.setValueAtTime(0.22, now + offset + 0.27);
          gain.gain.linearRampToValueAtTime(0, now + offset + 0.3);
          osc.start(now + offset);
          osc.stop(now + offset + 0.3);
        });
      } catch {}
    };

    if (!incomingLesson) {
      stopRing();
      return;
    }

    playRing();
    incomingRingTimerRef.current = setInterval(playRing, 3000);

    return stopRing;
  }, [incomingLesson]);

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

  const isStudent = user?.role === 'student';
  const isTeacher = !isStudent;
  const navItems = isStudent
    ? NAV_ITEMS.filter(item => item.id === 'homework')
    : NAV_ITEMS;

  useEffect(() => {
    if (user?.role === 'student') setPage('homework');
  }, [user]);

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

  if (loading) return (
    <div className="page-bg" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Загрузка…</span>
    </div>
  );

  return (
    <div className={`page-bg${isStudent ? " student-theme" : ""}`}>
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
            <NotificationBell onGoToAssignment={(assignmentId) => { setPage('homework'); }} />
            <div className="user-avatar" style={{ width: 34, height: 34, fontSize: 12 }}>
              {user ? (user.name?.[0] || '') + (user.surname?.[0] || '') : '??'}
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
            {navItems.map((item) => (
              <a
                key={item.label}
                href="#"
                className={`nav-item${page === item.id ? ' nav-item--active' : ''}`}
                onClick={e => { e.preventDefault(); setSelectedGroup(null); setPage(item.id); }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {isTeacher && item.badge && <span className="nav-badge">{item.badge}</span>}
              </a>
            ))}
          </nav>
        </aside>

        {/* ── MAIN ── */}
        <main className="main-content">
          {page === 'student-profile' && selectedStudent && isTeacher && (
            <StudentProfilePage
              student={selectedStudent}
              groups={groups}
              backLabel={
                profileBackPage === 'dashboard'
                  ? 'Назад к дашборду'
                  : profileBackPage === 'group-detail'
                    ? 'Назад к группе'
                    : 'Назад к ученикам'
              }
              onBack={() => { setPage(profileBackPage); setSelectedStudent(null); }}
              onStudentUpdated={(updated) => {
                setSelectedStudent(prev => (prev ? { ...prev, ...updated } : prev));
                setStudents(prev => prev.map(st => (st.id === updated.id ? { ...st, ...updated } : st)));
              }}
            />
          )}
          {page === 'group-detail' && selectedGroup && isTeacher && (
            <GroupDetailPage
              group={selectedGroup}
              onBack={() => { setPage('dashboard'); setSelectedGroup(null); }}
              onOpenProfile={s => {
                setProfileBackPage('group-detail');
                setSelectedStudent(s);
                setPage('student-profile');
              }}
            />
          )}
          {page === 'students' && isTeacher && (
            <StudentsPage
              onOpenProfile={s => {
                setProfileBackPage('students');
                setSelectedStudent(s);
                setPage('student-profile');
              }}
            />
          )}
          {page === 'homework' && <HomeworkPage isStudent={isStudent} />}
          {(page === 'dashboard' || page === 'generator') && isTeacher && <>

          {/* Search at top */}
          <div className="topbar">
            <div className="search-box" style={{ position: 'relative' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="search-input"
                type="text"
                placeholder="Поиск ученика по имени…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 180)}
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch('')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}

              {/* Дропдаун результатов */}
              {searchFocused && search.trim().length > 0 && (() => {
                const hits = students.filter(s =>
                  `${s.student_name || ''} ${s.student_surname || ''}`.toLowerCase().includes(search.toLowerCase())
                ).slice(0, 8);
                return (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                    background: '#fff', borderRadius: 12,
                    border: '1.5px solid var(--border)',
                    boxShadow: '0 8px 24px rgba(102,126,234,.15)',
                    zIndex: 200, overflow: 'hidden',
                  }}>
                    {hits.length === 0 ? (
                      <div style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-3)' }}>Ученики не найдены</div>
                    ) : hits.map(s => {
                      const name = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
                      const ini  = ((s.student_name?.[0] || '') + (s.student_surname?.[0] || '')).toUpperCase();
                      return (
                        <div
                          key={s.id}
                          onMouseDown={() => {
                            setSearch('');
                            setProfileBackPage('dashboard');
                            setSelectedStudent(s);
                            setPage('student-profile');
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '9px 14px', cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                            transition: 'background .12s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                            background: 'linear-gradient(135deg,#667eea,#586fd7)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 700, fontSize: 11,
                          }}>{ini}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.subject_name} · {s.grade} класс</div>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6"/>
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

          </div>

          {/* Banner */}
          <div className="welcome-banner">
            <div className="welcome-text">
              <p className="welcome-greeting">Добро пожаловать,</p>
              <h1 className="welcome-name">{user ? `${user.name} ${user.surname}` : '...'}</h1>
              <p className="welcome-role">Преподаю: {user ? (user.subjects?.map(s => s.toLowerCase()).join(', ') || '—') : '...'}</p>
              {isTeacher && (call ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {/* Индикатор + переход на платформу */}
                  <button
                    className="welcome-link welcome-link--active"
                    onClick={() => call.tab && !call.tab.closed
                      ? call.tab.focus()
                      : window.open(call.url || GENUROK_URL, '_blank', 'noopener,noreferrer')
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
                  {/* Ссылка для ученика */}
                  {call.studentUrl && (
                    <button
                      className="welcome-link"
                      style={{ background: 'rgba(99,179,237,.12)', border: '1.5px solid rgba(99,179,237,.3)', color: '#93C5FD' }}
                      onClick={() => {
                        navigator.clipboard.writeText(call.studentUrl);
                      }}
                      title={call.studentUrl}
                    >
                      📋 Ссылка ученику
                    </button>
                  )}
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
                <button type="button" className="welcome-link" onClick={() => setLessonModalOpen(true)}>
                  Начать урок
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                  </svg>
                </button>
              ))}
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

          {/* Homework widget */}
          <div className="section-block">
            <div className="section-header">
              <div className="section-title-wrap" style={{ flexWrap: 'wrap', gap: 10 }}>
                <h3 className="section-title">Домашние задания</h3>
                <div className="dash-hw-counters" aria-label="Сводка по домашним заданиям">
                  <span className="dash-hw-counter dash-hw-counter--total">Всего <strong>{dashHwStats.total}</strong></span>
                  <span className="dash-hw-counter dash-hw-counter--review">На проверке <strong>{dashHwStats.needReview}</strong></span>
                  <span className="dash-hw-counter dash-hw-counter--overdue">Просрочено <strong>{dashHwStats.overdue}</strong></span>
                </div>
              </div>
              <a href="#" className="section-link" onClick={e => { e.preventDefault(); setPage('homework'); }}>Все задания →</a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: '#fff', borderRadius: 14, border: '1.5px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
              {/* Шапка */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto', gap: 0, padding: '10px 18px', borderBottom: '1.5px solid var(--border)', background: 'var(--bg)' }}>
                {['УЧЕНИК', 'ЗАДАНИЕ', 'СТАТУС', 'ДЕЙСТВИЕ'].map((h, i) => (
                  <span key={i} className="dash-hw-table-th">{h}</span>
                ))}
              </div>

              {dashHomeworks.length === 0 ? (
                <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                  Нет активных домашних заданий
                </div>
              ) : dashHomeworks.map((a, i) => {
                const isOverdue = a.status === 'overdue' || (a.hw_deadline && new Date(a.hw_deadline) < new Date() && !['reviewed','submitted','reviewing'].includes(a.status));
                const needsReview = ['submitted', 'reviewing'].includes(a.status);
                const statusCfg = {
                  sent:      { label: 'В срок',        dot: '#22C55E', bg: '#F0FDF4', color: '#15803D' },
                  submitted: { label: 'Сдано',          dot: '#667eea', bg: '#EEF0FE', color: '#4338CA' },
                  reviewing: { label: 'На проверке',    dot: '#F59E0B', bg: '#FEF3C7', color: '#B45309' },
                  reviewed:  { label: 'Проверено',      dot: '#22C55E', bg: '#F0FDF4', color: '#15803D' },
                  revision:  { label: 'На доработке',   dot: '#F59E0B', bg: '#FEF3C7', color: '#B45309' },
                  overdue:   { label: 'Просрочено',     dot: '#EF4444', bg: '#FEF2F2', color: '#B91C1C' },
                }[isOverdue ? 'overdue' : a.status] || { label: a.status, dot: '#9ca3af', bg: '#F1F5F9', color: '#64748b' };

                const name = `${a.student_name || ''} ${a.student_surname || ''}`.trim();
                const ini  = ((a.student_name?.[0] || '') + (a.student_surname?.[0] || '')).toUpperCase();

                return (
                  <div
                    key={a.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr auto auto',
                      alignItems: 'center', gap: 0,
                      padding: '13px 18px',
                      borderBottom: i < dashHomeworks.length - 1 ? '1px solid var(--border)' : 'none',
                      transition: 'background .15s', cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => setPage('homework')}
                  >
                    {/* Ученик */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                        background: 'linear-gradient(135deg,#667eea,#586fd7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 700, fontSize: 12,
                      }}>{ini}</div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                    </div>

                    {/* Задание */}
                    <div style={{ fontSize: 13, color: 'var(--text-2)', paddingRight: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.hw_title}
                    </div>

                    {/* Статус */}
                    <div style={{ paddingRight: 16 }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        borderRadius: 20, padding: '4px 10px',
                        background: statusCfg.bg, color: statusCfg.color,
                        fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.dot, flexShrink: 0 }} />
                        {statusCfg.label}
                      </span>
                    </div>

                    {/* Кнопка */}
                    <div>
                      {needsReview && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPage('homework'); }}
                          style={{
                            padding: '6px 16px', borderRadius: 8, border: 'none',
                            background: '#3e5bd4', color: '#fff',
                            fontSize: 12, fontWeight: 700, cursor: 'pointer',
                            fontFamily: 'Montserrat, sans-serif', whiteSpace: 'nowrap',
                            transition: 'background .15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#2f4bbf'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#3e5bd4'; }}
                        >
                          Проверить
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Кнопка под таблицей ДЗ */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                className="btn-page-primary"
                style={{ minWidth: 180 }}
                onClick={() => setPage('homework')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                Создать задание
              </button>
            </div>
          </div>

          {/* Students Table */}
          <div className="section-block">
            <div className="section-header">
              <h3 className="section-title">Мои ученики</h3>
            </div>

            {/* Level filters + ссылка «Все ученики» в одну строку */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <div className="filter-bar" style={{ margin: 0, flex: 1, flexWrap: 'wrap' }}>
                {LEVEL_FILTERS.map(f => (
                  <button
                    key={f.id}
                    className={`filter-pill${levelFilter === f.id ? ' filter-pill--active' : ''}`}
                    onClick={() => { setLevelFilter(f.id); setSubjectFilter('Все'); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <button
                className="section-link"
                style={{ background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 0' }}
                onClick={() => setPage('students')}
              >
                Все ученики →
              </button>
            </div>

            {/* Subject filters */}
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

            <div className="table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th className="students-table-col--student">УЧЕНИК</th>
                    <th className="students-table-col--subject">ПРЕДМЕТ</th>
                    <th className="students-table-col--level">УРОВЕНЬ</th>
                    <th className="students-table-col--lesson">ТИП ЗАНЯТИЙ</th>
                    <th className="students-table-col--status">СТАТУС</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="table-empty">Ученики не найдены</td>
                    </tr>
                  ) : filtered.map((s) => (
                    <tr
                      key={s.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setProfileBackPage('dashboard');
                        setSelectedStudent(s);
                        setPage('student-profile');
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-lt)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                    >
                      <td className="students-table-col--student">
                        <div className="student-cell">
                          <div className="student-avatar-sm">{initials(`${s.student_name || '?'} ${s.student_surname || ''}`)}</div>
                          <div className="student-info">
                            <span className="student-name">{s.student_name} {s.student_surname}</span>
                            <span className="student-meta-sm">{s.grade} класс</span>
                          </div>
                        </div>
                      </td>
                      <td className="students-table-col--subject">
                        <span className={`subject-badge subject-badge--${SUBJECT_COLOR[s.subject_name] || 'default'}`}>
                          {s.subject_name}
                        </span>
                      </td>
                      <td className="students-table-col--level">
                        <span className={`level-badge level-badge--${LEVEL_COLOR[s.level_name] || 'default'}`}>
                          {s.level_name}
                        </span>
                      </td>
                      <td className="students-table-col--lesson">
                        {s.lesson_type === 'group' ? (
                          <div className="lesson-type-cell lesson-type-cell--group" title={s.group_name || ''}>
                            <span className="lesson-type-badge lesson-type-badge--group">Группа</span>
                            <span className="lesson-type-group-name">{s.group_name || '—'}</span>
                          </div>
                        ) : (
                          <div className="lesson-type-cell lesson-type-cell--ind">
                            <span className="lesson-type-badge lesson-type-badge--individual">Инд.</span>
                          </div>
                        )}
                      </td>
                      <td className="students-table-col--status">
                        <span className={`status-badge status-badge--${s.status === '1' ? 'active' : s.status === '3' ? 'danger' : 'warning'}`}>
                          {{'1':'Активный','2':'На паузе','3':'Завершил','4':'Пробный'}[s.status] || s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Кнопка под таблицей учеников */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                className="btn-page-primary"
                style={{ minWidth: 180 }}
                onClick={() => setPage('students')}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Добавить ученика
              </button>
            </div>

            {/* Мои группы */}
            <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1.5px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <h3 className="section-title" style={{ margin: 0 }}>Мои группы</h3>
                <button
                  type="button"
                  className="section-link"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', whiteSpace: 'nowrap' }}
                  onClick={() => setPage('students')}
                >
                  Управление группами →
                </button>
              </div>
              {groups.length === 0 ? (
                <p className="table-empty" style={{ margin: 0, borderRadius: 'var(--radius-md)', border: '1.5px solid var(--border)', background: 'var(--surface)' }}>
                  Пока нет групп. Создайте группу на странице «Ученики».
                </p>
              ) : (
                <div className="dash-groups-grid">
                  {groups.map(g => (
                    <div
                      key={g.id}
                      role="button"
                      tabIndex={0}
                      className="dash-group-card dash-group-card--clickable"
                      onClick={() => { setSelectedGroup(g); setPage('group-detail'); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedGroup(g);
                          setPage('group-detail');
                        }
                      }}
                    >
                      <div className="dash-group-card-title">{g.group_name}</div>
                      <div className="dash-group-card-meta">
                        <span className={`subject-badge subject-badge--${SUBJECT_COLOR[g.subject_name] || 'default'}`}>{g.subject_name}</span>
                        <span className={`level-badge level-badge--${LEVEL_COLOR[g.level_name] || 'default'}`}>{g.level_name}</span>
                      </div>
                      <span className="dash-group-card-hint">Открыть →</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
          </>}
        </main>

        {/* ── RIGHT SIDEBAR ── */}
        <aside className="right-sidebar">
          {/* User + actions */}
          <div className="user-block">
            <div className="user-actions">
              <NotificationBell onGoToAssignment={() => setPage('homework')} />
              <a href={`${API}/settings/`} className="icon-btn" title="Настройки">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </a>
              <a href={`${API}/logout/`} className="icon-btn icon-btn--logout" title="Выйти">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </a>
            </div>
            
            <div className="user-info">
              <div className="user-details">
                <span className="user-name">{user ? `${user.name} ${user.surname}` : '…'}</span>
                <span className="user-email">{isStudent ? 'Ученик' : 'Учитель'} · {user?.email || '…'}</span>
              </div>
              <div className="user-avatar">
                {user ? (user.name?.[0] || '') + (user.surname?.[0] || '') : '??'}
              </div>
            </div>
          </div>

          {isTeacher && (
            <>
              <div className="divider" />

              {/* Непрочитанные уведомления (API) */}
              <div className="notif-section">
                <div className="notif-header">
                  <span className="notif-label">Уведомления</span>
                  <div className="notif-nav">
                    <button
                      type="button"
                      className="notif-arrow"
                      onClick={() => { goNotif('prev'); resetNotifTimer(); }}
                      disabled={unreadNotifs.length === 0}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <span className="notif-counter">
                      {unreadNotifs.length ? `${notifIdx + 1}/${unreadNotifs.length}` : '0'}
                    </span>
                    <button
                      type="button"
                      className="notif-arrow"
                      onClick={() => { goNotif('next'); resetNotifTimer(); }}
                      disabled={unreadNotifs.length === 0}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="notif-slide-wrap">
                  {unreadNotifs.length === 0 ? (
                    <div className="notif-empty">Нет непрочитанных уведомлений</div>
                  ) : (() => {
                    const n = unreadNotifs[notifIdx];
                    if (!n) return null;
                    const dot = notifDotKind(n.notification_type);
                    return (
                      <div
                        key={n.id}
                        role="button"
                        tabIndex={0}
                        className={`notif-item notif-item--${notifDir}${n.assignment_id ? ' notif-item--clickable' : ''}`}
                        onClick={() => {
                          if (!n.read) {
                            fetch(`${API}/api/notifications/${n.id}/read/`, {
                              method: 'POST',
                              credentials: 'include',
                              headers: { 'X-CSRFToken': getCookie('csrftoken') },
                            }).then(() => {
                              setSidebarNotifs(prev => prev.map(x => (x.id === n.id ? { ...x, read: true } : x)));
                            });
                          }
                          if (n.assignment_id) setPage('homework');
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        <div className={`notif-dot-type notif-dot-type--${dot}`} />
                        <div className="notif-body">
                          <span className="notif-text">{n.text}</span>
                          <span className="notif-time">{timeAgoShort(n.created_at)}</span>
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
                    <button type="button" className="cal-nav-btn" onClick={() => {
                      if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); }
                      else setCalMonth(m => m - 1);
                    }}>‹</button>
                    <button
                      type="button"
                      className="cal-today-btn"
                      onClick={() => { setCalMonth(today.getMonth()); setCalYear(today.getFullYear()); }}
                    >Сегодня</button>
                    <button type="button" className="cal-nav-btn" onClick={() => {
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
            </>
          )}
        </aside>

      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-bottom-nav">
        <div className="bottom-nav-inner">
          {navItems.map((item) => (
            <a
              key={item.label}
              href="#"
              className={`bottom-nav-item${page === item.id ? ' bottom-nav-item--active' : ''}`}
              onClick={e => { e.preventDefault(); setSelectedGroup(null); setPage(item.id); }}
            >
              {isTeacher && item.badge && <span className="bottom-nav-badge">{item.badge}</span>}
              {item.icon}
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {/* ── LESSON START MODAL ── */}
      {isTeacher && lessonModalOpen && (() => {
        const activeStudents = students.filter(s => s.lesson_type === 'individual');

        async function startLesson(type, id, name) {
          const roomId = `${type}_${id}_${Date.now()}`;

          // Открываем таб немедленно (синхронно при клике), чтобы браузер не заблокировал его как попап.
          // Без noopener — иначе window.open возвращает null и tab.location.href не работает.
          const tab = window.open('about:blank', '_blank');

          try {
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
            const { url, student_url } = await res.json();

            if (tab && !tab.closed) {
              tab.location.href = url;
            } else {
              if (window.confirm(`Браузер заблокировал вкладку. Открыть урок в этой вкладке?`)) {
                window.location.href = url;
              }
            }

            setCall({ roomId, targetName: name, type, tab, url, studentUrl: student_url });
          } catch {
            if (tab && !tab.closed) tab.close();
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
                  После выбора откроется страница урока на сайте генератора.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── INCOMING LESSON MODAL ── */}
      {isStudent && incomingLesson && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: '36px 40px',
            maxWidth: 380, width: '100%', textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          }}>
            {/* Анимированный звонок */}
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg,#4F6EF7,#5b7cf7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'ringing 1s ease-in-out infinite',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.49 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.4 2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21 16.92z"/>
              </svg>
            </div>
            <style>{`@keyframes ringing{0%,100%{transform:rotate(0)}20%{transform:rotate(-12deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(8deg)}}`}</style>

            <p style={{ margin: 0, fontSize: 13, color: '#9CA3AF', fontFamily: 'Montserrat,sans-serif' }}>
              Входящий урок
            </p>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, fontFamily: 'Montserrat,sans-serif', color: '#1a1a2e' }}>
              {incomingLesson.teacher}
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: '#6B7280', fontFamily: 'Montserrat,sans-serif' }}>
              приглашает вас на урок
            </p>

            <div style={{ display: 'flex', gap: 12, marginTop: 8, width: '100%' }}>
              <button
                onClick={() => setIncomingLesson(null)}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: '#FEE2E2', color: '#DC2626',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  fontFamily: 'Montserrat,sans-serif',
                }}
              >
                Отклонить
              </button>
              <button
                onClick={() => {
                  window.open(incomingLesson.student_url, '_blank');
                  setIncomingLesson(null);
                }}
                style={{
                  flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg,#4F6EF7,#5b7cf7)', color: '#fff',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  fontFamily: 'Montserrat,sans-serif',
                }}
              >
                Принять
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

