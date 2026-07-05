/**
 * VoiceRecorder — the decorative recording UI for the composer.
 *
 * Shows an elapsed timer and an animated bar visualizer while recording. The
 * timer effect is driven off `isRecording` only (tick count held in a ref, the
 * callbacks in refs) so it fires once per recording start/stop rather than every
 * tick. Recording is decorative — stopping submits nothing.
 */
import React from 'react';
import { cn } from '@librechat/client/utils';

interface VoiceRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: (duration: number) => void;
  visualizerBars?: number;
}
export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  visualizerBars = 32,
}) => {
  const [time, setTime] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = React.useRef(0);
  // Hold the callbacks in refs so the timer effect depends only on `isRecording`
  // (re-firing it every tick would clear/recreate the interval and mis-fire stop).
  const onStartRef = React.useRef(onStartRecording);
  const onStopRef = React.useRef(onStopRecording);
  onStartRef.current = onStartRecording;
  onStopRef.current = onStopRecording;

  React.useEffect(() => {
    if (isRecording) {
      onStartRef.current();
      tickRef.current = 0;
      timerRef.current = setInterval(() => {
        tickRef.current += 1;
        setTime(tickRef.current);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      onStopRef.current(tickRef.current);
      tickRef.current = 0;
      setTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center w-full transition-all duration-300 py-3',
        isRecording ? 'opacity-100' : 'opacity-0 h-0',
      )}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className="font-mono text-sm text-gray-600 dark:text-white/80">{formatTime(time)}</span>
      </div>
      <div className="w-full h-10 flex items-center justify-center gap-0.5 px-4">
        {[...Array(visualizerBars)].map((_, i) => (
          <div
            key={i}
            className="w-0.5 rounded-full bg-gray-400 dark:bg-white/50 animate-pulse"
            style={{
              height: `${Math.max(15, Math.random() * 100)}%`,
              animationDelay: `${i * 0.05}s`,
              animationDuration: `${0.5 + Math.random() * 0.5}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
