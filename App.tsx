
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
  { id: 'red', name: 'ASSAULT', primary: '#ef4444', background: '#0a0000', surface: '#1a0000', text: '#ef4444', accent: '#ffffff', isDark: true },
  { id: 'cobalt', name: 'COBALT_SEA', primary: '#3b82f6', background: '#00050a', surface: '#000c1a', text: '#3b82f6', accent: '#10b981', isDark: true },
  { id: 'ghost', name: 'STEALTH', primary: '#f8fafc', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', accent: '#ef4444', isDark: true },
  { id: 'void', name: 'VOID_OPS', primary: '#a855f7', background: '#020005', surface: '#0a0015', text: '#a855f7', accent: '#22c55e', isDark: true }
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
  const presenceIntervalRef = useRef<number | null>(null);

  // Lógica para quitar la pantalla de carga de index.html
  useEffect(() => {
    const hideLoader = () => {
      const bootScreen = document.getElementById('boot-screen');
      if (bootScreen) {
        bootScreen.style.opacity = '0';
        setTimeout(() => { bootScreen.style.visibility = 'hidden'; }, 1000);
      }
    };
    // Esperamos un segundo para que React se asiente
    setTimeout(hideLoader, 1500);
  }, []);

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    setConfig(prev => ({ ...prev, roomName: result }));
    playBeep(440, 0.05);
  };

  const playBeep = (freq: number, duration: number) => {
    if (!audioContextRef.current) return;
    const osc = audioContextRef.current.createOscillator();
    const gain = audioContextRef.current.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, audioContextRef.current.currentTime);
    gain.gain.setValueAtTime(0.05, audioContextRef.current.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContextRef.current.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioContextRef.current.destination);
    osc.start();
    osc.stop(audioContextRef.current.currentTime + duration);
  };

  const addLog = useCallback((msg: string, type: string = 'info', sender: string = 'SYS') => {
    const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev.slice(-15), { msg: String(msg), type, sender, time }]);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => setMyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => addLog("GPS_OFF", "err"),
        { enableHighAccuracy: true }
      );
    }
  }, []);

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
    addLog(`Establishing Band: ${config.roomName}`);

    try {
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `talkie/premium/v2/${config.roomName}`;
        client.subscribe([`${base}/voice`, `${base}/text`, `${base}/presence`]);
        setAppState('CONNECTED');
        addLog("Network Secure");
        playBeep(880, 0.1);

        presenceIntervalRef.current = window.setInterval(() => {
          client.publish(`${base}/presence`, JSON.stringify({
            user_id: myId.current,
            username: config.username,
            is_transmitting: appState === 'TRANSMITTING',
            last_seen: new Date().toISOString(),
            coords: myCoords
          }));
          
          const now = new Date().getTime();
          setOtherUsers(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(id => {
              if (now - new Date(next[id].last_seen).getTime() > 10000) delete next[id];
            });
            return next;
          });
        }, 3000);
      });

      client.on('message', (topic: string, message: any) => {
        try {
          const data = JSON.parse(message.toString());
          if (topic.endsWith('/presence')) {
            if (data.user_id !== myId.current) setOtherUsers(prev => ({ ...prev, [data.user_id]: data }));
          } else if (topic.endsWith('/text')) {
             if (data.sender !== myId.current) addLog(data.text, 'text', data.senderName);
          } else {
             if (data.sender !== myId.current && data.blob) {
               audioQueue.current.push(data.blob);
               if (!isPlaying.current) playNext();
             }
          }
        } catch(e) {}
      });
    } catch(e) { setAppState('ERROR'); }
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
      if (audioContextRef.current && analyserRef.current) audioContextRef.current.createMediaStreamSource(stream).connect(analyserRef.current);
      playBeep(1200, 0.05);
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
      playBeep(600, 0.1);
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;
    } 
    setAppState('CONNECTED'); 
  };

  const TacticalRadar = () => (
    <div className="relative w-44 h-44 sm:w-64 sm:h-64 border-2 border-current/20 rounded-full flex items-center justify-center bg-black/80 shadow-[inset_0_0_40px_rgba(0,0,0,1)] overflow-hidden shrink-0">
        <div className="absolute inset-0 radar-sweep"></div>
        <div className="absolute w-full h-[1px] bg-current/10"></div>
        <div className="absolute h-full w-[1px] bg-current/10"></div>
        <div className="absolute w-full h-full border border-current/5 rounded-full scale-[0.3]"></div>
        <div className="absolute w-full h-full border border-current/5 rounded-full scale-[0.6]"></div>
        <div className="absolute w-full h-full border border-current/10 rounded-full scale-[0.9]"></div>

        <div className="w-2.5 h-2.5 bg-current rounded-full z-20 shadow-[0_0_15px_currentColor] animate-pulse"></div>
        
        {Object.values(otherUsers).map((user: UserPresence) => {
            let x = 0, y = 0;
            const maxRad = window.innerWidth < 640 ? 70 : 110;
            if (myCoords && user.coords) {
                const latDiff = (user.coords.lat - myCoords.lat) * 20000;
                const lngDiff = (user.coords.lng - myCoords.lng) * 20000;
                x = Math.max(-maxRad, Math.min(maxRad, lngDiff));
                y = Math.max(-maxRad, Math.min(maxRad, -latDiff));
            } else {
                const seed = user.user_id.split('').reduce((a,b) => a + b.charCodeAt(0), 0);
                const angle = (seed * 137) % 360;
                const dist = (maxRad * 0.4) + (seed % (maxRad * 0.5));
                x = Math.cos(angle * Math.PI / 180) * dist;
                y = Math.sin(angle * Math.PI / 180) * dist;
            }

            return (
                <div key={user.user_id} className="absolute flex flex-col items-center transition-all duration-1000" style={{ transform: `translate(${x}px, ${y}px)` }}>
                    <div className={`w-2 h-2 rounded-full ${user.is_transmitting ? 'bg-red-500 shadow-[0_0_20px_#ef4444]' : 'bg-current shadow-[0_0_10px_currentColor]'} animate-ping`}></div>
                    <div className={`w-1.5 h-1.5 rounded-full absolute ${user.is_transmitting ? 'bg-red-500' : 'bg-current'}`}></div>
                    <span className="text-[7px] font-black mt-3 opacity-90 bg-black/80 px-1 py-0.5 rounded border border-current/20 uppercase tracking-tighter whitespace-nowrap">{user.username}</span>
                </div>
            );
        })}
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-full relative select-none overflow-hidden" style={{ backgroundColor: currentTheme.background, color: currentTheme.text }}>
      
      {/* HEADER: Limpio y sin desbordamientos */}
      <header className="p-3 sm:p-4 flex justify-between items-center border-b-2 border-current/30 bg-black/90 backdrop-blur-2xl z-[60] shrink-0">
        <div className="flex items-center gap-2 sm:gap-4 overflow-hidden min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-current flex-shrink-0 flex items-center justify-center font-black italic text-lg sm:text-xl bg-current/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]">W</div>
            <div className="flex flex-col overflow-hidden">
                <div className="text-[7px] sm:text-[9px] font-black tracking-[3px] opacity-40 uppercase truncate">Mc Wolf Labs Tactical</div>
                <h1 className="text-[10px] sm:text-sm font-black italic tracking-wider truncate uppercase">{appState === 'IDLE' ? 'System Offline' : `Sector: ${config.roomName}`}</h1>
            </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-6 shrink-0">
            <div className="hidden lg:flex flex-col items-end font-mono">
                <span className="text-[8px] opacity-30 tracking-[1px]">COORD_SCAN</span>
                <span className="text-[10px] font-bold text-white/70">{myCoords ? `${myCoords.lat.toFixed(4)}N` : 'SEARCHING'}</span>
            </div>
            <button onClick={() => setShowSettings(true)} className="w-10 h-10 sm:w-14 sm:h-14 border-2 border-current/20 flex items-center justify-center hover:bg-current hover:text-black transition-all active:scale-90">
                <i className="fa-solid fa-bars-staggered"></i>
            </button>
        </div>
      </header>

      <main className="flex-1 p-3 sm:p-4 flex flex-col relative z-10 overflow-hidden">
        
        {/* PANEL PRINCIPAL: Reorganizado para visibilidad en móvil */}
        <div className="flex-1 flex flex-col lg:flex-row gap-4 mb-4 overflow-hidden">
            
            {/* RADAR: Prioridad central en móvil */}
            <div className="flex flex-col items-center justify-center bg-black/40 border-2 border-current/10 p-4 hud-corner top-left lg:w-80 backdrop-blur-sm shrink-0">
                <div className="text-[8px] sm:text-[10px] font-black opacity-30 tracking-[4px] mb-4 uppercase">Situational Awareness</div>
                <TacticalRadar />
                <div className="mt-4 flex gap-4 w-full justify-around text-[9px] font-black opacity-40 uppercase tracking-widest">
                    <span>UNITS: {Object.keys(otherUsers).length + 1}</span>
                    <span>LINK: OK</span>
                </div>
            </div>

            {/* FEED: Ocupa el resto del espacio */}
            <div className="flex-1 bg-black/60 border-2 border-current/10 hud-corner bottom-right p-3 flex flex-col overflow-hidden backdrop-blur-md">
                <div className="flex justify-between items-center border-b border-current/10 pb-2 mb-3">
                    <span className="text-[9px] font-black opacity-30 tracking-[4px]">COMMS_TRAFFIC</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 scroll-hide font-mono text-[9px] sm:text-[10px]">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 animate-in fade-in slide-in-from-left-2 ${log.type === 'text' ? 'text-white' : log.type === 'err' ? 'text-red-500' : ''}`}>
                            <span className="opacity-30 whitespace-nowrap">[{log.time}]</span>
                            <span className="font-bold text-current uppercase whitespace-nowrap">[{log.sender}]</span>
                            <span className="flex-1 italic break-words">{log.msg}</span>
                        </div>
                    ))}
                    {logs.length === 0 && <div className="h-full flex items-center justify-center opacity-5 font-black text-xl tracking-[10px]">STANDBY</div>}
                </div>
            </div>
        </div>

        {/* CONTROLES INFERIORES */}
        <div className="flex flex-col items-center shrink-0">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-md space-y-4 p-8 border-2 border-current/30 bg-current/5 hud-corner top-left bottom-right backdrop-blur-xl">
                    <div className="space-y-2">
                        <div className="flex justify-between items-end px-1">
                            <label className="text-[9px] font-black tracking-[4px] opacity-40 uppercase">Mission ID</label>
                            <button onClick={generateCode} className="text-[8px] font-black text-white hover:text-current uppercase bg-white/5 px-2 py-0.5 rounded">Auto</button>
                        </div>
                        <input 
                            type="text" 
                            placeholder="CODE" 
                            value={config.roomName} 
                            maxLength={6}
                            onChange={e => setConfig({...config, roomName: e.target.value.toUpperCase()})} 
                            className="w-full bg-black/90 border-2 border-current/40 p-4 font-black tracking-[10px] text-center text-2xl outline-none focus:border-current"
                        />
                    </div>
                    <button onClick={connect} className="w-full py-5 bg-current text-black font-black uppercase tracking-[8px] active:scale-95 transition-all">
                        Establish Uplink
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-2xl flex flex-col gap-4 sm:gap-6 pb-2">
                    <form onSubmit={(e) => { e.preventDefault(); if(textMsg.trim() && clientRef.current) { clientRef.current.publish(`talkie/premium/v2/${config.roomName}/text`, JSON.stringify({ sender: myId.current, senderName: config.username, text: textMsg })); addLog(textMsg, 'text', 'YOU'); setTextMsg(''); } }} className="flex border-2 border-current/30 p-1 bg-black/60">
                        <input value={textMsg} onChange={e => setTextMsg(e.target.value)} type="text" placeholder="SECURE PACKET..." className="flex-1 bg-transparent p-3 sm:p-4 font-bold text-xs outline-none tracking-widest min-w-0" />
                        <button className="bg-current text-black px-4 sm:px-8 font-black text-[10px] uppercase">SEND</button>
                    </form>

                    <div className="flex justify-center py-2 relative">
                        <button 
                            onMouseDown={startTalking} onMouseUp={stopTalking} onTouchStart={startTalking} onTouchEnd={stopTalking}
                            className={`w-32 h-32 sm:w-44 sm:h-44 rounded-full border-4 flex flex-col items-center justify-center transition-all relative z-10 active:scale-90 ${appState === 'TRANSMITTING' ? 'ptt-active-glow border-red-600 bg-red-950/40 text-red-500' : 'border-current bg-black/95 text-current'}`}
                        >
                            <div className={`absolute inset-0 rounded-full border-2 border-current opacity-20 ${appState === 'TRANSMITTING' ? 'animate-ping' : ''}`}></div>
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-microphone-lines' : 'fa-microphone'} text-4xl sm:text-6xl mb-2 sm:mb-4`}></i>
                            <span className="text-[9px] sm:text-[11px] font-black tracking-[4px] uppercase">{appState === 'TRANSMITTING' ? 'TX ON' : 'PTT'}</span>
                        </button>
                        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 sm:w-56 sm:h-56 border border-current/10 rounded-full ${appState === 'RECEIVING' ? 'animate-ping' : ''}`}></div>
                    </div>
                </div>
            )}
        </div>
      </main>

      <footer className="p-2 sm:p-4 border-t border-current/20 bg-black/90 text-[8px] sm:text-[10px] font-black tracking-[2px] flex flex-row justify-between items-center z-[60] shrink-0">
          <div className="flex items-center gap-4 opacity-50 truncate">
              <span className="bg-current text-black px-1.5 rounded-sm whitespace-nowrap">Mc Wolf Premium</span>
              <span className="truncate">{config.username}</span>
          </div>
          <div className="flex gap-4 items-center opacity-40">
              <span className="hidden sm:inline">RSA_256_STABLE</span>
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
          </div>
      </footer>

      {showSettings && (
          <div className="fixed inset-0 z-[200] bg-black/98 p-6 flex flex-col items-center justify-center backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-300 overflow-y-auto">
              <div className="w-full max-w-lg space-y-10 py-10">
                  <div className="text-center space-y-2">
                    <h2 className="text-2xl sm:text-4xl font-black italic tracking-[15px] text-current uppercase">System_Mods</h2>
                    <p className="text-[9px] font-bold opacity-30 tracking-[4px] uppercase">Mc Wolf Tactical Labs</p>
                  </div>
                  
                  <div className="space-y-8">
                      <div className="space-y-3">
                        <label className="text-[10px] font-black opacity-30 uppercase tracking-[4px] ml-1">Alias_ID</label>
                        <input type="text" value={config.username} onChange={e => setConfig({...config, username: e.target.value.toUpperCase()})} className="w-full bg-white/5 p-4 border-2 border-current/20 text-lg font-black outline-none focus:border-current" />
                      </div>

                      <div className="space-y-4">
                        <label className="text-[10px] font-black opacity-30 uppercase tracking-[4px] ml-1">UI_Matrix</label>
                        <div className="grid grid-cols-3 gap-3">
                            {THEMES.map(t => (
                                <button 
                                    key={t.id} 
                                    onClick={() => { setCurrentTheme(t); document.documentElement.style.setProperty('--primary', t.primary); }} 
                                    className={`h-12 border-2 flex items-center justify-center transition-all ${currentTheme.id === t.id ? 'border-white scale-105 shadow-lg' : 'border-transparent opacity-40'}`} 
                                    style={{ backgroundColor: t.primary }}
                                >
                                    <span className="text-[8px] text-black font-black uppercase tracking-tighter">{t.name}</span>
                                </button>
                            ))}
                        </div>
                      </div>

                      <div className="p-6 border-2 border-current/20 bg-black/40 space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 bg-current text-black flex items-center justify-center font-black rounded-sm shrink-0">W</div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-black uppercase tracking-widest truncate">{AUTHOR_INFO.name}</span>
                                <span className="text-[8px] opacity-40 font-bold uppercase tracking-[2px]">System Architect</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <a href={AUTHOR_INFO.facebook} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-4 border-2 border-current/30 hover:bg-current hover:text-black transition-all font-black text-[10px] uppercase">
                                <i className="fa-brands fa-facebook-f text-lg"></i>
                                FB
                            </a>
                            <a href={AUTHOR_INFO.instagram} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-4 border-2 border-current/30 hover:bg-current hover:text-black transition-all font-black text-[10px] uppercase">
                                <i className="fa-brands fa-instagram text-lg"></i>
                                IG
                            </a>
                        </div>
                      </div>
                  </div>

                  <button onClick={() => setShowSettings(false)} className="w-full py-5 border-2 border-current text-current font-black uppercase text-xs tracking-[10px] hover:bg-current hover:text-black transition-all">
                      Apply_Core
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
