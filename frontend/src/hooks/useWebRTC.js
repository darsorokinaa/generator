import { useEffect, useRef, useCallback, useState } from 'react';
import useSignaling from './useSignaling';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export default function useWebRTC(roomId, initiator, localStream) {
  const pcRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const [iceState, setIceState] = useState('new');

  // Queue ICE candidates that arrive before remote description is set
  const iceCandidateQueue = useRef([]);
  const remoteDescSet = useRef(false);

  const sendRef = useRef(null);
  const send = useCallback((msg) => sendRef.current?.(msg), []);

  const handleSignalingMessage = useCallback(async (msg) => {
    const pc = pcRef.current;
    if (!pc) return;

    if (msg.type === 'offer') {
      // Only accept offer when stable (avoid duplicate offers)
      if (pc.signalingState !== 'stable') {
        console.warn('[webrtc] ignoring offer in state', pc.signalingState);
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      remoteDescSet.current = true;
      // Flush queued ICE candidates
      for (const c of iceCandidateQueue.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      iceCandidateQueue.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'answer', payload: answer });

    } else if (msg.type === 'answer') {
      // Only accept answer when we've sent an offer
      if (pc.signalingState !== 'have-local-offer') {
        console.warn('[webrtc] ignoring answer in state', pc.signalingState);
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(msg.payload));
      remoteDescSet.current = true;
      // Flush queued ICE candidates
      for (const c of iceCandidateQueue.current) {
        await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
      }
      iceCandidateQueue.current = [];

    } else if (msg.type === 'ice-candidate') {
      if (!msg.payload) return;
      if (remoteDescSet.current) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.payload)).catch(console.warn);
      } else {
        // Buffer until remote description is ready
        iceCandidateQueue.current.push(msg.payload);
      }
    }
  }, [send]);

  const { send: _send } = useSignaling(roomId, handleSignalingMessage);

  useEffect(() => {
    sendRef.current = _send;
  }, [_send]);

  useEffect(() => {
    if (!localStream) return;

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    remoteDescSet.current = false;
    iceCandidateQueue.current = [];

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    const remoteMediaStream = new MediaStream();
    setRemoteStream(remoteMediaStream);

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => remoteMediaStream.addTrack(track));
    };

    pc.onicecandidate = (event) => {
      send({ type: 'ice-candidate', payload: event.candidate });
    };

    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);

    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => send({ type: 'offer', payload: pc.localDescription }))
        .catch(console.error);
    }

    return () => {
      pc.close();
      pcRef.current = null;
    };
  }, [localStream, initiator, send]);

  return { remoteStream, connectionState, iceState };
}
