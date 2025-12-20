import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- TYPES ---
export type AppStateType = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'TRANSMITTING' | 'RECEIVING' | 'ERROR';

interface UserPresence {
  user_id: string;
  username: string;
  is_transmitting: boolean;
  last_seen: string;
}

declare const mqtt: any;
const BROKER_URL = 'wss://broker.hivemq.com:8000/mqtt';

// --- COMPONENTS ---

const AudioVisualizer: React.FC<{ analyser: AnalyserNode | null; active: boolean; color: string }> = ({ analyser, active, color }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !analyser || !active) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = color;
        ctx.fillRect(x, (canvas.height - barHeight) / 2, barWidth, barHeight);
        x += barWidth + 2;
      }
    };
    draw();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, active, color]);
  return <canvas ref={canvasRef} className="w-full h-full" width={400} height={60} />;
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppStateType>('IDLE');
  const [logs, setLogs] = useState<{msg: string, type: string, sender: string, time: string}[]>([]);
  const [room, setRoom] = useState('');
  const [username] = useState(`UNIT-${Math.floor(100 + Math.random() * 899)}`);
  const [otherUsers, setOtherUsers] = useState<Record<string, UserPresence>>({});
  const [voxEnabled, setVoxEnabled] = useState(false);
  
  const clientRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const myId = useRef(Math.random().toString(36).substring(7));
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);
  const voxInterval = useRef<number | null>(null);
  const isAutoTransmitting = useRef(false);

  const addLog = useCallback((msg: any, type: string = 'info', sender: string = 'SYS') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Aseguramos que el mensaje sea siempre un string para evitar Error #31
    const safeMsg = typeof msg === 'object' ? JSON.stringify(msg) : String(msg || '');
    const safeSender = String(sender || 'UNK');
    setLogs(prev => [...prev.slice(-12), { msg: safeMsg, type, sender: safeSender, time }]);
  }, []);

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
    }
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  }, []);

  const connect = () => {
    if (!room.trim()) return;
    initAudio();
    setAppState('CONNECTING');
    addLog(`INITIALIZING_LINK: ${room}`);

    try {
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `talkie/v8/${room}`;
        client.subscribe([`${base}/voice`, `${base}/presence`]);
        setAppState('CONNECTED');
        addLog("LINK_ESTABLISHED");
        
        client.publish(`${base}/presence`, JSON.stringify({
            user_id: myId.current,
            username: String(username),
            last_seen: new Date().toISOString()
        }));
      });

      client.on('message', (topic: string, message: any) => {
        try {
          const data = JSON.parse(message.toString());
          if (topic.endsWith('/presence')) {
            if (data.user_id !== myId.current) {
              setOtherUsers(prev => ({ ...prev, [String(data.user_id)]: data }));
            }
          } else if (topic.endsWith('/voice')) {
             if (data.sender !== myId.current && data.blob) {
               audioQueue.current.push(String(data.blob));
               if (!isPlaying.current) playNext();
             }
          }
        } catch(e) {}
      });
      
      client.on('error', () => { setAppState('ERROR'); addLog("BROKER_ERROR", "err"); });
    } catch(e) { setAppState('ERROR'); addLog("CRITICAL_FAIL", "err"); }
  };

  const playNext = async () => {
    if (audioQueue.current.length === 0) { isPlaying.current = false; setAppState('CONNECTED'); return; }
    isPlaying.current = true;
    setAppState('RECEIVING');
    const base64 = audioQueue.current.shift();
    if (!base64 || !audioContextRef.current) { playNext(); return; }
    try {
      const resp = await fetch(`data:audio/webm;base64,${base64}`);
      const arrayBuffer = await (await resp.blob()).arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = playNext;
      source.start();
    } catch (e) { playNext(); }
  };

  const startTalking = async () => {
    if (appState !== 'CONNECTED' && appState !== 'RECEIVING') return;
    initAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (audioContextRef.current && analyserRef.current) {
          const source = audioContextRef.current.createMediaStreamSource(stream);
          source.connect(analyserRef.current);
      }
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && clientRef.current) {
          const reader = new FileReader();
          reader.readAsDataURL(e.data);
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            clientRef.current.publish(`talkie/v8/${room}/voice`, JSON.stringify({ sender: myId.current, blob: base64 }));
          };
        }
      };
      recorder.start(250);
      setAppState('TRANSMITTING');
    } catch (err) { addLog("MIC_BLOCKED", "err"); }
  };

  const stopTalking = () => { 
    if (mediaRecorderRef.current) { 
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
    } 
    setAppState('CONNECTED'); 
  };

  // VOX Sensitivity Tuning
  useEffect(() => {
    if (voxEnabled && appState === 'CONNECTED') {
        const checkAudio = () => {
            if (!analyserRef.current) return;
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            
            if (average > 30 && !isAutoTransmitting.current) {
                isAutoTransmitting.current = true;
                startTalking();
            } else if (average < 10 && isAutoTransmitting.current) {
                isAutoTransmitting.current = false;
                stopTalking();
            }
        };
        voxInterval.current = window.setInterval(checkAudio, 150);
    } else {
        if (voxInterval.current) clearInterval(voxInterval.current);
        if (isAutoTransmitting.current) {
            isAutoTransmitting.current = false;
            stopTalking();
        }
    }
    return () => { if (voxInterval.current) clearInterval(voxInterval.current); };
  }, [voxEnabled, appState]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#010101] text-[#10b981] select-none font-mono">
      
      <header className="p-4 border-b border-emerald-500/10 flex justify-between items-center bg-black/90">
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 border border-emerald-500/40 flex items-center justify-center font-black italic">W</div>
            <div className="flex flex-col">
                <span className="text-[6px] font-bold tracking-[2px] opacity-30 uppercase">Wolf Tactical</span>
                <h1 className="text-[10px] font-black uppercase tracking-widest">
                  {appState === 'IDLE' ? 'STANDBY' : `CH_${String(room)}`}
                </h1>
            </div>
        </div>
        <div className={`text-[7px] font-black px-2 py-1 border rounded-sm ${appState === 'CONNECTED' ? 'border-emerald-500 text-emerald-500 bg-emerald-500/5' : 'border-red-500/50 text-red-500'}`}>
            {appState}
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
            {/* TACTICAL RADAR */}
            <div className="flex flex-col items-center justify-center bg-emerald-500/5 border border-emerald-500/10 p-4 md:w-64 shrink-0 relative">
                <div className="absolute inset-0 opacity-5 bg-[linear-gradient(rgba(16,185,129,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.1)_1px,transparent_1px)] bg-[size:15px_15px]"></div>
                
                <div className="relative w-36 h-36 border border-emerald-500/20 rounded-full flex items-center justify-center bg-black/40 overflow-hidden">
                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,rgba(16,185,129,0.1)_0%,transparent_25%)] animate-[spin_4s_linear_infinite]"></div>
                    <div className="w-1 h-1 bg-emerald-500 rounded-full z-20"></div>
                    
                    {Object.values(otherUsers).map((u: UserPresence, i) => (
                        <div key={String(u.user_id)} className="absolute flex flex-col items-center" style={{ transform: `translate(${(Math.sin(i*2)*45)}px, ${(Math.cos(i*2)*45)}px)` }}>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></div>
                            <span className="text-[5px] font-black mt-1 bg-black/90 px-1 border border-emerald-500/10 rounded uppercase">{String(u.username)}</span>
                        </div>
                    ))}
                </div>
                <div className="mt-4 w-full text-[7px] font-bold opacity-30 uppercase flex justify-between">
                    <span>Active_Units:</span>
                    <span>{Object.keys(otherUsers).length + 1}</span>
                </div>
            </div>

            {/* COMMUNICATIONS FEED */}
            <div className="flex-1 bg-black/20 border border-emerald-500/5 p-3 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-2 text-[6px] font-black opacity-20 uppercase tracking-[2px]">
                    <span>Secure_Data_Stream</span>
                    <span>V8_STABLE</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[9px] scrollbar-hide">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 ${log.type === 'err' ? 'text-red-500' : 'text-emerald-500/70'}`}>
                            <span className="opacity-20">[{String(log.time)}]</span>
                            <span className="font-bold">[{String(log.sender)}]</span>
                            <span className="flex-1 break-all opacity-80">{String(log.msg)}</span>
                        </div>
                    ))}
                    {logs.length === 0 && <div className="h-full flex items-center justify-center opacity-5 font-black text-xl italic">WAITING_FOR_DATA</div>}
                </div>
            </div>
        </div>

        {/* INPUT & CONTROLS */}
        <div className="flex flex-col items-center gap-4 py-2">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-xs space-y-3">
                    <input 
                        type="text" 
                        placeholder="CHANNEL_CODE" 
                        value={room} 
                        onChange={e => setRoom(e.target.value.toUpperCase())} 
                        className="w-full bg-emerald-500/5 border border-emerald-500/20 p-4 font-black tracking-[4px] text-center outline-none focus:border-emerald-500/50 transition-colors uppercase"
                    />
                    <button onClick={connect} className="w-full py-4 bg-emerald-500 text-black font-black uppercase tracking-[4px] text-[10px] active:scale-95 transition-transform">
                        Establish Connection
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-md space-y-4">
                    <div className="h-12 border border-emerald-500/10 bg-black/40 relative overflow-hidden flex items-center justify-center">
                        <AudioVisualizer analyser={analyserRef.current} active={appState === 'TRANSMITTING' || appState === 'RECEIVING'} color={appState === 'TRANSMITTING' ? '#ef4444' : '#10b981'} />
                    </div>
                    
                    <div className="flex items-center justify-between gap-4 px-2">
                        <button 
                            onClick={() => setVoxEnabled(!voxEnabled)}
                            className={`flex-1 py-3 border text-[8px] font-black uppercase tracking-widest transition-all ${voxEnabled ? 'bg-emerald-500 text-black border-emerald-500' : 'border-emerald-500/20 text-emerald-500 opacity-60'}`}
                        >
                            VOX: {voxEnabled ? 'AUTO' : 'MANUAL'}
                        </button>
                        
                        <div className="flex-1 text-center">
                            <span className={`text-[9px] font-black uppercase ${appState === 'TRANSMITTING' ? 'text-red-500 animate-pulse' : 'text-emerald-500 opacity-50'}`}>
                                {appState === 'TRANSMITTING' ? '>> SENDING' : appState === 'RECEIVING' ? '<< RECEIVING' : 'STANDBY'}
                            </span>
                        </div>
                    </div>

                    <div className="flex justify-center">
                        <button 
                            onMouseDown={!voxEnabled ? startTalking : undefined} 
                            onMouseUp={!voxEnabled ? stopTalking : undefined} 
                            onTouchStart={!voxEnabled ? startTalking : undefined} 
                            onTouchEnd={!voxEnabled ? stopTalking : undefined}
                            disabled={voxEnabled}
                            className={`w-32 h-32 rounded-full border flex flex-col items-center justify-center transition-all active:scale-90 touch-none ${appState === 'TRANSMITTING' ? 'border-red-600 bg-red-950/10 text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.2)]' : voxEnabled ? 'border-emerald-500/10 text-emerald-500/20 bg-emerald-500/5 cursor-not-allowed' : 'border-emerald-500 bg-emerald-500/5 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]'}`}
                        >
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-signal' : 'fa-microphone'} text-2xl mb-2`}></i>
                            <span className="text-[7px] font-black tracking-[3px] uppercase">{voxEnabled ? 'AUTO_ON' : 'PRESS_TX'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
      </main>

      <footer className="px-4 py-2 border-t border-emerald-500/5 bg-black flex justify-between items-center text-[6px] font-black tracking-widest opacity-20">
          <span>{username}</span>
          <span>SEC_CORE_V8.0_STABLE</span>
      </footer>
    </div>
  );
};

export default App;