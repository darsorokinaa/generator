import React, { useState, useEffect, useCallback } from 'react';
import { CoverPattern } from './HWCard';

/* ────────────────────────────────────────────────────────────────────────────
   Shared helpers
──────────────────────────────────────────────────────────────────────────── */
const RU_MONTHS_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const RU_MONTHS_SHORT = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];

function fmtShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]}`;
}
function fmtFull(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function ini(name='', surname='') {
  return `${name.charAt(0)}${surname.charAt(0)}`.toUpperCase() || '?';
}

const AVATAR_COLORS = ['#667eea','#f7b733','#43cea2','#ee9ca7','#2193b0','#c94b4b','#fc5c7d','#11998e'];
function avColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const ASGN_LABEL = {
  sent: 'Не сдал', submitted: 'Сдал', reviewing: 'На проверке',
  reviewed: 'Проверено', revision: 'На доработке',
  overdue: 'Просрочено', cancelled: 'Отменено',
};
const ASGN_COLOR = {
  sent:      { bg: '#f1f5f9', color: '#64748b' },
  submitted: { bg: '#f0fdf4', color: '#15803d' },
  reviewing: { bg: '#fffbeb', color: '#b45309' },
  reviewed:  { bg: '#f0fdf4', color: '#15803d' },
  revision:  { bg: '#fef2f2', color: '#b91c1c' },
  overdue:   { bg: '#fef2f2', color: '#b91c1c' },
  cancelled: { bg: '#f1f5f9', color: '#94a3b8' },
};

function Badge({ label, bg, color }) {
  return (
    <span style={{ display:'inline-block', padding:'2px 9px', borderRadius:20,
      fontSize:11, fontWeight:600, background:bg, color }}>
      {label}
    </span>
  );
}

function Avatar({ name, surname, size = 28 }) {
  const key = ini(name, surname);
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:avColor(key),
      color:'#fff', fontSize:size*0.38, fontWeight:700, display:'flex',
      alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      {key}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   MiniCalendar — used in HWExtendPanel
──────────────────────────────────────────────────────────────────────────── */
function MiniCalendar({ value, onChange }) {
  const today = new Date();
  const [view, setView] = useState(() => value ? new Date(value) : new Date());
  const year  = view.getFullYear();
  const month = view.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = today.toISOString().split('T')[0];
  const cells = [...Array(firstDow).fill(null),
                 ...Array.from({length: daysInMonth}, (_, i) => i + 1)];

  return (
    <div className="hw-cal">
      <div className="hw-cal-nav">
        <button className="hw-cal-nav-btn" onClick={() => setView(new Date(year, month-1, 1))}>‹</button>
        <span className="hw-cal-title">{RU_MONTHS_FULL[month]} {year}</span>
        <button className="hw-cal-nav-btn" onClick={() => setView(new Date(year, month+1, 1))}>›</button>
      </div>
      <div className="hw-cal-dow">
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="hw-cal-grid">
        {cells.map((day, i) => {
          if (!day) return <span key={i} className="hw-cal-empty" />;
          const iso = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const isPast = iso < todayStr;
          const isToday = iso === todayStr;
          const isSel = iso === value;
          return (
            <button key={i} disabled={isPast}
              className={`hw-cal-day${isPast?' hw-cal-day--past':''}${isToday?' hw-cal-day--today':''}${isSel?' hw-cal-day--sel':''}`}
              onClick={() => onChange(iso)}>
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Pill toggle helper
──────────────────────────────────────────────────────────────────────────── */
function Pills({ options, value, onChange, multi = false }) {
  const vals = multi ? (Array.isArray(value) ? value : []) : [value];
  return (
    <div className="hw-pills">
      {options.map(o => {
        const active = vals.includes(o.value);
        return (
          <button key={o.value}
            className={`hw-pill${active ? ' hw-pill--on' : ''}`}
            onClick={() => {
              if (multi) {
                onChange(active ? vals.filter(v => v !== o.value) : [...vals, o.value]);
              } else {
                onChange(o.value);
              }
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   1. HWDrawer — right-side detail panel (560px)
════════════════════════════════════════════════════════════════════════════ */
export function HWDrawer({ hw, hwAsgns = [], onClose, onRemindAll, onOpenStudent }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 210);
  }, [onClose]);

  // close on Escape
  useEffect(() => {
    const h = e => e.key === 'Escape' && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);

  const title   = hw.homework_title || hw.title || `Вариант ${hw.variant_id}`;
  const subject = hw.subject || '—';
  const dl      = hw.deadline ? fmtFull(hw.deadline) : null;

  const sorted = [...hwAsgns].sort((a, b) => {
    const ord = { reviewing:0, submitted:1, revision:2, overdue:3, sent:4, reviewed:5, cancelled:6 };
    return (ord[a.status]??9) - (ord[b.status]??9);
  });

  const submitted   = hwAsgns.filter(a => !['sent','overdue','cancelled'].includes(a.status)).length;
  const total       = hw.assigned_count || hwAsgns.length;
  const toReview    = hwAsgns.filter(a => ['submitted','reviewing'].includes(a.status)).length;
  const scored      = hwAsgns.filter(a => a.score != null);
  const avg         = scored.length ? (scored.reduce((s,a) => s+parseFloat(a.score),0)/scored.length).toFixed(1) : null;
  const pct         = total > 0 ? Math.round(submitted/total*100) : 0;
  const pcColor     = pct >= 80 ? '#639922' : pct >= 50 ? '#EF9F27' : '#E24B4A';

  return (
    <>
      {/* Backdrop */}
      <div className={`hw-drawer-backdrop${visible ? ' hw-drawer-backdrop--show' : ''}`}
        onClick={close} />
      {/* Panel */}
      <div className={`hw-drawer${visible ? ' hw-drawer--open' : ''}`}>

        {/* ── Cover header ── */}
        <div className="hw-drawer-cover">
          <CoverPattern id={hw.id || 0} status="assigned" />
          <div className="hw-drawer-cover-content">
            <button className="hw-drawer-close" onClick={close}>×</button>
            <div className="hw-drawer-cover-title">{title}</div>
            <div className="hw-drawer-cover-meta">
              <span className="hw-drawer-cover-badge">{subject}</span>
              {dl && <span className="hw-drawer-cover-dl">· Срок: {dl}</span>}
            </div>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="hw-drawer-body">

          {/* Description */}
          {hw.text && (
            <div className="hw-drawer-section">
              <div className="hw-drawer-desc">{hw.text}</div>
            </div>
          )}

          {/* Metric cards */}
          <div className="hw-drawer-section">
            <div className="hw-drawer-metrics">
              <div className="hw-drawer-metric">
                <div className="hw-drawer-metric-val">{submitted}/{total}</div>
                <div className="hw-drawer-metric-lbl">Сдали</div>
              </div>
              <div className="hw-drawer-metric">
                <div className="hw-drawer-metric-val" style={{ color: avg ? '#378ADD' : '#94a3b8' }}>
                  {avg ?? '—'}
                </div>
                <div className="hw-drawer-metric-lbl">Средний балл</div>
              </div>
              <div className="hw-drawer-metric">
                <div className="hw-drawer-metric-val" style={{ color: toReview > 0 ? '#EF9F27' : '#94a3b8' }}>
                  {toReview}
                </div>
                <div className="hw-drawer-metric-lbl">На проверке</div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="hw-drawer-bar">
              <div className="hw-drawer-bar-fill" style={{ width:`${pct}%`, background:pcColor }} />
            </div>
          </div>

          {/* Student list */}
          {sorted.length > 0 && (
            <div className="hw-drawer-section">
              <div className="hw-drawer-section-title">Ученики</div>
              <div className="hw-drawer-students">
                {sorted.map(a => {
                  const sc = ASGN_COLOR[a.status] || ASGN_COLOR.sent;
                  const needsAction = ['submitted','reviewing'].includes(a.status);
                  const name = `${a.student_name||''} ${a.student_surname||''}`.trim() || 'Ученик';
                  return (
                    <div key={a.id} className="hw-drawer-student">
                      <Avatar name={a.student_name} surname={a.student_surname} size={30} />
                      <div className="hw-drawer-student-name">{name}</div>
                      <Badge label={ASGN_LABEL[a.status]||a.status} bg={sc.bg} color={sc.color} />
                      <div className="hw-drawer-student-date">{a.submitted_at ? fmtShort(a.submitted_at) : '—'}</div>
                      <div className="hw-drawer-student-score">
                        {a.score != null ? <strong>{a.score}</strong> : '—'}
                      </div>
                      <button
                        className="hw-drawer-student-act"
                        onClick={() => onOpenStudent && onOpenStudent(a)}>
                        {needsAction ? 'Оценить' : 'Смотреть'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Fixed footer ── */}
        <div className="hw-drawer-footer">
          {toReview > 0 && (
            <button className="hw-drawer-btn hw-drawer-btn--primary"
              onClick={() => { const a = sorted.find(x => ['submitted','reviewing'].includes(x.status)); a && onOpenStudent && onOpenStudent(a); }}>
              Проверить всё
            </button>
          )}
          <button className="hw-drawer-btn"
            onClick={() => { close(); onRemindAll && onRemindAll(hw); }}>
            Напомнить несдавшим
          </button>
          <button className="hw-drawer-btn" onClick={close}>Закрыть</button>
        </div>
      </div>
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   2. HWRemindPanel — inline panel below card
════════════════════════════════════════════════════════════════════════════ */
export function HWRemindPanel({ hw, hwAsgns = [], onClose, onSend }) {
  const notSubmitted = hwAsgns.filter(a => ['sent','overdue'].includes(a.status));
  const [tab,      setTab]      = useState('all');   // 'all' | 'manual'
  const [selected, setSelected] = useState([]);
  const [channels, setChannels] = useState(['diary']);
  const [text,     setText]     = useState('');
  const [when,     setWhen]     = useState('now');   // 'now' | 'schedule'
  const [schedDate,setSchedDate]= useState('');
  const [schedTime,setSchedTime]= useState('09:00');
  const [sending,  setSending]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const [visible,  setVisible]  = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const TEMPLATE = `Напоминаю о задании «${hw.homework_title || hw.title || 'ДЗ'}». Срок сдачи ${hw.deadline ? fmtShort(hw.deadline) : 'скоро'}. Пожалуйста, выполните и сдайте вовремя.`;
  const count = tab === 'all' ? notSubmitted.length : selected.length;

  const toggleStudent = (id) => setSelected(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id]);

  const handleSend = async () => {
    if (sending || sent) return;
    setSending(true);
    await onSend?.({ hw, students: tab==='all'?notSubmitted:notSubmitted.filter(a=>selected.includes(a.id)), channels, text: text||TEMPLATE, when, schedDate, schedTime });
    setSent(true);
    setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, 800);
  };

  const CHANNEL_OPTS = [
    { value:'diary',    label:'Дневник' },
    { value:'telegram', label:'Telegram' },
    { value:'email',    label:'Email' },
  ];

  return (
    <div className={`hw-inline-panel${visible ? ' hw-inline-panel--show' : ''}`}>
      <div className="hw-inline-panel-head">
        <span className="hw-inline-panel-title">Напомнить ученикам</span>
        <button className="hw-inline-panel-close" onClick={onClose}>×</button>
      </div>

      {/* Row 1: Who */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Кому</label>
        <div className="hw-pills">
          <button className={`hw-pill${tab==='all'?' hw-pill--on':''}`} onClick={() => setTab('all')}>
            Всем несдавшим <span className="hw-pill-count">{notSubmitted.length}</span>
          </button>
          <button className={`hw-pill${tab==='manual'?' hw-pill--on':''}`} onClick={() => setTab('manual')}>
            Выбрать вручную
          </button>
        </div>
        {tab === 'manual' && (
          <div className="hw-remind-checkboxes">
            {notSubmitted.map(a => {
              const name = `${a.student_name||''} ${a.student_surname||''}`.trim();
              return (
                <label key={a.id} className="hw-remind-check-row">
                  <input type="checkbox" checked={selected.includes(a.id)}
                    onChange={() => toggleStudent(a.id)} />
                  <Avatar name={a.student_name} surname={a.student_surname} size={22} />
                  <span>{name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Row 2: Channel */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Канал</label>
        <Pills options={CHANNEL_OPTS} value={channels} onChange={setChannels} multi />
      </div>

      {/* Row 3: Message */}
      <div className="hw-remind-row">
        <div className="hw-remind-label-row">
          <label className="hw-remind-label">Текст</label>
          <button className="hw-template-btn" onClick={() => setText(TEMPLATE)}>Вставить шаблон</button>
        </div>
        <div className="hw-textarea-wrap">
          <textarea className="hw-textarea" rows={3} maxLength={200}
            placeholder="Напоминаю о задании…"
            value={text} onChange={e => setText(e.target.value)} />
          <span className="hw-char-count">{text.length}/200</span>
        </div>
      </div>

      {/* Row 4: When */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Когда</label>
        <Pills options={[{value:'now',label:'Сейчас'},{value:'schedule',label:'Запланировать'}]}
          value={when} onChange={setWhen} />
        {when === 'schedule' && (
          <div className="hw-sched-row">
            <input type="date" className="hw-input-sm" value={schedDate}
              onChange={e => setSchedDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
            <input type="time" className="hw-input-sm" value={schedTime}
              onChange={e => setSchedTime(e.target.value)} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="hw-inline-panel-footer">
        <button className={`hw-inline-btn hw-inline-btn--primary${sent?' hw-inline-btn--sent':''}`}
          onClick={handleSend} disabled={sending||sent}>
          {sent ? '✓ Отправлено' : sending ? '…' : 'Отправить'}
        </button>
        <span className="hw-remind-hint">Будет отправлено {count} ученик{count===1?'у':count<5?'ам':'ам'}</span>
        <button className="hw-inline-btn" onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   3. HWExtendPanel — inline deadline extension panel
════════════════════════════════════════════════════════════════════════════ */
export function HWExtendPanel({ hw, onClose, onApply }) {
  const today = new Date();

  const [selDate,  setSelDate]  = useState('');
  const [selTime,  setSelTime]  = useState('23:59');
  const [notify,   setNotify]   = useState(true);
  const [visible,  setVisible]  = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const QUICK_OPTS = [
    { label:'+1 день',   days:1 },
    { label:'+3 дня',    days:3 },
    { label:'+1 неделя', days:7 },
    { label:'+2 недели', days:14 },
  ];

  const applyQuick = (days) => {
    const base = hw.deadline ? new Date(hw.deadline) : today;
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    setSelDate(next.toISOString().split('T')[0]);
  };

  const newDeadlinePreview = selDate
    ? `${parseInt(selDate.split('-')[2])} ${RU_MONTHS_SHORT[parseInt(selDate.split('-')[1])-1]}, ${selTime}`
    : null;

  const handleApply = async () => {
    if (!selDate || applying) return;
    setApplying(true);
    const iso = `${selDate}T${selTime}:00`;
    await onApply?.({ hw, newDeadline: iso, notifyStudents: notify });
    setVisible(false);
    setTimeout(onClose, 200);
  };

  return (
    <div className={`hw-inline-panel${visible ? ' hw-inline-panel--show' : ''}`}>
      <div className="hw-inline-panel-head">
        <span className="hw-inline-panel-title">Продлить дедлайн</span>
        <button className="hw-inline-panel-close" onClick={onClose}>×</button>
      </div>

      {/* Current deadline */}
      {hw.deadline && (
        <div className="hw-extend-current">
          <span className="hw-extend-current-lbl">Сейчас:</span>
          <span className="hw-extend-current-val">{fmtFull(hw.deadline)}</span>
        </div>
      )}

      {/* Quick options */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Быстрый выбор</label>
        <div className="hw-pills">
          {QUICK_OPTS.map(o => (
            <button key={o.days} className="hw-pill" onClick={() => applyQuick(o.days)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mini calendar */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Точная дата</label>
        <MiniCalendar value={selDate} onChange={setSelDate} />
      </div>

      {/* Time */}
      <div className="hw-remind-row">
        <label className="hw-remind-label">Время</label>
        <div className="hw-time-row">
          <input className="hw-time-inp" type="number" min={0} max={23}
            value={selTime.split(':')[0]}
            onChange={e => setSelTime(`${e.target.value.padStart(2,'0')}:${selTime.split(':')[1]}`)} />
          <span className="hw-time-sep">:</span>
          <input className="hw-time-inp" type="number" min={0} max={59}
            value={selTime.split(':')[1]}
            onChange={e => setSelTime(`${selTime.split(':')[0]}:${e.target.value.padStart(2,'0')}`)} />
        </div>
      </div>

      {/* Notify toggle */}
      <div className="hw-remind-row hw-remind-row--toggle">
        <label className="hw-toggle-label">
          <div className={`hw-toggle${notify ? ' hw-toggle--on' : ''}`}
            onClick={() => setNotify(n => !n)}>
            <div className="hw-toggle-thumb" />
          </div>
          <span>Уведомить учеников о продлении</span>
        </label>
      </div>

      {/* Footer */}
      <div className="hw-inline-panel-footer">
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2 }}>
          <button className="hw-inline-btn hw-inline-btn--primary"
            onClick={handleApply} disabled={!selDate || applying}>
            {applying ? '…' : 'Применить'}
          </button>
          {newDeadlinePreview && (
            <span className="hw-extend-preview">Новый дедлайн: {newDeadlinePreview}</span>
          )}
        </div>
        <button className="hw-inline-btn" onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   4. HWManageDrawer — full editing drawer (720px)
════════════════════════════════════════════════════════════════════════════ */
export function HWManageDrawer({ hw, hwAsgns = [], onClose, onSave, onDelete }) {
  const [visible, setVisible] = useState(false);
  const [dirty,   setDirty]   = useState(false);
  const [showDelConfirm, setShowDelConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving,   setSaving]  = useState(false);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(onClose, 210);
  }, [onClose]);

  useEffect(() => {
    const h = e => e.key === 'Escape' && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);

  // Form state (pre-filled from hw)
  const [title,     setTitle]     = useState(hw.homework_title || hw.title || '');
  const [descr,     setDescr]     = useState(hw.text || '');
  const [subject,   setSubject]   = useState(hw.subject || '');
  const [deadline,  setDeadline]  = useState(hw.deadline ? hw.deadline.split('T')[0] : '');
  const [dlTime,    setDlTime]    = useState(hw.deadline ? hw.deadline.substring(11,16) : '23:59');
  const [autoRemind,setAutoRemind]= useState(false);
  const [remindDays,setRemindDays]= useState(['1']);
  const [remindCh,  setRemindCh]  = useState(['diary']);
  const [gradeOn,   setGradeOn]   = useState(false);
  const [maxScore,  setMaxScore]  = useState('100');
  const [showResult,setShowResult]= useState(true);
  const [isHidden,  setIsHidden]  = useState(false);
  const [noLate,    setNoLate]    = useState(false);
  const [allowComm, setAllowComm] = useState(true);

  const mark = () => setDirty(true);

  const handleSave = async () => {
    setSaving(true);
    await onSave?.({ title, text: descr, subject, deadline:`${deadline}T${dlTime}:00`, autoRemind, remindDays, remindChannels: remindCh, gradeOn, maxScore, showResult, isHidden, noLate, allowComm });
    setSaving(false);
    close();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete?.(hw);
    setDeleting(false);
    close();
  };

  const CHANNEL_OPTS = [
    { value:'diary', label:'Дневник' },
    { value:'telegram', label:'Telegram' },
    { value:'email', label:'Email' },
  ];
  const REMIND_DAYS_OPTS = [
    { value:'1', label:'1 день' },
    { value:'3', label:'3 дня' },
    { value:'7', label:'1 неделя' },
  ];

  return (
    <>
      <div className={`hw-manage-backdrop${visible ? ' hw-manage-backdrop--show' : ''}`}
        onClick={() => { if (!dirty) close(); }} />

      <div className={`hw-manage-drawer${visible ? ' hw-manage-drawer--open' : ''}`}>

        {/* Header */}
        <div className="hw-manage-header">
          <span className="hw-manage-header-title">Управление заданием</span>
          <button className="hw-drawer-close" onClick={close}>×</button>
        </div>

        {/* Unsaved banner */}
        {dirty && (
          <div className="hw-manage-unsaved">
            <span>Есть несохранённые изменения</span>
            <div style={{ display:'flex', gap:8 }}>
              <button className="hw-inline-btn hw-inline-btn--primary hw-inline-btn--sm" onClick={handleSave}>Сохранить</button>
              <button className="hw-inline-btn hw-inline-btn--sm" onClick={() => { setDirty(false); close(); }}>Выйти</button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="hw-manage-body">

          {/* ── Основное ── */}
          <div className="hw-manage-section">
            <div className="hw-manage-section-title">Основное</div>
            <div className="hw-manage-field">
              <label className="hw-manage-label">Название</label>
              <input className="hw-manage-input" value={title}
                onChange={e => { setTitle(e.target.value); mark(); }} />
            </div>
            <div className="hw-manage-field">
              <label className="hw-manage-label">Описание</label>
              <textarea className="hw-manage-textarea" rows={4} value={descr}
                onChange={e => { setDescr(e.target.value); mark(); }} />
            </div>
            <div className="hw-manage-field">
              <label className="hw-manage-label">Предмет</label>
              <input className="hw-manage-input" value={subject}
                onChange={e => { setSubject(e.target.value); mark(); }} />
            </div>
          </div>

          {/* ── Дедлайн ── */}
          <div className="hw-manage-section">
            <div className="hw-manage-section-title">Дедлайн и расписание</div>
            <div className="hw-manage-field">
              <label className="hw-manage-label">Дата и время</label>
              <div className="hw-time-row">
                <input type="date" className="hw-manage-input" style={{ flex:1 }} value={deadline}
                  onChange={e => { setDeadline(e.target.value); mark(); }} min={new Date().toISOString().split('T')[0]} />
                <input className="hw-time-inp" type="number" min={0} max={23}
                  value={dlTime.split(':')[0]}
                  onChange={e => { setDlTime(`${e.target.value.padStart(2,'0')}:${dlTime.split(':')[1]}`); mark(); }} />
                <span className="hw-time-sep">:</span>
                <input className="hw-time-inp" type="number" min={0} max={59}
                  value={dlTime.split(':')[1]}
                  onChange={e => { setDlTime(`${dlTime.split(':')[0]}:${e.target.value.padStart(2,'0')}`); mark(); }} />
              </div>
            </div>
            <div className="hw-manage-field hw-manage-field--toggle">
              <label className="hw-toggle-label">
                <div className={`hw-toggle${autoRemind?' hw-toggle--on':''}`}
                  onClick={() => { setAutoRemind(v=>!v); mark(); }}>
                  <div className="hw-toggle-thumb" />
                </div>
                <span>Напомнить автоматически</span>
              </label>
            </div>
            {autoRemind && (
              <>
                <div className="hw-manage-field">
                  <label className="hw-manage-label">За сколько</label>
                  <Pills options={REMIND_DAYS_OPTS} value={remindDays} onChange={v => { setRemindDays(v); mark(); }} multi />
                </div>
                <div className="hw-manage-field">
                  <label className="hw-manage-label">Канал</label>
                  <Pills options={CHANNEL_OPTS} value={remindCh} onChange={v => { setRemindCh(v); mark(); }} multi />
                </div>
              </>
            )}
          </div>

          {/* ── Оценивание ── */}
          <div className="hw-manage-section">
            <div className="hw-manage-section-title">Оценивание</div>
            <div className="hw-manage-field hw-manage-field--toggle">
              <label className="hw-toggle-label">
                <div className={`hw-toggle${gradeOn?' hw-toggle--on':''}`}
                  onClick={() => { setGradeOn(v=>!v); mark(); }}>
                  <div className="hw-toggle-thumb" />
                </div>
                <span>Выставлять оценки</span>
              </label>
            </div>
            {gradeOn && (
              <div className="hw-manage-field">
                <label className="hw-manage-label">Максимальный балл</label>
                <input className="hw-manage-input" type="number" style={{ width:100 }} value={maxScore}
                  onChange={e => { setMaxScore(e.target.value); mark(); }} />
              </div>
            )}
            <div className="hw-manage-field hw-manage-field--toggle">
              <label className="hw-toggle-label">
                <div className={`hw-toggle${showResult?' hw-toggle--on':''}`}
                  onClick={() => { setShowResult(v=>!v); mark(); }}>
                  <div className="hw-toggle-thumb" />
                </div>
                <span>Показывать результат ученику сразу</span>
              </label>
            </div>
          </div>

          {/* ── Доступность ── */}
          <div className="hw-manage-section">
            <div className="hw-manage-section-title">Доступность</div>
            {[
              [isHidden,  setIsHidden,  'Скрыть задание (черновик)'],
              [noLate,    setNoLate,    'Запретить сдачу после дедлайна'],
              [allowComm, setAllowComm, 'Разрешить комментарии'],
            ].map(([val, set, lbl], i) => (
              <div key={i} className="hw-manage-field hw-manage-field--toggle">
                <label className="hw-toggle-label">
                  <div className={`hw-toggle${val?' hw-toggle--on':''}`}
                    onClick={() => { set(v=>!v); mark(); }}>
                    <div className="hw-toggle-thumb" />
                  </div>
                  <span>{lbl}</span>
                </label>
              </div>
            ))}
          </div>

          {/* Spacer for footer */}
          <div style={{ height: 80 }} />
        </div>

        {/* Delete confirmation banner */}
        {showDelConfirm && (
          <div className="hw-manage-del-confirm">
            <span>Задание будет удалено безвозвратно для всех учеников</span>
            <div style={{ display:'flex', gap:8 }}>
              <button className="hw-inline-btn hw-inline-btn--danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? '…' : 'Да, удалить'}
              </button>
              <button className="hw-inline-btn" onClick={() => setShowDelConfirm(false)}>Отмена</button>
            </div>
          </div>
        )}

        {/* Fixed footer */}
        <div className="hw-manage-footer">
          <button className="hw-manage-del-btn" onClick={() => setShowDelConfirm(true)}>
            Удалить задание
          </button>
          <div style={{ display:'flex', gap:10 }}>
            <button className="hw-inline-btn" onClick={close}>Отмена</button>
            <button className="hw-inline-btn hw-inline-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? '…' : 'Сохранить изменения'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
