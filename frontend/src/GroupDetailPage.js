import { useEffect, useState } from 'react';
import API from './api';
import { ResponsivePageHeader, ResponsiveDataList, ResponsiveTableOrCards, ResponsiveCard } from './components/ResponsiveUi';

const SUBJECT_COLOR = {
  'Математика': 'math', 'Алгебра': 'math', 'Геометрия': 'math',
  'Информатика': 'cs', 'Физика': 'physics',
};
const LEVEL_COLOR = { 'ОГЭ': 'oge', 'ЕГЭ': 'ege' };

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

function fallbackAvatarColor(name) {
  const palette = ['#4F6EF7', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#EC4899', '#E87B35'];
  const n = String(name || '');
  let h = 0;
  for (let i = 0; i < n.length; i += 1) h = n.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function avatarBgCss(bgValue, fallbackName = '') {
  const raw = String(bgValue || '').trim();
  if (!raw) return fallbackAvatarColor(fallbackName);
  if (raw.includes('gradient(') || raw.startsWith('#') || raw.startsWith('rgb')) return raw;
  const MAP = {
    violet: 'linear-gradient(135deg, #6D5EF8 0%, #9A8BFF 100%)',
    ocean: 'linear-gradient(135deg, #0EA5E9 0%, #2563EB 100%)',
    mint: 'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
    sunset: 'linear-gradient(135deg, #F59E0B 0%, #FB7185 100%)',
    peach: 'linear-gradient(135deg, #FB7185 0%, #FDBA74 100%)',
    forest: 'linear-gradient(135deg, #15803D 0%, #65A30D 100%)',
  };
  return MAP[raw] || fallbackAvatarColor(fallbackName);
}

const STATUS_LABELS = { '1': 'Активный', '2': 'На паузе', '3': 'Завершил', '4': 'Пробный урок' };

export default function GroupDetailPage({ group, onBack, onOpenProfile }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 640 : false));

  useEffect(() => {
    if (!group?.id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API}/api/students/`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        const gid = Number(group.id);
        setMembers(list.filter(s => Number(s.group) === gid));
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [group?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const letter = (group.group_name || '?')[0]?.toUpperCase() || '?';

  return (
    <div className="page-content">
      <button type="button" className="profile-back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Назад на главную
      </button>

      <div className="sp-hero" style={{ marginTop: 8 }}>
        <div className="sp-avatar" style={{ borderRadius: 16, fontSize: 22 }}>{letter}</div>
        <div className="sp-hero-info">
          <h1 className="sp-name">{group.group_name}</h1>
          <div className="sp-hero-badges">
            <span className={`subject-badge subject-badge--${SUBJECT_COLOR[group.subject_name] || 'default'}`}>{group.subject_name}</span>
            <span className={`level-badge level-badge--${LEVEL_COLOR[group.level_name] || 'default'}`}>{group.level_name}</span>
            <span className="lesson-type-badge lesson-type-badge--group">Группа</span>
          </div>
        </div>
      </div>

      <div className="sp-grid" style={{ marginTop: 20 }}>
        <div className="sp-card">
          <div className="sp-card-title">О группе</div>
          <div className="sp-rows">
            <div className="sp-row">
              <span className="sp-row-label">Название</span>
              <span className="sp-row-value">{group.group_name}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Предмет</span>
              <span className={`subject-badge subject-badge--${SUBJECT_COLOR[group.subject_name] || 'default'}`}>{group.subject_name}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Уровень</span>
              <span className={`level-badge level-badge--${LEVEL_COLOR[group.level_name] || 'default'}`}>{group.level_name}</span>
            </div>
            <div className="sp-row">
              <span className="sp-row-label">Учеников в группе</span>
              <span className="sp-row-value" style={{ fontWeight: 700 }}>{loading ? '…' : members.length}</span>
            </div>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Подсказка</div>
          <p className="sp-placeholder-text" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            Чтобы добавить ученика в эту группу, откройте его профиль и выберите группу в разделе «Тип занятий».
          </p>
        </div>
      </div>

      <div className="section-block" style={{ marginTop: 24, padding: 0, border: 'none', boxShadow: 'none', background: 'transparent' }}>
        <ResponsivePageHeader title="Ученики в группе" />
        <ResponsiveTableOrCards
          isMobile={isMobile}
          mobile={(
            <ResponsiveDataList
              items={members}
              empty={(
                <ResponsiveCard>
                  <div className="table-empty">{loading ? 'Загрузка…' : 'В этой группе пока нет учеников'}</div>
                </ResponsiveCard>
              )}
              renderItem={(s) => {
                const fullName = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
                const avatarEmoji = String(s.student_avatar_emoji || '').trim();
                const avatarBackground = avatarBgCss(s.student_avatar_bg, fullName);
                return (
                  <ResponsiveCard key={s.id} className="group-member-card">
                    <button
                      type="button"
                      className="group-member-btn"
                      onClick={() => onOpenProfile(s)}
                    >
                      <div className="student-cell">
                        <div className="student-avatar-sm" style={{ background: avatarBackground }}>{avatarEmoji || initials(fullName)}</div>
                        <div className="student-info">
                          <span className="student-name">{s.student_name} {s.student_surname}</span>
                          {s.student_email ? <span className="student-meta-sm" style={{ display: 'block' }}>{s.student_email}</span> : null}
                        </div>
                      </div>
                      <div className="group-member-meta">
                        <span className="cell-plain">{s.grade ? `${s.grade} класс` : '—'}</span>
                        <span className={`status-badge status-badge--${s.status === '1' ? 'active' : s.status === '3' ? 'danger' : 'warning'}`}>
                          {STATUS_LABELS[s.status] || s.status}
                        </span>
                      </div>
                    </button>
                  </ResponsiveCard>
                );
              }}
            />
          )}
          desktop={(
            <div className="table-wrap">
              <table className="students-table">
                <thead>
                  <tr>
                    <th>Ученик</th>
                    <th>Класс</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={3} className="table-empty">Загрузка…</td>
                    </tr>
                  ) : members.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="table-empty">В этой группе пока нет учеников</td>
                    </tr>
                  ) : members.map((s) => {
                    const fullName = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
                    const avatarEmoji = String(s.student_avatar_emoji || '').trim();
                    const avatarBackground = avatarBgCss(s.student_avatar_bg, fullName);
                    return (
                      <tr
                        key={s.id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onOpenProfile(s)}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-lt)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                      >
                        <td>
                          <div className="student-cell">
                            <div className="student-avatar-sm" style={{ background: avatarBackground }}>{avatarEmoji || initials(fullName)}</div>
                            <div className="student-info">
                              <span className="student-name">{s.student_name} {s.student_surname}</span>
                              {s.student_email ? (
                                <span className="student-meta-sm" style={{ display: 'block' }}>{s.student_email}</span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="cell-plain">{s.grade ? `${s.grade} класс` : '—'}</span>
                        </td>
                        <td>
                          <span className={`status-badge status-badge--${s.status === '1' ? 'active' : s.status === '3' ? 'danger' : 'warning'}`}>
                            {STATUS_LABELS[s.status] || s.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        />
      </div>
    </div>
  );
}
