import { useState, useEffect, useCallback, useRef } from 'react';
import useWebRTC from '../hooks/useWebRTC';
import Controls from './Controls';

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes livePulse  { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.75)} }
    @keyframes waitPulse  { 0%,100%{transform:scale(1);opacity:.7} 50%{transform:scale(1.08);opacity:1} }
    @keyframes fadeIn     { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
    @keyframes pipIn      { from{opacity:0;transform:scale(.85)} to{opacity:1;transform:scale(1)} }
  `;
  document.head.appendChild(style);
}
injectKeyframes();

function VideoStream({ stream, muted = false, mirror = false, style = {} }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        objectFit: 'cover',
        transform: mirror ? 'scaleX(-1)' : 'none',
        ...style,
      }}
    />
  );
}

function Avatar({ name = '', waiting = false, size = 80, message = '' }) {
  const initials = name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, zIndex: 1 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: 'linear-gradient(135deg, #3a3a4a 0%, #22222c 100%)',
        border: '2px solid rgba(255,255,255,.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: waiting ? 'waitPulse 2.4s ease-in-out infinite' : 'none',
        boxShadow: waiting ? '0 0 0 8px rgba(255,255,255,.04), 0 0 0 16px rgba(255,255,255,.02)' : 'none',
      }}>
        {waiting ? (
          <svg width={size * 0.44} height={size * 0.44} viewBox="0 0 24 24" fill="rgba(255,255,255,.22)">
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
          </svg>
        ) : (
          <span style={{ fontSize: size * 0.38, fontWeight: 700, color: 'rgba(255,255,255,.6)', fontFamily: 'system-ui,sans-serif', letterSpacing: '-1px' }}>
            {initials}
          </span>
        )}
      </div>
      {message && (
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', fontFamily: "'Montserrat',sans-serif", fontWeight: 500 }}>
          {message}
        </span>
      )}
    </div>
  );
}

function NameBadge({ name, micOff = false, noVideo = false }) {
  return (
    <div style={{
      position: 'absolute', bottom: 10, left: 10,
      display: 'flex', alignItems: 'center', gap: 6,
      background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      borderRadius: 8, padding: '4px 10px',
      zIndex: 3,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: noVideo ? '#FF453A' : '#34C759',
        boxShadow: `0 0 0 2px ${noVideo ? 'rgba(255,69,58,.25)' : 'rgba(52,199,89,.25)'}`,
      }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.9)', fontFamily: "'Montserrat',sans-serif", whiteSpace: 'nowrap' }}>
        {name}
      </span>
      {micOff && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="#FF453A" style={{ flexShrink: 0 }}>
          <path d="M4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3a2.7 2.7 0 0 0 .7-.1l1.9 1.9c-.61.28-1.28.44-2 .46C10.01 16.4 7 13.47 7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
          <path d="M14.98 11.17l-6.15-6.15A2.99 2.99 0 0 1 12 2c1.66 0 3 1.34 3 3v6c0 .01-.02.12-.02.17z"/>
        </svg>
      )}
    </div>
  );
}

/* ── Connection state pill ──────────────────────────────── */
function ConnStatePill({ connectionState, wsConnected }) {
  const isGood = connectionState === 'connected' && wsConnected;
  const label =
    connectionState === 'connected' ? (wsConnected ? 'Подключено' : 'WS…') :
    connectionState === 'connecting' ? 'Подключение…' :
    connectionState === 'failed' ? 'Ошибка' :
    connectionState === 'disconnected' ? 'Обрыв связи' :
    connectionState === 'closed' ? 'Закрыто' :
    'Ожидание…';
  const bg = isGood ? 'rgba(52,199,89,.18)' : 'rgba(255,149,0,.18)';
  const color = isGood ? '#34C759' : '#FF9500';
  if (isGood) return null;
  return (
    <div style={{
      position: 'absolute', top: 46, left: '50%', transform: 'translateX(-50%)',
      background: bg, border: `1px solid ${color}40`,
      borderRadius: 6, padding: '3px 10px',
      fontSize: 10, fontWeight: 700, color, zIndex: 12,
      fontFamily: "'Montserrat',sans-serif",
      animation: 'fadeIn .3s ease',
    }}>
      {label}
    </div>
  );
}

export default function Room({
  roomId, initiator = false, userName = '',
  targetName = '', lessonType = 'student', onLeave, wsUrl,
}) {
  const [localStream, setLocalStream]     = useState(null);
  const [micOn, setMicOn]                 = useState(true);
  const [camOn, setCamOn]                 = useState(true);
  const [mediaError, setMediaError]       = useState(null);
  const [elapsed, setElapsed]             = useState(0);
  const [pipHovered, setPipHovered]       = useState(false);
  const startRef                          = useRef(Date.now());

  useEffect(() => {
    let stream;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(s => { stream = s; setLocalStream(s); })
      .catch(() => setMediaError('Нет доступа к камере или микрофону.\nПроверьте разрешения браузера.'));
    return () => stream?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;

  const { remoteStream, connectionState, peerLeft, wsConnected, sendCallEnded } =
    useWebRTC(roomId, initiator, localStream, wsUrl);

  const [remoteHasTracks, setRemoteHasTracks] = useState(false);
  useEffect(() => {
    if (!remoteStream) { setRemoteHasTracks(false); return; }
    const check = () => setRemoteHasTracks(remoteStream.getTracks().length > 0);
    check();
    remoteStream.addEventListener('addtrack', check);
    remoteStream.addEventListener('removetrack', check);
    return () => {
      remoteStream.removeEventListener('addtrack', check);
      remoteStream.removeEventListener('removetrack', check);
    };
  }, [remoteStream]);

  const toggleMic = useCallback(() => {
    localStream?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setMicOn(v => !v);
  }, [localStream]);

  const toggleCam = useCallback(() => {
    localStream?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setCamOn(v => !v);
  }, [localStream]);

  const hangUp = useCallback(() => {
    sendCallEnded();
    localStream?.getTracks().forEach(t => t.stop());
    onLeave?.();
  }, [localStream, onLeave, sendCallEnded]);

  const remoteName = targetName || (initiator ? 'Ученик' : 'Учитель');

  // When remote peer explicitly ended the call → auto-leave after a short delay
  useEffect(() => {
    if (peerLeft !== 'ended') return;
    const timer = setTimeout(() => {
      localStream?.getTracks().forEach(t => t.stop());
      onLeave?.();
    }, 2000);
    return () => clearTimeout(timer);
  }, [peerLeft, localStream, onLeave]);

  if (mediaError) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', background:'#0e0e12' }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, padding:'36px 32px', borderRadius:20, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)', maxWidth:300, textAlign:'center' }}>
          <div style={{ width:64,height:64,borderRadius:'50%',background:'rgba(255,59,48,.1)',display:'flex',alignItems:'center',justifyContent:'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#FF453A">
              <path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
            </svg>
          </div>
          <p style={{ margin:0, fontSize:16, fontWeight:700, color:'#fff', fontFamily:"'Montserrat',sans-serif" }}>Нет доступа к камере</p>
          <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,.4)', fontFamily:"'Montserrat',sans-serif", lineHeight:1.6, whiteSpace:'pre-line' }}>{mediaError}</p>
          <button onClick={() => window.location.reload()} style={{ padding:'10px 24px', borderRadius:10, border:'none', background:'#0A84FF', color:'#fff', fontWeight:700, fontFamily:"'Montserrat',sans-serif", cursor:'pointer', fontSize:13 }}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  const showRemoteVideo = remoteHasTracks && peerLeft !== 'ended';
  const peerDisconnected = peerLeft === true;
  const peerEnded = peerLeft === 'ended';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', background: '#0e0e12',
      overflow: 'hidden', fontFamily: "'Montserrat',sans-serif",
      userSelect: 'none', position: 'relative',
    }}>

      {/* ── Top bar ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px',
        background: 'linear-gradient(to bottom, rgba(0,0,0,.7) 0%, transparent 100%)',
        zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{
            display:'flex', alignItems:'center', gap:5,
            background: peerEnded ? 'rgba(255,255,255,.1)' : 'rgba(255,59,48,.18)',
            border: `1px solid ${peerEnded ? 'rgba(255,255,255,.15)' : 'rgba(255,59,48,.35)'}`,
            borderRadius:6, padding:'3px 8px',
            fontSize:9, fontWeight:800,
            color: peerEnded ? 'rgba(255,255,255,.4)' : '#FF453A',
            letterSpacing:'1.5px',
            fontFamily:"'Unbounded',sans-serif",
          }}>
            {!peerEnded && (
              <div style={{ width:5,height:5,borderRadius:'50%',background:'#FF453A', animation:'livePulse 2s ease-in-out infinite' }} />
            )}
            {peerEnded ? 'ЗАВЕРШЁН' : 'LIVE'}
          </div>
          <span style={{ fontSize:13, fontWeight:600, color:'rgba(255,255,255,.85)' }}>
            {remoteName}
          </span>
        </div>
        <div style={{
          fontSize:14, fontWeight:700, color:'rgba(255,255,255,.55)',
          fontFamily:"'Unbounded',sans-serif", letterSpacing:'2px',
          fontVariantNumeric:'tabular-nums',
        }}>
          {fmt(elapsed)}
        </div>
      </div>

      <ConnStatePill connectionState={connectionState} wsConnected={wsConnected} />

      {/* ── Main video (remote) ── */}
      <div style={{
        flex: 1, position: 'relative', background: '#0e0e12', minHeight: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {showRemoteVideo ? (
          <VideoStream stream={remoteStream} muted={false} />
        ) : peerEnded ? (
          <Avatar name={remoteName} size={72} message="Собеседник завершил звонок" />
        ) : peerDisconnected ? (
          <Avatar name={remoteName} waiting size={72} message="Собеседник отключился…" />
        ) : (
          <Avatar name={remoteName} waiting size={72} message="Ожидаем подключения…" />
        )}
        {showRemoteVideo && <NameBadge name={remoteName} />}
      </div>

      {/* ── Controls bar ── */}
      <div style={{
        position: 'relative', flexShrink: 0,
        background: 'linear-gradient(to top, rgba(0,0,0,.85) 0%, rgba(0,0,0,.5) 100%)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,.06)',
      }}>
        {/* PiP — local video */}
        <div
          style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', right: 12,
            width: pipHovered ? 110 : 90, height: pipHovered ? 148 : 122,
            borderRadius: 12,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,.15)',
            boxShadow: '0 8px 24px rgba(0,0,0,.6)',
            background: '#1a1a20',
            transition: 'width .2s, height .2s, box-shadow .2s',
            cursor: 'default',
            animation: 'pipIn .3s ease',
            zIndex: 20,
          }}
          onMouseEnter={() => setPipHovered(true)}
          onMouseLeave={() => setPipHovered(false)}
        >
          {localStream && camOn ? (
            <VideoStream stream={localStream} muted mirror />
          ) : (
            <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Avatar name={userName || 'Вы'} size={44} />
            </div>
          )}
          <NameBadge name={userName || 'Вы'} micOff={!micOn} noVideo={!camOn} />
        </div>

        <Controls
          micOn={micOn}
          camOn={camOn}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          onHangUp={hangUp}
        />
      </div>

    </div>
  );
}
