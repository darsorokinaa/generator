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

function getStudentSubjectLabel(student, subjects) {
  const direct =
    student?.subject_name
    || student?.subject_title
    || student?.subject_label
    || student?.subject_rus
    || '';
  if (direct) return String(direct);

  const sid = Number(student?.subject_id ?? student?.subject);
  if (Number.isFinite(sid) && Array.isArray(subjects)) {
    const found = subjects.find((s) => Number(s.id) === sid);
    if (found?.subject_name) return String(found.subject_name);
  }
  return '—';
}

// ── Вспомогательные ──────────────────────────────────────────────────
function getCookie(name) {
  return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.split('=')[1] || '';
}

const GRADE_CHOICES    = ['7','8','9','10','11'].map(v => ({ value: v, label: `${v} класс` }));
const STATUS_CHOICES   = [{ value: '1', label: 'Активный' },{ value: '2', label: 'На паузе' },{ value: '3', label: 'Завершил' },{ value: '4', label: 'Пробный' }];
const GENDER_CHOICES   = [{ value: 'other', label: 'Не указан' },{ value: 'female', label: 'Женский' },{ value: 'male', label: 'Мужской' }];

// ── Toast ─────────────────────────────────────────────────────────────
function Toast({ msg }) {
  return msg ? <div className="sp-toast">{msg}</div> : null;
}

