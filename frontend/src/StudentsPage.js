import { useState, useEffect, useCallback, useRef } from 'react';
import API from './api';

// ── Палитры ──────────────────────────────────────────────────────────
const GROUP_ACCENT_COLORS = ['#534AB7','#0F6E56','#D85A30','#185FA5','#993556','#BA7517'];
const AVATAR_PALETTE      = ['#4F6EF7','#10B981','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#EC4899','#E87B35'];

function strHash(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}
function avatarColor(name)      { return AVATAR_PALETTE[strHash(name) % AVATAR_PALETTE.length]; }
function groupAccentColor(name) { return GROUP_ACCENT_COLORS[strHash(name) % GROUP_ACCENT_COLORS.length]; }
function initials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// ── Вспомогательные ──────────────────────────────────────────────────
function getCookie(name) {
  return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.split('=')[1] || '';
}

const GRADE_CHOICES    = ['7','8','9','10','11'].map(v => ({ value: v, label: `${v} класс` }));
const STATUS_CHOICES   = [{ value: '1', label: 'Активный' },{ value: '2', label: 'На паузе' },{ value: '3', label: 'Завершил' },{ value: '4', label: 'Пробный' }];
const GENDER_CHOICES   = [{ value: 'other', label: 'Не указан' },{ value: 'female', label: 'Женский' },{ value: 'male', label: 'Мужской' }];
const EMPTY_STUDENT    = { name:'', surname:'', email:'', phone:'', subject:'', level:'', grade:'9', status:'1', lesson_type:'individual', group:'', gender:'other', birth_date:'', goal:'' };

// ── Toast ─────────────────────────────────────────────────────────────
function Toast({ msg }) {
  return msg ? <div className="sp-toast">{msg}</div> : null;
}

