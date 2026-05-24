import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { 
  Camera, CameraOff, Mic, MicOff, MonitorUp, 
  FileText, CircleDot, Copy, Check, LogOut
} from 'lucide-react';
import { useWebRTC } from './hooks/useWebRTC';
import { VideoPlayer } from './components/VideoPlayer';

function App() {
  const [roomId, setRoomId] = useState<string>('');
  const [inRoom, setInRoom] = useState<boolean>(false);
  const [joinId, setJoinId] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check URL parameters for direct room joining
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomId(room);
      setInRoom(true);
    }
  }, []);

  const createRoom = () => {
    const id = uuidv4().slice(0, 8);
    window.history.pushState({}, '', `?room=${id}`);
    setRoomId(id);
    setInRoom(true);
  };

  const joinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinId.trim()) {
       window.history.pushState({}, '', `?room=${joinId.trim()}`);
       setRoomId(joinId.trim());
       setInRoom(true);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inRoom) {
    return <RoomView roomId={roomId} onLeave={() => {
      window.history.pushState({}, '', '/');
      setInRoom(false);
      setRoomId('');
    }} copyLink={copyLink} copied={copied} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full space-y-8 bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-xl shadow-emerald-500/5">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-emerald-500 rounded-lg flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
            <Camera className="w-8 h-8 text-slate-900" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 uppercase">MeetLite</h1>
          <p className="text-[10px] text-emerald-400 font-mono uppercase tracking-widest">High-Efficiency Mode</p>
        </div>

        <div className="space-y-4 pt-6">
          <button 
            onClick={createRoom}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-900 transition-colors font-bold py-3.5 rounded-lg flex justify-center items-center gap-2 uppercase tracking-wide text-[11px]"
          >
            <Camera className="w-4 h-4" />
            New Meeting
          </button>
          
          <div className="relative flex items-center py-4">
            <div className="flex-grow border-t border-slate-800"></div>
            <span className="flex-shrink-0 mx-4 text-slate-500 font-mono text-[10px] tracking-widest uppercase">Or join with code</span>
            <div className="flex-grow border-t border-slate-800"></div>
          </div>

          <form onSubmit={joinRoom} className="flex gap-2">
            <input 
              type="text" 
              placeholder="Enter meeting code" 
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 transition-all font-mono text-xs"
            />
            <button 
              type="submit"
              disabled={!joinId.trim()}
              className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-700 text-slate-100 font-bold px-6 py-3 rounded-lg transition-colors text-xs uppercase tracking-wide"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function RoomView({ roomId, onLeave, copyLink, copied }: { roomId: string, onLeave: () => void, copyLink: () => void, copied: boolean }) {
  const {
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
    recordMeeting
  } = useWebRTC(roomId);

  const [showNotes, setShowNotes] = useState(false);

  // Dynamic grid setup based on peer count
  const peerCount = peers.length + 1; // +1 for local
  let gridCols = "grid-cols-1";
  if (peerCount > 1 && peerCount <= 4) gridCols = "sm:grid-cols-2";
  else if (peerCount > 4) gridCols = "sm:grid-cols-3";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center font-bold text-slate-900">M</div>
          <div>
            <h1 className="text-sm font-semibold leading-tight uppercase">MEETLITE</h1>
            <p className="text-[10px] text-emerald-400 font-mono uppercase tracking-widest hidden sm:block">High-Efficiency Mode Active</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="flex items-center gap-2">
            <button 
              onClick={copyLink}
              className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md px-3 py-1.5 text-[10px] font-mono text-slate-300 transition-colors"
            >
              <span className="hidden sm:inline">ID: </span>{roomId} 
              {copied ? <Check className="w-3" /> : <Copy className="w-3" />}
            </button>
          </div>
          {/* Status indicators */}
          {peerCount > 1 && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full">
              <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse"></div>
              <span className="text-[11px] font-medium text-rose-500 tracking-wide uppercase">LIVE</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        {/* Video Grid */}
        <div className={`flex-1 p-4 grid gap-3 ${gridCols} auto-rows-fr bg-slate-950 overflow-y-auto`}>
           <VideoPlayer 
             stream={displayStream} 
             muted={true} 
             name={isScreenSharing ? "You (Presentation)" : "You (Host)"}
             className={peers.length === 0 ? "max-w-4xl mx-auto w-full aspect-video border-2 border-emerald-500 shadow-lg shadow-emerald-500/10" : "aspect-video border-2 border-emerald-500 shadow-lg shadow-emerald-500/10"}
           />
           {peers.map(peer => (
              <VideoPlayer 
                key={peer.id} 
                stream={peer.stream} 
                name={`Guest`}
                className="aspect-video"
              />
           ))}
        </div>

        {/* Right Sidebar: Notes */}
        {showNotes && (
          <aside className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col shrink-0">
            <div className="p-4 border-b border-slate-800">
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                Live Session Notes
              </h2>
            </div>
            <div className="flex-1 p-4 flex flex-col">
              <textarea
                value={notes}
                onChange={(e) => updateNotes(e.target.value)}
                placeholder="Add a quick note..."
                className="flex-1 w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 resize-none focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="p-4 bg-slate-950 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>DATA SAVER: ON</span>
                <span className="text-emerald-500">OPTIMIZED</span>
              </div>
            </div>
          </aside>
        )}
      </main>

      {/* Bottom Control Bar */}
      <footer className="h-20 border-t border-slate-800 bg-slate-900/80 flex items-center justify-center gap-2 sm:gap-4 shrink-0 px-4">
        <ControlButton 
          active={!isAudioMuted} 
          icon={isAudioMuted ? <MicOff className="w-5 h-5 text-rose-500" /> : <Mic className="w-5 h-5 text-slate-300" />} 
          onClick={toggleAudio} 
        />
        <ControlButton 
          active={!isVideoMuted} 
          icon={isVideoMuted ? <CameraOff className="w-5 h-5 text-rose-500" /> : <Camera className="w-5 h-5 text-slate-300" />} 
          onClick={toggleVideo} 
        />
        <div className="w-px h-8 bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>
        <button 
           onClick={toggleScreenShare}
           className={`px-4 sm:px-6 h-10 sm:h-12 rounded-full ${isScreenSharing ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'} font-bold text-[10px] sm:text-xs uppercase tracking-wider flex items-center gap-2 transition-colors`}
        >
          <MonitorUp className="w-4 h-4" />
          <span className="hidden sm:inline">Share</span>
        </button>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className={`w-10 h-10 sm:w-auto sm:px-6 sm:h-12 rounded-full flex items-center justify-center gap-2 ${showNotes ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'} font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-colors`}
        >
          <FileText className="w-4 h-4" />
          <span className="hidden sm:inline">Notes</span>
        </button>
        <button 
           onClick={recordMeeting}
           className="w-10 h-10 sm:w-auto sm:px-6 sm:h-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center gap-2 hover:bg-slate-700 text-slate-300 font-bold text-[10px] sm:text-xs uppercase tracking-wider transition-colors"
        >
          <CircleDot className="w-4 h-4 text-rose-500" />
          <span className="hidden sm:inline">Record</span>
        </button>
        <div className="w-px h-8 bg-slate-700 mx-1 sm:mx-2 hidden sm:block"></div>
        <button 
           onClick={onLeave}
           className="px-4 sm:px-8 h-10 sm:h-12 rounded-full bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] sm:text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
        >
           <span className="hidden sm:inline">End Call</span>
           <LogOut className="w-4 h-4 sm:hidden" />
        </button>
      </footer>
    </div>
  );
}

function ControlButton({ active, icon, onClick, label }: { active: boolean, icon: React.ReactNode, onClick: () => void, label?: string }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full transition-colors border
        ${active ? 'bg-slate-800 border-slate-700 hover:bg-slate-700' : 'bg-rose-500/10 border-rose-500/50 hover:bg-rose-500/20'}
      `}
    >
      {icon}
    </button>
  );
}

export default App;