// ── Строка ученика ────────────────────────────────────────────────────
function StudentRow({ student, dragging, onDragStart, onDragEnd, onOpenProfile, onArchive, onDelete, showSubject = false, subjectLabel = '—' }) {
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
      <td className="sp-td sp-td--student" data-label="Ученик">
        <span className="sp-drag-handle" title="Перетащить">⠿</span>
        <span className="sp-avatar" style={{ background: color }}>{initials(name)}</span>
        <span className="sp-name">{name || '—'}</span>
      </td>
      {showSubject && <td className="sp-td sp-td--subject" data-label="Предмет">{subjectLabel}</td>}
      <td className="sp-td sp-td--grade" data-label="Класс">{student.grade ? `${student.grade} кл.` : '—'}</td>
      <td className="sp-td sp-td--status" data-label="Статус">
        <span className={`sp-status ${active ? 'sp-status--active' : 'sp-status--pause'}`}>
          {active ? 'Активен' : 'Пауза'}
        </span>
      </td>
      <td className="sp-td sp-td--actions" data-label="Действия" onClick={e => e.stopPropagation()}>
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
function SectionCard({
  id, title, dot, dotColor, students, draggingId, dragOver, onDragOver, onDragLeave, onDrop, onAddStudent, onOpenProfile, onDragStart, onDragEnd, onArchive, onDelete, onDeleteGroup, showSubject = false, subjects = [],
  canRenameGroup = false, onRenameGroup,
}) {
  const isOver = dragOver === id;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title || '');
  const [renameBusy, setRenameBusy] = useState(false);
  const titleInputRef = useRef(null);

  useEffect(() => { setTitleDraft(title || ''); }, [title]);
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  async function handleRenameSave() {
    if (!canRenameGroup || !onRenameGroup) return;
    const next = String(titleDraft || '').trim();
    if (!next || next === String(title || '').trim()) {
      setEditingTitle(false);
      setTitleDraft(title || '');
      return;
    }
    setRenameBusy(true);
    const ok = await onRenameGroup(next);
    setRenameBusy(false);
    if (ok) {
      setEditingTitle(false);
    }
  }

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
          {canRenameGroup && editingTitle ? (
            <div className="sp-group-rename-inline" onClick={(e) => e.stopPropagation()}>
              <input
                ref={titleInputRef}
                className="sp-group-rename-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleRenameSave(); }
                  if (e.key === 'Escape') { e.preventDefault(); setEditingTitle(false); setTitleDraft(title || ''); }
                }}
                disabled={renameBusy}
              />
              <button type="button" className="sp-group-icon-btn" title="Сохранить" onClick={handleRenameSave} disabled={renameBusy}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </button>
              <button type="button" className="sp-group-icon-btn" title="Отмена" onClick={() => { setEditingTitle(false); setTitleDraft(title || ''); }} disabled={renameBusy}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ) : (
            <>
              <span className="sp-card-title">{title}</span>
              {canRenameGroup && (
                <button
                  type="button"
                  className="sp-group-icon-btn"
                  title="Переименовать группу"
                  onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
              )}
            </>
          )}
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
          <button type="button" className="sp-add-student-btn" onClick={() => onAddStudent(id)}>+ Пригласить ученика</button>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="sp-empty-drop">Перетащите ученика сюда</div>
      ) : (
        <table className="sp-table">
          <thead>
            <tr>
              <th className="sp-th sp-th--student">Ученик</th>
              {showSubject && <th className="sp-th sp-th--subject">Предмет</th>}
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
                showSubject={showSubject}
                subjectLabel={showSubject ? getStudentSubjectLabel(s, subjects) : '—'}
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
  const [groupModal, setGroupModal]     = useState(false);
  const [groupForm, setGroupForm]       = useState({ group_name: '', subject: '', level: '' });
  const [groupError, setGroupError]     = useState('');
  const [groupSaving, setGroupSaving]   = useState(false);

  const [inviteModal, setInviteModal] = useState(null); // null | { lesson_type, group_id? }
  const [inviteForm, setInviteForm] = useState({ subject: '', level: '' });
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);
  const inviteCopiedTimer = useRef(null);

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

  // ── Invite student modal ─────────────────────────────────────────
  function openAddModal(sectionId) {
    const isGroup = sectionId && sectionId !== 'individual';
    const groupId = isGroup ? Number(sectionId.replace('group:', '')) : null;
    setInviteModal({ lesson_type: isGroup ? 'group' : 'individual', group_id: groupId });
    setInviteForm({
      subject: subjects[0]?.id ? String(subjects[0].id) : '',
      level: levels[0]?.id ? String(levels[0].id) : '',
    });
    setInviteError('');
    setInviteUrl('');
    setInviteCopied(false);
  }

  async function handleInviteSubmit(e) {
    e.preventDefault();
    if (!inviteModal) return;
    const isGroup = inviteModal.lesson_type === 'group';
    if (!isGroup && !inviteForm.subject) { setInviteError('Выберите предмет'); return; }
    if (!isGroup && !inviteForm.level) { setInviteError('Выберите уровень'); return; }

    setInviteLoading(true);
    setInviteError('');
    setInviteUrl('');
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/students/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const payload = isGroup
        ? { lesson_type: 'group', group_id: inviteModal.group_id }
        : { lesson_type: 'individual', subject: Number(inviteForm.subject), level: Number(inviteForm.level) };
      const r = await fetch(`${API}/api/students/invite-link/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.invite_url) {
        setInviteUrl(d.invite_url);
        setInviteCopied(false);
      } else {
        setInviteError(d.error || 'Не удалось создать ссылку');
      }
    } catch {
      setInviteError('Нет связи с сервером');
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleCopyInviteUrl() {
    if (!inviteUrl) return;
    const inviteMessage = `Добро пожаловать! Мы рады пригласить вас на занятия.\nПереходите по ссылке и присоединяйтесь:\n${inviteUrl}`;
    try {
      await navigator.clipboard.writeText(inviteMessage);
      setInviteCopied(true);
      clearTimeout(inviteCopiedTimer.current);
      inviteCopiedTimer.current = setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setInviteError('Не удалось скопировать ссылку');
    }
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

  async function handleRenameGroup(groupId, newName) {
    try {
      let csrf = getCookie('csrftoken');
      if (!csrf) { await fetch(`${API}/api/groups/`, { credentials: 'include' }); csrf = getCookie('csrftoken'); }
      const r = await fetch(`${API}/api/groups/${groupId}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        body: JSON.stringify({ group_name: newName }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        showToast((typeof data.error === 'string' && data.error) || 'Не удалось переименовать группу');
        return false;
      }
      const updatedName = data.group_name || newName;
      setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, group_name: updatedName } : g)));
      setStudents(prev => prev.map(s => (
        Number(s.group) === Number(groupId) ? { ...s, group_name: updatedName } : s
      )));
      showToast(`Группа переименована: ${updatedName}`);
      return true;
    } catch {
      showToast('Нет связи с сервером');
      return false;
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

  const addModalIsGroup   = inviteModal?.lesson_type === 'group';
  const addModalGroupName = addModalIsGroup ? groups.find(g => g.id === inviteModal?.group_id)?.group_name : null;
  const addModalTitle     = addModalIsGroup ? `Пригласить в «${addModalGroupName || 'группу'}»` : 'Пригласить ученика';

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
        showSubject
        subjects={subjects}
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
          showSubject
          subjects={subjects}
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
          canRenameGroup
          onRenameGroup={(name) => handleRenameGroup(g.id, name)}
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

      {/* ── MODAL: ПРИГЛАШЕНИЕ УЧЕНИКА ── */}
      {inviteModal !== null && (
        <div className="modal-overlay" onClick={() => setInviteModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{addModalTitle}</span>
              <button className="modal-close" onClick={() => setInviteModal(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form className="modal-form" onSubmit={handleInviteSubmit}>
              <div
                style={{
                  marginBottom: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid #dbeafe',
                  background: '#eff6ff',
                  color: '#1e3a8a',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {addModalIsGroup
                  ? 'Инструкция: нажмите «Создать ссылку», затем «Скопировать ссылку» и отправьте сообщение ученику. По этой ссылке ученик автоматически попадёт в выбранную группу.'
                  : 'Инструкция: выберите предмет и уровень, нажмите «Создать ссылку», затем «Скопировать ссылку» и отправьте сообщение ученику.'}
              </div>
              {!addModalIsGroup && (
                <>
                  <div className="modal-row">
                    <div className="modal-field"><label>Предмет <span className="modal-required">*</span></label><select value={inviteForm.subject} onChange={e => setInviteForm(f => ({ ...f, subject: e.target.value }))}><option value="">— выберите —</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.subject_name}</option>)}</select></div>
                    <div className="modal-field"><label>Уровень <span className="modal-required">*</span></label><select value={inviteForm.level} onChange={e => setInviteForm(f => ({ ...f, level: e.target.value }))}><option value="">— выберите —</option>{levels.map(l => <option key={l.id} value={l.id}>{l.level}</option>)}</select></div>
                  </div>
                </>
              )}
              {inviteError && <div className="modal-error">{inviteError}</div>}
              {inviteUrl && (
                <div className="credentials-message" style={{ marginTop: 10 }}>
                  <span className="credentials-message-label">Сообщение для ученика:</span>
                  <pre className="credentials-message-text">{`Добро пожаловать! Мы рады пригласить вас на занятия.
Переходите по ссылке и присоединяйтесь:
${inviteUrl}`}</pre>
                  <button type="button" className="credentials-copy-all" onClick={handleCopyInviteUrl}>
                    {inviteCopied ? '✓ Скопировано' : 'Скопировать ссылку'}
                  </button>
                </div>
              )}
              <div className="modal-actions">
                <button type="button" className="modal-btn modal-btn--cancel" onClick={() => setInviteModal(null)}>Закрыть</button>
                <button type="submit" className="modal-btn modal-btn--save" disabled={inviteLoading}>{inviteLoading ? 'Создание…' : (inviteUrl ? 'Новая ссылка' : 'Создать ссылку')}</button>
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
    </div>
  );
}
