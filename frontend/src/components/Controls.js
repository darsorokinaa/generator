export default function Controls({ micOn, camOn, onToggleMic, onToggleCam, onHangUp }) {
  return (
    <div style={s.bar}>
      <div style={s.group}>
        <CtrlBtn on={micOn} onClick={onToggleMic}
          label={micOn ? 'Звук' : 'Без звука'}
          icon={micOn ? <IconMic /> : <IconMicOff />}
        />
        <CtrlBtn on={camOn} onClick={onToggleCam}
          label={camOn ? 'Видео' : 'Без видео'}
          icon={camOn ? <IconCam /> : <IconCamOff />}
        />
      </div>

      <button style={s.leave} onClick={onHangUp}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24 11.36 11.36 0 0 0 3.57.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1.02L6.62 10.79z"/>
        </svg>
        Завершить
      </button>
    </div>
  );
}

function CtrlBtn({ on, label, onClick, icon }) {
  return (
    <button
      style={s.btn(on)}
      onClick={onClick}
      title={label}
    >
      <div style={s.iconWrap(on)}>
        {icon}
      </div>
      <span style={s.label(on)}>{label}</span>
    </button>
  );
}

/* ---- Icons ---- */
const IconMic = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
  </svg>
);
const IconMicOff = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28z"/>
    <path d="M14.98 11.17l-6.15-6.15A2.99 2.99 0 0 1 12 2c1.66 0 3 1.34 3 3v6c0 .01-.02.12-.02.17z"/>
    <path d="M4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3a2.7 2.7 0 0 0 .7-.1l1.9 1.9c-.61.28-1.28.44-2 .46C10.01 16.4 7 13.47 7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
  </svg>
);
const IconCam = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
  </svg>
);
const IconCamOff = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.13 0 .24-.03.35-.08L19.73 21 21 19.73 3.27 2z"/>
  </svg>
);

/* ---- Styles ---- */
const s = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: 'rgba(18,18,22,.95)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderTop: '1px solid rgba(255,255,255,.07)',
    minHeight: 76,
    flexShrink: 0,
  },
  group: {
    display: 'flex',
    gap: 8,
  },
  btn: () => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    padding: '0 6px 6px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    borderRadius: 12,
    minWidth: 68,
  }),
  iconWrap: (on) => ({
    width: 44, height: 44,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: on ? 'rgba(255,255,255,.1)' : 'rgba(255,59,48,.18)',
    color: on ? 'rgba(255,255,255,.85)' : '#FF453A',
    transition: 'background .2s, color .2s',
    border: `1px solid ${on ? 'rgba(255,255,255,.08)' : 'rgba(255,69,58,.3)'}`,
  }),
  label: (on) => ({
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'Montserrat', sans-serif",
    color: on ? 'rgba(255,255,255,.45)' : '#FF453A',
    letterSpacing: '.2px',
    whiteSpace: 'nowrap',
  }),
  leave: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 22px',
    borderRadius: 12,
    border: 'none',
    background: 'linear-gradient(135deg, #FF3B30, #D62D23)',
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
    fontFamily: "'Montserrat', sans-serif",
    cursor: 'pointer',
    letterSpacing: '.3px',
    boxShadow: '0 4px 14px rgba(255,59,48,.35)',
  },
};
