import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { variantPreviewSiteBaseUrl } from './generatorVariantUrl';
import { ResponsivePageHeader } from './components/ResponsiveUi';

const GEN_RAW = (process.env.REACT_APP_GENERATOR_URL || 'https://test.genurok.ru').replace(/\/$/, '');
const GEN = GEN_RAW.replace(/\/api$/, '');
const VARIANT_PREVIEW_SITE = variantPreviewSiteBaseUrl();
const TASK_BANK_PAGE = 100;
const MOBILE_CREATE_PAGE_SIZE = 5;
const MOBILE_BREAKPOINT = 640;


const LEVEL_LABELS = {
  oge: 'ОГЭ',
  ege: 'ЕГЭ',
  base: 'База',
  basic: 'База',
  profile: 'Профиль',
  profi: 'Профиль',
};

function formatLevelLabel(rawLevel) {
  const key = String(rawLevel || '').trim().toLowerCase();
  if (!key) return '';
  return LEVEL_LABELS[key] || String(rawLevel).toUpperCase();
}

function getVariantCardTitle(variant) {
  const fallback = `Вариант #${variant.variant_id}`;
  const baseTitle = variant.title || fallback;
  const rawLevel = String(variant.level || '').trim();
  if (!rawLevel) return baseTitle;

  const escaped = rawLevel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const levelInParens = new RegExp(`\\(\\s*${escaped}\\s*\\)`, 'i');
  if (!levelInParens.test(baseTitle)) return baseTitle;

  return baseTitle.replace(levelInParens, `(${formatLevelLabel(rawLevel)})`);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return '';
}

/* ── Same MathJax rendering style as 01 generator ───────────────────────────── */
function MathContent({ html, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return undefined;
    ref.current.innerHTML = (html != null ? String(html) : '') || '';
    const el = ref.current;
    let cancelled = false;

    const tryTypeset = () => {
      if (cancelled) return;
      if (window.MathJax?.typesetPromise) {
        try { window.MathJax.typesetPromise([el]).catch(() => {}); } catch (_) {}
      } else {
        setTimeout(tryTypeset, 100);
      }
    };

    const timer = setTimeout(tryTypeset, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html]);

  return <div ref={ref} className={className} />;
}

/* ── Shimmer loading bar ─────────────────────────────────────────────────────── */
function LoadingBar({ active }) {
  if (!active) return null;
  return <div className="vp-loading-bar"><div className="vp-loading-bar-fill" /></div>;
}

function MobileListPager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="vp-mobile-pager">
      <button
        type="button"
        className="vp-mobile-pager-btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        Назад
      </button>
      <span className="vp-mobile-pager-label">Страница {page} из {totalPages}</span>
      <button
        type="button"
        className="vp-mobile-pager-btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
      >
        Далее
      </button>
    </div>
  );
}

