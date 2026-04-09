import { useEffect, useRef, useCallback, useState } from 'react';
import useSignaling from './useSignaling';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 4,
};

function log(...a) { console.log('%c[rtc]', 'color:#0af', ...a); }
function warn(...a) { console.warn('%c[rtc]', 'color:#fa0', ...a); }

export default function useWebRTC(roomId, initiator, localStream, wsUrl) {
  const pcRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const [peerLeft, setPeerLeft] = useState(false);

  const remoteDescSet = useRef(false);
  const iceCandidateQ = useRef([]);
  const wsReady = useRef(false);
  const earlyMessages = useRef([]);

  const busyRef = useRef(false);
  const sigQueue = useRef([]);

  const sendRef = useRef(null);
  const send = useCallback((msg) => sendRef.current?.(msg), []);

  /* ── Send "call-ended" before hanging up ─────────────────── */
  const sendCallEnded = useCallback(() => {
    send({ type: 'call-ended' });
  }, [send]);

  /* ── Offer ───────────────────────────────────────────────── */
  const sendOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;

    if (pc.signalingState === 'have-local-offer' && pc.localDescription) {
      log('re-sending existing offer');
      send({ type: 'offer', payload: pc.localDescription });
      return;
    }
    if (pc.signalingState !== 'stable') return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', payload: pc.localDescription });
      log('offer sent');
    } catch (e) {
      warn('createOffer failed', e);
    }
  }, [send]);

  /* ── Process one signaling message ───────────────────────── */
  const processMsg = useCallback(async (msg) => {
    const pc = pcRef.current;
    if (!pc) {
      earlyMessages.current.push(msg);
      log('queued', msg.type, '(PC not ready)');
      return;
    }

    try {
      switch (msg.type) {
        case 'offer': {
          if (pc.signalingState !== 'stable') {
            warn('ignoring offer in state', pc.signalingState);
            return;
          }
          log('offer received');
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          remoteDescSet.current = true;
          await flushIce(pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ type: 'answer', payload: answer });
          log('answer sent');
          break;
        }
        case 'answer': {
          log('answer received, sigState =', pc.signalingState);
          if (pc.signalingState !== 'have-local-offer') {
            warn('ignoring answer in state', pc.signalingState);
            return;
          }
          await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
          remoteDescSet.current = true;
          log('remote desc set, connectionState =', pc.connectionState);
          await flushIce(pc);
          break;
        }
        case 'ice-candidate': {
          if (!msg.payload) return;
          if (remoteDescSet.current && pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch(() => {});
          } else {
            iceCandidateQ.current.push(msg.payload);
          }
          break;
        }
        default:
          break;
      }
    } catch (e) {
      warn('processMsg error:', msg.type, e);
    }
  }, [send]);

  async function flushIce(pc) {
    const q = iceCandidateQ.current.splice(0);
    for (const c of q) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  }

  /* ── Serialized signaling dispatcher ─────────────────────── */
  const drainQueue = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (sigQueue.current.length > 0) {
        const m = sigQueue.current.shift();
        switch (m.type) {
          case '__ws_ready__': {
            wsReady.current = true;
            const cs = pcRef.current?.connectionState;
            log('WS ready, initiator =', initiator, 'pc.conn =', cs);
            if (initiator && cs !== 'connected' && cs !== 'connecting') {
              await sendOffer();
            }
            break;
          }
          case 'peer_joined': {
            log('peer joined');
            setPeerLeft(false);
            const cs2 = pcRef.current?.connectionState;
            if (initiator && cs2 !== 'connected' && cs2 !== 'connecting') {
              await sendOffer();
            }
            break;
          }
          case 'peer_left':
            log('peer left');
            setPeerLeft(true);
            break;
          case 'call-ended':
            log('remote peer ended call');
            setPeerLeft('ended');
            break;
          default:
            await processMsg(m);
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [initiator, sendOffer, processMsg]);

  const onSignaling = useCallback((msg) => {
    sigQueue.current.push(msg);
    drainQueue();
  }, [drainQueue]);

  /* ── Signaling WS ────────────────────────────────────────── */
  const { send: wsSend, connected: wsConnected } = useSignaling(roomId, onSignaling, wsUrl);

  useEffect(() => { sendRef.current = wsSend; }, [wsSend]);

  /* ── PeerConnection lifecycle ────────────────────────────── */
  useEffect(() => {
    if (!localStream) return;

    log('creating PC, initiator =', initiator);
    const pc = new RTCPeerConnection(ICE_CONFIG);
    pcRef.current = pc;
    remoteDescSet.current = false;
    iceCandidateQ.current = [];

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    const remote = new MediaStream();
    setRemoteStream(remote);

    pc.ontrack = (ev) => {
      log('ontrack', ev.track.kind, 'id=', ev.track.id,
          'streams=', ev.streams.length,
          'remote tracks before=', remote.getTracks().length);
      if (!remote.getTrackById(ev.track.id)) {
        remote.addTrack(ev.track);
      }
      log('remote tracks after=', remote.getTracks().length);
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) send({ type: 'ice-candidate', payload: ev.candidate });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      log('state →', s);
      setConnectionState(s);

      if (s === 'failed' && initiator) {
        log('connection failed → restarting ICE');
        pc.restartIce();
        sendOffer();
      }
    };

    pc.oniceconnectionstatechange = () => {
      log('ice →', pc.iceConnectionState);
    };

    if (earlyMessages.current.length) {
      log('draining', earlyMessages.current.length, 'early messages');
      const msgs = earlyMessages.current.splice(0);
      (async () => {
        for (const m of msgs) await processMsg(m);
      })();
    }

    if (initiator && wsReady.current) {
      log('WS was ready, sending offer');
      sendOffer();
    }

    return () => {
      log('closing PC');
      pc.close();
      pcRef.current = null;
    };
  }, [localStream, initiator, send, sendOffer, processMsg]);

  return { remoteStream, connectionState, peerLeft, wsConnected, sendCallEnded };
}
