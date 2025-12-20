import React, { useState, useEffect, useRef, useCallback } from 'react';

// --- DEFINICIONES ---
export type AppStateType = 'IDLE' | 'CONNECTING' | 'CONNECTED' | 'TRANSMITTING' | 'RECEIVING' | 'ERROR';

interface UserPresence {
  user_id: string;
  username: string;
  is_transmitting: boolean;
  last_seen: string;
}

declare const mqtt: any;
const BROKER_URL = 'wss://broker.hivemq.com:8000/mqtt';

// --- SUBCOMPONENTE VISUALIZADOR ---
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

// --- COMPONENTE PRINCIPAL ---
const App: React.FC = () => {
  const [appState, setAppState] = useState<AppStateType>('IDLE');
  const [logs, setLogs] = useState<{msg: string, type: string, sender: string, time: string}[]>([]);
  const [room, setRoom] = useState('');
  const [username] = useState(`OPERATOR-${Math.floor(100 + Math.random() * 899)}`);
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
    const safeMsg = typeof msg === 'object' ? JSON.stringify(msg) : String(msg || '');
    const safeSender = String(sender || 'UNK');
    setLogs(prev => [...prev.slice(-10), { msg: safeMsg, type, sender: safeSender, time }]);
  }, []);

  const initAudio = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
  }, []);

  const connect = () => {
    if (!room.trim()) return;
    initAudio();
    setAppState('CONNECTING');
    addLog(`INIT_LINK_SEC_V9: ${room}`);

    try {
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `wolf/v9/${room}`;
        client.subscribe([`${base}/voice`, `${base}/presence`]);
        setAppState('CONNECTED');
        addLog("CHANNEL_ESTABLISHED");
        
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
      
      client.on('error', () => { setAppState('ERROR'); addLog("CONNECTION_INTERRUPTED", "err"); });
    } catch(e) { setAppState('ERROR'); addLog("CRITICAL_NETWORK_FAIL", "err"); }
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
            clientRef.current.publish(`wolf/v9/${room}/voice`, JSON.stringify({ sender: myId.current, blob: base64 }));
          };
        }
      };
      recorder.start(250);
      setAppState('TRANSMITTING');
    } catch (err) { addLog("MICROPHONE_ACCESS_DENIED", "err"); }
  };

  const stopTalking = () => { 
    if (mediaRecorderRef.current) { 
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
    } 
    setAppState('CONNECTED'); 
  };

  useEffect(() => {
    if (voxEnabled && appState === 'CONNECTED') {
        const checkAudio = () => {
            if (!analyserRef.current) return;
            const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            
            if (average > 25 && !isAutoTransmitting.current) {
                isAutoTransmitting.current = true;
                startTalking();
            } else if (average < 8 && isAutoTransmitting.current) {
                isAutoTransmitting.current = false;
                stopTalking();
            }
        };
        voxInterval.current = window.setInterval(checkAudio, 100);
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
    <div className="flex flex-col h-screen w-full overflow-hidden bg-[#000] text-[#10b981] select-none font-mono">
      
      <header className="p-4 border-b border-emerald-500/10 flex justify-between items-center bg-black/50 backdrop-blur-md">
        <div className="flex items-center gap-2">
            <div className="w-6 h-6 border border-emerald-500 flex items-center justify-center font-bold text-xs italic">W</div>
            <div className="flex flex-col">
                <span className="text-[6px] font-black opacity-30 uppercase tracking-[2px]">WOLF_TAC_V9</span>
                <h1 className="text-[10px] font-black uppercase tracking-widest">
                  {appState === 'IDLE' ? 'DISCONNECTED' : `NODE_${String(room)}`}
                </h1>
            </div>
        </div>
        <div className={`text-[7px] font-black px-2 py-0.5 border ${appState === 'CONNECTED' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-500' : 'border-red-500 text-red-500'}`}>
            {appState}
        </div>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col md:flex-row gap-4 overflow-hidden">
            {/* RADAR TÁCTICO */}
            <div className="flex flex-col items-center justify-center bg-emerald-500/5 border border-emerald-500/10 p-4 md:w-56 shrink-0 relative">
                <div className="absolute inset-0 opacity-5 bg-[linear-gradient(rgba(16,185,129,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.1)_1px,transparent_1px)] bg-[size:10px_10px]"></div>
                
                <div className="relative w-32 h-32 border border-emerald-500/20 rounded-full flex items-center justify-center bg-black/40 overflow-hidden">
                    <div className="absolute inset-0 bg-[conic-gradient(from_0deg,rgba(16,185,129,0.05)_0%,transparent_20%)] animate-[spin_5s_linear_infinite]"></div>
                    <div className="w-1 h-1 bg-emerald-500 rounded-full z-20"></div>
                    
                    {Object.values(otherUsers).map((u: UserPresence, i) => (
                        <div key={String(u.user_id)} className="absolute flex flex-col items-center" style={{ transform: `translate(${(Math.sin(i*2)*40)}px, ${(Math.cos(i*2)*40)}px)` }}>
                            <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></div>
                            <span className="text-[5px] font-black mt-1 bg-black/80 px-1 border border-emerald-500/10 rounded uppercase">{String(u.username)}</span>
                        </div>
                    ))}
                </div>
                <div className="mt-4 w-full text-[7px] font-bold opacity-30 uppercase flex justify-between px-2">
                    <span>Active_Nodes:</span>
                    <span>{Object.keys(otherUsers).length + 1}</span>
                </div>
            </div>

            {/* FEED DE DATOS */}
            <div className="flex-1 bg-black/30 border border-emerald-500/5 p-3 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-2 text-[6px] font-black opacity-20 uppercase tracking-[2px]">
                    <span>Secure_Uplink_Log</span>
                    <span>V9_STABLE</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[9px] scrollbar-hide">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 ${log.type === 'err' ? 'text-red-500' : 'text-emerald-500/60'}`}>
                            <span className="opacity-20">[{String(log.time)}]</span>
                            <span className="font-bold">[{String(log.sender)}]</span>
                            <span className="flex-1 break-all opacity-80">{String(log.msg)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* CONTROLES */}
        <div className="flex flex-col items-center gap-4 py-2">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-xs space-y-2">
                    <input 
                        type="text" 
                        placeholder="ENTER_ROOM_CODE" 
                        value={room} 
                        onChange={e => setRoom(e.target.value.toUpperCase().replace(/\s/g, '_'))} 
                        className="w-full bg-emerald-500/5 border border-emerald-500/20 p-4 font-black tracking-[4px] text-center outline-none focus:border-emerald-500/40 transition-colors uppercase text-sm"
                    />
                    <button onClick={connect} className="w-full py-4 bg-emerald-500 text-black font-black uppercase tracking-[3px] text-[10px] active:scale-95 transition-transform hover:bg-emerald-400">
                        Connect to Node
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-md space-y-4">
                    <div className="h-10 border border-emerald-500/10 bg-black/40 relative overflow-hidden flex items-center justify-center">
                        <AudioVisualizer analyser={analyserRef.current} active={appState === 'TRANSMITTING' || appState === 'RECEIVING'} color={appState === 'TRANSMITTING' ? '#ef4444' : '#10b981'} />
                    </div>
                    
                    <div className="flex items-center justify-between gap-4 px-2">
                        <button 
                            onClick={() => { initAudio(); setVoxEnabled(!voxEnabled); }}
                            className={`flex-1 py-3 border text-[8px] font-black uppercase tracking-widest transition-all ${voxEnabled ? 'bg-emerald-500 text-black border-emerald-500' : 'border-emerald-500/20 text-emerald-500 opacity-60'}`}
                        >
                            VOX: {voxEnabled ? 'AUTOMATIC' : 'MANUAL'}
                        </button>
                        
                        <div className="flex-1 text-center">
                            <span className={`text-[8px] font-black uppercase ${appState === 'TRANSMITTING' ? 'text-red-500 animate-pulse' : 'text-emerald-500 opacity-40'}`}>
                                {appState === 'TRANSMITTING' ? '>> TX_ACTIVE' : appState === 'RECEIVING' ? '<< RX_ACTIVE' : 'READY'}
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
                            className={`w-28 h-28 rounded-full border flex flex-col items-center justify-center transition-all active:scale-90 touch-none ${appState === 'TRANSMITTING' ? 'border-red-600 bg-red-950/10 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : voxEnabled ? 'border-emerald-500/5 text-emerald-500/10 cursor-not-allowed' : 'border-emerald-500 bg-emerald-500/5 text-emerald-500'}`}
                        >
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-tower-broadcast' : 'fa-microphone'} text-xl mb-1`}></i>
                            <span className="text-[6px] font-black tracking-[2px] uppercase">{voxEnabled ? 'VOX_ON' : 'PUSH_TX'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
      </main>

      <footer className="px-4 py-2 border-t border-emerald-500/5 bg-black flex justify-between items-center text-[6px] font-black tracking-widest opacity-20">
          <span>{username}</span>
          <span>SEC_CORE_V9.0_STABLE</span>
      </footer>
    </div>
  );
};

export default App;