import { useEffect, useRef, useState, useCallback } from 'react';
import { 
  collection, doc, setDoc, updateDoc, onSnapshot, query, where, deleteDoc, getDoc, serverTimestamp 
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

export interface Peer {
  id: string;
  name?: string;
  stream: MediaStream;
}

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

export const useWebRTC = (roomId: string, name: string) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [notes, setNotes] = useState('');
  
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const peerConnections = useRef<{ [id: string]: RTCPeerConnection }>({});
  const candidateQueue = useRef<{ [id: string]: any[] }>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const myJoinedAtRef = useRef<number>(Date.now());

  const [peersTempMeta, setPeersTempMeta] = useState<{ [id: string]: { name: string } }>({});
  
  const addPeerStream = useCallback((id: string, stream: MediaStream) => {
    setPeers((prev) => {
      if (prev.find((p) => p.id === id)) return prev;
      return [...prev, { id, stream }];
    });
  }, []);

  const removePeerStream = useCallback((id: string) => {
    setPeers((prev) => prev.filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    if (!roomId) return;

    let initialStream: MediaStream;
    let unsubParticipants: () => void;
    let unsubSignals: () => void;
    let unsubRoom: () => void;

    const init = async (userUid: string) => {
      myUserIdRef.current = userUid;
      myJoinedAtRef.current = Date.now();
      
      try {
        try {
          initialStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
          });
        } catch (err) {
          console.warn("Failed to get both video and audio, trying audio only...", err);
          try {
            initialStream = await navigator.mediaDevices.getUserMedia({
              audio: true,
              video: false
            });
            setIsVideoMuted(true);
          } catch (err2) {
            console.warn("Failed to get audio, trying video only...", err2);
            try {
              initialStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false
              });
              setIsAudioMuted(true);
            } catch (err3) {
              console.error("Failed to get any media devices.", err3);
              initialStream = new MediaStream();
              setIsAudioMuted(true);
              setIsVideoMuted(true);
            }
          }
        }
        
        setLocalStream(initialStream);
        setDisplayStream(initialStream);
        localStreamRef.current = initialStream;

        // Ensure room exists
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) {
          try {
            await setDoc(roomRef, { createdAt: Date.now(), notes: "" });
          } catch (err) {
            // Might have been created concurrently, ignore
          }
        }

        // Listen to notes
        unsubRoom = onSnapshot(roomRef, (snap) => {
          if (snap.exists()) {
            setNotes(snap.data().notes || "");
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `rooms/${roomId}`));

        // Add self to participants
        const participantRef = doc(db, 'rooms', roomId, 'participants', userUid);
        await setDoc(participantRef, { joinedAt: myJoinedAtRef.current, name });

        const sendSignal = async (targetId: string, type: string, payload: any) => {
          const signalId = Date.now().toString() + Math.random().toString(36).substring(7);
          await setDoc(doc(db, 'rooms', roomId, 'signals', signalId), {
            senderId: userUid,
            targetId,
            type,
            data: JSON.stringify(payload),
            createdAt: Date.now()
          });
        };

        // Listen for new participants
        unsubParticipants = onSnapshot(collection(db, 'rooms', roomId, 'participants'), (snap) => {
          snap.docChanges().forEach(async (change) => {
            const participantId = change.doc.id;
            if (participantId === userUid) return;

            if (change.type === 'added' || change.type === 'modified') {
              const pData = change.doc.data();
              setPeersTempMeta((prev) => ({ ...prev, [participantId]: { name: pData.name || "Guest" } }));
              // I am the initiator if I was here before them, or break tie using id comparison
              const amIInitiator = pData.joinedAt > myJoinedAtRef.current || 
                (pData.joinedAt === myJoinedAtRef.current && userUid > participantId);

              if (change.type === 'modified') {
                if (peerConnections.current[participantId]) {
                  peerConnections.current[participantId].close();
                  delete peerConnections.current[participantId];
                }
                removePeerStream(participantId);
                if (candidateQueue.current[participantId]) {
                  candidateQueue.current[participantId] = [];
                }
              }

              if (amIInitiator) {
                const pc = new RTCPeerConnection(configuration);
                peerConnections.current[participantId] = pc;

                localStreamRef.current?.getTracks().forEach(track => {
                  if (localStreamRef.current) pc.addTrack(track, localStreamRef.current);
                });

                pc.ontrack = (e) => addPeerStream(participantId, e.streams[0]);

                pc.onicecandidate = (e) => {
                  if (e.candidate) {
                    sendSignal(participantId, 'candidate', e.candidate);
                  }
                };

                const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                await pc.setLocalDescription(offer);
                sendSignal(participantId, 'offer', pc.localDescription);
              }
            } else if (change.type === 'removed') {
              if (peerConnections.current[participantId]) {
                peerConnections.current[participantId].close();
                delete peerConnections.current[participantId];
              }
              removePeerStream(participantId);
            }
          });
        }, (error) => handleFirestoreError(error, OperationType.GET, `rooms/${roomId}/participants`));

        // Listen for incoming signals
        const qSignals = query(collection(db, 'rooms', roomId, 'signals'), where('targetId', '==', userUid));
        unsubSignals = onSnapshot(qSignals, (snap) => {
          snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const signal = change.doc.data();
              const senderId = signal.senderId;
              const payload = JSON.parse(signal.data);

              // Clean up signal right away so it's not reprocessed
              deleteDoc(change.doc.ref).catch(err => console.warn("Failed to delete signal", err));

              let pc = peerConnections.current[senderId];

              if (signal.type === 'offer') {
                pc = new RTCPeerConnection(configuration);
                peerConnections.current[senderId] = pc;
                if (!candidateQueue.current[senderId]) candidateQueue.current[senderId] = [];

                localStreamRef.current?.getTracks().forEach(track => {
                  if (localStreamRef.current) pc.addTrack(track, localStreamRef.current);
                });

                pc.ontrack = (e) => addPeerStream(senderId, e.streams[0]);

                pc.onicecandidate = (e) => {
                  if (e.candidate) {
                    sendSignal(senderId, 'candidate', e.candidate);
                  }
                };

                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                
                // Process any candidates that arrived while setting remote description
                if (candidateQueue.current[senderId]) {
                  for (const c of candidateQueue.current[senderId]) {
                    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
                  }
                  candidateQueue.current[senderId] = [];
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendSignal(senderId, 'answer', pc.localDescription);

              } else if (signal.type === 'answer' && pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(payload));
                
                // Process any candidates that arrived while setting remote description
                if (candidateQueue.current[senderId]) {
                  for (const c of candidateQueue.current[senderId]) {
                    await pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.warn);
                  }
                  candidateQueue.current[senderId] = [];
                }
              } else if (signal.type === 'candidate') {
                if (pc && pc.remoteDescription) {
                  await pc.addIceCandidate(new RTCIceCandidate(payload)).catch(console.warn);
                } else {
                  if (!candidateQueue.current[senderId]) candidateQueue.current[senderId] = [];
                  candidateQueue.current[senderId].push(payload);
                }
              }
            }
          });
        }, (error) => handleFirestoreError(error, OperationType.GET, `rooms/${roomId}/signals`));

      } catch (err) {
        console.error("Error accessing media devices.", err);
      }
    };

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        init(user.uid);
      }
    });

    const cleanupParticipant = () => {
      if (myUserIdRef.current) {
        // Fire and forget removal on beforeunload
         fetch(`https://firestore.googleapis.com/v1/projects/${db.app.options.projectId}/databases/(default)/documents/rooms/${roomId}/participants/${myUserIdRef.current}`, {
           method: 'DELETE',
           keepalive: true
         }).catch(() => {});
      }
    };

    window.addEventListener('beforeunload', cleanupParticipant);

    return () => {
      unsubscribeAuth();
      if (initialStream) initialStream.getTracks().forEach(t => t.stop());
      Object.values(peerConnections.current).forEach((pc: RTCPeerConnection) => pc.close());
      peerConnections.current = {};
      if (unsubParticipants) unsubParticipants();
      if (unsubSignals) unsubSignals();
      if (unsubRoom) unsubRoom();
      
      if (myUserIdRef.current) {
         deleteDoc(doc(db, 'rooms', roomId, 'participants', myUserIdRef.current)).catch(() => {});
      }
      window.removeEventListener('beforeunload', cleanupParticipant);
    };
  }, [roomId, addPeerStream, removePeerStream]);

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        setDisplayStream(screenStream);
        setIsScreenSharing(true);

        Object.values(peerConnections.current).forEach((pc: RTCPeerConnection) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });

        screenTrack.onended = () => revertToCamera();
      } catch (err) {
        console.error("Failed to share screen", err);
      }
    } else {
      revertToCamera();
    }
  };

  const revertToCamera = () => {
    if (localStreamRef.current) {
      const cameraTrack = localStreamRef.current.getVideoTracks()[0];
      if (cameraTrack) {
        Object.values(peerConnections.current).forEach((pc: RTCPeerConnection) => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(cameraTrack);
        });
      }
      setDisplayStream(localStreamRef.current);
      setIsScreenSharing(false);
    }
  };

  const updateNotes = (newNotes: string) => {
    setNotes(newNotes);
    if (roomId) {
      updateDoc(doc(db, 'rooms', roomId), { notes: newNotes }).catch(err => {
        handleFirestoreError(err, OperationType.UPDATE, `rooms/${roomId}`);
      });
    }
  };

  const recordMeeting = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: true
      });
      
      const audioCtx = new window.AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      
      if (stream.getAudioTracks().length) {
        audioCtx.createMediaStreamSource(stream).connect(dest);
      }
      if (localStreamRef.current && localStreamRef.current.getAudioTracks().length) {
        audioCtx.createMediaStreamSource(localStreamRef.current).connect(dest);
      }
      
      const combinedStream = new MediaStream([
        stream.getVideoTracks()[0],
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream);
      const chunks: BlobPart[] = [];
      
      recorder.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `MeetLite-Recording-${new Date().toISOString()}.webm`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      };
      
      recorder.start();
      
      stream.getVideoTracks()[0].onended = () => {
        recorder.stop();
      };
    } catch (err) {
      console.error("Recording failed.", err);
    }
  };

  return {
    displayStream,
    peers,
    notes,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    updateNotes,
    recordMeeting,
    peersMeta: peersTempMeta
  };
};
