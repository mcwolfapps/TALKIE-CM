import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- TYPES & CONSTANTS ---
export type AppStateType = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'TRANSMITTING' | 'RECEIVING' | 'ERROR';

interface UserPresence {
  user_id: string;
  username: string;
  is_transmitting: boolean;
  last_seen: string;
  coords?: { lat: number; lng: number; };
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
  return <canvas ref={canvasRef} className="w-full h-full" width={400} height={80} />;
};

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppStateType>('IDLE');
  const [logs, setLogs] = useState<{msg: string, type: string, sender: string, time: string}[]>([]);
  const [room, setRoom] = useState('');
  const [username, setUsername] = useState(`UNIT-${Math.floor(100 + Math.random() * 899)}`);
  const [otherUsers, setOtherUsers] = useState<Record<string, UserPresence>>({});
  const [myCoords, setMyCoords] = useState<{lat: number, lng: number} | null>(null);
  
  const clientRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const myId = useRef(Math.random().toString(36).substring(7));
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);

  // Sanitización extrema para prevenir Error #31
  const addLog = useCallback((msg: any, type: string = 'info', sender: string = 'SYS') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let safeMsg = "EMPTY_DATA";
    if (msg === null) safeMsg = "NULL";
    else if (msg === undefined) safeMsg = "UNDEFINED";
    else if (typeof msg === 'object') {
      try { safeMsg = JSON.stringify(msg); } catch (e) { safeMsg = "[NON_SERIALIZABLE]"; }
    } else {
      safeMsg = String(msg);
    }

    const safeSender = typeof sender === 'string' ? sender : 'UNK';
    setLogs(prev => [...prev.slice(-12), { msg: safeMsg, type, sender: safeSender, time }]);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => addLog("GPS_OFFLINE", "err")
      );
    }
  }, [addLog]);

  const initAudio = () => {
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      analyserRef.current = audioContextRef.current.createAnalyser();
    }
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const connect = () => {
    if (!room.trim()) return;
    initAudio();
    setAppState('CONNECTING');
    addLog(`INIT_UPLINK_${room}`);

    try {
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `talkie/v5/${room}`;
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
              setOtherUsers(prev => ({ 
                ...prev, 
                [String(data.user_id)]: {
                  ...data,
                  username: String(data.username || 'UNKNOWN_UNIT')
                } 
              }));
            }
          } else if (topic.endsWith('/voice')) {
             if (data.sender !== myId.current && data.blob) {
               audioQueue.current.push(String(data.blob));
               if (!isPlaying.current) playNext();
             }
          }
        } catch(e) {}
      });
      
      client.on('error', () => {
          setAppState('ERROR');
          addLog("UPLINK_ERROR", "err");
      });

    } catch(e) { 
      setAppState('ERROR');
      addLog("UPLINK_FAILED", "err");
    }
  };

  const playNext = async () => {
    if (audioQueue.current.length === 0) { isPlaying.current = false; setAppState('CONNECTED'); return; }
    isPlaying.current = true;
    setAppState('RECEIVING');
    const base64 = audioQueue.current.shift();
    if (!base64 || !audioContextRef.current) { playNext(); return; }
    try {
      const resp = await fetch(`data:audio/webm;base64,${base64}`);
      const audioBuffer = await audioContextRef.current.decodeAudioData(await (await resp.blob()).arrayBuffer());
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = playNext;
      source.start();
    } catch (e) { playNext(); }
  };

  const startTalking = async () => {
    if (appState !== 'CONNECTED') return;
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
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            clientRef.current.publish(`talkie/v5/${room}/voice`, JSON.stringify({ sender: myId.current, blob: base64 }));
          };
        }
      };
      recorder.start(250);
      setAppState('TRANSMITTING');
    } catch (err) { addLog("MIC_ERROR", "err"); }
  };

  const stopTalking = () => { 
    if (mediaRecorderRef.current) { 
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
    } 
    setAppState('CONNECTED'); 
  };

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#050505] text-[#10b981] select-none">
      
      <header className="p-4 border-b border-emerald-500/20 flex justify-between items-center bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-emerald-500 flex items-center justify-center font-black italic shadow-[0_0_15px_rgba(16,185,129,0.3)]">W</div>
            <div className="flex flex-col">
                <span className="text-[8px] font-bold tracking-[3px] opacity-40 uppercase">Wolf Tactical Labs</span>
                <h1 className="text-xs font-black uppercase tracking-tighter">
                  {appState === 'IDLE' ? 'OFFLINE' : `SEC_${String(room)}`}
                </h1>
            </div>
        </div>
        <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
                <span className="text-[7px] font-bold opacity-30">ENCRYPTION</span>
                <span className="text-[9px] font-black">RSA-AES</span>
            </div>
            <div className={`w-2 h-2 rounded-full ${appState === 'CONNECTED' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
            <div className="flex flex-col items-center justify-center bg-emerald-500/5 border border-emerald-500/10 p-6 lg:w-80 shrink-0 relative">
                <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(16,185,129,0.05)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
                <span className="text-[8px] font-black opacity-30 mb-6 tracking-widest uppercase relative z-10">360_TACTICAL_SCAN</span>
                
                <div className="relative w-48 h-48 border-2 border-emerald-500/30 rounded-full flex items-center justify-center bg-black/40 shadow-inner overflow-hidden">
                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,rgba(16,185,129,0.2)_0%,transparent_40%)] animate-[spin_4s_linear_infinite]"></div>
                    <div className="absolute w-full h-full border border-emerald-500/5 rounded-full scale-[0.3]"></div>
                    <div className="absolute w-full h-full border border-emerald-500/5 rounded-full scale-[0.6]"></div>
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full z-20 shadow-[0_0_15px_#10b981]"></div>
                    
                    {/* Sanitización explícita en el radar */}
                    {(Object.values(otherUsers) as UserPresence[]).map((u, i) => (
                        <div key={String(u.user_id)} className="absolute flex flex-col items-center" style={{ transform: `translate(${(Math.sin(i*2)*50)}px, ${(Math.cos(i*2)*50)}px)` }}>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400"></div>
                            <span className="text-[6px] font-black mt-1 bg-black/80 px-1 rounded uppercase tracking-tighter">{String(u.username)}</span>
                        </div>
                    ))}
                </div>

                <div className="mt-8 grid grid-cols-2 gap-2 w-full text-[8px] font-black opacity-50 uppercase text-center relative z-10">
                    <div className="bg-emerald-500/10 py-1.5 border border-emerald-500/10">NODES: {Object.keys(otherUsers).length + 1}</div>
                    <div className="bg-emerald-500/10 py-1.5 border border-emerald-500/10">SYNC: OK</div>
                </div>
            </div>

            <div className="flex-1 bg-black/60 border border-emerald-500/10 p-4 flex flex-col overflow-hidden backdrop-blur-sm">
                <div className="flex justify-between items-center mb-3 border-b border-emerald-500/10 pb-2">
                    <span className="text-[8px] font-black opacity-30 tracking-[4px] uppercase">Operational_Log_Feed</span>
                    <span className="text-[8px] font-bold opacity-20">EST_LINK_v5</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 font-mono text-[10px] scrollbar-hide">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-3 animate-in fade-in slide-in-from-left-1 ${log.type === 'err' ? 'text-red-500' : ''}`}>
                            <span className="opacity-20 whitespace-nowrap">[{String(log.time)}]</span>
                            <span className="font-bold text-emerald-500 whitespace-nowrap">[{String(log.sender)}]</span>
                            <span className="flex-1 italic break-words opacity-80">{String(log.msg)}</span>
                        </div>
                    ))}
                    {logs.length === 0 && <div className="h-full flex items-center justify-center opacity-5 font-black text-2xl italic tracking-[15px]">STANDBY_READY</div>}
                </div>
            </div>
        </div>

        <div className="flex flex-col items-center gap-4 shrink-0 pb-6">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-sm space-y-4 p-6 border-2 border-emerald-500/30 bg-emerald-500/5">
                    <div className="space-y-1">
                        <label className="text-[8px] font-black opacity-30 uppercase tracking-[3px] ml-1">Mission_Sector</label>
                        <input 
                            type="text" 
                            placeholder="CODE_NAME" 
                            value={room} 
                            maxLength={10}
                            onChange={e => setRoom(e.target.value.toUpperCase())} 
                            className="w-full bg-black border border-emerald-500/40 p-4 font-black tracking-[6px] text-center text-xl outline-none focus:border-emerald-500 transition-all shadow-inner"
                        />
                    </div>
                    <button onClick={connect} className="w-full py-5 bg-emerald-500 text-black font-black uppercase tracking-[8px] text-xs hover:bg-emerald-400 active:scale-95 transition-all shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                        Establish Network
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-2xl space-y-6">
                    <div className="h-14 border border-emerald-500/20 flex items-center justify-center p-2 bg-black/40 relative overflow-hidden">
                        <AudioVisualizer analyser={analyserRef.current} active={appState === 'TRANSMITTING' || appState === 'RECEIVING'} color={appState === 'TRANSMITTING' ? '#ef4444' : '#10b981'} />
                    </div>
                    
                    <div className="flex justify-center relative py-2">
                        <button 
                            onMouseDown={startTalking} onMouseUp={stopTalking} onTouchStart={startTalking} onTouchEnd={stopTalking}
                            className={`w-44 h-44 rounded-full border-4 flex flex-col items-center justify-center transition-all relative z-10 active:scale-90 touch-none shadow-2xl ${appState === 'TRANSMITTING' ? 'border-red-600 bg-red-950/20 text-red-500 shadow-[0_0_50px_rgba(239,68,68,0.4)]' : 'border-emerald-500 bg-black text-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.15)]'}`}
                        >
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-microphone-lines' : 'fa-microphone'} text-5xl mb-4`}></i>
                            <span className="text-[10px] font-black tracking-[6px] uppercase">{appState === 'TRANSMITTING' ? 'TX_ACTIVE' : 'PUSH_TALK'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
      </main>

      <footer className="p-3 border-t border-emerald-500/10 bg-black flex justify-between items-center text-[8px] font-black tracking-widest opacity-40">
          <div className="flex items-center gap-4">
              <span className="bg-emerald-500 text-black px-2 py-0.5 rounded-sm">ID: {String(username)}</span>
              <span className="hidden sm:inline">UPLINK_STABLE // 256bit_AES</span>
          </div>
          <div className="flex items-center gap-2">
              <i className="fa-solid fa-tower-broadcast animate-pulse"></i>
              <span>SEC_RADIO_WOLF_v5.0</span>
          </div>
      </footer>
    </div>
  );
};

export default App;