import { useState, useEffect, useRef, useCallback } from 'react';
import './Dashboard.css';
import StudentsPage from './StudentsPage';
import HomeworkPage from './HomeworkPage';
import StudentProfilePage from './StudentProfilePage';
import GroupDetailPage from './GroupDetailPage';
import NotificationBell from './NotificationBell';
import VariantsPage from './VariantsPage';
import API from './api';
import {
  openHomeworkOnGenerator,
  buildHomeworkReviewPlayUrl,
  cabinetSpaBasePathname,
  cabinetSpaPlayerOrigin,
} from './homeworkGeneratorNav';

const AVATAR_EMOJI_GROUPS = {
  food: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒', '🍑', '🥝', '🍍', '🥑'],
  animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐼', '🐨', '🐯', '🦁', '🐸', '🐧', '🦉'],
  plants: ['🌵', '🌿', '🍀', '🌱', '🌷', '🌸', '🌺', '🌻', '🌼', '🌴', '🍁', '🍃'],
};
const AVATAR_EMOJI_POOL = [
  ...AVATAR_EMOJI_GROUPS.food,
  ...AVATAR_EMOJI_GROUPS.animals,
  ...AVATAR_EMOJI_GROUPS.plants,
];
const AVATAR_BG_OPTIONS = [
  { id: 'violet', label: 'Фиолетовый', css: 'linear-gradient(135deg, #6D5EF8 0%, #9A8BFF 100%)' },
  { id: 'ocean', label: 'Океан', css: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)' },
  { id: 'mint', label: 'Мята', css: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)' },
  { id: 'sunset', label: 'Закат', css: 'linear-gradient(135deg, #F59E0B 0%, #FB7185 100%)' },
  { id: 'peach', label: 'Персик', css: 'linear-gradient(135deg, #FB7185 0%, #FDBA74 100%)' },
  { id: 'forest', label: 'Лес', css: 'linear-gradient(135deg, #15803D 0%, #65A30D 100%)' },
];

// const GENUROK_URL = (process.env.REACT_APP_GENERATOR_URL || 'https://test.genurok.ru').replace(/\/$/, '');

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

