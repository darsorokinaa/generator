import { useState, useEffect, useCallback, useRef } from 'react';
import useWebRTC from '../hooks/useWebRTC';
import VideoTile from './VideoTile';
import Controls from './Controls';

export default function Room({ roomId, initiator = false, userName = '', targetName = '', lessonType = 'student', onLeave }) {
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [mediaError, setMediaError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  /* ── Media ─────────────────────────────────────────────────────── */
  useEffect(() => {
    let stream;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(s => { stream = s; setLocalStream(s); })
      .catch(() => setMediaError('Нет доступа к камере или микрофону.\nПроверьте разрешения браузера.'));
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  /* ── Call timer ─────────────────────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const formatTime = (sec) => {
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const { remoteStream } = useWebRTC(roomId, initiator, localStream);

  /* ── Controls ───────────────────────────────────────────────────── */
  const toggleMic = useCallback(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMicOn(v => !v);
  }, [localStream]);

  const toggleCam = useCallback(() => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOn(v => !v);
  }, [localStream]);

  const hangUp = useCallback(() => {
    localStream?.getTracks().forEach(t => t.stop());
    onLeave?.();
  }, [localStream, onLeave]);

  /* ── Error screen ───────────────────────────────────────────────── */
  if (mediaError) {
    return (
      <div style={s.center}>
        <div style={s.errorBox}>
          <div style={s.errorIcon}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="#FF453A">
              <path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
            </svg>
          </div>
          <p style={s.errorTitle}>Нет доступа к камере</p>
          <p style={s.errorText}>{mediaError}</p>
          <button style={s.retryBtn} onClick={() => window.location.reload()}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  const hasRemote = !!remoteStream;

  return (
    <div style={s.room}>

      {/* Top bar */}
      <div style={s.topBar}>
        <div style={s.roomInfo}>
          <div style={s.liveChip}>
            <div style={s.liveDot} />
            LIVE
          </div>
          {lessonType === 'group' && (
            <div style={s.typeChip}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
              Группа
            </div>
          )}
          {targetName && (
            <span style={s.targetName}>{targetName}</span>
          )}
        </div>
        <div style={s.timer}>{formatTime(elapsed)}</div>
      </div>

      {/* Video grid */}
      <div style={s.grid}>

        {/* Remote / waiting placeholder */}
        <VideoTile
          stream={remoteStream}
          label={targetName || (initiator ? 'Ученик' : 'Учитель')}
          muted={false}
          isLocal={false}
          waiting={!hasRemote}
        />

        {/* Local */}
        <VideoTile
          stream={localStream}
          label={userName || 'Вы'}
          muted
          isLocal
          noVideo={!camOn}
          micOff={!micOn}
        />
      </div>

      {/* Controls */}
      <Controls
        micOn={micOn}
        camOn={camOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onHangUp={hangUp}
      />
    </div>
  );
}

const livePulse = {
  animation: 'livePulse 2s ease-in-out infinite',
};

const F = {
  mono: "'Unbounded', sans-serif",
  body: "'Montserrat', sans-serif",
};

const s = {
  room: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    maxHeight: '100%',
    background: '#111114',
    overflow: 'hidden',
    fontFamily: F.body,
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 28px',
    background: 'rgba(0,0,0,.5)',
    borderBottom: '1px solid rgba(255,255,255,.06)',
    flexShrink: 0,
    boxSizing: 'border-box',
  },
  roomInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: 1,
  },
  liveChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'rgba(255,59,48,.15)',
    border: '1px solid rgba(255,59,48,.3)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 9,
    fontWeight: 800,
    fontFamily: F.mono,
    color: '#FF453A',
    letterSpacing: '1.5px',
    flexShrink: 0,
  },
  liveDot: {
    width: 5, height: 5,
    borderRadius: '50%',
    background: '#FF453A',
    ...livePulse,
  },
  typeChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'rgba(99,179,237,.15)',
    border: '1px solid rgba(99,179,237,.3)',
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 9,
    fontWeight: 700,
    fontFamily: F.mono,
    color: '#63B3ED',
    letterSpacing: '1px',
    flexShrink: 0,
  },
  targetName: {
    fontSize: 13,
    fontWeight: 700,
    fontFamily: F.body,
    color: 'rgba(255,255,255,.8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  timer: {
    fontSize: 15,
    fontWeight: 700,
    fontFamily: F.mono,
    color: 'rgba(255,255,255,.5)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '2px',
    flexShrink: 0,
  },
  grid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    padding: '10px 14px 12px',
    overflow: 'hidden',
    minHeight: 0,
    boxSizing: 'border-box',
  },
  center: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    background: '#111114',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    padding: '36px 40px',
    borderRadius: 20,
    background: 'rgba(255,255,255,.04)',
    border: '1px solid rgba(255,255,255,.08)',
    maxWidth: 320,
    textAlign: 'center',
  },
  errorIcon: {
    width: 64, height: 64,
    borderRadius: '50%',
    background: 'rgba(255,59,48,.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  errorTitle: {
    margin: 0,
    fontSize: 17,
    fontWeight: 700,
    fontFamily: F.body,
    color: '#fff',
  },
  errorText: {
    margin: 0,
    color: 'rgba(255,255,255,.45)',
    fontFamily: F.body,
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-line',
  },
  retryBtn: {
    marginTop: 6,
    padding: '10px 24px',
    borderRadius: 10,
    border: 'none',
    background: '#0A84FF',
    color: '#fff',
    fontWeight: 700,
    fontFamily: F.body,
    cursor: 'pointer',
    fontSize: 13,
  },
};
