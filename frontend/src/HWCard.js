import React, { useState } from 'react';
import { Check, ArrowRight, Bell, Calendar } from 'lucide-react';

/* ── Status palette ───────────────────────────────────────────────────────── */
const PAL = {
  overdue:  { bg: '#FCEBEB', stroke: '#E24B4A', label: 'Просрочено',  lc: '#A32D2D' },
  review:   { bg: '#FAEEDA', stroke: '#EF9F27', label: 'На проверке', lc: '#854F0B' },
  done:     { bg: '#EAF3DE', stroke: '#639922', label: 'Выполнено',   lc: '#3B6D11' },
  assigned: { bg: '#E6F1FB', stroke: '#378ADD', label: 'Активно',     lc: '#185FA5' },
  draft:    { bg: '#F1EFE8', stroke: '#888780', label: 'Черновик',    lc: '#5F5E5A' },
};

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function shortDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((target - today) / 86400000);
  if (diff < 0)   return { text: `${Math.abs(diff)} дн назад`, urgent: true };
  if (diff === 0) return { text: 'Сегодня',  urgent: true };
  if (diff === 1) return { text: 'Завтра',   urgent: true };
  return { text: `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`, urgent: false };
}

function progColor(ratio) {
  if (ratio < 0.3) return 'var(--gu-red-text)';
  if (ratio < 0.7) return 'var(--gu-amber-text)';
  return 'var(--gu-text-primary)';
}

function avgColor(score) {
  if (score < 50) return 'var(--gu-red-text)';
  if (score < 75) return 'var(--gu-amber-text)';
  return 'var(--gu-green-text)';
}

/* ── Abstract SVG cover pattern ───────────────────────────────────────────── */
export function CoverPattern({ id = 0, status = 'assigned' }) {
  const { bg, stroke } = PAL[status] || PAL.assigned;
  const W = 320, H = 130;

  // Seed-based pseudo-random (deterministic per card id)
  const rnd = (n, min = 0, max = 1) => {
    const x = Math.sin(id * 127.1 + n * 311.7) * 43758.5453;
    return min + (x - Math.floor(x)) * (max - min);
  };

  // Two concentric-circle clusters (positioned partially off-canvas for depth)
  const clusters = [
    {
      cx: rnd(1, W * 0.55, W * 1.05),
      cy: rnd(2, -H * 0.25, H * 0.45),
      radii: [rnd(3, 28, 48), rnd(4, 52, 72), rnd(5, 76, 98), rnd(6, 100, 122)],
    },
    {
      cx: rnd(7, -W * 0.15, W * 0.32),
      cy: rnd(8, H * 0.55, H * 1.25),
      radii: [rnd(9, 18, 32), rnd(10, 38, 52), rnd(11, 56, 70)],
    },
  ];

  // 5 flowing horizontal wave paths
  const waves = Array.from({ length: 5 }, (_, i) => {
    const baseY = rnd(20 + i * 4, 8, H - 8);
    const amp   = rnd(21 + i * 4, 7, 22);
    const phase = rnd(22 + i * 4, 0, 1);
    const y = (t) => baseY + Math.sin((phase + t) * Math.PI * 2) * amp;
    return `M 0 ${y(0)} C ${W * 0.25} ${y(0)}, ${W * 0.33} ${y(0.2)}, ${W * 0.5} ${y(0.33)} S ${W * 0.75} ${y(0.55)}, ${W} ${y(0.67)}`;
  });

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
      <rect width={W} height={H} fill={bg} />
      {clusters.map((cl, ci) =>
        cl.radii.map((r, ri) => (
          <circle key={`${ci}-${ri}`} cx={cl.cx} cy={cl.cy} r={r}
            fill="none" stroke={stroke} strokeWidth={1.1} opacity={0.22} />
        ))
      )}
      {waves.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={1.2} opacity={0.2} />
      ))}
    </svg>
  );
}

/* ── Avatar initials helper ───────────────────────────────────────────────── */
function initials(name = '', surname = '') {
  return `${name.charAt(0)}${surname.charAt(0)}`.toUpperCase() || '?';
}