/** ws/notify/: при пустом REACT_APP_API_URL CRA шлёт WS на :3000 — прокси часто обрывает handshake; задайте REACT_APP_WS_URL. */
function notifyWebSocketUrl() {
  const custom = (process.env.REACT_APP_WS_URL || '').trim().replace(/\/$/, '');
  if (custom) return `${custom}/ws/notify/`;
  const api = (API || '').trim().replace(/\/$/, '');
  if (api) return `${api.replace(/^http/, 'ws')}/ws/notify/`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws/notify/`;
}




export default function Dashboard() {
  const [page, setPage] = useState('dashboard');
  const [profileBackPage, setProfileBackPage] = useState('students');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [groups, setGroups] = useState([]);
  const today = new Date();
  const [dashHomeworks, setDashHomeworks] = useState([]);
  const [dashHwStats, setDashHwStats] = useState({ total: 0, needReview: 0, overdue: 0 });
  const hwPollRef = useRef(null);
  const [studentMyAssignments, setStudentMyAssignments] = useState([]);
  const [studentReports, setStudentReports] = useState([]);
  const [studentReportsLoading, setStudentReportsLoading] = useState(false);
  const studentHwPollRef = useRef(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [reviewTab, setReviewTab] = useState('all');
  const [alertDismissed, setAlertDismissed] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [reviewShowAll, setReviewShowAll] = useState(false);
  const [createDone, setCreateDone] = useState(false);
  const [weather, setWeather] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarDraft, setAvatarDraft] = useState({ emoji: '', bg: AVATAR_BG_OPTIONS[0].id });
  const [mobileAvatarMenuOpen, setMobileAvatarMenuOpen] = useState(false);
  const mobileAvatarMenuRef = useRef(null);
  const [incomingLesson, setIncomingLesson] = useState(null);
  const incomingLessonRef = useRef(null);
  const notifyWsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const incomingRingTimerRef = useRef(null);
  /** Пока true — звонок в ЛК уже погашен (вкладка урока открылась или invite снят). */
  const lessonRingDismissedRef = useRef(false);
  /** Invite с этим JWT ученик уже принял: не поднимать звонок снова, пока сервер не сбросит pending. */
  const lessonInviteSuppressedTokenRef = useRef('');
  const lessonPollIntervalRef = useRef(null);
  const lessonFailsafeRef = useRef(null);
  const lessonRingTimeoutRef = useRef(null);

  const forceStopIncomingRing = useCallback(() => {
    if (incomingRingTimerRef.current) {
      clearInterval(incomingRingTimerRef.current);
      incomingRingTimerRef.current = null;
    }
  }, []);

  /** Снять звонок и модалку без POST (pending уже нет на сервере). */
  const dismissIncomingLessonUiOnly = useCallback(() => {
    lessonRingDismissedRef.current = true;
    if (lessonFailsafeRef.current) {
      clearTimeout(lessonFailsafeRef.current);
      lessonFailsafeRef.current = null;
    }
    if (lessonPollIntervalRef.current) {
      clearInterval(lessonPollIntervalRef.current);
      lessonPollIntervalRef.current = null;
    }
    forceStopIncomingRing();
    setIncomingLesson(null);
  }, [forceStopIncomingRing]);

  useEffect(() => {
    incomingLessonRef.current = incomingLesson;
    if (incomingLesson) {
      lessonRingDismissedRef.current = false;
      if (lessonRingTimeoutRef.current) clearTimeout(lessonRingTimeoutRef.current);
      lessonRingTimeoutRef.current = setTimeout(() => {
        const t = String(incomingLesson.token || '');
        if (t) {
          lessonInviteSuppressedTokenRef.current = t;
          // Автосброс по таймауту: сообщаем серверу
          fetch(`${API}/api/lesson/student-reject/`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRFToken': getCookie('csrftoken'),
            },
            body: JSON.stringify({ token: t }),
          }).catch(() => {});
        }
        dismissIncomingLessonUiOnly();
      }, 60000);
    } else {
      if (lessonRingTimeoutRef.current) {
        clearTimeout(lessonRingTimeoutRef.current);
        lessonRingTimeoutRef.current = null;
      }
    }
    return () => {
      if (lessonRingTimeoutRef.current) {
        clearTimeout(lessonRingTimeoutRef.current);
        lessonRingTimeoutRef.current = null;
      }
    };
  }, [incomingLesson, dismissIncomingLessonUiOnly]);

  useEffect(() => {
    return () => {
      if (lessonPollIntervalRef.current) {
        clearInterval(lessonPollIntervalRef.current);
        lessonPollIntervalRef.current = null;
      }
      if (lessonFailsafeRef.current) {
        clearTimeout(lessonFailsafeRef.current);
        lessonFailsafeRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mobileAvatarMenuOpen) return undefined;
    const onDocPointerDown = (e) => {
      if (mobileAvatarMenuRef.current && !mobileAvatarMenuRef.current.contains(e.target)) {
        setMobileAvatarMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('touchstart', onDocPointerDown, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('touchstart', onDocPointerDown);
    };
  }, [mobileAvatarMenuOpen]);

  // Notifications polling (used by NotificationBell badge count)
  // eslint-disable-next-line no-unused-vars
  useEffect(() => {
    if (!authChecked || !user || user.role === 'student') return;
    const load = () => {
      fetch(`${API}/api/notifications/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []);
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
    fetch(`${API}/api/students/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => { setStudents(Array.isArray(data) ? data : []); })
      .catch(() => setStudents([]));
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

  const fetchStudentMyHomework = useCallback(async () => {
    if (!authChecked || !user || user.role !== 'student') return;
    try {
      const r = await fetch(`${API}/api/homework/my/`, { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      setStudentMyAssignments(Array.isArray(data) ? data : []);
    } catch {
      setStudentMyAssignments([]);
    }
  }, [authChecked, user]);

  const fetchStudentReports = useCallback(async () => {
    if (!authChecked || !user || user.role === 'student') return;
    setStudentReportsLoading(true);
    try {
      const r = await fetch(`${API}/api/student-reports/`, { credentials: 'include' });
      if (!r.ok) {
        setStudentReports([]);
        return;
      }
      const data = await r.json();
      setStudentReports(Array.isArray(data) ? data : []);
    } catch {
      setStudentReports([]);
    } finally {
      setStudentReportsLoading(false);
    }
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || user.role !== 'student') return undefined;
    fetchStudentMyHomework();
    studentHwPollRef.current = setInterval(fetchStudentMyHomework, 30_000);
    return () => {
      if (studentHwPollRef.current) clearInterval(studentHwPollRef.current);
    };
  }, [fetchStudentMyHomework]);

  useEffect(() => {
    if (page === 'dashboard' && user?.role === 'student') fetchStudentMyHomework();
  }, [page, fetchStudentMyHomework, user]);

  useEffect(() => {
    if (page === 'student-reports' && user?.role !== 'student') fetchStudentReports();
  }, [page, fetchStudentReports, user]);

  /** Сразу на генератор (join-url), без промежуточной страницы ЛК ?homework_room=. */
  const goToStudentAssignment = useCallback((assignmentId) => {
    if (!assignmentId) return;
    void openHomeworkOnGenerator(assignmentId).catch(() => {
      const u = new URL(cabinetSpaBasePathname(), cabinetSpaPlayerOrigin());
      u.searchParams.set('variant_play', String(assignmentId));
      u.searchParams.set('hw_local', '1');
      u.searchParams.delete('homework_room');
      window.location.assign(u.toString());
    });
  }, []);

  // Погода по геолокации (Open-Meteo, бесплатно, без ключа)
  useEffect(() => {
    if (!authChecked || !user || user.role === 'student') return;
    if (!navigator.geolocation) return;
    // Не вызывать getCurrentPosition, если политика документа запрещает geolocation (иначе [Violation] в консоли).
    try {
      const pp = document.permissionsPolicy;
      if (pp && typeof pp.allowsFeature === 'function' && !pp.allowsFeature('geolocation')) return;
    } catch {
      /* empty */
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude } }) => {
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weathercode&timezone=auto`)
          .then(r => r.json())
          .then(d => setWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weathercode }))
          .catch(() => {});
      },
      () => {},
      { timeout: 10000, maximumAge: 600_000 },
    );
  }, [authChecked, user]);

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
    const ws = new WebSocket(notifyWebSocketUrl());
    notifyWsRef.current = ws;
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'lesson_call_cancelled' || msg.event === 'student_joined_lesson') {
          const t = String(msg?.token || '');
          const cur = incomingLessonRef.current;
          const curTok = String(cur?.token || '');
          if (!t || !curTok || t === curTok) {
            if (t || curTok) {
              lessonInviteSuppressedTokenRef.current = t || curTok;
            }
            dismissIncomingLessonUiOnly();
          }
          return;
        }
        if (msg.event === 'incoming_lesson') {
          const t = String(msg?.token || '');
          if (t && t === lessonInviteSuppressedTokenRef.current) return;
          setIncomingLesson(msg);
          return;
        }
        if (msg.event === 'homework_assigned') {
          fetchStudentMyHomework();
        }
      } catch {}
    };
    ws.onerror = () => {};
    return () => {
      ws.close();
      if (notifyWsRef.current === ws) notifyWsRef.current = null;
    };
  }, [user, dismissIncomingLessonUiOnly, fetchStudentMyHomework]);

  // Fallback: подтягиваем pending из API; пока модалка открыта — следим, чтобы гасить ЛК, когда invite уже снят (ученик на уроке).
  useEffect(() => {
    if (!user || user.role !== 'student') return undefined;
    let stopped = false;
    const poll = () => {
      fetch(`${API}/api/lesson/pending/`, { credentials: 'include' })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (stopped) return;
          const invite = data?.invite;
          if (!invite) {
            // Больше не очищаем suppressed token, чтобы избежать гонки (race condition),
            // когда старый poll возвращает старый инвайт сразу после его отмены.
            // Новый урок всё равно будет иметь новый токен.
          }
          if (incomingLesson) {
            if (!invite) {
              dismissIncomingLessonUiOnly();
            }
            return;
          }
          if (invite?.event === 'incoming_lesson') {
            const t = String(invite?.token || '');
            if (t && t === lessonInviteSuppressedTokenRef.current) return;
            setIncomingLesson(invite);
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, incomingLesson ? 2000 : 4000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [user, incomingLesson, dismissIncomingLessonUiOnly]);

  // Создаём AudioContext после первого пользовательского жеста
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

  // Звук входящего урока
  useEffect(() => {
    const stopRing = () => {
      forceStopIncomingRing();
    };
    const playRing = () => {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
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
      return stopRing;
    }
    playRing();
    incomingRingTimerRef.current = setInterval(playRing, 3000);
    return stopRing;
  }, [incomingLesson, forceStopIncomingRing]);

  const postStudentJoined = useCallback((token) => {
    return fetch(`${API}/api/lesson/student-joined/`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken'),
      },
      body: JSON.stringify(token ? { token } : {}),
    }).then(r => (r.ok ? r.json().catch(() => ({})) : Promise.reject(new Error('student-joined'))));
  }, []);

  const rejectIncomingLesson = useCallback(() => {
    const t = incomingLesson?.token;
    if (t) {
      lessonInviteSuppressedTokenRef.current = String(t);
      // Сообщаем серверу, что ученик отклонил/пропустил звонок, чтобы после обновления страницы он не зазвонил снова
      fetch(`${API}/api/lesson/student-reject/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({ token: t }),
      }).catch(() => {});
    }
    dismissIncomingLessonUiOnly();
  }, [incomingLesson, dismissIncomingLessonUiOnly]);

  const acceptIncomingLesson = useCallback(() => {
    const currentInvite = incomingLesson;
    const url = currentInvite?.student_url || currentInvite?.url;
    if (!url) {
      return;
    }

    let lessonToken = currentInvite?.token || '';
    if (!lessonToken) {
      try {
        const u = new URL(url, window.location.origin);
        lessonToken = u.searchParams.get('token') || '';
      } catch {}
    }

    // Синхронно в обработчике клика — иначе браузер блокирует всплывающее окно.
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      // Если браузер всё равно заблокировал попап, переходим в этой же вкладке
      window.location.href = url;
    }

    if (lessonToken) {
      lessonInviteSuppressedTokenRef.current = lessonToken;
    }

    // Сразу гасим звонок и снимаем invite: ждать load у чужого домена ненадёжно.
    dismissIncomingLessonUiOnly();
    void postStudentJoined(lessonToken).catch(() => {
      /* сеть: suppress остаётся, иначе poll снова поднимет тот же invite и звонок зациклится */
    });
  }, [incomingLesson, postStudentJoined, dismissIncomingLessonUiOnly]);


  const isStudent = user?.role === 'student';
  const isTeacher = !isStudent;

  const studentHwActionCount = isStudent
    ? studentMyAssignments.filter(
        a => a.status !== 'cancelled' && ['sent', 'revision', 'overdue'].includes(a.status),
      ).length
    : 0;

  const studentHwWord = (n) => {
    if (n % 10 === 1 && n % 100 !== 11) return 'задание';
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'задания';
    return 'заданий';
  };

  const ST_HW_STATUS_LABEL = {
    sent: 'К выполнению',
    submitted: 'На проверке',
    reviewing: 'На проверке',
    reviewed: 'Проверено',
    revision: 'Доработка',
    overdue: 'Просрочено',
    cancelled: 'Отменено',
  };

  const studentDashHwSorted = isStudent
    ? [...studentMyAssignments]
        .filter(a => a.status !== 'cancelled')
        .sort((a, b) => {
          const pr = { revision: 0, overdue: 1, sent: 2, submitted: 3, reviewing: 3, reviewed: 4 };
          const pa = pr[a.status] ?? 9;
          const pb = pr[b.status] ?? 9;
          if (pa !== pb) return pa - pb;
          const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
          const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
          return da - db;
        })
    : [];

  const studentHwRowKind = (a) => {
    if (a.status === 'reviewed') return 'green';
    if (['submitted', 'reviewing'].includes(a.status)) return 'amber';
    return 'red';
  };

  const fmtStudentHwDeadline = (dl) => {
    if (!dl) return '';
    try {
      return new Date(dl).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const studentHwCtaLabel = (a) => {
    if (a.status === 'revision') return 'Доработать';
    if (['submitted', 'reviewing'].includes(a.status)) return 'Открыть';
    if (a.status === 'reviewed') return 'Результат';
    return 'Выполнить';
  };

  const filteredStudents = students.filter(s => {
    if (!search) return false;
    const fullName = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
    return fullName.toLowerCase().includes(search.toLowerCase());
  });

  const activeStudents = students.filter(s => s.status === '1');

  const isOverdueAssignment = (a) =>
    a.status === 'overdue' ||
    (a.hw_deadline && new Date(a.hw_deadline) < new Date() &&
      !['reviewed', 'submitted', 'reviewing', 'cancelled'].includes(a.status));

  const overdueHws  = dashHomeworks.filter(a => isOverdueAssignment(a));
  const waitingHws  = dashHomeworks.filter(a => ['submitted', 'reviewing'].includes(a.status));
  const reviewTabItems = reviewTab === 'overdue' ? overdueHws : reviewTab === 'waiting' ? waitingHws : dashHomeworks;

  // Helpers для главной страницы
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6)  return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 17) return 'Добрый день';
    return 'Добрый вечер';
  })();
  const weatherEmoji = (code) => {
    if (code == null) return '🌤';
    if (code === 0)    return '☀️';
    if (code <= 3)     return '⛅';
    if (code <= 48)    return '🌫️';
    if (code <= 67)    return '🌧️';
    if (code <= 77)    return '❄️';
    if (code <= 82)    return '🌦️';
    return '⛈️';
  };
  const weatherLabel = (code) => {
    if (code == null) return '–';
    if (code === 0)   return 'Ясно';
    if (code <= 3)    return 'Облачно';
    if (code <= 48)   return 'Туман';
    if (code <= 57)   return 'Изморось';
    if (code <= 67)   return 'Дождь';
    if (code <= 77)   return 'Снег';
    if (code <= 82)   return 'Ливень';
    return 'Гроза';
  };
  const declWork = (n) => {
    if (n % 10 === 1 && n % 100 !== 11) return 'работа';
    if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'работы';
    return 'работ';
  };
  // Сортировка событий ДЗ: красные → янтарные → зелёные
  const hwEvents = (() => {
    const now = new Date();
    return dashHomeworks.map(a => {
      const deadline = a.hw_deadline ? new Date(a.hw_deadline) : null;
      const deadlinePassed = deadline && deadline < now;
      const submitted = ['submitted', 'reviewing'].includes(a.status);
      const kind = submitted ? (deadlinePassed ? 'amber' : 'green') : 'red';
      return { ...a, kind, deadlinePassed };
    }).sort((a, b) => ({ red: 0, amber: 1, green: 2 }[a.kind] - { red: 0, amber: 1, green: 2 }[b.kind]));
  })();

  const PAGE_TITLES = {
    dashboard: 'Дашборд', students: 'Мои ученики', homework: 'Задания',
    schedule: 'Расписание', analytics: 'Аналитика', // generator: 'AI-Генератор',
    variants: 'Варианты',
    'student-reports': 'Результаты учеников',
    'student-profile': 'Профиль ученика', 'group-detail': 'Группа',
  };

  const todayStr = (() => {
    const d = today;
    const days = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `${(days[d.getDay()][0].toUpperCase() + days[d.getDay()].slice(1))}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  })();

  const scheduleGroups = groups.slice(0, 3).map((g, i) => {
    const hrs = [9, 14, 17]; const mins = [0, 0, 30];
    const slot = new Date(today); slot.setHours(hrs[i], mins[i], 0, 0);
    const diffMs = slot - today; const diffMin = Math.round(diffMs / 60000);
    let status, statusLabel;
    if (diffMs < -3600000)      { status = 'past';    statusLabel = 'Завершён'; }
    else if (diffMs < 0)        { status = 'current'; statusLabel = 'Сейчас'; }
    else if (diffMin < 60)      { status = 'soon';    statusLabel = `Через ${diffMin} мин`; }
    else                        { status = 'future';  statusLabel = `Через ${Math.round(diffMin / 60)}ч`; }
    const cnt = students.filter(s => s.group_name === g.group_name).length;
    return { ...g, time: `${String(hrs[i]).padStart(2,'0')}:${String(mins[i]).padStart(2,'0')}`, status, statusLabel, studentCount: cnt };
  });

  const nextLesson = scheduleGroups.find(g => g.status === 'soon' || g.status === 'future');

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2fb', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', border: '3px solid #E5E7EB', borderTopColor: '#4F6EF7', animation: 'spin 0.8s linear infinite' }} />
        <p style={{ color: '#9CA3AF', fontFamily: 'Montserrat, sans-serif', fontSize: 14, margin: 0 }}>Проверка авторизации…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const avatarFallback = user ? (user.name?.[0] || '') + (user.surname?.[0] || '') : '??';
  const avatarToken = user?.avatar_emoji || avatarFallback;
  const avatarBgId = user?.avatar_bg || AVATAR_BG_OPTIONS[0].id;
  const avatarBgCss = AVATAR_BG_OPTIONS.find(x => x.id === avatarBgId)?.css || AVATAR_BG_OPTIONS[0].css;

  const updateAvatarProfile = async ({ emoji, bg }) => {
    if (!user) return;
    setAvatarBusy(true);
    try {
      const resp = await fetch(`${API}/api/me/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({
          avatar_emoji: emoji || '',
          avatar_bg: bg || AVATAR_BG_OPTIONS[0].id,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert(data.error || 'Не удалось обновить аватар');
        return;
      }
      setUser((prev) => ({ ...(prev || {}), ...data }));
      setAvatarEditorOpen(false);
    } catch {
      alert('Нет связи с сервером');
    } finally {
      setAvatarBusy(false);
    }
  };

  const openAvatarEditor = () => {
    setAvatarDraft({
      emoji: user?.avatar_emoji || AVATAR_EMOJI_POOL[Math.floor(Math.random() * AVATAR_EMOJI_POOL.length)],
      bg: user?.avatar_bg || AVATAR_BG_OPTIONS[0].id,
    });
    setAvatarEditorOpen(true);
  };

  return (
    <div className="app-shell">

        {/* ── MOBILE TOPBAR ── */}
        <header className="mobile-topbar">
          <div className="mobile-logo">
          <div className="brand-icon-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
          <span className="mobile-logo-text">ГенУрок</span>
          </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <NotificationBell />
          <div className="mobile-avatar-menu" ref={mobileAvatarMenuRef}>
            <button
              type="button"
              className="mobile-avatar"
              style={{ background: avatarBgCss }}
              onClick={() => setMobileAvatarMenuOpen((v) => !v)}
              aria-label="Профиль"
              aria-expanded={mobileAvatarMenuOpen}
            >
              {avatarToken}
            </button>
            {mobileAvatarMenuOpen && (
              <div className="mobile-avatar-dropdown">
                <a href={`${API}/logout/`} className="mobile-avatar-dropdown-item" onClick={() => setMobileAvatarMenuOpen(false)}>
                  Выйти из профиля
                </a>
              </div>
            )}
          </div>
          </div>
        </header>

        {/* ── LEFT SIDEBAR ── */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
          <div>
            <div className="brand-name">ГенУрок</div>
            <div className="brand-sub">Личный кабинет</div>
          </div>
          </div>

          <nav className="sidebar-nav">
          {isTeacher ? (<>
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
            <a href="#"
              className={`nav-item nav-item--main${page === 'dashboard' ? ' nav-item--active' : ''}`}
              onClick={e => { e.preventDefault(); setSelectedGroup(null); setPage('dashboard'); }}
            >
              <span className="nav-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                </svg>
              </span>
              <span className="nav-item-label">Главная</span>
            </a>

            <div className="nav-divider" />

            <div className="nav-section-label">Учебный процесс</div>
            {[
              { id: 'students', label: 'Мои ученики', badge: activeStudents.length || null, icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>) },
              { id: 'student-reports', label: 'Результаты учеников', badge: studentReports.length || null, icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>) },
              // { id: 'homework', label: 'Задания', badge: dashHwStats.needReview || null, icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>) },
            ].map(({ id, label, badge, icon }) => (
              // eslint-disable-next-line jsx-a11y/anchor-is-valid
              <a key={id} href="#"
                className={`nav-item${page === id ? ' nav-item--active' : ''}`}
                onClick={e => { e.preventDefault(); setSelectedGroup(null); setPage(id); }}
              >
                <span className="nav-item-icon">{icon}</span>
                <span className="nav-item-label">{label}</span>
                {badge != null && <span className="nav-badge">{badge}</span>}
              </a>
            ))}

            <div className="nav-section-label" style={{ marginTop: 8 }}>Инструменты</div>
            {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
            <a href="#"
              className={`nav-item${page === 'variants' ? ' nav-item--active' : ''}`}
              onClick={e => { e.preventDefault(); setPage('variants'); }}
            >
              <span className="nav-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="4" rx="1"/><rect x="2" y="10" width="20" height="4" rx="1"/><rect x="2" y="17" width="20" height="4" rx="1"/>
                    </svg>
              </span>
              <span className="nav-item-label">Варианты</span>
            </a>

            <div className="nav-item nav-item--disabled" aria-disabled="true">
              <span className="nav-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className="nav-item-label">Расписание</span>
              <span className="nav-badge-soon">Скоро</span>
            </div>

            <div className="nav-item nav-item--disabled" aria-disabled="true">
              <span className="nav-item-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
                </svg>
              </span>
              <span className="nav-item-label">Мои материалы</span>
              <span className="nav-badge-soon">Скоро</span>
            </div>
            {/* AI-Генератор — скрыт */}
            {/* {[
              { id: 'generator', label: 'AI-Генератор', isNew: true, icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>) },
            ].map(({ id, label, isNew, icon }) => (
              // eslint-disable-next-line jsx-a11y/anchor-is-valid
              <a key={id} href="#"
                className={`nav-item${page === id ? ' nav-item--active' : ''}`}
                onClick={e => { e.preventDefault(); if (id === 'generator') window.open(GENUROK_URL, '_blank', 'noopener,noreferrer'); else setPage(id); }}
              >
                <span className="nav-item-icon">{icon}</span>
                <span className="nav-item-label">{label}</span>
                {isNew && <span className="nav-badge-new">NEW</span>}
              </a>
            ))} */}
          </>) : (
            <>
              <div className="nav-section-label">Обучение</div>
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a href="#"
                className={`nav-item nav-item--main${page === 'dashboard' ? ' nav-item--active' : ''}`}
                onClick={e => { e.preventDefault(); setSelectedGroup(null); setPage('dashboard'); }}
              >
                <span className="nav-item-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                  </svg>
                </span>
                <span className="nav-item-label">Дашборд</span>
              </a>
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a href="#" className={`nav-item${page === 'homework' ? ' nav-item--active' : ''}`} onClick={e => { e.preventDefault(); setPage('homework'); }}>
                <span className="nav-item-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
                <span className="nav-item-label">Мои задания</span>
                {studentHwActionCount > 0 ? <span className="nav-badge">{studentHwActionCount}</span> : null}
              </a>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <a href={`${API}/logout/`} className="sidebar-footer-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Выйти из профиля
          </a>
          <div className="sidebar-user-row">
            <div className="sidebar-user-avatar" style={{ background: avatarBgCss }}>
              {avatarToken}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user ? `${user.name} ${user.surname}` : '…'}</div>
              <div className="sidebar-user-role">{isStudent ? 'Ученик' : (user?.subjects?.join(', ') || 'Учитель')}</div>
                </div>
              </div>
            </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="app-main">

        {/* TOP HEADER */}
        <header className="app-topbar">
          <div className="topbar-left">
            <h1 className="topbar-title">{PAGE_TITLES[page] || 'Дашборд'}</h1>
            {page === 'dashboard' && <span className="topbar-date">{todayStr}</span>}
                </div>
          <div className="topbar-right">
            <div className="search-wrap">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input className="topbar-search" type="text" placeholder="Поиск учеников, заданий..." value={search} onChange={e => setSearch(e.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 180)} />
              {search && <button className="search-clear-btn" onClick={() => setSearch('')}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
              {searchFocused && search && filteredStudents.length > 0 && (
                <div className="search-dropdown">
                  {filteredStudents.slice(0, 6).map(s => {
                    const name = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
                    const ini = ((s.student_name?.[0] || '') + (s.student_surname?.[0] || '')).toUpperCase();
                return (
                      <div key={s.id} className="search-dropdown-item" onMouseDown={() => { setSearch(''); setProfileBackPage('dashboard'); setSelectedStudent(s); setPage('student-profile'); }}>
                        <div className="search-dropdown-avatar">{ini}</div>
                        <div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>{name}</div><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.subject_name} · {s.grade} класс</div></div>
                  </div>
                );
              })}
            </div>
              )}
            </div>
            <NotificationBell />
            {/* isTeacher && <button className="topbar-add-btn" onClick={() => setPage('homework')} title="Создать задание">+</button> */}
          </div>
        </header>

        {/* PAGE BODY */}
        <div className="app-body">

          {page === 'student-profile' && selectedStudent && isTeacher && (
            <StudentProfilePage student={selectedStudent} groups={groups}
              backLabel={profileBackPage === 'dashboard' ? 'Назад к дашборду' : profileBackPage === 'group-detail' ? 'Назад к группе' : 'Назад к ученикам'}
              onBack={() => { setPage(profileBackPage); setSelectedStudent(null); }}
              onStudentUpdated={(updated) => { setSelectedStudent(prev => prev ? { ...prev, ...updated } : prev); setStudents(prev => prev.map(st => st.id === updated.id ? { ...st, ...updated } : st)); }}
            />
          )}
          {page === 'group-detail' && selectedGroup && isTeacher && (
            <GroupDetailPage group={selectedGroup} onBack={() => { setPage('dashboard'); setSelectedGroup(null); }}
              onOpenProfile={s => { setProfileBackPage('group-detail'); setSelectedStudent(s); setPage('student-profile'); }}
            />
          )}
          {page === 'students' && isTeacher && (
            <StudentsPage onOpenProfile={s => { setProfileBackPage('students'); setSelectedStudent(s); setPage('student-profile'); }} />
          )}
          {page === 'homework' && (
            <HomeworkPage isStudent={isStudent} />
          )}
          {page === 'variants' && isTeacher && <VariantsPage />}
          {page === 'student-reports' && isTeacher && (
            <div className="section-block">
              <div className="section-header">
                <div className="section-title-wrap">
                  <h3 className="section-title">Отчёты по ученикам</h3>
                </div>
                <button type="button" className="btn-page-secondary" onClick={fetchStudentReports}>
                  Обновить
                </button>
              </div>
              <div className="table-wrap">
                <table className="students-table">
                  <thead>
                    <tr>
                      <th>Ученик</th>
                      <th>Вариант</th>
                      <th>Оценка</th>
                      <th>Статус</th>
                      <th>Дата</th>
                      <th>PDF отчёт</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentReportsLoading ? (
                      <tr>
                        <td colSpan={6} className="table-empty">Загрузка отчётов…</td>
                      </tr>
                    ) : studentReports.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="table-empty">Пока нет отчётов. Они создаются после проверки работы.</td>
                      </tr>
                    ) : studentReports.map((row) => {
                      const statusLabel = row.status === 'reviewed'
                        ? 'Проверено'
                        : row.status === 'revision'
                          ? 'На доработке'
                          : row.status || '—';
                      const when = row.generated_at
                        ? new Date(row.generated_at).toLocaleString('ru-RU', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                        })
                        : '—';
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="student-cell">
                              <div className="student-avatar-sm">{((row.student_name?.[0] || '') + (row.student_surname?.[0] || '')).toUpperCase()}</div>
                              <div className="student-info">
                                <span className="student-name">{row.student_name} {row.student_surname}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="cell-plain">{row.title || `Вариант ${row.variant_id}`}</span>
                          </td>
                          <td>
                            <span className="cell-plain">{row.score != null ? `${row.score} б` : '—'}</span>
                          </td>
                          <td>
                            <span className={`status-badge status-badge--${row.status === 'reviewed' ? 'active' : row.status === 'revision' ? 'warning' : 'danger'}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td>
                            <span className="cell-plain">{when}</span>
                          </td>
                          <td>
                            {row.report_file_url ? (
                              <a href={row.report_file_url} className="row-btn" target="_blank" rel="noopener noreferrer">
                                Открыть PDF
                              </a>
                            ) : (
                              <span className="cell-plain" style={{ color: 'var(--text-3)' }}>Файл недоступен</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── DASHBOARD TEACHER ── */}
          {page === 'dashboard' && isTeacher && (
            <div className="dash-new">

              {/* ── БЛОК 1: HERO ── */}
              <div className="hero-card">
                <div className="hero-avatar-wrap">
                  <div className="hero-avatar-lg" style={{ background: avatarBgCss, color: '#fff' }}>
                    {avatarToken}
                  </div>
                  <button type="button" className="hero-avatar-edit-btn" title="Изменить аватар" onClick={openAvatarEditor}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                  </button>
                        </div>
                <div className="hero-content">
                  <div className="hero-greeting">{greeting}, {user?.name}!</div>
                  <div className="hero-meta">
                    {user?.subjects?.join(', ') || 'Учитель'}
                    {activeStudents.length > 0 && <> · <strong>{activeStudents.length}</strong> учеников</>}
                    {groups.length > 0 && <> · <strong>{groups.length}</strong> групп</>}
                          </div>
                  <div className="hero-badges">
                    {dashHwStats.needReview > 0 ? (
                      <span className="hero-badge hero-badge--warn">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {dashHwStats.needReview} {declWork(dashHwStats.needReview)} ждут проверки
                      </span>
                    ) : (
                      <span className="hero-badge hero-badge--ok">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        Все работы проверены
                      </span>
                    )}
                    {dashHwStats.overdue > 0 && (
                      <span className="hero-badge hero-badge--danger">
                        {dashHwStats.overdue} просрочено
                        </span>
                    )}
            </div>
                </div>
                <a href={`${API}/logout/`} className="hero-edit-btn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Выйти из профиля
                </a>
            </div>

              {/* ── БЛОК 2: ВИДЖЕТЫ ── */}
              <div className="widgets-row">
                {/* Погода */}
                <div className="widget-card">
                  <div className="widget-icon-wrap widget-icon-wrap--blue">
                    <span style={{ fontSize: 26, lineHeight: 1 }}>{weatherEmoji(weather?.code)}</span>
              </div>
                  <div className="widget-body">
                    <div className="widget-title">Погода сейчас</div>
                    {weather ? (
                      <>
                        <div className="widget-value">{weather.temp}°C</div>
                        <div className="widget-sub">{weatherLabel(weather.code)}</div>
                      </>
                    ) : (
                      <div className="widget-value widget-value--muted">Определяется…</div>
                    )}
                      </div>
                    </div>

                {/* Ближайший урок */}
                <div className="widget-card">
                  <div className="widget-icon-wrap widget-icon-wrap--purple">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                  <div className="widget-body">
                    <div className="widget-title">Ближайший урок</div>
                    {nextLesson ? (
                      <>
                        <div className="widget-value">{nextLesson.group_name}</div>
                        <div className="widget-sub">{nextLesson.time} · <span className={`widget-status widget-status--${nextLesson.status}`}>{nextLesson.statusLabel}</span></div>
                      </>
                    ) : (
                      <>
                        <div className="widget-value widget-value--muted">–</div>
                        <div className="widget-sub">Уроков не запланировано</div>
                      </>
              )}
            </div>
          </div>

                {/* Сдача заданий */}
                <div className="widget-card">
                  <div className={`widget-icon-wrap ${dashHwStats.needReview > 0 ? 'widget-icon-wrap--amber' : 'widget-icon-wrap--green'}`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </div>
                  <div className="widget-body">
                    <div className="widget-title">Сдача заданий</div>
                    <div className="widget-value">
                      <span className={dashHwStats.needReview > 0 ? 'widget-num--warn' : 'widget-num--ok'}>{dashHwStats.needReview}</span>
                      <span className="widget-denom"> / {dashHwStats.total}</span>
              </div>
                    <div className="widget-sub">{dashHwStats.needReview > 0 ? 'ждут проверки' : 'всё проверено'}</div>
              </div>
            </div>
          </div>

              {/* ── БЛОК 3: ОПОВЕЩЕНИЯ О ДЗ ── */}
              <div className="section-card">
                <div className="section-card-header">
                  <div>
                    <h2 className="section-card-title">Уведомления</h2>
                    {/* <div className="section-card-sub">Сортировка: не сдано → с опозданием → вовремя</div> */}
                  </div>
                  <div className="hw-legend">
                    <span className="hw-leg hw-leg--green">сдано вовремя</span>
                    <span className="hw-leg hw-leg--amber">с опозданием</span>
                    <span className="hw-leg hw-leg--red">не сдано</span>
                </div>
                        </div>

                {hwEvents.length === 0 ? (
                  <div className="review-empty-state">
                    <div className="review-empty-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    <div className="review-empty-title">Нет активных событий</div>
                    <div className="review-empty-sub">Новые оповещения появятся здесь автоматически</div>
                </div>
                ) : (
                  <div className="hw-events-list">
                    {(reviewShowAll ? hwEvents : hwEvents.slice(0, 6)).map((a, idx) => {
                      const name = `${a.student_name || ''} ${a.student_surname || ''}`.trim();
                      const ini  = ((a.student_name?.[0] || '') + (a.student_surname?.[0] || '')).toUpperCase();
                      const deadline = a.hw_deadline ? new Date(a.hw_deadline) : null;
                      const daysLeft = deadline ? Math.ceil((deadline - new Date()) / 86400000) : null;
                      const submitted = ['submitted', 'reviewing'].includes(a.status);
                      const kindLabel = a.kind === 'green' ? 'Сдано вовремя' : a.kind === 'amber' ? 'Сдано с опозданием' : 'Не сдано';
                      return (
                        <div key={a.id} className={`hw-event-row hw-event-row--${a.kind}`} style={{ animationDelay: `${idx * 40}ms` }}>
                          <div className={`hw-event-stripe hw-event-stripe--${a.kind}`} />
                          <div className="hw-event-avatar">{ini}</div>
                          <div className="hw-event-info">
                            <div className="hw-event-name">{name || '—'}</div>
                            <div className="hw-event-subject">
                              {a.hw_subject || 'Задание'}{a.hw_title ? ` · ${a.hw_title}` : ''}
              </div>
                          </div>
                          <div className="hw-event-meta">
                            <span className={`hw-event-badge hw-event-badge--${a.kind}`}>{kindLabel}</span>
                            {daysLeft !== null && (
                              <span className="hw-event-deadline">
                                {daysLeft < 0 ? `${Math.abs(daysLeft)} дн. назад` : daysLeft === 0 ? 'Сегодня' : `через ${daysLeft} дн.`}
                    </span>
                            )}
                  </div>
                          {submitted && (
                            <button
                              type="button"
                              className="hw-event-check-btn"
                              onClick={() => {
                                const url = buildHomeworkReviewPlayUrl(a.id);
                                if (url) window.location.assign(url);
                              }}
                            >
                              Проверить →
                            </button>
                          )}
                  </div>
                      );
                    })}
                </div>
                )}

                {hwEvents.length > 6 && (
                  <div className="review-footer">
                    <button className="review-more-btn" onClick={() => setReviewShowAll(v => !v)}>
                      {reviewShowAll ? 'Свернуть' : `Показать ещё ${hwEvents.length - 6}`}
                    </button>
                        </div>
                  )}
              </div>

                </div>
          )}

          {/* STUDENT DASHBOARD */}
          {page === 'dashboard' && isStudent && (
            <div className="dash-new">
              <div className="hero-card">
                <div className="hero-avatar-wrap">
                  <div className="hero-avatar-lg" style={{ background: avatarBgCss, color: '#fff' }}>
                    {avatarToken}
                  </div>
                  <button type="button" className="hero-avatar-edit-btn" title="Изменить аватар" onClick={openAvatarEditor}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                  </button>
                </div>
                <div className="hero-content">
                  <div className="hero-greeting">{greeting}, {user?.name}!</div>
                  <div className="hero-meta">
                    {user?.subject_name || user?.subjects?.join(', ') || 'Ученик'}
                    {user?.grade && <> · <strong>{user.grade}</strong> класс</>}
                  </div>
                  <div className="hero-badges">
                    {studentHwActionCount > 0 ? (
                      <span className="hero-badge hero-badge--warn">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {studentHwActionCount} {studentHwWord(studentHwActionCount)} к выполнению
                      </span>
                    ) : (
                      <span className="hero-badge hero-badge--ok">
                        Личный кабинет активен
                      </span>
                    )}
                  </div>
                </div>
                <button className="hero-edit-btn" onClick={() => setPage('homework')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  Перейти к заданиям
                </button>
              </div>

              <div className="section-card" style={{ marginTop: 20 }}>
                <div className="section-card-header">
                  <div>
                    <h2 className="section-card-title">Домашние задания</h2>
                    <div className="section-card-sub" style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3, #64748b)', lineHeight: 1.45 }}>
                      Учитель задаёт вариант как ДЗ — вы решаете его здесь же: ответы сохраняются, «Проверить» доступна один раз, можно прикрепить файлы и отправить работу на проверку.
                    </div>
                  </div>
                  <button type="button" className="review-more-btn" onClick={() => setPage('homework')}>
                    Все задания
                  </button>
                </div>

                {studentDashHwSorted.length === 0 ? (
                  <div className="review-empty-state">
                    <div className="review-empty-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </div>
                    <div className="review-empty-title">Пока нет заданий</div>
                    <div className="review-empty-sub">Когда учитель задаст вариант как ДЗ, уведомление появится в колокольчике, а задание — в этом списке</div>
                  </div>
                ) : (
                  <div className="hw-events-list">
                    {studentDashHwSorted.slice(0, 8).map((a, idx) => {
                      const kind = studentHwRowKind(a);
                      const dl = fmtStudentHwDeadline(a.deadline);
                      return (
                        <div key={a.id} className={`hw-event-row hw-event-row--${kind}`} style={{ animationDelay: `${idx * 40}ms` }}>
                          <div className={`hw-event-stripe hw-event-stripe--${kind}`} />
                          <div className="hw-event-info" style={{ flex: 1, minWidth: 0 }}>
                            <div className="hw-event-name">{a.homework_title || `Вариант ${a.variant_id ?? ''}`}</div>
                            <div className="hw-event-subject">
                              {[a.subject, a.teacher_name].filter(Boolean).join(' · ')}
                              {dl ? ` · сдать до ${dl}` : ''}
                            </div>
                          </div>
                          <div className="hw-event-meta" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                            <span className={`hw-event-badge hw-event-badge--${kind}`}>{ST_HW_STATUS_LABEL[a.status] || a.status}</span>
                          </div>
                          <button type="button" className="hw-event-check-btn" onClick={() => goToStudentAssignment(a.id)}>
                            {studentHwCtaLabel(a)} →
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>{/* /app-body */}
      </div>{/* /app-main */}

      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-bottom-nav">
        <div className="bottom-nav-inner">
          {(isStudent ? [
            { id: 'dashboard', label: 'Дашборд', badge: null, icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>) },
            { id: 'homework', label: 'Задания', badge: studentHwActionCount > 0 ? studentHwActionCount : null, icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>) },
          ] : [
            { id: 'dashboard', label: 'Главная',  icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>) },
            { id: 'students', label: 'Мои ученики',   icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>) },
            { id: 'student-reports', label: 'Результаты', badge: studentReports.length || null, icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>) },
            // { id: 'homework', label: 'Задания', icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>) },
            { id: 'variants', label: 'Варианты',  icon: (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="4" rx="1"/><rect x="2" y="10" width="20" height="4" rx="1"/><rect x="2" y="17" width="20" height="4" rx="1"/></svg>) },
          ]).map(item => (
            // eslint-disable-next-line jsx-a11y/anchor-is-valid
            <a key={item.id} href="#" className={`bottom-nav-item${page === item.id ? ' bottom-nav-item--active' : ''}`} onClick={e => { e.preventDefault(); setPage(item.id); setSelectedGroup(null); setMobileAvatarMenuOpen(false); }}>
              <span className="bottom-nav-item-wrap">
                {item.icon}
                {item.badge ? <span className="bottom-nav-badge">{item.badge}</span> : null}
              </span>
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </nav>

      {isStudent && incomingLesson && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal modal--lesson-call">
            <div className="modal-header">
              <div className="modal-title">Входящий урок</div>
            </div>
            <div className="modal-form">
              <div className="lesson-call-teacher">
                {incomingLesson.teacher || 'Учитель'} уже в комнате урока — присоединяйтесь
              </div>
              <div className="modal-actions lesson-call-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={rejectIncomingLesson}>
                  Закрыть
                </button>
                <button type="button" className="modal-btn modal-btn--save" onClick={acceptIncomingLesson}>
                  Присоединиться
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {avatarEditorOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setAvatarEditorOpen(false)}>
          <div className="modal modal--avatar-editor" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Редактировать аватар</div>
              <button className="modal-close" type="button" onClick={() => setAvatarEditorOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="avatar-editor-preview">
                <div className="avatar-editor-preview-circle" style={{ background: AVATAR_BG_OPTIONS.find(x => x.id === avatarDraft.bg)?.css || AVATAR_BG_OPTIONS[0].css }}>
                  {avatarDraft.emoji || avatarFallback}
                </div>
              </div>
              <div className="avatar-editor-title">Emoji</div>
              <div className="avatar-editor-grid">
                {AVATAR_EMOJI_POOL.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`avatar-editor-emoji-btn${avatarDraft.emoji === emoji ? ' avatar-editor-emoji-btn--active' : ''}`}
                    onClick={() => setAvatarDraft((v) => ({ ...v, emoji }))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="avatar-editor-title">Фон</div>
              <div className="avatar-editor-bg-row">
                {AVATAR_BG_OPTIONS.map((bg) => (
                  <button
                    key={bg.id}
                    type="button"
                    className={`avatar-editor-bg-btn${avatarDraft.bg === bg.id ? ' avatar-editor-bg-btn--active' : ''}`}
                    style={{ background: bg.css }}
                    title={bg.label}
                    onClick={() => setAvatarDraft((v) => ({ ...v, bg: bg.id }))}
                  />
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setAvatarEditorOpen(false)}>Отмена</button>
                <button
                  type="button"
                  className="modal-btn modal-btn--save"
                  onClick={() => updateAvatarProfile({ emoji: avatarDraft.emoji, bg: avatarDraft.bg })}
                  disabled={avatarBusy}
                >
                  {avatarBusy ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

