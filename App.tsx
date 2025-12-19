
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, IntercomConfig, AppTheme, AppStateType, UserPresence } from './types';
import AudioVisualizer from './components/AudioVisualizer';

declare const mqtt: any;

const BROKER_URL = 'wss://broker.hivemq.com:8000/mqtt';
const AUTHOR_INFO = {
  name: "Mc Wolf",
  tag: "MFR_SPEC_TALKIE_v4.8_PREMIUM",
  facebook: "https://www.facebook.com/share/1aJC2QMujs/",
  instagram: "https://www.instagram.com/mc_roony03?igsh=MW41bmh6ZmpyZXI4bg=="
};

const THEMES: AppTheme[] = [
  { id: 'emerald', name: 'OPERATIVE', primary: '#10b981', background: '#050505', surface: '#0a0a0a', text: '#10b981', accent: '#ef4444', isDark: true },
  { id: 'amber', name: 'COMMAND', primary: '#f59e0b', background: '#070500', surface: '#100c00', text: '#f59e0b', accent: '#3b82f6', isDark: true },
  { id: 'red', name: 'ASSAULT', primary: '#ef4444', background: '#0a0000', surface: '#1a0000', text: '#ef4444', accent: '#ffffff', isDark: true }
];

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppStateType>('IDLE');
  const [logs, setLogs] = useState<{msg: string, type: string, sender: string, time: string}[]>([]);
  const [textMsg, setTextMsg] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<AppTheme>(THEMES[0]);
  const [otherUsers, setOtherUsers] = useState<Record<string, UserPresence>>({});
  const [myCoords, setMyCoords] = useState<{lat: number, lng: number} | null>(null);
  const [config, setConfig] = useState<IntercomConfig>({
    roomName: '',
    username: `UNIT-${Math.floor(100 + Math.random() * 899)}`,
    voxEnabled: false
  });

  const clientRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const myId = useRef(Math.random().toString(36).substring(7));
  const audioQueue = useRef<string[]>([]);
  const isPlaying = useRef(false);

  const addLog = useCallback((msg: string, type: string = 'info', sender: string = 'SYS') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-8), { msg: String(msg), type, sender, time }]);
  }, []);

  useEffect(() => {
    // Intentar obtener GPS al inicio
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => addLog("GPS_SCAN_ERROR", "err")
      );
    }
  }, [addLog]);

  const initAudio = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
      analyserRef.current = audioContextRef.current.createAnalyser();
    }
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
  };

  const connect = () => {
    if (!config.roomName.trim()) return;
    initAudio();
    setAppState('CONNECTING');
    addLog(`LINKING_SECTOR: ${config.roomName}`);

    try {
      if (typeof mqtt === 'undefined') throw new Error("MQTT_LIB_FAIL");
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `talkie/premium/v2/${config.roomName}`;
        client.subscribe([`${base}/voice`, `${base}/text`, `${base}/presence`]);
        setAppState('CONNECTED');
        addLog("SECURE_UPLINK_READY");
      });

      client.on('message', (topic: string, message: any) => {
        try {
          const data = JSON.parse(message.toString());
          if (topic.endsWith('/presence')) {
            if (data.user_id !== myId.current) setOtherUsers(prev => ({ ...prev, [data.user_id]: data }));
          } else if (topic.endsWith('/text')) {
             if (data.sender !== myId.current) addLog(data.text, 'text', data.senderName);
          } else if (topic.endsWith('/voice')) {
             if (data.sender !== myId.current && data.blob) {
               audioQueue.current.push(data.blob);
               if (!isPlaying.current) playNext();
             }
          }
        } catch(e) {}
      });
    } catch(e) { 
      setAppState('ERROR');
      addLog("CONNECTION_REFUSED", "err");
    }
  };

  const playNext = async () => {
    if (audioQueue.current.length === 0) { isPlaying.current = false; return; }
    isPlaying.current = true;
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
      if (audioContextRef.current && analyserRef.current) audioContextRef.current.createMediaStreamSource(stream).connect(analyserRef.current);
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && clientRef.current) {
          const reader = new FileReader();
          reader.readAsDataURL(e.data);
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            clientRef.current.publish(`talkie/premium/v2/${config.roomName}/voice`, JSON.stringify({ sender: myId.current, blob: base64 }));
          };
        }
      };
      recorder.start(200);
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

  const TacticalRadar = () => (
    <div className="relative w-48 h-48 sm:w-64 sm:h-64 border-2 border-current/30 rounded-full flex items-center justify-center bg-black overflow-hidden shrink-0 shadow-[0_0_30px_rgba(0,0,0,0.8)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(16,185,129,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
        <div className="absolute w-full h-full border border-current/10 rounded-full scale-[0.5]"></div>
        <div className="absolute w-full h-full border border-current/10 rounded-full scale-[0.8]"></div>
        <div className="absolute w-full h-full border-l border-current/10"></div>
        <div className="absolute w-full h-full border-t border-current/10"></div>
        
        {/* Marcador propio */}
        <div className="w-3 h-3 bg-current rounded-full z-20 shadow-[0_0_15px_currentColor]"></div>

        {Object.values(otherUsers).map((user: UserPresence) => (
            <div key={user.user_id} className="absolute flex flex-col items-center z-30" style={{ transform: `translate(${(Math.random()-0.5)*100}px, ${(Math.random()-0.5)*100}px)` }}>
                <div className={`w-2 h-2 rounded-full ${user.is_transmitting ? 'bg-red-500 animate-ping' : 'bg-current'}`}></div>
                <span className="text-[7px] font-black mt-1 bg-black/80 px-1 rounded uppercase tracking-tighter">{user.username}</span>
            </div>
        ))}
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-full relative select-none" style={{ backgroundColor: currentTheme.background, color: currentTheme.text }}>
      
      {/* HEADER */}
      <header className="p-3 sm:p-4 flex justify-between items-center border-b border-current/20 bg-black/90 z-50">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-current flex items-center justify-center font-black italic bg-current/5">W</div>
            <div className="flex flex-col overflow-hidden">
                <span className="text-[8px] font-black tracking-widest opacity-40 uppercase truncate">Mc Wolf Labs Tactical</span>
                <h1 className="text-[10px] sm:text-xs font-black truncate uppercase tracking-tighter">
                  {appState === 'IDLE' ? 'CORE_OFFLINE' : `SECTOR_${config.roomName}`}
                </h1>
            </div>
        </div>
        <button onClick={() => setShowSettings(true)} className="w-10 h-10 border border-current/20 flex items-center justify-center bg-black/40">
            <i className="fa-solid fa-gear"></i>
        </button>
      </header>

      <main className="flex-1 p-3 flex flex-col gap-4 overflow-hidden relative z-10">
        
        {/* PANEL DE ESTADO */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
            <div className="flex flex-col items-center justify-center bg-black/40 border border-current/10 p-4 lg:w-72 shrink-0">
                <span className="text-[8px] font-black opacity-30 mb-4 tracking-widest uppercase">360_TACTICAL_SCAN</span>
                <TacticalRadar />
                <div className="mt-4 grid grid-cols-2 gap-2 w-full text-[8px] font-black opacity-50 uppercase text-center">
                    <div className="bg-current/5 p-1">UNITS: {Object.keys(otherUsers).length + 1}</div>
                    <div className="bg-current/5 p-1">LINK: OK</div>
                </div>
            </div>

            <div className="flex-1 bg-black/60 border border-current/10 p-3 flex flex-col overflow-hidden">
                <span className="text-[8px] font-black opacity-30 mb-2 tracking-widest uppercase">COMMS_LOG</span>
                <div className="flex-1 overflow-y-auto space-y-2 font-mono text-[9px] sm:text-[10px]">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 animate-in fade-in slide-in-from-left-4 ${log.type === 'err' ? 'text-red-500' : ''}`}>
                            <span className="opacity-30">[{log.time}]</span>
                            <span className="font-bold text-current">[{log.sender}]</span>
                            <span className="flex-1 italic break-words">{log.msg}</span>
                        </div>
                    ))}
                    {logs.length === 0 && <div className="h-full flex items-center justify-center opacity-10 font-black text-xl italic tracking-[15px]">STANDBY</div>}
                </div>
            </div>
        </div>

        {/* CONTROLES */}
        <div className="flex flex-col items-center gap-4 shrink-0 pb-4">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-sm space-y-4 p-6 border-2 border-current/30 bg-current/5">
                    <input 
                        type="text" 
                        placeholder="MISSION_CODE" 
                        value={config.roomName} 
                        maxLength={6}
                        onChange={e => setConfig({...config, roomName: e.target.value.toUpperCase()})} 
                        className="w-full bg-black border-2 border-current/40 p-3 font-black tracking-widest text-center text-xl outline-none"
                    />
                    <button onClick={connect} className="w-full py-4 bg-current text-black font-black uppercase tracking-widest text-sm shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                        Establish Uplink
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-2xl space-y-6">
                    <div className="h-12 border border-current/20 flex items-center justify-center p-2">
                        <AudioVisualizer analyser={analyserRef.current} active={appState === 'TRANSMITTING' || appState === 'RECEIVING'} color={appState === 'TRANSMITTING' ? '#ef4444' : currentTheme.primary} />
                    </div>
                    <div className="flex justify-center relative">
                        <button 
                            onMouseDown={startTalking} onMouseUp={stopTalking} onTouchStart={startTalking} onTouchEnd={stopTalking}
                            className={`w-36 h-36 rounded-full border-4 flex flex-col items-center justify-center transition-all relative z-10 active:scale-95 ${appState === 'TRANSMITTING' ? 'border-red-600 bg-red-950/40 text-red-500 shadow-[0_0_40px_rgba(239,68,68,0.4)]' : 'border-current bg-black text-current'}`}
                        >
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-microphone-lines' : 'fa-microphone'} text-5xl mb-2`}></i>
                            <span className="text-[10px] font-black tracking-widest uppercase">{appState === 'TRANSMITTING' ? 'TX_ACTIVE' : 'PUSH_TALK'}</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
      </main>

      {/* FOOTER */}
      <footer className="p-2 border-t border-current/10 bg-black text-[7px] font-black flex justify-between items-center z-50">
          <div className="opacity-50 uppercase tracking-widest">
              OP: {config.username} | STABLE_LINK
          </div>
          <div className="flex items-center gap-2 opacity-40">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
              <span>ENCRYPTED_RSA_AES</span>
          </div>
      </footer>

      {/* AJUSTES */}
      {showSettings && (
          <div className="fixed inset-0 z-[200] bg-black/98 p-6 flex flex-col items-center justify-center backdrop-blur-3xl overflow-y-auto">
              <div className="w-full max-w-md space-y-8">
                  <h2 className="text-2xl font-black tracking-widest text-current uppercase text-center italic">Settings_Core</h2>
                  
                  <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black opacity-30 uppercase">Alias_Tag</label>
                        <input type="text" value={config.username} onChange={e => setConfig({...config, username: e.target.value.toUpperCase()})} className="w-full bg-white/5 p-4 border border-current/30 text-lg font-black outline-none focus:border-current" />
                      </div>

                      <div className="p-4 border border-current/20 bg-black/40 space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-current text-black flex items-center justify-center font-black rounded-sm">W</div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-xs font-black uppercase tracking-widest text-white">{AUTHOR_INFO.name}</span>
                                <span className="text-[7px] opacity-40 font-bold uppercase tracking-widest">Technical Architect</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <a href={AUTHOR_INFO.facebook} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 border border-current/40 hover:bg-current hover:text-black transition-all font-black text-[8px] uppercase">
                                FB_FOLLOW
                            </a>
                            <a href={AUTHOR_INFO.instagram} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 border border-current/40 hover:bg-current hover:text-black transition-all font-black text-[8px] uppercase">
                                IG_FOLLOW
                            </a>
                        </div>
                      </div>
                  </div>

                  <button onClick={() => setShowSettings(false)} className="w-full py-5 border-2 border-current text-current font-black uppercase text-xs tracking-widest hover:bg-white hover:text-black transition-all">
                      Apply_Changes
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
