import React, { useEffect, useRef } from 'react';
import { Peer } from '../hooks/useWebRTC';
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

interface VideoPlayerProps {
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
  name?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ stream, muted = false, className, name }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={cn("relative rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center", className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-cover"
      />
      {name && (
        <div className="absolute bottom-3 left-3 px-2 py-1 bg-slate-900/80 backdrop-blur-sm rounded text-[10px] font-medium border border-slate-700 text-slate-100">
          {name}
        </div>
      )}
    </div>
  );
};
