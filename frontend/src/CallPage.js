import { useState } from 'react';
import Room from './components/Room';

/**
 * Standalone страница видеозвонка — открывается как iframe из генератора.
 * URL: /call/?room=<roomId>&name=<userName>&role=teacher|student&sig=<wsUrl>
 */
export default function CallPage() {
  const params = new URLSearchParams(window.location.search);
  const roomId     = params.get('room')   || '';
  const userName   = params.get('name')   || 'Участник';
  const role       = params.get('role')   || 'student';
  const targetName = params.get('target') || '';
  const wsUrl      = params.get('sig')    || '';

  const initiator = role === 'teacher';

  const [left, setLeft] = useState(false);

  if (!roomId) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
        height:'100vh', background:'#111114', color:'rgba(255,255,255,.4)',
        fontFamily:'Montserrat,sans-serif', fontSize:14 }}>
        room не указан
      </div>
    );
  }

  if (left) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
        height:'100vh', background:'#111114', color:'rgba(255,255,255,.5)',
        fontFamily:'Montserrat,sans-serif', fontSize:15, flexDirection:'column', gap:16 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.42 9.47 19.79 19.79 0 0 1 1.35 .82 2 2 0 0 1 3.32-1.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.3 6.73"/>
          <line x1="23" y1="1" x2="1" y2="23"/>
        </svg>
        <span>Звонок завершён</span>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', overflow: 'hidden' }}>
      <Room
        roomId={roomId}
        initiator={initiator}
        userName={userName}
        targetName={targetName}
        lessonType={role === 'teacher' ? 'individual' : 'student'}
        wsUrl={wsUrl || undefined}
        onLeave={() => setLeft(true)}
      />
    </div>
  );
}
