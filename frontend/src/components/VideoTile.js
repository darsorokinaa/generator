import { useEffect, useRef } from 'react';

export default function VideoTile({
  stream,
  label = '',
  muted = false,
  isLocal = false,
  noVideo = false,
  micOff = false,
  waiting = false,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  const initials = label
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  return (
    <div style={s.tile}>
      {/* Always in DOM — only hidden via CSS to preserve srcObject */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        style={{
          ...s.video,
          transform: isLocal ? 'scaleX(-1)' : 'none',
          display: (noVideo || waiting || !stream) ? 'none' : 'block',
        }}
      />

      {/* Avatar — shown when no video */}
      {(noVideo || waiting || !stream) && (
        <div style={s.avatarArea}>
          <div style={s.avatarRing}>
            <div style={s.avatar}>
              {waiting ? (
                <svg width="44" height="44" viewBox="0 0 24 24" fill="rgba(255,255,255,.25)">
                  <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
                </svg>
              ) : (
                <span style={s.initials}>{initials}</span>
              )}
            </div>
          </div>
          {waiting && (
            <p style={s.waitText}>{isLocal ? 'Камера недоступна' : 'Ожидаем подключения…'}</p>
          )}
        </div>
      )}

      {/* Bottom-left name badge */}
      <div style={s.badge}>
        <div style={s.badgeDot(noVideo)} />
        <span style={s.badgeName}>{label}</span>
        {micOff && (
          <div style={s.micOffIcon} title="Микрофон выключен">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28z"/>
              <path d="M14.98 11.17l-6.15-6.15A2.99 2.99 0 0 1 12 2c1.66 0 3 1.34 3 3v6c0 .01-.02.12-.02.17z"/>
              <path d="M4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3a2.7 2.7 0 0 0 .7-.1l1.9 1.9c-.61.28-1.28.44-2 .46C10.01 16.4 7 13.47 7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Camera-off indicator */}
      {noVideo && !waiting && (
        <div style={s.camOffChip}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
          </svg>
          Камера выкл.
        </div>
      )}
    </div>
  );
}

const s = {
  tile: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    background: 'linear-gradient(145deg, #2a2a2e 0%, #1e1e22 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
  },
  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  avatarArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    zIndex: 1,
  },
  avatarRing: {
    padding: 3,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(255,255,255,.12), rgba(255,255,255,.03))',
  },
  avatar: {
    width: 96, height: 96,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #3a3a42, #28282f)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid rgba(255,255,255,.08)',
  },
  initials: {
    fontSize: 34,
    fontWeight: 700,
    color: 'rgba(255,255,255,.7)',
    fontFamily: 'system-ui, sans-serif',
    letterSpacing: '-1px',
  },
  waitText: {
    margin: 0,
    fontSize: 12,
    color: 'rgba(255,255,255,.3)',
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 500,
    letterSpacing: '.3px',
  },
  badge: {
    position: 'absolute',
    bottom: 12, left: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(0,0,0,.6)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    borderRadius: 8,
    padding: '4px 10px 4px 8px',
    zIndex: 2,
  },
  badgeDot: (noVideo) => ({
    width: 6, height: 6,
    borderRadius: '50%',
    background: noVideo ? '#FF453A' : '#34C759',
    flexShrink: 0,
    boxShadow: noVideo ? '0 0 0 2px rgba(255,69,58,.25)' : '0 0 0 2px rgba(52,199,89,.25)',
  }),
  badgeName: {
    fontSize: 12,
    fontWeight: 600,
    color: 'rgba(255,255,255,.9)',
    fontFamily: "'Montserrat', sans-serif",
    letterSpacing: '.2px',
  },
  micOffIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#FF453A',
    flexShrink: 0,
    marginLeft: 2,
  },
  camOffChip: {
    position: 'absolute',
    top: 12, right: 12,
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    fontWeight: 600,
    color: '#FF6B6B',
    fontFamily: "'Montserrat', sans-serif",
    background: 'rgba(255,59,48,.15)',
    border: '1px solid rgba(255,59,48,.25)',
    borderRadius: 6,
    padding: '3px 8px',
    zIndex: 2,
    backdropFilter: 'blur(8px)',
  },
};
