import { useEffect, useState } from 'react';
import API from './api';

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

const STATUS_LABELS = { '1': 'Активный', '2': 'На паузе', '3': 'Завершил', '4': 'Пробный урок' };

export default function GroupDetailPage({ group, onBack, onOpenProfile }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

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

  const letter = (group.group_name || '?')[0]?.toUpperCase() || '?';

  return (
    <div className="page-content">
      <button type="button" className="profile-back-btn" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Назад к дашборду
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
        <h3 className="section-title" style={{ marginBottom: 12 }}>Ученики в группе</h3>
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
              ) : members.map(s => (
                <tr
                  key={s.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onOpenProfile(s)}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-lt)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}
                >
                  <td>
                    <div className="student-cell">
                      <div className="student-avatar-sm">{initials(`${s.student_name || ''} ${s.student_surname || ''}`)}</div>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