const AVATAR_COLORS = ['#667eea', '#f7b733', '#43cea2', '#ee9ca7', '#2193b0', '#c94b4b', '#fc5c7d', '#11998e'];
function avatarColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* ── HWCard — horizontal card (matches Genurok expanded style) ────────────── */
export function HWCard({
  id = 0,
  title,
  group,
  deadline,
  description,
  status = 'assigned',
  progress = { submitted: 0, total: 0 },
  avgScore,
  notSubmitted = [],   // [{name, surname}]
  onCheck,
  onOpen,
  onRemind,
  onExtend,
  onAssign,
  onManage,
}) {
  const pal     = PAL[status] || PAL.assigned;
  const dl      = deadline ? shortDate(deadline) : null;
  const ratio   = progress.total > 0 ? progress.submitted / progress.total : 0;
  const pct     = Math.round(ratio * 100);
  const pc      = progColor(ratio);
  const isDraft = status === 'draft';

  const showCheck  = status === 'review'   && !!onCheck;
  const showRemind = status === 'assigned' && progress.submitted < progress.total && !!onRemind;
  const showExtend = (status === 'overdue' || status === 'assigned') && !!onExtend;
  const showAssign = isDraft && !!onAssign;

  const actionBtns = [
    showAssign && { label: 'Назначить', fn: onAssign, primary: true },
    showCheck  && { label: 'Проверить', fn: onCheck },
    onOpen     && { label: 'Открыть',   fn: onOpen },
    showRemind && { label: 'Напомнить', fn: onRemind },
    showExtend && { label: 'Продлить',  fn: onExtend },
  ].filter(Boolean);

  const MAX_AVATARS = 3;
  const visibleNS  = notSubmitted.slice(0, MAX_AVATARS);
  const extraNS    = notSubmitted.length - MAX_AVATARS;

  return (
    <div className="hwc-card" style={{ borderLeftColor: pal.stroke }}>

      {/* ── Abstract cover — left strip, full height ─────────────────── */}
      <div className="hwc-card-cover">
        <CoverPattern id={id} status={status} />
      </div>

      {/* ── Content area ─────────────────────────────────────────────── */}
      <div className="hwc-card-content">

      {/* ── Main body ─────────────────────────────────────────────────── */}
      <div className="hwc-card-main">

        {/* Left: title + description + meta */}
        <div className="hwc-card-left">
          <div className="hwc-card-title-row">
            <span className="hwc-card-title">{title}</span>
            {pal.label && (
              <span className="hwc-card-badge" style={{ color: pal.lc, background: pal.bg }}>
                {pal.label}
              </span>
            )}
            {onManage && (
              <button
                className="hwc-card-manage-btn"
                onClick={e => { e.stopPropagation(); onManage(); }}
                title="Управление ДЗ"
              >···</button>
            )}
          </div>

          {description && (
            <div className="hwc-card-desc">{description}</div>
          )}

          {/* Meta: group · deadline · not-submitted */}
          <div className="hwc-card-meta-row">
            {group && <span className="hwc-meta-item">{group}</span>}
            {dl && (
              <span className="hwc-meta-item">
                · Срок:&nbsp;
                <span style={{ color: dl.urgent ? 'var(--gu-amber-text)' : 'inherit', fontWeight: 500 }}>
                  {dl.text}
                </span>
              </span>
            )}
            {!isDraft && notSubmitted.length > 0 && (
              <span className="hwc-meta-item hwc-meta-ns">
                · Не сдали:
                <span className="hwc-avatars">
                  {visibleNS.map((s, i) => {
                    const ini = initials(s.name, s.surname);
                    return (
                      <span
                        key={i}
                        className="hwc-avatar"
                        style={{ background: avatarColor(ini), zIndex: MAX_AVATARS - i }}
                        title={`${s.name} ${s.surname}`.trim()}
                      >
                        {ini}
                      </span>
                    );
                  })}
                  {extraNS > 0 && (
                    <span className="hwc-avatar hwc-avatar--extra">+{extraNS}</span>
                  )}
                </span>
              </span>
            )}
            {isDraft && (
              <span className="hwc-meta-item" style={{ color: 'var(--gu-text-tertiary)', fontStyle: 'italic' }}>
                · Не назначено
              </span>
            )}
          </div>
        </div>

        {/* Right: big number + bar + percentage + score */}
        {!isDraft && (
          <div className="hwc-card-right">
            <div className="hwc-card-prog-big" style={{ color: pc }}>
              {progress.submitted}&nbsp;/&nbsp;{progress.total}
            </div>
            <div className="hwc-card-bar">
              <div className="hwc-card-bar-fill" style={{ width: `${pct}%`, background: pc }} />
            </div>
            <div className="hwc-card-right-sub">
              <span style={{ color: 'var(--gu-text-secondary)' }}>{pct}%&nbsp;сдали</span>
              {avgScore != null && (
                <span style={{ color: avgColor(avgScore), fontWeight: 500 }}>ø&nbsp;{avgScore}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Action buttons ─────────────────────────────────────────────── */}
      {actionBtns.length > 0 && (
        <div className="hwc-card-actions">
          {actionBtns.map((btn, i) => (
            <button
              key={i}
              className={`hwc-card-act${btn.primary ? ' hwc-card-act--publish' : ''}`}
              onClick={e => { e.stopPropagation(); btn.fn && btn.fn(); }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
      </div>{/* /hwc-card-content */}
    </div>
  );
}

/* ── CompactHWCard — table row with small cover thumbnail ─────────────────── */
export function CompactHWCard({
  id = 0,
  title,
  group,
  deadline,
  status = 'assigned',
  progress = { submitted: 0, total: 0 },
  avgScore,
  onCheck,
  onOpen,
  onRemind,
  onExtend,
}) {
  const [hovered, setHovered] = useState(false);
  const pal   = PAL[status] || PAL.assigned;
  const dl    = deadline ? shortDate(deadline) : null;
  const ratio = progress.total > 0 ? progress.submitted / progress.total : 0;
  const pc    = progColor(ratio);

  const showCheck  = status === 'review'   && !!onCheck;
  const showRemind = status === 'assigned' && progress.submitted < progress.total && !!onRemind;
  const showExtend = (status === 'overdue' || status === 'assigned') && !!onExtend;

  return (
    <div
      className={`hwc-row${hovered ? ' hwc-row--hover' : ''}`}
      style={{ borderLeftColor: pal.stroke }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpen && onOpen()}
    >
      {/* Mini cover */}
      <div className="hwc-row-thumb">
        <CoverPattern id={id} status={status} />
      </div>

      {/* Title + group */}
      <div className="hwc-row-info">
        <span className="hwc-row-title">{title}</span>
        <span className="hwc-row-group">{group}</span>
      </div>

      {/* Status badge */}
      {pal.label && status !== 'assigned' && (
        <span className="hwc-row-badge" style={{ color: pal.lc, background: pal.bg }}>
          {pal.label}
        </span>
      )}

      {/* Progress */}
      <div className="hwc-row-col">
        <span style={{ color: pc, fontFamily: 'monospace', fontWeight: 500, fontSize: 12 }}>
          {progress.submitted}/{progress.total}
        </span>
        <div className="hwc-row-bar">
          <div className="hwc-row-bar-fill" style={{ width: `${Math.round(ratio * 100)}%`, background: pc }} />
        </div>
      </div>

      {/* Deadline */}
      <div className="hwc-row-col">
        {dl
          ? <span style={{ fontSize: 12, color: dl.urgent ? 'var(--gu-amber-text)' : 'var(--gu-text-secondary)' }}>{dl.text}</span>
          : <span style={{ color: 'var(--gu-text-tertiary)' }}>—</span>}
      </div>

      {/* Score */}
      <div className="hwc-row-col">
        {avgScore != null
          ? <span style={{ fontSize: 12, color: avgColor(avgScore), fontWeight: 500 }}>ø {avgScore}</span>
          : <span style={{ color: 'var(--gu-text-tertiary)' }}>—</span>}
      </div>

      {/* Actions */}
      <div className="hwc-row-actions" onClick={e => e.stopPropagation()}>
        <span className={`hwc-row-dots${hovered ? ' hwc-row-dots--hidden' : ''}`}>···</span>
        <div className={`hwc-row-btns${hovered ? ' hwc-row-btns--show' : ''}`}>
          {showCheck && (
            <button className="hwc-row-btn" onClick={() => onCheck()} title="Проверить">
              <Check size={13} strokeWidth={2} />
            </button>
          )}
          {onOpen && (
            <button className="hwc-row-btn" onClick={() => onOpen()} title="Открыть">
              <ArrowRight size={13} strokeWidth={2} />
            </button>
          )}
          {showRemind && (
            <button className="hwc-row-btn" onClick={() => onRemind()} title="Напомнить">
              <Bell size={13} strokeWidth={2} />
            </button>
          )}
          {showExtend && (
            <button className="hwc-row-btn" onClick={() => onExtend()} title="Продлить">
              <Calendar size={13} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