// ── Строка ученика ────────────────────────────────────────────────────
function StudentRow({ student, dragging, onDragStart, onDragEnd, onOpenProfile, onArchive, onDelete }) {
  const name   = `${student.student_name || ''} ${student.student_surname || ''}`.trim();
  const color  = avatarColor(name);
  const active = student.status === '1';
  const [menuPos, setMenuPos] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuPos) return;
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuPos(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuPos]);

  function openMenu(e) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  return (
    <tr
      className={`sp-tr${dragging ? ' sp-tr--dragging' : ''}`}
      draggable
      onDragStart={e => onDragStart(e, student)}
      onDragEnd={onDragEnd}
      onClick={() => onOpenProfile && onOpenProfile(student)}
    >
      <td className="sp-td sp-td--student">
        <span className="sp-drag-handle" title="Перетащить">⠿</span>
        <span className="sp-avatar" style={{ background: color }}>{initials(name)}</span>
        <span className="sp-name">{name || '—'}</span>
      </td>
      <td className="sp-td sp-td--grade">{student.grade ? `${student.grade} кл.` : '—'}</td>
      <td className="sp-td sp-td--status">
        <span className={`sp-status ${active ? 'sp-status--active' : 'sp-status--pause'}`}>
          {active ? 'Активен' : 'Пауза'}
        </span>
      </td>
      <td className="sp-td sp-td--actions" onClick={e => e.stopPropagation()}>
        <button className="sp-row-menu-btn" title="Действия" onClick={openMenu}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
        {menuPos && (
          <div
            ref={menuRef}
            className="sp-row-dropdown"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button className="sp-row-dropdown-item" onClick={() => { setMenuPos(null); onArchive(student); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              В архив
            </button>
            <button className="sp-row-dropdown-item sp-row-dropdown-item--danger" onClick={() => { setMenuPos(null); onDelete(student); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              Удалить
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Карточка-секция (индивид. или группа) ────────────────────────────
function SectionCard({ id, title, dot, dotColor, students, draggingId, dragOver, onDragOver, onDragLeave, onDrop, onAddStudent, onOpenProfile, onDragStart, onDragEnd, onArchive, onDelete, onDeleteGroup }) {
  const isOver = dragOver === id;
  return (
    <div
      className={`sp-section-card${isOver ? ' sp-section-card--over' : ''}`}
      onDragOver={e => { e.preventDefault(); onDragOver(id); }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(id); }}
    >
      <div className="sp-card-header">
        <div className="sp-card-header-left">
          {dot && <span className="sp-group-dot" style={{ background: dotColor }} />}
          <span className="sp-card-title">{title}</span>
          <span className="sp-card-pill">{students.length}</span>
        </div>
        <div className="sp-card-header-actions">
          {onDeleteGroup && (
            <button
              type="button"
              className="sp-delete-group-btn"
              onClick={(e) => { e.stopPropagation(); onDeleteGroup(); }}
            >
              Удалить группу
            </button>
          )}
          <button type="button" className="sp-add-student-btn" onClick={() => onAddStudent(id)}>+ Добавить ученика</button>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="sp-empty-drop">Перетащите ученика сюда</div>
      ) : (
        <table className="sp-table">
          <thead>
            <tr>
              <th className="sp-th sp-th--student">Ученик</th>
              <th className="sp-th sp-th--grade">Класс</th>
              <th className="sp-th sp-th--status">Статус</th>
              <th className="sp-th sp-th--actions"></th>
            </tr>
          </thead>
          <tbody>
            {students.map(s => (
              <StudentRow
                key={s.id}
                student={s}
                dragging={draggingId === s.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onOpenProfile={onOpenProfile}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Главный компонент ─────────────────────────────────────────────────
export default function StudentsPage({ onOpenProfile }) {
  const [students, setStudents]     = useState([]);
  const [groups, setGroups]         = useState([]);
  const [subjects, setSubjects]     = useState([]);
  const [levels, setLevels]         = useState([]);
  const [loading, setLoading]       = useState(true);

  // DnD
  const [draggingStudent, setDraggingStudent] = useState(null); // student obj
  const [draggingFrom, setDraggingFrom]       = useState(null); // section id
  const [dragOver, setDragOver]               = useState(null); // section id

  // Toast
  const [toast, setToast]   = useState('');
  const toastTimer           = useRef(null);
  const [showArchive, setShowArchive] = useState(false);

  // Modals
  const [addModal, setAddModal]         = useState(null); // null | section-id (for context)
  const [form, setForm]                 = useState(EMPTY_STUDENT);
  const [formError, setFormError]       = useState('');
  const [saving, setSaving]             = useState(false);
  const [credentials, setCredentials]   = useState(null);

  const [groupModal, setGroupModal]     = useState(false);
  const [groupForm, setGroupForm]       = useState({ group_name: '', subject: '', level: '' });
  const [groupError, setGroupError]     = useState('');
  const [groupSaving, setGroupSaving]   = useState(false);

  // ── Data loading ─────────────────────────────────────────────────
  const loadAll = useCallback((opts = {}) => {
    const silent = !!opts.silent;
    if (!silent) setLoading(true);
    Promise.all([
      fetch(`${API}/api/students/`, { credentials: 'include' }).then(r => r.json()),
      fetch(`${API}/api/groups/`, { credentials: 'include' }).then(r => (r.ok ? r.json() : [])),
    ])
      .then(([stu, grp]) => {
        setStudents(Array.isArray(stu) ? stu : []);
        setGroups(Array.isArray(grp) ? grp : []);
      })
      .catch(() => {})
      .finally(() => { if (!silent) setLoading(false); });
  }, []);

  useEffect(() => {
    loadAll();
    fetch(`${API}/api/subjects/`, { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(d => setSubjects(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/api/levels/`,   { credentials: 'include' }).then(r => r.ok ? r.json() : []).then(d => setLevels(Array.isArray(d) ? d : [])).catch(() => {});
  }, [loadAll]);

  useEffect(() => {
    if (addModal !== null && levels.length && !form.level)
      setForm(f => ({ ...f, level: String(levels[0].id) }));
  }, [addModal, levels, form.level]);

  // ── Toast helper ─────────────────────────────────────────────────
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }

  // ── DnD handlers ─────────────────────────────────────────────────
  function handleDragStart(e, student) {
    e.dataTransfer.effectAllowed = 'move';
    setDraggingStudent(student);
    // detect from-section
    const fromSection = student.lesson_type === 'individual'
      ? 'individual'
      : `group:${groups.find(g => g.group_name === student.group_name)?.id || ''}`;
    setDraggingFrom(fromSection);
  }
  function handleDragEnd() {
    setDraggingStudent(null);
    setDraggingFrom(null);
    setDragOver(null);
  }
  function handleDragOver(sectionId) {
    if (sectionId !== draggingFrom) setDragOver(sectionId);
  }
  function handleDragLeave() { setDragOver(null); }

  async function handleDrop(targetSectionId) {
    setDragOver(null);
    if (!draggingStudent || targetSectionId === draggingFrom) return;

    const s       = draggingStudent;
    const isIndiv = targetSectionId === 'individual';
    const groupId = isIndiv ? null : Number(targetSectionId.replace('group:', ''));
    const targetGroup = groups.find(g => g.id === groupId);
    const targetName  = isIndiv ? 'Индивидуальные' : (targetGroup?.group_name || 'Группа');

    // Optimistic update
    setStudents(prev => prev.map(st => {
      if (st.id !== s.id) return st;
      return {
        ...st,
        lesson_type: isIndiv ? 'individual' : 'group',
        group_name: isIndiv ? null : targetGroup?.group_name,
      };
    }));

    const studentName = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
    showToast(`${studentName} → ${targetName}`);

    // Sync with backend
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      await fetch(`${API}/api/students/${s.id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ lesson_type: isIndiv ? 'individual' : 'group', group: groupId }),
      });
    } catch { /* silent — optimistic already applied */ }

    setDraggingStudent(null);
    setDraggingFrom(null);
  }

  // ── Add student modal ────────────────────────────────────────────
  function openAddModal(sectionId) {
    const isGroup = sectionId && sectionId !== 'individual';
    const groupId = isGroup ? Number(sectionId.replace('group:', '')) : null;
    setForm({
      ...EMPTY_STUDENT,
      subject: subjects[0]?.id ? String(subjects[0].id) : '',
      level:   levels[0]?.id   ? String(levels[0].id)   : '',
      lesson_type: isGroup ? 'group' : 'individual',
      group: groupId ? String(groupId) : '',
    });
    setFormError('');
    setAddModal(sectionId ?? 'individual');
  }

  function handleField(e) { setForm(f => ({ ...f, [e.target.name]: e.target.value })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim())  { setFormError('Введите имя ученика'); return; }
    if (!form.subject)       { setFormError('Выберите предмет'); return; }
    if (!form.level)         { setFormError('Выберите уровень'); return; }
    setSaving(true); setFormError('');
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const payload = {
        name: form.name.trim(), surname: (form.surname || '').trim(),
        email: (form.email || '').trim(), phone: (form.phone || '').trim(),
        subject: Number(form.subject), level: Number(form.level),
        grade: form.grade, goal: (form.goal || '').trim(),
        status: form.status, lesson_type: form.lesson_type,
        group: form.lesson_type === 'group' && form.group ? Number(form.group) : null,
        gender: form.gender,
      };
      if (form.birth_date) payload.birth_date = form.birth_date;
      const r = await fetch(`${API}/api/students/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify(payload) });
      if (r.ok) {
        const created = await r.json();
        setAddModal(null); setLoading(true); loadAll();
        if (created.credentials) setCredentials(created.credentials);
      } else {
        let err = {}; try { err = await r.json(); } catch { /**/ }
        setFormError((typeof err.detail === 'string' && err.detail) || (typeof err.error === 'string' && err.error) || `Ошибка (${r.status})`);
      }
    } catch { setFormError('Нет связи с сервером'); } finally { setSaving(false); }
  }

  // ── Create group modal ───────────────────────────────────────────
  async function handleGroupSubmit(e) {
    e.preventDefault();
    if (!groupForm.group_name.trim()) { setGroupError('Введите название группы'); return; }
    if (!groupForm.subject)            { setGroupError('Выберите предмет'); return; }
    if (!groupForm.level)              { setGroupError('Выберите уровень'); return; }
    setGroupSaving(true); setGroupError('');
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/groups/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const r = await fetch(`${API}/api/groups/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify({ ...groupForm, subject: Number(groupForm.subject), level: Number(groupForm.level) }) });
      if (r.ok) {
        setGroupModal(false);
        setGroupForm({ group_name: '', subject: '', level: '' });
        loadAll({ silent: true });
      } else { const err = await r.json(); setGroupError(err.error || 'Ошибка'); }
    } catch { setGroupError('Нет связи с сервером'); } finally { setGroupSaving(false); }
  }

  // ── Archive / Delete ─────────────────────────────────────────────
  async function handleArchive(student) {
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const r = await fetch(`${API}/api/students/${student.id}/`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ status: '3' }),
      });
      if (r.ok) {
        setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: '3' } : s));
        const name = `${student.student_name || ''} ${student.student_surname || ''}`.trim();
        showToast(`${name} → Архив`);
      }
    } catch { /* silent */ }
  }

  async function handleDelete(student) {
    const name = `${student.student_name || ''} ${student.student_surname || ''}`.trim();
    if (!window.confirm(`Удалить «${name}»? Это действие необратимо.`)) return;
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const r = await fetch(`${API}/api/students/${student.id}/`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'X-CSRFToken': csrf },
      });
      if (r.ok || r.status === 204) {
        setStudents(prev => prev.filter(s => s.id !== student.id));
        showToast(`${name} удалён`);
      }
    } catch { /* silent */ }
  }

  async function handleDeleteGroup(groupRow) {
    const inGroupCount = students.filter(
      s => s.status !== '3' && s.lesson_type === 'group' && Number(s.group) === Number(groupRow.id),
    ).length;
    const msg = inGroupCount > 0
      ? `Удалить группу «${groupRow.group_name}»?\n\nВсе ученики группы (${inGroupCount}) будут перенесены в архив. Связь с группой удалится; профили учеников останутся.`
      : `Удалить пустую группу «${groupRow.group_name}»?`;
    if (!window.confirm(msg)) return;
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/groups/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const r = await fetch(`${API}/api/groups/${groupRow.id}/`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-CSRFToken': csrf },
      });
      if (r.ok || r.status === 204) {
        showToast(
          inGroupCount > 0
            ? `Группа удалена. Ученики (${inGroupCount}) — в архиве.`
            : 'Группа удалена',
        );
        loadAll();
      } else {
        let err = {};
        try { err = await r.json(); } catch { /**/ }
        showToast((typeof err.error === 'string' && err.error) || 'Не удалось удалить группу');
      }
    } catch {
      showToast('Нет связи с сервером');
    }
  }

  // ── Derived ──────────────────────────────────────────────────────
  const activeStudents  = students.filter(s => s.status !== '3');
  const archivedStudents = students.filter(s => s.status === '3');
  const indStudents = activeStudents.filter(s => s.lesson_type === 'individual');
  const groupSections = groups.map(g => ({
    ...g,
    sectionId: `group:${g.id}`,
    color: groupAccentColor(g.group_name),
    students: activeStudents.filter(s => s.group_name === g.group_name),
  }));

  const addModalIsGroup   = addModal && addModal !== 'individual';
  const addModalGroupName = addModalIsGroup ? groups.find(g => String(g.id) === addModal.replace('group:', ''))?.group_name : null;
  const addModalTitle     = addModalIsGroup ? `Добавить в «${addModalGroupName || 'группу'}»` : 'Добавить ученика';

  // ── Render ───────────────────────────────────────────────────────
  if (loading) return (
    <div className="page-content" style={{ display:'flex', alignItems:'center', justifyContent:'center', padding: '80px 0' }}>
      <div style={{ color: 'var(--text-3)', fontWeight: 500 }}>Загрузка…</div>
    </div>
  );

  return (
    <div className="page-content sp-page">
      <Toast msg={toast} />

      {/* ── TOP BAR ── */}
      <div className="sp-topbar">
        <h1 className="sp-h1">Мои ученики</h1>
        <div className="sp-topbar-actions">
          <button
            className={`sp-btn-archive${showArchive ? ' sp-btn-archive--active' : ''}`}
            onClick={() => setShowArchive(v => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
            Архив
            {archivedStudents.length > 0 && (
              <span className="sp-archive-pill">{archivedStudents.length}</span>
            )}
          </button>
          <button className="sp-btn-primary" onClick={() => {
            setGroupForm({ group_name: '', subject: subjects[0]?.id || '', level: levels[0]?.id || '' });
            setGroupError('');
            setGroupModal(true);
          }}>
            + Создать группу
          </button>
        </div>
      </div>

      {/* ── ИНДИВИДУАЛЬНЫЕ ── */}
      <SectionCard
        id="individual"
        title="Индивидуальные занятия"
        dot={false}
        students={indStudents}
        draggingId={draggingStudent?.id}
        dragOver={dragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onAddStudent={openAddModal}
        onOpenProfile={onOpenProfile}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />

      {/* ── ГРУППЫ ── */}
      {groupSections.map(g => (
        <SectionCard
          key={g.id}
          id={g.sectionId}
          title={g.group_name}
          dot={true}
          dotColor={g.color}
          students={g.students}
          draggingId={draggingStudent?.id}
          dragOver={dragOver}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onAddStudent={openAddModal}
          onOpenProfile={onOpenProfile}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onDeleteGroup={() => handleDeleteGroup(g)}
        />
      ))}

      {/* ── АРХИВ ── */}
      {showArchive && (
        <div className="sp-section-card sp-section-card--archive">
          <div className="sp-card-header">
            <div className="sp-card-header-left">
              <span className="sp-archive-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
              </span>
              <span className="sp-card-title">Архив</span>
              <span className="sp-card-pill">{archivedStudents.length}</span>
            </div>
          </div>

          {archivedStudents.length === 0 ? (
            <div className="sp-empty-drop" style={{ color: '#9CA3AF' }}>Нет архивных учеников</div>
          ) : (
            <table className="sp-table">
              <thead>
                <tr>
                  <th className="sp-th sp-th--student">Ученик</th>
                  <th className="sp-th sp-th--grade">Класс</th>
                  <th className="sp-th sp-th--status">Статус</th>
                  <th className="sp-th sp-th--actions"></th>
                </tr>
              </thead>
              <tbody>
                {archivedStudents.map(s => {
                  const name  = `${s.student_name || ''} ${s.student_surname || ''}`.trim();
                  const color = avatarColor(name);
                  return (
                    <tr key={s.id} className="sp-tr sp-tr--archived" onClick={() => onOpenProfile && onOpenProfile(s)}>
                      <td className="sp-td sp-td--student">
                        <span className="sp-drag-handle" style={{ opacity: 0, pointerEvents: 'none' }}>⠿</span>
                        <span className="sp-avatar sp-avatar--archived" style={{ background: color }}>{initials(name)}</span>
                        <span className="sp-name">{name || '—'}</span>
                      </td>
                      <td className="sp-td sp-td--grade">{s.grade ? `${s.grade} кл.` : '—'}</td>
                      <td className="sp-td sp-td--status">
                        <span className="sp-status sp-status--archive">Архив</span>
                      </td>
                      <td className="sp-td sp-td--actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="sp-restore-btn"
                          title="Восстановить"
                          onClick={async () => {
                            try {
                              let csrf = getCookie('csrftoken');
                              if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
                              const r = await fetch(`${API}/api/students/${s.id}/`, {
                                method: 'PATCH', credentials: 'include',
                                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
                                body: JSON.stringify({ status: '1' }),
                              });
                              if (r.ok) {
                                setStudents(prev => prev.map(st => st.id === s.id ? { ...st, status: '1' } : st));
                                showToast(`${name} восстановлен`);
                              }
                            } catch { /* silent */ }
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.64"/></svg>
                          Восстановить
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── MODAL: ДОБАВИТЬ УЧЕНИКА ── */}
      {addModal !== null && (
        <div className="modal-overlay" onClick={() => setAddModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{addModalTitle}</span>
              <button className="modal-close" onClick={() => setAddModal(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form className="modal-form" onSubmit={handleSubmit}>
              <div className="modal-section-label">Личные данные</div>
              <div className="modal-row">
                <div className="modal-field"><label>Имя <span className="modal-required">*</span></label><input name="name" value={form.name} onChange={handleField} placeholder="Анна" autoFocus /></div>
                <div className="modal-field"><label>Фамилия</label><input name="surname" value={form.surname} onChange={handleField} placeholder="Козлова" /></div>
              </div>
              <div className="modal-row">
                <div className="modal-field"><label>Email</label><input name="email" type="email" value={form.email} onChange={handleField} placeholder="anna@mail.ru" /></div>
                <div className="modal-field"><label>Телефон</label><input name="phone" value={form.phone} onChange={handleField} placeholder="+7 900 000-00-00" /></div>
              </div>
              <div className="modal-section-label" style={{ marginTop: 16 }}>Обучение</div>
              <div className="modal-row">
                <div className="modal-field"><label>Предмет <span className="modal-required">*</span></label><select name="subject" value={form.subject} onChange={handleField}><option value="">— выберите —</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}</select></div>
                <div className="modal-field"><label>Уровень <span className="modal-required">*</span></label><select name="level" value={form.level} onChange={handleField}><option value="">— выберите —</option>{levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}</select></div>
              </div>
              <div className="modal-row">
                <div className="modal-field"><label>Класс</label><select name="grade" value={form.grade} onChange={handleField}>{GRADE_CHOICES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}</select></div>
                <div className="modal-field"><label>Статус</label><select name="status" value={form.status} onChange={handleField}>{STATUS_CHOICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
              </div>
              {!addModalIsGroup && (
                <div className="modal-row">
                  <div className="modal-field"><label>Тип занятий</label>
                    <select name="lesson_type" value={form.lesson_type} onChange={handleField}>
                      <option value="individual">Индивидуальное</option>
                      <option value="group">Групповое</option>
                    </select>
                  </div>
                  {form.lesson_type === 'group' && (
                    <div className="modal-field"><label>Группа</label><select name="group" value={form.group} onChange={handleField}><option value="">— выберите —</option>{groups.map(g => <option key={g.id} value={g.id}>{g.group_name}</option>)}</select></div>
                  )}
                </div>
              )}
              {formError && <div className="modal-error">{formError}</div>}
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setAddModal(null)}>Отмена</button>
                <button type="submit" className="modal-btn modal-btn--save" disabled={saving}>{saving ? 'Сохранение…' : 'Добавить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: СОЗДАТЬ ГРУППУ ── */}
      {groupModal && (
        <div className="modal-overlay" onClick={() => setGroupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Новая группа</span>
              <button className="modal-close" onClick={() => setGroupModal(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form className="modal-form" onSubmit={handleGroupSubmit}>
              <div className="modal-field">
                <label>Название группы <span className="modal-required">*</span></label>
                <input name="group_name" value={groupForm.group_name} onChange={e => setGroupForm(f => ({ ...f, group_name: e.target.value }))} placeholder="Алгебра 10А" autoFocus />
              </div>
              <div className="modal-row">
                <div className="modal-field"><label>Предмет <span className="modal-required">*</span></label><select value={groupForm.subject} onChange={e => setGroupForm(f => ({ ...f, subject: e.target.value }))}><option value="">— выберите —</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}</select></div>
                <div className="modal-field"><label>Уровень <span className="modal-required">*</span></label><select value={groupForm.level} onChange={e => setGroupForm(f => ({ ...f, level: e.target.value }))}><option value="">— выберите —</option>{levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}</select></div>
              </div>
              {groupError && <div className="modal-error">{groupError}</div>}
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setGroupModal(false)}>Отмена</button>
                <button type="submit" className="modal-btn modal-btn--save" disabled={groupSaving}>{groupSaving ? 'Создание…' : 'Создать'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL: CREDENTIALS ── */}
      {credentials && (() => {
        const isFemale = credentials.gender === 'female';
        const isMale   = credentials.gender === 'male';
        const added2 = isFemale ? 'зарегистрировала' : isMale ? 'зарегистрировал' : 'зарегистрировал(а)';
        const glad   = isFemale ? 'буду рада тебя видеть' : isMale ? 'буду рад тебя видеть' : 'буду рад(а) тебя видеть';
        const msg = `Привет! 👋\nЯ ${added2} тебя на платформе ГенУрок.рф.\n\nТвои данные для входа:\n🔑 Логин: ${credentials.login}\n🔒 Пароль: ${credentials.password}\n\n🌐 https://генурок.рф/login/\n\nЗаходи, ${glad}!`;
        return (
          <div className="modal-overlay" onClick={() => setCredentials(null)}>
            <div className="modal modal--credentials" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">Ученик добавлен</span>
                <button className="modal-close" onClick={() => setCredentials(null)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
              <div className="credentials-body">
                <div className="credentials-hint"><span className="credentials-hint-icon">⚠️</span><span>Пароль показывается только один раз.</span></div>
                <div className="credentials-row"><span className="credentials-label">Логин</span><span className="credentials-value">{credentials.login}</span></div>
                <div className="credentials-row"><span className="credentials-label">Пароль</span><span className="credentials-value credentials-value--password">{credentials.password}</span></div>
                <div className="credentials-message"><span className="credentials-message-label">Сообщение для ученика:</span><pre className="credentials-message-text">{msg}</pre></div>
                <button className="credentials-copy-all" onClick={() => navigator.clipboard.writeText(msg)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Скопировать сообщение
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