/* ── Single task row inside a card or group ──────────────────────────────────── */
function TaskRow({ task, added, onAdd, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const plain = (task.text || '').replace(/<[^>]+>/g, '').trim();

  return (
    <div className={`vp-task-row${added ? ' vp-task-row--added' : ''}${className ? ' ' + className : ''}`}>
      <div className="vp-task-row-header">
        <div className="vp-task-card-meta">
          <span className="vp-task-num">#{task.id}</span>
          {task.task_number != null && <span className="vp-task-badge">Задание {task.task_number}</span>}
          {task.task_title && <span className="vp-task-topic">{task.task_title}</span>}
          {task.subtopic  && <span className="vp-task-subtopic">{task.subtopic}</span>}
        </div>
        <button
          className={`vp-add-btn${added ? ' vp-add-btn--added' : ''}`}
          onClick={() => !added && onAdd(task)}
          disabled={added}
        >
          {added ? '✓' : '+'}
        </button>
      </div>
      <MathContent
        html={task.text || '<em>Нет текста</em>'}
        className={`vp-task-text${expanded ? ' vp-task-text--full' : ''}`}
      />
      {plain.length > 200 && !expanded && (
        <button className="vp-task-expand-btn" onClick={() => setExpanded(true)}>Показать полностью ↓</button>
      )}
    </div>
  );
}

/* ── Standalone task card (for single entries) ───────────────────────────────── */
function TaskCard({ task, added, onAdd }) {
  return (
    <div className={`vp-task-card${added ? ' vp-task-card--added' : ''}`}>
      <TaskRow task={task} added={added} onAdd={onAdd} />
    </div>
  );
}

/* ── Group card (for full group instances) ───────────────────────────────────── */
function GroupCard({ entry, groupInstances, addedIds, onAddTask, onAddGroupInstance }) {
  const nums = (entry.subtasks || []).map(s => s.task_number).sort((a, b) => a - b);
  const range = compactTaskRange(nums);
  const isLinked = entry.type === 'linked_group';

  return (
    <div className={`vp-group-card${isLinked ? ' vp-group-card--linked' : ''}`}>
      <div className="vp-group-card-header">
        <div className="vp-group-card-title">
          <span className="vp-group-card-label">
            {isLinked ? '🔗 Связанная группа' : '📦 Группа'} [{range}]
          </span>
          <span className="vp-group-card-subtitle">Задания: {range}</span>
        </div>
        <span className="vp-group-card-count">{groupInstances.length} вариантов группы</span>
      </div>

      {groupInstances.length === 0 ? (
        <div className="vp-hint vp-hint--compact" style={{ margin: 12 }}>Группы не найдены</div>
      ) : (
        groupInstances.map((instance, idx) => {
          const allAdded = (instance.tasks || []).every(t => addedIds.has(t.id));
          const canAdd = (instance.tasks || []).some(t => !addedIds.has(t.id));
          return (
            <div key={instance.group_id || idx} className="vp-group-instance">
              <div className="vp-group-instance-head">
                <span className="vp-group-instance-title">Вариант группы #{instance.group_id}</span>
                <button
                  className={`vp-group-add-btn${allAdded ? ' vp-group-add-btn--done' : ''}`}
                  onClick={() => !allAdded && canAdd && onAddGroupInstance(instance)}
                  disabled={allAdded || !canAdd}
                >
                  {allAdded ? '✓ Добавлено' : '+ Добавить группу'}
                </button>
              </div>

              <div className="vp-group-instance-body">
                {(instance.tasks || []).map(t => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    added={addedIds.has(t.id)}
                    onAdd={onAddTask}
                    className="vp-task-row--in-group"
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/* ── Variant panel item ──────────────────────────────────────────────────────── */
function VariantItem({ item, index, onRemove, onDragStart, onDragEnter, onDrop, dragging }) {
  const [expanded, setExpanded] = useState(false);
  const plain = ((item.text || '').replace(/<[^>]+>/g, '').trim());

  return (
    <div
      className={`vp-vi${dragging ? ' vp-vi--dragging' : ''}${expanded ? ' vp-vi--expanded' : ''}`}
      draggable
      onDragStart={() => onDragStart(index)}
      onDragEnter={() => onDragEnter(index)}
      onDragOver={e => e.preventDefault()}
      onDrop={() => onDrop(index)}
    >
      <div className="vp-vi-head">
        <span className="vp-vi-drag">⠿</span>
        <span className="vp-vi-num">{index + 1}</span>
        {item.task_number != null && (
          <span className="vp-task-badge">Задание {item.task_number}</span>
        )}
        <span className="vp-vi-text">{plain.slice(0, 45) || `Задача #${item.id}`}</span>
        <button
          className="vp-vi-expand"
          type="button"
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
          title={expanded ? 'Свернуть' : 'Развернуть'}
          onClick={e => {
            e.stopPropagation();
            setExpanded(prev => !prev);
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
            aria-hidden="true"
          >
            <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="vp-vi-remove"
          type="button"
          onClick={e => {
            e.stopPropagation();
            onRemove(item.id);
          }}
        >
          ×
        </button>
      </div>
      {expanded && (
        <MathContent
          html={item.text || '<em>Нет текста</em>'}
          className="vp-vi-fulltext vp-task-text vp-task-text--full"
        />
      )}
    </div>
  );
}

/* ── Normalize raw task from any API response ─────────────────────────────────── */
function normalizeTasks(raw, fallbackTaskNumber) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(t => normalizeOneTask(t, fallbackTaskNumber));
  const nested =
    raw.tasks ?? raw.task ?? raw.results ?? raw.data ?? raw.items ?? raw.task_list;
  if (nested && !Array.isArray(nested) && typeof nested === 'object') {
    if ('text' in nested || 'task_text' in nested || 'id' in nested || 'pk' in nested)
      return [normalizeOneTask(nested, fallbackTaskNumber)];
  }
  if (Array.isArray(nested)) return nested.map(t => normalizeOneTask(t, fallbackTaskNumber));
  if (typeof raw === 'object') {
    const vals = Object.values(raw).filter(v => v && typeof v === 'object' && !Array.isArray(v) && ('text' in v || 'task_text' in v || 'id' in v));
    if (vals.length) return vals.map(t => normalizeOneTask(t, fallbackTaskNumber));
  }
  return [];
}

function normalizeOneTask(t, fallbackTaskNumber) {
  return {
    id:          t.id ?? t.pk ?? t.task_id ?? Math.random(),
    task_number: t.task_number ?? t.number ?? t.task ?? fallbackTaskNumber ?? null,
    task_title:  t.task_title ?? t.title ?? '',
    subtopic:    t.subtopic ?? t.subtopic_title ?? '',
    subtopic_id: t.subtopic_id ?? null,
    text:        t.text ?? t.task_text ?? t.task_template ?? t.content ?? '',
  };
}

function compactTaskRange(numbers) {
  const uniq = Array.from(
    new Set((numbers || []).filter(n => Number.isFinite(+n)).map(n => +n)),
  ).sort((a, b) => a - b);
  if (!uniq.length) return '';

  const parts = [];
  let start = uniq[0];
  let prev = uniq[0];
  for (let i = 1; i < uniq.length; i += 1) {
    const cur = uniq[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = cur;
    prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

function itemsIncludeTaskNumber(items, n) {
  for (const item of (items || [])) {
    if (item.type === 'group' || item.type === 'linked_group') {
      const nums = item.task_numbers || (item.tasks || []).map(t => t.task_number);
      if ((nums || []).includes(n)) return true;
    } else if (item.task_number === n) {
      return true;
    }
  }
  return false;
}

function getItemPart(item) {
  if (!item) return null;
  if (item.type === 'group' || item.type === 'linked_group') {
    return item.tasks?.[0]?.part ?? item.part ?? null;
  }
  return item.part ?? null;
}

/* ── Normalize a catalog entry (single / group / linked_group) ─────────────────── */
function normalizeEntry(item) {
  if (!item) return null;

  if (item.type === 'single') {
    return {
      uid:           `s-${item.id}`,
      type:          'single',
      id:            item.id,
      task_number:   item.task_number,
      task_title:    item.task_title || '',
      part:          item.part ?? null,
      count:         item.count_task || 0,
      label:         `Задание ${item.task_number}: ${item.task_title || ''}`,
      subtasks:      null,
      subtopics_ext: null,
    };
  }

  if (item.type === 'group') {
    const nums = (item.task_numbers || (item.tasks || []).map(t => t.task_number)).sort((a, b) => a - b);
    const range = compactTaskRange(nums);
    return {
      uid:           `g-${item.group_id}`,
      type:          'group',
      id:            item.group_id,
      task_number:   null,
      task_title:    '',
      part:          null,
      count:         item.count_available || (item.tasks || []).reduce((s, t) => s + (t.count_task || 0), 0),
      label:         `Группа [${range}]`,
      subtasks:      (item.tasks || []).map(t => ({
        tasklist_id:  t.tasklist_id ?? t.id,
        task_number:  t.task_number,
        task_title:   t.task_title || '',
      })),
      subtopics_ext: (item.subtopics || []).map(s => ({
        id:         s.id,
        title:      s.title,
        task_count: s.display_count ?? s.task_count ?? 0,
      })),
    };
  }

  if (item.type === 'linked_group') {
    const nums = (item.task_numbers || []).sort((a, b) => a - b);
    const range = compactTaskRange(nums);
    return {
      uid:           `lg-${item.linked_key}`,
      type:          'linked_group',
      id:            item.linked_key,
      task_number:   null,
      task_title:    '',
      part:          null,
      count:         item.count_available || 0,
      label:         `Связанная группа [${range}]`,
      subtasks:      (item.tasks || []).map(t => ({
        tasklist_id:  t.tasklist_id,
        task_number:  t.task_number,
        task_title:   t.task_title || '',
      })),
      subtopics_ext: (item.subtopics || []).map(s => ({
        id:         s.id,
        title:      s.title,
        task_count: s.display_count ?? s.task_count ?? 0,
      })),
    };
  }

  return null;
}

function classifyVariantStatus(variant) {
  if ((variant?.assigned_count || 0) > 0) return { key: 'assigned', label: 'Задан как ДЗ' };
  const createdTs = Date.parse(String(variant?.created_at || ''));
  if (Number.isFinite(createdTs) && (Date.now() - createdTs) < (1000 * 60 * 60 * 48)) {
    return { key: 'new', label: 'Новый' };
  }
  return { key: 'used', label: 'Использовался' };
}

function detectCoverTheme(variant) {
  const level = String(variant?.level || '').toLowerCase();
  const title = String(variant?.title || '').toLowerCase();
  if (title.includes('космос')) return 'space';
  if (title.includes('весна')) return 'spring';
  if (level.includes('oge')) return 'oge';
  if (level.includes('ege')) return 'ege';
  return 'default';
}

function VariantActionsMenu({ onPreview, onPdf, onDuplicate }) {
  return (
    <details className="vp-actions-menu">
      <summary className="vp-actions-menu-btn" title="Ещё действия" aria-label="Ещё действия">⋯</summary>
      <div className="vp-actions-menu-list">
        <button type="button" className="vp-actions-menu-item" onClick={onPreview}>Предпросмотр</button>
        <button type="button" className="vp-actions-menu-item" onClick={onPdf}>Скачать PDF</button>
        <button type="button" className="vp-actions-menu-item" onClick={onDuplicate}>Дублировать</button>
        <button type="button" className="vp-actions-menu-item vp-actions-menu-item--disabled" disabled title="Скоро">Удалить (скоро)</button>
      </div>
    </details>
  );
}

function VariantsToolbar({
  mySearch,
  setMySearch,
  mySubjectFilter,
  setMySubjectFilter,
  myLevelFilter,
  setMyLevelFilter,
  mySort,
  setMySort,
  mySubjects,
  myLevels,
}) {
  return (
    <div className="vp-my-toolbar">
      <div className="vp-my-search-wrap">
        <input
          className="vp-my-search-input"
          type="text"
          placeholder="Поиск по названию, ID, предмету"
          value={mySearch}
          onChange={(e) => setMySearch(e.target.value)}
        />
      </div>
      <select className="vp-my-select" value={mySubjectFilter} onChange={(e) => setMySubjectFilter(e.target.value)}>
        <option value="all">Все предметы</option>
        {mySubjects.map((s) => <option key={s} value={s}>{String(s).toUpperCase()}</option>)}
      </select>
      <select className="vp-my-select" value={myLevelFilter} onChange={(e) => setMyLevelFilter(e.target.value)}>
        <option value="all">Все уровни</option>
        {myLevels.map((l) => <option key={l} value={l}>{formatLevelLabel(l)}</option>)}
      </select>
      <select className="vp-my-select" value={mySort} onChange={(e) => setMySort(e.target.value)}>
        <option value="newest">Сначала новые</option>
        <option value="oldest">Сначала старые</option>
      </select>
    </div>
  );
}

function VariantCard({
  variant,
  viewMode,
  onStartLesson,
  onAssignHomework,
  onDuplicate,
  formatSavedAt,
}) {
  const status = classifyVariantStatus(variant);
  const coverTheme = detectCoverTheme(variant);
  return (
    <div className={`vp-my-card vp-my-card--${viewMode}`}>
      {viewMode === 'cover' && (
        <div className={`vp-my-card-cover vp-my-card-cover--${coverTheme}`}>
          <div className="vp-my-card-cover-chip">{String(variant.subject || '').toUpperCase() || 'ПРЕДМЕТ'}</div>
          <div className="vp-my-card-cover-level">{formatLevelLabel(variant.level) || 'Уровень'}</div>
        </div>
      )}
      <div className="vp-my-card-head">
        <div className="vp-my-card-title">{getVariantCardTitle(variant)}</div>
        <span className="vp-my-card-id">#{variant.variant_id}</span>
      </div>
      <div className="vp-my-card-meta">
        <span>{String(variant.subject || '').toUpperCase()}</span>
        <span>{formatLevelLabel(variant.level)}</span>
        <span>{formatSavedAt(variant.created_at)}</span>
        <span>Задач: {(variant.task_ids || []).length}</span>
      </div>
      <div className="vp-my-card-status-row">
        <span className={`vp-my-status-badge vp-my-status-badge--${status.key}`}>{status.label}</span>
      </div>
      <div className="vp-my-card-actions">
        <button
          type="button"
          className="vp-my-action-btn vp-my-action-btn--lesson"
          onClick={() => onStartLesson(variant)}
        >
          {status.key === 'used' ? 'Продолжить урок' : 'Начать урок'}
        </button>
        <button
          type="button"
          className="vp-my-action-btn vp-my-action-btn--hw"
          onClick={() => onAssignHomework(variant)}
        >
          Задать как ДЗ
        </button>
        <VariantActionsMenu
          onPreview={() => window.open(`${VARIANT_PREVIEW_SITE}/${variant.level}/${variant.subject}/variant/${variant.variant_id}/`, '_blank', 'noopener,noreferrer')}
          onPdf={() => window.open(`${GEN}/api/${variant.level}/${variant.subject}/variant/${variant.variant_id}/pdf/`, '_blank', 'noopener,noreferrer')}
          onDuplicate={() => onDuplicate(variant)}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   VariantsPage
═══════════════════════════════════════════════════════════════════════════════ */
export default function VariantsPage() {
  const [mode, setMode] = useState('mine');

  // Resizing sidebar
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const isResizing = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return;
      const newWidth = document.documentElement.clientWidth - e.clientX;
      if (newWidth > 250 && newWidth < 800) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Catalog
  const [catalog, setCatalog]               = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Manual filters
  const [selLevel, setSelLevel]             = useState(null);
  const [selSubject, setSelSubject]         = useState(null);
  const [taskCats, setTaskCats]             = useState([]);
  const [selEntry, setSelEntry]             = useState(null);
  const [subtopics, setSubtopics]           = useState([]);
  const [selSubtopicId, setSelSubtopicId]   = useState('');
  const [tasks, setTasks]                   = useState([]);          // flat list for single
  const [groupInstances, setGroupInstances] = useState([]);          // full TaskGroup instances
  const [mobileManualPage, setMobileManualPage] = useState(1);
  const [tasksTotal, setTasksTotal]         = useState(0);
  const [tasksLoading, setTasksLoading]     = useState(false);
  const [tasksError, setTasksError]         = useState(null);
  const [isMobile, setIsMobile]             = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= MOBILE_BREAKPOINT;
  });

  // Variant panel
  const [variantItems, setVariantItems]     = useState([]);
  const [variantName, setVariantName]       = useState('');
  const [clearConfirm, setClearConfirm]     = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [savedVariantId, setSavedVId]       = useState(null);
  const [toast, setToast]                   = useState(null);
  const [myVariants, setMyVariants]         = useState([]);
  const [myVariantsLoading, setMyVariantsLoading] = useState(false);
  const [myVariantsError, setMyVariantsError] = useState('');
  const [mySearch, setMySearch] = useState('');
  const [mySubjectFilter, setMySubjectFilter] = useState('all');
  const [myLevelFilter, setMyLevelFilter] = useState('all');
  const [mySort, setMySort] = useState('newest');
  const [myViewMode, setMyViewMode] = useState('cover');

  // Drag
  const dragFrom = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // Random mode
  const [randLevel, setRandLevel]         = useState(null);
  const [randSubject, setRandSubject]     = useState(null);
  const [randTaskCatalog, setRandTaskCatalog] = useState([]);
  const [randSubtopicsByTask, setRandSubtopicsByTask] = useState([]);
  const [onlyFipiVariant, setOnlyFipiVariant] = useState(false);
  const [randFormat, setRandFormat] = useState('full');
  const [randOgeInf13SubtopicId, setRandOgeInf13SubtopicId] = useState(null);
  const [randLoading, setRandLoading]     = useState(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTargetVariant, setAssignTargetVariant] = useState(null);
  const [assignStudents, setAssignStudents] = useState([]);
  const [assignGroups, setAssignGroups] = useState([]);
  const [assignTargetKeys, setAssignTargetKeys] = useState([]);
  const [assignDeadline, setAssignDeadline] = useState('');
  const [assignComment, setAssignComment] = useState('');
  const [assignStudentsLoading, setAssignStudentsLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [lessonModalOpen, setLessonModalOpen] = useState(false);
  const [lessonTargetVariant, setLessonTargetVariant] = useState(null);
  const [lessonStudents, setLessonStudents] = useState([]);
  const [lessonGroups, setLessonGroups] = useState([]);
  const [lessonTargetKey, setLessonTargetKey] = useState('');
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonStarting, setLessonStarting] = useState(false);
  const [lessonError, setLessonError] = useState('');

  const isActiveStudent = useCallback((s) => String(s?.status || '') === '1', []);
  const isIndividualStudent = useCallback((s) => String(s?.lesson_type || 'individual') === 'individual', []);

  /* ── helpers ── */
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const startLessonForVariant = useCallback((variant) => {
    if (!variant?.variant_id) return;
    setLessonTargetVariant(variant);
    setLessonModalOpen(true);
    setLessonTargetKey('');
    setLessonError('');
    setLessonLoading(true);
    Promise.all([
      fetch('/api/students/', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch('/api/groups/', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([studentsData, groupsData]) => {
        setLessonStudents(Array.isArray(studentsData) ? studentsData : []);
        setLessonGroups(Array.isArray(groupsData) ? groupsData : []);
      })
      .catch(() => {
        setLessonStudents([]);
        setLessonGroups([]);
        setLessonError('Не удалось загрузить список учеников и групп');
      })
      .finally(() => setLessonLoading(false));
  }, []);

  const closeLessonModal = useCallback(() => {
    if (lessonStarting) return;
    setLessonModalOpen(false);
    setLessonTargetVariant(null);
    setLessonTargetKey('');
    setLessonStudents([]);
    setLessonGroups([]);
    setLessonLoading(false);
    setLessonError('');
  }, [lessonStarting]);

  const submitStartLesson = useCallback(async () => {
    if (!lessonTargetVariant?.variant_id) return;
    if (!lessonTargetKey) {
      setLessonError('Выберите ученика или группу');
      return;
    }
    const [targetType, rawId] = String(lessonTargetKey).split(':');
    const targetId = Number(rawId);
    if (!Number.isFinite(targetId)) {
      setLessonError('Некорректный получатель урока');
      return;
    }
    const isGroup = targetType === 'group';
    const targetObj = isGroup
      ? lessonGroups.find(g => Number(g.id) === targetId)
      : lessonStudents.find(s => Number(s.id) === targetId);
    if (!isGroup && targetObj && !isActiveStudent(targetObj)) {
      setLessonError('Ученик в архиве. Начать урок можно только с активным учеником.');
      return;
    }
    const targetName = isGroup
      ? (targetObj?.group_name || `Группа #${targetId}`)
      : (() => {
        const fullName = `${targetObj?.name || targetObj?.student_name || ''} ${targetObj?.surname || targetObj?.student_surname || ''}`.trim();
        const loginHint = targetObj?.student_username || targetObj?.student_email || '';
        if (fullName && loginHint) return `${fullName} (${loginHint})`;
        return fullName || `Ученик #${targetId}`;
      })();

    // Важно: открываем окно синхронно в обработчике клика, иначе браузер может заблокировать popup.
    const lessonWindow = window.open('', '_blank', 'noopener,noreferrer');
    setLessonStarting(true);
    setLessonError('');
    try {
      const roomId = `variant-${lessonTargetVariant.variant_id}-${Date.now()}`;
      const resp = await fetch('/api/lesson/start/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({
          room_id: roomId,
          type: isGroup ? 'group' : 'student',
          target_id: targetId,
          target_name: targetName,
          variant_id: lessonTargetVariant.variant_id,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setLessonError(
          err.error
          || (err.detail && String(err.detail))
          || 'Не удалось начать урок. Проверьте endpoint /api/lesson/start/.'
        );
        setLessonStarting(false);
        return;
      }
      const data = await resp.json().catch(() => ({}));
      if (!isGroup && data?.invite_sent === false) {
        setLessonError('Не удалось определить аккаунт ученика для звонка. Выберите ученика ещё раз.');
        setLessonStarting(false);
        return;
      }
      const token = data?.token;
      if (!token) {
        setLessonError('Сервер не вернул lesson token');
        setLessonStarting(false);
        return;
      }

      const teacherRoomUrl = data?.url;
      if (!teacherRoomUrl) {
        if (lessonWindow && !lessonWindow.closed) lessonWindow.close();
        setLessonError('Сервер не вернул ссылку комнаты урока');
        setLessonStarting(false);
        return;
      }
      if (lessonWindow && !lessonWindow.closed) {
        lessonWindow.location.href = teacherRoomUrl;
      } else {
        // Фолбэк, если браузер всё же заблокировал предварительное окно.
        window.location.assign(teacherRoomUrl);
      }
      closeLessonModal();
      const ringTargets = Array.isArray(data?.debug_notify_usernames) ? data.debug_notify_usernames : [];
      if (ringTargets.length) {
        showToast(`Урок запущен. Звонок отправлен: ${ringTargets.join(', ')}`);
      } else {
        showToast(`Урок для «${targetName}» запущен`);
      }
    } catch (e) {
      if (lessonWindow && !lessonWindow.closed) lessonWindow.close();
      setLessonError(e.message || 'Ошибка сети');
    } finally {
      setLessonStarting(false);
    }
  }, [
    lessonTargetVariant,
    lessonTargetKey,
    lessonGroups,
    lessonStudents,
    isActiveStudent,
    showToast,
    closeLessonModal,
  ]);

  const assignVariantAsHomework = useCallback((variant) => {
    if (!variant?.variant_id) return;
    setAssignTargetVariant(variant);
    setAssignModalOpen(true);
    setAssignTargetKeys([]);
    setAssignDeadline('');
    setAssignComment('');
    setAssignError('');
    setAssignStudentsLoading(true);
    Promise.all([
      fetch('/api/students/', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
      fetch('/api/groups/', { credentials: 'include' })
        .then(r => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([studentsData, groupsData]) => {
        setAssignStudents(Array.isArray(studentsData) ? studentsData : []);
        setAssignGroups(Array.isArray(groupsData) ? groupsData : []);
      })
      .catch(() => {
        setAssignStudents([]);
        setAssignGroups([]);
        setAssignError('Не удалось загрузить список учеников и групп');
      })
      .finally(() => setAssignStudentsLoading(false));
  }, []);

  const closeAssignModal = useCallback(() => {
    if (assignSaving) return;
    setAssignModalOpen(false);
    setAssignTargetVariant(null);
    setAssignTargetKeys([]);
    setAssignDeadline('');
    setAssignComment('');
    setAssignError('');
    setAssignStudents([]);
    setAssignGroups([]);
    setAssignStudentsLoading(false);
  }, [assignSaving]);

  const submitAssignHomework = useCallback(async () => {
    if (!assignTargetVariant?.variant_id) return;
    if (!assignTargetKeys.length) {
      setAssignError('Выберите хотя бы одного ученика или группу');
      return;
    }
    let studentIds = [];
    for (const key of assignTargetKeys) {
      const [targetType, rawId] = String(key).split(':');
      const targetId = Number(rawId);
      if (!Number.isFinite(targetId)) continue;
      if (targetType === 'student') {
        const selectedStudent = assignStudents.find(
          s => Number(s.student ?? s.id) === targetId || Number(s.id) === targetId
        );
        if (!selectedStudent) continue;
        if (!isActiveStudent(selectedStudent)) {
          setAssignError('Нельзя назначить ДЗ архивным ученикам. Снимите их из выбора.');
          return;
        }
        studentIds.push(targetId);
        continue;
      }
      if (targetType === 'group') {
        const group = assignGroups.find(g => Number(g.id) === targetId);
        const groupStudents = assignStudents
          .filter(s => (
            isActiveStudent(s) && (
              Number(s.group) === targetId
              || Number(s.group_id) === targetId
              || (group?.group_name && String(s.group_name || '') === String(group.group_name))
            )
          ))
          .map(s => Number(s.student ?? s.id))
          .filter(Number.isFinite);
        studentIds.push(...groupStudents);
      }
    }
    studentIds = Array.from(new Set(studentIds));
    if (!studentIds.length) {
      setAssignError('Для выбранного пункта не найдено учеников');
      return;
    }

    setAssignSaving(true);
    setAssignError('');
    try {
      const createResp = await fetch('/api/homework/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({
          variant_id: assignTargetVariant.variant_id,
          title: assignTargetVariant.title || `Вариант #${assignTargetVariant.variant_id}`,
          subject: assignTargetVariant.subject || '',
          text: assignComment || '',
          deadline: assignDeadline || undefined,
        }),
      });
      if (!createResp.ok) {
        const err = await createResp.json().catch(() => ({}));
        setAssignError(err.error || 'Не удалось создать ДЗ');
        setAssignSaving(false);
        return;
      }
      const hw = await createResp.json().catch(() => ({}));
      if (!hw?.id) {
        setAssignError('Домашнее задание создано с ошибкой, попробуйте снова');
        setAssignSaving(false);
        return;
      }
      const assignResp = await fetch(`/api/homework/${hw.id}/assign/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({ student_ids: studentIds }),
      });
      if (!assignResp.ok) {
        const err = await assignResp.json().catch(() => ({}));
        setAssignError(err.error || 'ДЗ создано, но не удалось назначить ученикам');
        setAssignSaving(false);
        return;
      }
      showToast(`Вариант #${assignTargetVariant.variant_id} назначен как ДЗ`);
      closeAssignModal();
    } catch (e) {
      setAssignError(e.message || 'Ошибка сети');
    } finally {
      setAssignSaving(false);
    }
  }, [
    assignTargetVariant,
    assignTargetKeys,
    assignStudents,
    assignGroups,
    isActiveStudent,
    assignComment,
    assignDeadline,
    showToast,
    closeAssignModal,
  ]);

  const toggleAssignTargetKey = useCallback((key) => {
    setAssignTargetKeys((prev) => (
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    ));
  }, []);

  const loadMyVariants = useCallback(async () => {
    setMyVariantsLoading(true);
    setMyVariantsError('');
    try {
      const r = await fetch('/api/variants/', { credentials: 'include' });
      const d = await r.json().catch(() => []);
      if (!r.ok) {
        setMyVariantsError(d?.error || `Сервер: ${r.status}`);
        setMyVariants([]);
      } else {
        setMyVariants(Array.isArray(d) ? d : []);
      }
    } catch (_) {
      setMyVariantsError('Не удалось загрузить список вариантов');
      setMyVariants([]);
    }
    setMyVariantsLoading(false);
  }, []);

  const allLevels        = catalog.map(c => ({ level: c.level, level_rus: c.level_rus }));
  const subjectsForLevel = lv => catalog.find(c => c.level === lv?.level)?.subjects || [];
  const manualSubjects   = subjectsForLevel(selLevel);
  const randomSubjects   = subjectsForLevel(randLevel);
  const addedIds         = new Set(variantItems.map(i => i.id));
  const filterAny        = !!(selLevel || selSubject || selEntry);
  const manualSourceCount = selEntry?.type === 'single' ? tasks.length : groupInstances.length;
  const manualTotalPages = isMobile ? Math.max(1, Math.ceil(manualSourceCount / MOBILE_CREATE_PAGE_SIZE)) : 1;
  const manualPageStart = isMobile ? (mobileManualPage - 1) * MOBILE_CREATE_PAGE_SIZE : 0;
  const pagedTasks = isMobile ? tasks.slice(manualPageStart, manualPageStart + MOBILE_CREATE_PAGE_SIZE) : tasks;
  const pagedGroupInstances = isMobile
    ? groupInstances.slice(manualPageStart, manualPageStart + MOBILE_CREATE_PAGE_SIZE)
    : groupInstances;

  useEffect(() => {
    setMobileManualPage(1);
  }, [selLevel, selSubject, selEntry, selSubtopicId]);

  useEffect(() => {
    if (!isMobile) return;
    if (mobileManualPage > manualTotalPages) {
      setMobileManualPage(manualTotalPages);
    }
  }, [isMobile, mobileManualPage, manualTotalPages]);

  /* ── load catalog ── */
  useEffect(() => {
    fetch('/api/gen/catalog/', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { catalog: [] })
      .then(d => setCatalog(d.catalog || []))
      .catch(() => {})
      .finally(() => setCatalogLoading(false));
  }, []);

  useEffect(() => {
    loadMyVariants();
  }, [loadMyVariants]);

  /* ── load task categories (all types: single, group, linked_group) ── */
  useEffect(() => {
    if (!selSubject || !selLevel) {
      setTaskCats([]); setSelEntry(null); setSubtopics([]); setSelSubtopicId(''); setTasks([]); setGroupInstances([]);
      return;
    }
    fetch(`/api/gen/tasks/?level=${selLevel.level}&subject=${selSubject.subject_short}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then(d => {
        const raw = d.tasks || [];
        const entries = raw
          .map(normalizeEntry)
          .filter(e => e && e.count > 0);
        setTaskCats(entries);
        setSelEntry(null);
        setSubtopics([]); setSelSubtopicId(''); setTasks([]); setGroupInstances([]);
      })
      .catch(() => {});
  }, [selSubject, selLevel]);

  /* ── load subtopics ── */
  useEffect(() => {
    if (!selEntry) { setSubtopics([]); setSelSubtopicId(''); return; }

    // For groups/linked_groups, subtopics come from the entry itself
    if (selEntry.type !== 'single') {
      setSubtopics(selEntry.subtopics_ext || []);
      setSelSubtopicId('');
      return;
    }

    // For singles, load from the subtopics endpoint
    if (!selSubject || !selLevel || !selEntry.id) { setSubtopics([]); setSelSubtopicId(''); return; }
    fetch(`/api/gen/subtopics/?level=${selLevel.level}&subject=${selSubject.subject_short}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { subtopics_by_task: [] })
      .then(d => {
        const found = (d.subtopics_by_task || []).find(t => String(t.task_list_id) === String(selEntry.id));
        setSubtopics(found?.subtopics || []);
        setSelSubtopicId('');
      })
      .catch(() => {});
  }, [selEntry, selSubject, selLevel]);

  /* ── load tasks ── */
  const loadTasks = useCallback(async () => {
    if (!selEntry || !selSubject || !selLevel) return;
    setTasksLoading(true);
    setTasks([]);
    setGroupInstances([]);
    setTasksError(null);

    try {
      if (selEntry.type === 'single') {
        /* ─ Single: try get-all-tasks, fallback to task-bank ─ */
        let normalized = [];
        const p = new URLSearchParams({
          subject:     selSubject.subject_short,
          level:       selLevel.level,
          task_number: selEntry.task_number,
        });
        if (selSubtopicId) p.set('subtopic', selSubtopicId);

        const r = await fetch(`/api/get-all-tasks/?${p}`, { credentials: 'include' });
        const raw = await r.json().catch(() => ({}));
        if (r.ok) {
          normalized = normalizeTasks(raw, selEntry.task_number);
        } else {
          setTasksError(raw?.error || `Сервер: ${r.status}`);
        }

        if (normalized.length === 0 && selEntry.id) {
          const p2 = new URLSearchParams({
            level:        selLevel.level,
            subject:      selSubject.subject_short,
            task_list_id: String(selEntry.id),
            page:         '1',
            per_page:     String(TASK_BANK_PAGE),
          });
          if (selSubtopicId) p2.set('subtopic_id', selSubtopicId);
          const r2 = await fetch(`/api/gen/task-bank/?${p2}`, { credentials: 'include' });
          if (r2.ok) {
            const d2 = await r2.json();
            const fb = normalizeTasks(d2, selEntry.task_number);
            if (fb.length) { normalized = fb; setTasksError(null); }
          }
        }

        setTasks(normalized);
        setTasksTotal(normalized.length);

      } else {
        /* ─ Group / linked_group: fetch full group instances ─ */
        const p = new URLSearchParams({
          level: selLevel.level,
          subject: selSubject.subject_short,
          page: '1',
          per_page: String(TASK_BANK_PAGE),
        });
        if (selEntry.type === 'group') p.set('group_id', String(selEntry.id));
        if (selEntry.type === 'linked_group') p.set('linked_key', String(selEntry.id));
        if (selSubtopicId) p.set('subtopic_id', selSubtopicId);

        const r = await fetch(`/api/gen/group-instances/?${p}`, { credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) {
          setTasksError(d?.error || `Сервер: ${r.status}`);
          setTasksTotal(0);
        } else {
          const instances = (d.instances || []).map(g => ({
            group_id: g.group_id,
            subtopic_id: g.subtopic_id,
            tasks: (g.tasks || []).map(t => normalizeOneTask(t, t.task_number)),
          }));
          setGroupInstances(instances);
          setTasksTotal(instances.length);
        }
      }
    } catch (e) {
      console.warn('loadTasks error:', e);
      setTasksError(e.message || 'Ошибка сети');
      setTasks([]);
      setGroupInstances([]);
      setTasksTotal(0);
    }

    setTasksLoading(false);
  }, [selEntry, selSubject, selLevel, selSubtopicId]);

  useEffect(() => {
    if (selEntry) { loadTasks(); } else {
      setTasks([]); setGroupInstances([]); setTasksTotal(0); setTasksError(null);
    }
  }, [selEntry, selSubtopicId, loadTasks]);

  /* ── random mode: load task catalog + subtopics (for FIPI and OGE inf #13) ── */
  useEffect(() => {
    if (!randSubject || !randLevel) {
      setRandTaskCatalog([]);
      setRandSubtopicsByTask([]);
      setRandOgeInf13SubtopicId(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`/api/gen/tasks/?level=${randLevel.level}&subject=${randSubject.subject_short}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { tasks: [] })
        .catch(() => ({ tasks: [] })),
      fetch(`/api/gen/subtopics/?level=${randLevel.level}&subject=${randSubject.subject_short}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : { subtopics_by_task: [] })
        .catch(() => ({ subtopics_by_task: [] })),
    ]).then(([tasksData, subsData]) => {
      if (cancelled) return;
      setRandTaskCatalog(tasksData.tasks || []);
      const byTask = subsData.subtopics_by_task || [];
      setRandSubtopicsByTask(byTask);

      if (randLevel.level === 'oge' && randSubject.subject_short === 'inf') {
        const block13 = byTask.find(row => row.task_number === 13);
        const subs = block13?.subtopics || [];
        if (subs.length >= 2) {
          setRandOgeInf13SubtopicId(prev => (
            prev != null && subs.some(st => st.id === prev) ? prev : subs[0].id
          ));
        } else {
          setRandOgeInf13SubtopicId(null);
        }
      } else {
        setRandOgeInf13SubtopicId(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [randSubject, randLevel]);

  useEffect(() => {
    if (randSubject?.subject_short === 'inf' && randLevel?.level === 'ege' && randFormat !== 'full') {
      setRandFormat('full');
    }
  }, [randSubject, randLevel, randFormat]);

  /* ── variant mutations ── */
  const addToVariant = useCallback(task =>
    setVariantItems(prev => prev.find(i => i.id === task.id) ? prev : [...prev, { ...task }]), []);

  // Add a whole group instance (all tasks inside)
  const addGroupToVariant = useCallback((instance) => {
    const toAdd = (instance.tasks || []).filter(t => !variantItems.some(v => v.id === t.id));
    if (toAdd.length) {
      setVariantItems(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        return [...prev, ...toAdd.filter(t => !existingIds.has(t.id))];
      });
    }
  }, [variantItems]);
  const removeFromVariant = useCallback(id =>
    setVariantItems(prev => prev.filter(i => i.id !== id)), []);

  /* ── drag-and-drop ── */
  const handleDragStart = useCallback(idx => { dragFrom.current = idx; }, []);
  const handleDragEnter = useCallback(idx => setDragOverIdx(idx), []);
  const handleDrop = useCallback(targetIdx => {
    const from = dragFrom.current;
    if (from === null || from === targetIdx) { dragFrom.current = null; setDragOverIdx(null); return; }
    setVariantItems(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(targetIdx, 0, item);
      return arr;
    });
    dragFrom.current = null; setDragOverIdx(null);
  }, []);

  /* ── save variant ── */
  const saveVariant = async () => {
    if (!variantItems.length) return;
    const lv   = selLevel   || randLevel;
    const subj = selSubject || randSubject;
    if (!lv || !subj) { showToast('Выберите предмет и уровень', 'error'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/variants/save/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({
          level: lv.level,
          subject: subj.subject_short,
          task_ids: variantItems.map(i => i.id),
          tasks: variantItems.map(i => ({
            task_id: i.id,
            task_number: i.task_number ?? null,
          })),
          title: `Вариант ${subj.subject_name || subj.subject_short} (${formatLevelLabel(lv.level)})`,
        }),
      });
      if (r.ok) {
        const d = await r.json();
        setSavedVId(d.variant_id);
        if (d?.id) {
          setMyVariants(prev => [d, ...prev.filter(v => v.id !== d.id)]);
        } else {
          loadMyVariants();
        }
        setMode('mine');
        showToast(`✓ Вариант #${d.variant_id} сохранён и привязан к учителю`);
      } else {
        const err = await r.json().catch(() => ({}));
        showToast(err.error || 'Ошибка при сохранении', 'error');
      }
    } catch { showToast('Ошибка соединения', 'error'); }
    setSaving(false);
  };

  /* ── generate variant (same approach as 01 generator TasksPage) ── */
  const generateRandom = async (partMode) => {
    if (!randSubject || !randLevel) return;

    const hasFipiForTaskList = taskListId => {
      const block = randSubtopicsByTask.find(b => b.task_list_id === taskListId);
      if (!block) return false;
      return (block.subtopics || []).some(st => (st.fipi_task_count ?? 0) > 0);
    };

    const isFipiItem = item => {
      if (item.type === 'group' || item.type === 'linked_group') {
        const ids = (item.tasks || []).map(t => t.tasklist_id).filter(Boolean);
        return ids.some(id => hasFipiForTaskList(id));
      }
      return hasFipiForTaskList(item.id);
    };

    let source = randTaskCatalog || [];
    if (onlyFipiVariant && randSubtopicsByTask.length > 0) {
      source = source.filter(isFipiItem);
    }

    if (partMode === 1 || partMode === 2) {
      source = source.filter(item => {
        const p = getItemPart(item);
        return Number(p) === Number(partMode);
      });
    }

    if (!source.length) {
      showToast('По выбранным параметрам нет задач для генерации', 'error');
      return;
    }

    if (
      randLevel.level === 'oge'
      && randSubject.subject_short === 'inf'
      && itemsIncludeTaskNumber(source, 13)
    ) {
      const block13 = randSubtopicsByTask.find(row => row.task_number === 13);
      const subs = block13?.subtopics || [];
      if (subs.length >= 2 && randOgeInf13SubtopicId == null) {
        showToast('Выберите тип задания 13: текст или презентация', 'error');
        return;
      }
    }

    const payload = { content: {} };
    if (onlyFipiVariant) payload.only_fipi = true;
    if (
      randLevel.level === 'oge'
      && randSubject.subject_short === 'inf'
      && itemsIncludeTaskNumber(source, 13)
      && randOgeInf13SubtopicId != null
    ) {
      payload.oge_inf_13_subtopics = [randOgeInf13SubtopicId];
    }

    source.forEach(item => {
      if (item.type === 'group' && item.tasks?.length) {
        item.tasks.forEach(t => {
          const tlId = t.tasklist_id ?? t.id;
          if (tlId != null) payload.content[String(tlId)] = 1;
        });
      } else if (item.type === 'linked_group' && item.tasks?.length) {
        item.tasks.forEach(t => {
          if (t.tasklist_id != null) payload.content[String(t.tasklist_id)] = 1;
        });
      } else if (item.id != null) {
        payload.content[String(item.id)] = 1;
      }
    });

    if (!Object.keys(payload.content).length) {
      showToast('Не удалось собрать payload для генерации', 'error');
      return;
    }

    setRandLoading(partMode ?? 'full');
    try {
      const r = await fetch('/api/gen/variant/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCookie('csrftoken'),
        },
        body: JSON.stringify({
          level: randLevel.level,
          subject: randSubject.subject_short,
          ...payload,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.variant_id) {
        showToast(d.error || 'Ошибка генерации варианта', 'error');
        setRandLoading(null);
        return;
      }

      const vr = await fetch(`/api/homework/variant/${d.variant_id}/`, { credentials: 'include' });
      if (vr.ok) {
        const vd = await vr.json();
        const items = (vd.tasks || []).map((t, i) => normalizeOneTask({
          id: t.task_id ?? t.id ?? i,
          task_number: t.task_number ?? t.number ?? null,
          task_title: t.task_title ?? t.title ?? '',
          subtopic: t.subtopic ?? t.subtopic_title ?? '',
          subtopic_id: t.subtopic_id ?? null,
          text: t.text ?? t.task_text ?? t.task_template ?? t.content ?? '',
          part: t.part ?? null,
        }));
        setVariantItems(items);
        setSavedVId(d.variant_id);
        showToast(`✓ Вариант #${d.variant_id} сгенерирован`);
      } else {
        showToast('Вариант создан, но не удалось загрузить задачи', 'error');
      }
    } catch {
      showToast('Ошибка соединения', 'error');
    }
    setRandLoading(null);
  };

  const lv   = selLevel   || randLevel;
  const subj = selSubject || randSubject;
  const isInfEgeRandom = randSubject?.subject_short === 'inf' && randLevel?.level === 'ege';
  const canGenerateRandom = Boolean(randSubject && randLevel && randLoading === null);
  const selectedRandomPart = randFormat === 'part1' ? 1 : randFormat === 'part2' ? 2 : null;
  const randomCtaText = randLoading !== null
    ? 'Генерация...'
    : 'Сгенерировать вариант';
  const formatSavedAt = iso => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_) {
      return '';
    }
  };

  const mySubjects = useMemo(() => {
    const set = new Set();
    myVariants.forEach((v) => {
      const s = String(v.subject || '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [myVariants]);

  const myLevels = useMemo(() => {
    const set = new Set();
    myVariants.forEach((v) => {
      const s = String(v.level || '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [myVariants]);

  const visibleMyVariants = useMemo(() => {
    const search = String(mySearch || '').trim().toLowerCase();
    const arr = myVariants.filter((v) => {
      const subject = String(v.subject || '').trim();
      const level = String(v.level || '').trim();
      if (mySubjectFilter !== 'all' && subject !== mySubjectFilter) return false;
      if (myLevelFilter !== 'all' && level !== myLevelFilter) return false;
      if (!search) return true;
      const hay = `${v.title || ''} ${v.variant_id || ''} ${subject} ${formatLevelLabel(level)}`.toLowerCase();
      return hay.includes(search);
    });
    arr.sort((a, b) => {
      const ta = Date.parse(String(a.created_at || '')) || 0;
      const tb = Date.parse(String(b.created_at || '')) || 0;
      return mySort === 'oldest' ? (ta - tb) : (tb - ta);
    });
    return arr;
  }, [myVariants, mySearch, mySubjectFilter, myLevelFilter, mySort]);

  const handleDuplicateVariant = useCallback(async (v) => {
    try {
      const r = await fetch('/api/variants/save/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({
          level: v.level,
          subject: v.subject,
          task_ids: Array.isArray(v.task_ids) ? v.task_ids : [],
          title: `${v.title || `Вариант #${v.variant_id}`} (копия)`,
        }),
      });
      if (r.ok) {
        const saved = await r.json();
        setMyVariants((prev) => [saved, ...prev]);
        showToast('Вариант продублирован');
      } else {
        showToast('Не удалось дублировать вариант', 'error');
      }
    } catch {
      showToast('Ошибка сети при дублировании', 'error');
    }
  }, [showToast]);

  /* ── helpers for current entry display ── */
  const isGroup = selEntry && selEntry.type !== 'single';

  /* ── render ── */
  return (
    <div className="vp-shell">

      {toast && (
        <div className={`vp-toast${toast.type === 'error' ? ' vp-toast--err' : ''}`}>{toast.msg}</div>
      )}

      {/* Mode tabs */}
      <div className="vp-mode-tabs">
        <button className={`vp-mode-tab${mode === 'mine' ? ' vp-mode-tab--on' : ''}`} onClick={() => setMode('mine')}>
          Мои варианты
        </button>
        <button className={`vp-mode-tab${mode === 'manual' ? ' vp-mode-tab--on' : ''}`} onClick={() => setMode('manual')}>
          Создать вручную
        </button>
        <button className={`vp-mode-tab${mode === 'random' ? ' vp-mode-tab--on' : ''}`} onClick={() => setMode('random')}>
          Сгенерировать вариант
        </button>
      </div>

      <div 
        className={`vp-layout${mode === 'mine' ? ' vp-layout--my' : ''}`}
        style={{ '--vp-sidebar-width': `${sidebarWidth}px` }}
      >

        {/* ── LEFT zone ── */}
        <div className="vp-left">

          {/* ══ MANUAL ══ */}
          {mode === 'manual' && (
            <>
              <div className="vp-filter-panel">
                <div className="vp-filter-groups">
                  <div className="vp-filter-group">
                    <span className="vp-filter-label">Уровень</span>
                    <div className="vp-filter-select-wrap">
                      <select className="vp-filter-select" value={selLevel?.level || ''}
                        onChange={e => {
                          const l = allLevels.find(x => x.level === e.target.value) || null;
                          setSelLevel(l); setSelSubject(null); setSelEntry(null);
                          setSubtopics([]); setSelSubtopicId(''); setTasks([]); setGroupInstances([]);
                          setTasksError(null);
                        }}>
                        <option value="">Все уровни</option>
                        {allLevels.map(l => <option key={l.level} value={l.level}>{l.level_rus || l.level}</option>)}
                      </select>
                      <span className="vp-filter-chevron" aria-hidden="true">▾</span>
                    </div>
                  </div>

                  <div className="vp-filter-group">
                    <span className="vp-filter-label">Предмет</span>
                    <div className="vp-filter-select-wrap">
                      <select className="vp-filter-select" disabled={!selLevel || manualSubjects.length === 0}
                        value={selSubject?.subject_short || ''}
                        onChange={e => {
                          const s = manualSubjects.find(x => x.subject_short === e.target.value) || null;
                          setSelSubject(s); setSelEntry(null);
                          setSubtopics([]); setSelSubtopicId(''); setTasks([]); setGroupInstances([]); setTasksError(null);
                        }}>
                        <option value="">
                          {selLevel && manualSubjects.length === 0 ? 'Нет доступных предметов' : 'Все предметы'}
                        </option>
                        {manualSubjects.map(s => (
                          <option key={s.subject_short} value={s.subject_short}>{s.subject_name}</option>
                        ))}
                      </select>
                      <span className="vp-filter-chevron" aria-hidden="true">▾</span>
                    </div>
                  </div>

                  <div className="vp-filter-group">
                    <span className="vp-filter-label">Задание</span>
                    <div className="vp-filter-select-wrap">
                      <select className="vp-filter-select" disabled={!selSubject}
                        value={selEntry?.uid || ''}
                        onChange={e => {
                          const entry = taskCats.find(c => c.uid === e.target.value) || null;
                          setSelEntry(entry);
                          setSelSubtopicId(''); setTasksError(null);
                        }}>
                        <option value="">Все задания</option>
                        {taskCats.map(c => (
                          <option key={c.uid} value={c.uid}>{c.label}</option>
                        ))}
                      </select>
                      <span className="vp-filter-chevron" aria-hidden="true">▾</span>
                    </div>
                  </div>

                  <div className="vp-filter-group">
                    <span className="vp-filter-label">Подтема</span>
                    <div className="vp-filter-select-wrap">
                      <select className="vp-filter-select" disabled={!selEntry || !subtopics.length}
                        value={selSubtopicId}
                        onChange={e => { setSelSubtopicId(e.target.value); setTasksError(null); }}>
                        <option value="">Все подтемы</option>
                        {subtopics.map(st => (
                          <option key={st.id} value={st.id}>{st.title} ({st.task_count || 0})</option>
                        ))}
                      </select>
                      <span className="vp-filter-chevron" aria-hidden="true">▾</span>
                    </div>
                  </div>
                </div>

                <div className="vp-filter-divider" />

                <div className="vp-filter-tags" aria-live="polite">
                  <span className="vp-filter-tags-label">Сейчас:</span>
                  {selLevel && <span className="vp-filter-tag">{selLevel.level_rus || selLevel.level}</span>}
                  {selSubject && <span className="vp-filter-tag">{selSubject.subject_name}</span>}
                  {selEntry && <span className="vp-filter-tag">{selEntry.label}</span>}
                  {selSubtopicId && subtopics.length > 0 && (
                    <span className="vp-filter-tag">{subtopics.find(s => String(s.id) === String(selSubtopicId))?.title || ''}</span>
                  )}
                </div>

                <button
                  className="vp-filter-reset"
                  onClick={() => {
                    setSelLevel(null); setSelSubject(null); setSelEntry(null);
                    setSubtopics([]); setSelSubtopicId(''); setTasks([]); setGroupInstances([]);
                    setTasksError(null);
                  }}
                >
                  Сбросить
                </button>
              </div>

              {/* Group subtask info */}
              {isGroup && selEntry.subtasks && (
                <div className="vp-group-info">
                  <span className="vp-group-info-label">Задания в группе:</span>
                  <span className="vp-group-chip">
                    {compactTaskRange((selEntry.subtasks || []).map(st => st.task_number))}
                  </span>
                </div>
              )}

              <LoadingBar active={tasksLoading} />

              {!tasksLoading && (
                <div className="vp-found-count">
                  Найдено: <span className="vp-found-count-value">{tasksTotal}</span>{' '}
                  {selEntry?.type === 'single' ? 'заданий' : 'групп'}
                </div>
              )}
              {catalogLoading && <div className="vp-hint vp-hint--compact">Загрузка каталога…</div>}
              {!catalogLoading && !selLevel && (
                <div className="vp-hint">
                  <strong className="vp-hint-title">Шаг 1.</strong> Выберите класс / уровень.
                </div>
              )}
              {!catalogLoading && selLevel && !selSubject && (
                <div className="vp-hint vp-hint--compact">
                  <strong className="vp-hint-title">Шаг 2.</strong> Выберите предмет.
                </div>
              )}
              {!catalogLoading && selLevel && selSubject && !selEntry && (
                <div className="vp-hint vp-hint--compact">
                  <strong className="vp-hint-title">Шаг 3.</strong> Выберите тему или задание из списка.
                </div>
              )}
              {tasksError && <div className="vp-hint vp-hint--err">{tasksError}</div>}
              {selEntry && !tasksLoading && tasksTotal === 0 && !tasksError && (
                <div className="vp-hint vp-hint--compact">По выбранным параметрам задачи не найдены.</div>
              )}

              {/* Single entry: flat task list */}
              {selEntry?.type === 'single' && tasks.length > 0 && (
                <div className="vp-task-list">
                  {pagedTasks.map(t => (
                    <TaskCard key={t.id} task={t} added={addedIds.has(t.id)} onAdd={addToVariant} />
                  ))}
                </div>
              )}

              {/* Group / linked_group: single GroupCard */}
              {selEntry && selEntry.type !== 'single' && tasksTotal > 0 && (
                <div className="vp-task-list">
                  <GroupCard
                    entry={selEntry}
                    groupInstances={pagedGroupInstances}
                    addedIds={addedIds}
                    onAddTask={addToVariant}
                    onAddGroupInstance={addGroupToVariant}
                  />
                </div>
              )}
              {isMobile && selEntry && manualTotalPages > 1 && (
                <MobileListPager
                  page={mobileManualPage}
                  totalPages={manualTotalPages}
                  onChange={(nextPage) => {
                    const normalized = Math.max(1, Math.min(manualTotalPages, nextPage));
                    setMobileManualPage(normalized);
                  }}
                />
              )}
            </>
          )}

          {/* ══ RANDOM ══ */}
          {mode === 'random' && (
            <div className="vp-variant-generator">
              <div className="vp-variant-generator__container">
                <div className="vp-variant-generator__top">
                  <div className="vp-field-group">
                    <label className="vp-field-label">Класс / Уровень</label>
                    <div className="vp-select-wrap">
                      <select className="vp-select-field" value={randLevel?.level || ''}
                        onChange={e => {
                          const l = allLevels.find(x => x.level === e.target.value) || null;
                          setRandLevel(l);
                          setRandSubject(null);
                        }}>
                        <option value="">Выберите уровень</option>
                        {allLevels.map(l => <option key={l.level} value={l.level}>{l.level_rus || l.level}</option>)}
                      </select>
                      <span className="vp-select-icon" aria-hidden="true">▾</span>
                    </div>
                  </div>

                  <div className="vp-field-group">
                    <label className="vp-field-label">Предмет</label>
                    <div className="vp-select-wrap">
                      <select className="vp-select-field" disabled={!randLevel || randomSubjects.length === 0}
                        value={randSubject?.subject_short || ''}
                        onChange={e => {
                          const s = randomSubjects.find(x => x.subject_short === e.target.value) || null;
                          setRandSubject(s);
                        }}>
                        <option value="">
                          {randLevel && randomSubjects.length === 0 ? 'Нет доступных предметов' : 'Выберите предмет'}
                        </option>
                        {randomSubjects.map(s => (
                          <option key={s.subject_short} value={s.subject_short}>{s.subject_name}</option>
                        ))}
                      </select>
                      <span className="vp-select-icon" aria-hidden="true">▾</span>
                    </div>
                  </div>
                </div>

                <div className="vp-variant-generator__body">
                  <div className="vp-variant-generator__header">
                    <div className="vp-eyebrow">Генерация варианта</div>
                    <h3 className="vp-variant-generator__title">Создание варианта</h3>
                    <p className="vp-variant-generator__subtitle">Выберите параметры, источник заданий и формат варианта.</p>
                  </div>

                  <div className="vp-variant-generator__controls">
                    <div className="vp-control-row vp-control-row--split">
                      <div className="vp-control-block">
                        <div className="vp-control-caption">Источник заданий</div>
                        <label className="vp-gen-toggle">
                          <input
                            type="checkbox"
                            checked={onlyFipiVariant}
                            onChange={e => setOnlyFipiVariant(e.target.checked)}
                          />
                          <span className="vp-gen-toggle-track">
                            <span className="vp-gen-toggle-thumb" />
                          </span>
                          <span className="vp-gen-toggle-text">Только задания ФИПИ</span>
                        </label>
                      </div>

                      <div className="vp-control-block vp-control-block--compact">
                        <div className="vp-control-caption">Формат варианта</div>
                        <div className="vp-segmented" role="tablist" aria-label="Формат варианта">
                          <button
                            type="button"
                            className={`vp-segmented-item${randFormat === 'part1' ? ' vp-segmented-item--active' : ''}`}
                            onClick={() => setRandFormat('part1')}
                            disabled={randLoading !== null || isInfEgeRandom}
                          >
                            Часть 1
                          </button>
                          <button
                            type="button"
                            className={`vp-segmented-item${randFormat === 'part2' ? ' vp-segmented-item--active' : ''}`}
                            onClick={() => setRandFormat('part2')}
                            disabled={randLoading !== null || isInfEgeRandom}
                          >
                            Часть 2
                          </button>
                          <button
                            type="button"
                            className={`vp-segmented-item${randFormat === 'full' ? ' vp-segmented-item--active' : ''}`}
                            onClick={() => setRandFormat('full')}
                            disabled={randLoading !== null}
                          >
                            Полный
                          </button>
                        </div>
                      </div>
                    </div>

                    {randLevel?.level === 'oge' && randSubject?.subject_short === 'inf' && (
                      (() => {
                        const block13 = randSubtopicsByTask.find(row => row.task_number === 13);
                        const subs = block13?.subtopics || [];
                        if (subs.length < 2) return null;
                        return (
                          <div className="vp-oge13-wrap">
                            <div className="vp-oge13-title">Тип задания 13</div>
                            <div className="vp-oge13-options">
                              {subs.map(st => (
                                <label key={st.id} className="vp-oge13-option">
                                  <input
                                    type="radio"
                                    name="vp-oge13"
                                    checked={randOgeInf13SubtopicId === st.id}
                                    onChange={() => setRandOgeInf13SubtopicId(st.id)}
                                  />
                                  <span>{st.title}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    )}

                    <div className="vp-control-row">
                      <button
                        className="vp-generate-btn"
                        onClick={() => generateRandom(selectedRandomPart)}
                        disabled={!canGenerateRandom}
                      >
                        {randLoading !== null ? <><span className="vp-spin" /> {randomCtaText}</> : randomCtaText}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══ MY VARIANTS ══ */}
          {mode === 'mine' && (
            <div className="vp-my-wrap">
              <ResponsivePageHeader
                className="vp-my-header"
                title="Мои варианты"
                subtitle="Быстрый доступ к урокам, ДЗ и экспорту"
                right={(
                  <div className="vp-my-header-actions">
                    <div className="vp-view-segmented">
                      <button
                        type="button"
                        className={`vp-view-segmented-btn${myViewMode === 'cover' ? ' vp-view-segmented-btn--active' : ''}`}
                        onClick={() => setMyViewMode('cover')}
                      >
                        С обложкой
                      </button>
                      <button
                        type="button"
                        className={`vp-view-segmented-btn${myViewMode === 'minimal' ? ' vp-view-segmented-btn--active' : ''}`}
                        onClick={() => setMyViewMode('minimal')}
                      >
                        Минимальный
                      </button>
                    </div>
                    <button className="vp-my-refresh" type="button" onClick={loadMyVariants} disabled={myVariantsLoading} title="Обновить список">
                      {myVariantsLoading ? 'Обновление…' : '↻'}
                    </button>
                  </div>
                )}
              />

              <VariantsToolbar
                mySearch={mySearch}
                setMySearch={setMySearch}
                mySubjectFilter={mySubjectFilter}
                setMySubjectFilter={setMySubjectFilter}
                myLevelFilter={myLevelFilter}
                setMyLevelFilter={setMyLevelFilter}
                mySort={mySort}
                setMySort={setMySort}
                mySubjects={mySubjects}
                myLevels={myLevels}
              />

              {myVariantsError && <div className="vp-hint vp-hint--err">{myVariantsError}</div>}
              {myVariantsLoading && !myVariants.length && (
                <div className="vp-hint vp-hint--compact">Загрузка вариантов…</div>
              )}
              {!myVariantsLoading && !myVariantsError && myVariants.length === 0 && (
                <div className="vp-hint vp-hint--compact">У вас пока нет сохранённых вариантов.</div>
              )}
              {!myVariantsLoading && !myVariantsError && myVariants.length > 0 && visibleMyVariants.length === 0 && (
                <div className="vp-hint vp-hint--compact">Ничего не найдено по текущим фильтрам.</div>
              )}

              <div className={`vp-my-list${myViewMode === 'minimal' ? ' vp-my-list--minimal' : ''}`}>
                {visibleMyVariants.map(v => (
                  <VariantCard
                    key={v.id || `${v.variant_id}-${v.created_at}`}
                    variant={v}
                    viewMode={myViewMode}
                    onStartLesson={startLessonForVariant}
                    onAssignHomework={assignVariantAsHomework}
                    onDuplicate={handleDuplicateVariant}
                    formatSavedAt={formatSavedAt}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT panel — variant ── */}
        {mode !== 'mine' && <div className="vp-right">
          <div 
            className="vp-resizer" 
            onMouseDown={() => {
              isResizing.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }} 
          />
          <div className="vp-panel-top">
            <div className="vp-panel-title-row">
              <span className="vp-panel-title">Вариант</span>
              {variantItems.length > 0 && (
                <span className="vp-panel-count">{variantItems.length} задач</span>
              )}
              {variantItems.length > 0 && !clearConfirm && (
                <button className="vp-clear-btn" onClick={() => setClearConfirm(true)}>Очистить</button>
              )}
            </div>

            {clearConfirm && (
              <div className="vp-clear-confirm">
                <span>Удалить все {variantItems.length} задач?</span>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="vp-confirm-yes" onClick={() => { setVariantItems([]); setClearConfirm(false); }}>Да</button>
                  <button className="vp-confirm-no" onClick={() => setClearConfirm(false)}>Отмена</button>
                </div>
              </div>
            )}

            <input className="vp-name-input" placeholder="Название варианта…"
              value={variantName} onChange={e => setVariantName(e.target.value)} />
          </div>

          <div className="vp-panel-body">
            {variantItems.length === 0 ? (
              <div className="vp-panel-empty">
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                <div>Добавьте задачи<br />из списка слева</div>
              </div>
            ) : (
              <>
                <div className="vp-items-list"
                  onDragLeave={() => setDragOverIdx(null)}
                  onDragEnd={() => { dragFrom.current = null; setDragOverIdx(null); }}>
                  {variantItems.map((item, idx) => (
                    <VariantItem key={item.id} item={item} index={idx}
                      onRemove={removeFromVariant}
                      onDragStart={handleDragStart}
                      onDragEnter={handleDragEnter}
                      onDrop={handleDrop}
                      dragging={dragOverIdx === idx && dragFrom.current !== null && dragFrom.current !== idx}
                    />
                  ))}
                </div>
                <div className="vp-summary">
                  <span>Всего задач: {variantItems.length}</span>
                </div>
              </>
            )}
          </div>

          <div className="vp-panel-footer">
            <button className="vp-save-btn" onClick={saveVariant} disabled={!variantItems.length || saving}>
              {saving ? 'Сохранение…' : 'Сохранить вариант'}
            </button>
            {savedVariantId && lv && subj && (
              <div className="vp-panel-ghost-row">
                <a href={`${VARIANT_PREVIEW_SITE}/${lv.level}/${subj.subject_short}/variant/${savedVariantId}/`}
                  target="_blank" rel="noopener noreferrer" className="vp-ghost-btn">
                  Предпросмотр
                </a>
                <a href={`${GEN}/api/${lv.level}/${subj.subject_short}/variant/${savedVariantId}/pdf/`}
                  target="_blank" rel="noopener noreferrer" className="vp-ghost-btn">
                  Экспорт PDF
                </a>
              </div>
            )}
          </div>
        </div>}
      </div>

      {assignModalOpen && (
        <div className="modal-overlay" onClick={closeAssignModal}>
          <div className="modal modal--assign-variant" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Задать как ДЗ</span>
              <button className="modal-close" onClick={closeAssignModal} disabled={assignSaving}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="vp-assign-variant-caption">
                Вариант: #{assignTargetVariant?.variant_id}
              </div>
              {assignError && <div className="modal-error">{assignError}</div>}

              <div className="modal-field">
                <label>Комментарий учителя</label>
                <textarea
                  placeholder="Напишите инструкцию для учеников..."
                  value={assignComment}
                  onChange={e => setAssignComment(e.target.value)}
                />
              </div>

              <div className="modal-field">
                <label>Срок сдачи</label>
                <input
                  type="datetime-local"
                  value={assignDeadline}
                  onChange={e => setAssignDeadline(e.target.value)}
                />
              </div>

              <div className="modal-field">
                <label>Кому задать</label>
                {assignStudentsLoading ? (
                  <div className="vp-assign-empty">Загрузка учеников и групп...</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div className="vp-assign-empty" style={{ marginBottom: 6 }}>Индивидуальные ученики</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {assignStudents
                          .filter(s => isIndividualStudent(s) && isActiveStudent(s))
                          .map((s) => {
                            const sid = Number(s.student ?? s.id);
                            const key = `student:${sid}`;
                            const selected = assignTargetKeys.includes(key);
                            return (
                              <button
                                type="button"
                                key={key}
                                onClick={() => toggleAssignTargetKey(key)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: 999,
                                  border: `1px solid ${selected ? '#4F6EF7' : '#dbe3f0'}`,
                                  background: selected ? '#EEF2FF' : '#fff',
                                  color: selected ? '#1e40af' : '#334155',
                                  cursor: 'pointer',
                                  fontSize: 12,
                                  fontWeight: selected ? 700 : 500,
                                }}
                              >
                                {`${s.name || s.student_name || ''} ${s.surname || s.student_surname || ''}`.trim() || `Ученик #${sid}`}
                              </button>
                            );
                          })}
                      </div>
                    </div>
                    <div>
                      <div className="vp-assign-empty" style={{ marginBottom: 6 }}>Группы</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {assignGroups.map((g) => {
                          const key = `group:${g.id}`;
                          const selected = assignTargetKeys.includes(key);
                          return (
                            <button
                              type="button"
                              key={key}
                              onClick={() => toggleAssignTargetKey(key)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 999,
                                border: `1px solid ${selected ? '#4F6EF7' : '#dbe3f0'}`,
                                background: selected ? '#EEF2FF' : '#fff',
                                color: selected ? '#1e40af' : '#334155',
                                cursor: 'pointer',
                                fontSize: 12,
                                fontWeight: selected ? 700 : 500,
                              }}
                            >
                              {g.group_name || `Группа #${g.id}`}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {!!assignTargetKeys.length && (
                      <div className="vp-assign-empty">Выбрано пунктов: {assignTargetKeys.length}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button className="modal-btn modal-btn--cancel" onClick={closeAssignModal} disabled={assignSaving}>
                  Отмена
                </button>
                <button
                  className="modal-btn modal-btn--save"
                  onClick={submitAssignHomework}
                  disabled={assignSaving || assignStudentsLoading}
                >
                  {assignSaving ? 'Назначение...' : 'Задать ДЗ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {lessonModalOpen && (
        <div className="modal-overlay" onClick={closeLessonModal}>
          <div className="modal modal--assign-variant" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Начать урок</span>
              <button className="modal-close" onClick={closeLessonModal} disabled={lessonStarting}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-form">
              <div className="vp-assign-variant-caption">
                Вариант: #{lessonTargetVariant?.variant_id}
              </div>
              {lessonError && <div className="modal-error">{lessonError}</div>}

              <div className="modal-field">
                <label>Кому провести урок</label>
                {lessonLoading ? (
                  <div className="vp-assign-empty">Загрузка учеников и групп...</div>
                ) : (
                  <select value={lessonTargetKey} onChange={e => setLessonTargetKey(e.target.value)}>
                    <option value="">— выберите ученика или группу —</option>
                    <optgroup label="Индивидуальные ученики">
                      {lessonStudents
                        .filter(s => isIndividualStudent(s) && isActiveStudent(s))
                        .map(s => (
                          <option key={`lesson-student-${s.id}`} value={`student:${s.id}`}>
                            {(() => {
                              const fullName = `${s.name || s.student_name || ''} ${s.surname || s.student_surname || ''}`.trim();
                              const loginHint = s.student_username || s.student_email || '';
                              if (fullName && loginHint) return `${fullName} (${loginHint})`;
                              return fullName || `Ученик #${s.student || s.id}`;
                            })()}
                          </option>
                        ))}
                    </optgroup>
                    <optgroup label="Группы">
                      {lessonGroups.map(g => (
                        <option key={`lesson-group-${g.id}`} value={`group:${g.id}`}>
                          {g.group_name || `Группа #${g.id}`}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                )}
              </div>

              <div className="modal-actions">
                <button className="modal-btn modal-btn--cancel" onClick={closeLessonModal} disabled={lessonStarting}>
                  Отмена
                </button>
                <button
                  className="modal-btn modal-btn--save"
                  onClick={submitStartLesson}
                  disabled={lessonStarting || lessonLoading}
                >
                  {lessonStarting ? 'Запуск...' : 'Начать урок'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
