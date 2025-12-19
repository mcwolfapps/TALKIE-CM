
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
    setLogs(prev => [...prev.slice(-20), { msg: String(msg), type, sender, time }]);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => setMyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => addLog("GPS_SIGNAL_LOST", "err"),
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
    addLog(`INIT UPLINK: ${config.roomName}`);

    try {
      const client = mqtt.connect(BROKER_URL);
      clientRef.current = client;

      client.on('connect', () => {
        const base = `talkie/premium/v2/${config.roomName}`;
        client.subscribe([`${base}/voice`, `${base}/text`, `${base}/presence`]);
        setAppState('CONNECTED');
        addLog("LINK SECURED");
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
    <div className="relative w-48 h-48 sm:w-64 sm:h-64 border-2 border-current/20 rounded-full flex items-center justify-center bg-black/80 shadow-[inset_0_0_40px_rgba(0,0,0,1)] overflow-hidden">
        <div className="absolute inset-0 radar-sweep"></div>
        <div className="absolute w-full h-[1px] bg-current/10"></div>
        <div className="absolute h-full w-[1px] bg-current/10"></div>
        <div className="absolute w-full h-full border border-current/5 rounded-full scale-[0.3]"></div>
        <div className="absolute w-full h-full border border-current/5 rounded-full scale-[0.6]"></div>
        <div className="absolute w-full h-full border border-current/10 rounded-full scale-[0.9]"></div>

        <div className="w-3 h-3 bg-current rounded-full z-20 shadow-[0_0_15px_currentColor] animate-pulse"></div>
        
        {Object.values(otherUsers).map((user: UserPresence) => {
            let x = 0, y = 0;
            const maxRad = window.innerWidth < 640 ? 80 : 110;
            if (myCoords && user.coords) {
                const latDiff = (user.coords.lat - myCoords.lat) * 25000;
                const lngDiff = (user.coords.lng - myCoords.lng) * 25000;
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
                    <span className="text-[7px] font-black mt-3 opacity-90 bg-black/90 px-1 py-0.5 rounded border border-current/20 uppercase tracking-tighter whitespace-nowrap">{user.username}</span>
                </div>
            );
        })}
    </div>
  );

  return (
    <div className="flex flex-col h-screen w-full relative select-none overflow-hidden" style={{ backgroundColor: currentTheme.background, color: currentTheme.text }}>
      
      {/* HEADER TÁCTICO */}
      <header className="p-3 sm:p-4 flex justify-between items-center border-b-2 border-current/30 bg-black/90 backdrop-blur-2xl z-[60]">
        <div className="flex items-center gap-2 sm:gap-4 overflow-hidden">
            <div className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-current flex-shrink-0 flex items-center justify-center font-black italic text-lg sm:text-xl bg-current/10 shadow-[0_0_15px_rgba(0,0,0,0.5)]">MW</div>
            <div className="overflow-hidden">
                <div className="text-[7px] sm:text-[9px] font-black tracking-[2px] sm:tracking-[5px] opacity-40 uppercase truncate">Mc Wolf Comm-Link</div>
                <h1 className="text-xs sm:text-sm font-black italic tracking-[0.1em] sm:tracking-[0.25em] truncate">{appState === 'IDLE' ? 'OFFLINE' : `SECTOR: ${config.roomName}`}</h1>
            </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-6">
            <div className="hidden lg:flex flex-col items-end font-mono">
                <span className="text-[8px] opacity-30 tracking-[2px]">TELEMETRY_DATA</span>
                <span className="text-[10px] font-bold text-white/80">{myCoords ? `${myCoords.lat.toFixed(4)}N ${myCoords.lng.toFixed(4)}W` : 'SCANNING...'}</span>
            </div>
            <button onClick={() => setShowSettings(true)} className="w-10 h-10 sm:w-14 sm:h-14 border-2 border-current/20 flex items-center justify-center hover:bg-current hover:text-black transition-all active:scale-90 shadow-lg">
                <i className="fa-solid fa-bars-staggered text-lg"></i>
            </button>
        </div>
      </header>

      <main className="flex-1 p-3 sm:p-4 flex flex-col relative z-10 overflow-hidden">
        
        {/* PANEL CENTRAL: LOGS Y RADAR */}
        <div className="flex-1 flex flex-col lg:flex-row gap-3 sm:gap-6 mb-3 sm:mb-6 overflow-hidden">
            {/* FEED DE DATOS */}
            <div className="flex-1 bg-black/60 border-2 border-current/20 hud-corner top-left p-3 sm:p-5 flex flex-col overflow-hidden backdrop-blur-md">
                <div className="flex justify-between items-center border-b-2 border-current/10 pb-2 mb-3">
                    <span className="text-[9px] sm:text-[11px] font-black opacity-30 tracking-[2px] sm:tracking-[5px]">COMMS_FEED</span>
                    <span className="text-[9px] sm:text-[11px] font-bold px-2 py-0.5 bg-current/10 rounded">{logs.length} P</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-3 scroll-hide font-mono text-[9px] sm:text-[11px]">
                    {logs.map((log, i) => (
                        <div key={i} className={`flex gap-2 sm:gap-4 animate-in fade-in slide-in-from-left-4 ${log.type === 'text' ? 'text-white' : log.type === 'err' ? 'text-red-500' : ''}`}>
                            <span className="opacity-40 font-bold whitespace-nowrap">[{log.time}]</span>
                            <span className="font-black text-current uppercase whitespace-nowrap">[{log.sender}]</span>
                            <span className="flex-1 italic tracking-tight opacity-90 break-words">{log.msg}</span>
                        </div>
                    ))}
                    {logs.length === 0 && <div className="h-full flex flex-col items-center justify-center opacity-10 space-y-4">
                        <i className="fa-solid fa-satellite-dish text-4xl sm:text-6xl"></i>
                        <span className="font-black tracking-[8px] sm:tracking-[12px] text-sm sm:text-lg uppercase">Awaiting Data</span>
                    </div>}
                </div>
            </div>

            {/* RADAR CIRCULAR */}
            <div className="w-full lg:w-80 bg-black/60 border-2 border-current/20 hud-corner bottom-right p-4 sm:p-8 flex flex-col items-center justify-center backdrop-blur-md">
                <div className="text-[9px] sm:text-[11px] font-black opacity-40 tracking-[4px] sm:tracking-[6px] mb-4 sm:mb-8 uppercase">360_SITUATION_AWARE</div>
                <TacticalRadar />
                <div className="mt-6 sm:mt-10 grid grid-cols-2 gap-4 sm:gap-6 w-full text-[9px] sm:text-[10px] font-black opacity-50 uppercase tracking-widest">
                    <div className="border-l-2 border-current/40 pl-2 sm:pl-3 flex flex-col">
                        <span>UNITS</span>
                        <span className="text-white text-base sm:text-lg">{Object.keys(otherUsers).length + 1}</span>
                    </div>
                    <div className="border-l-2 border-current/40 pl-2 sm:pl-3 flex flex-col">
                        <span>UPLINK</span>
                        <span className="text-white text-base sm:text-lg">SECURE</span>
                    </div>
                </div>
            </div>
        </div>

        {/* OSCILOSCOPIO */}
        <div className="h-16 sm:h-24 bg-black/90 border-y-2 border-current/20 mb-4 sm:mb-8 flex items-center justify-center p-2 sm:p-3 relative shadow-inner">
             <div className="absolute top-1 left-2 sm:top-2 sm:left-6 text-[7px] sm:text-[8px] font-black opacity-30 tracking-[2px] sm:tracking-[4px]">SPECTRAL_OSCILLOSCOPE</div>
             <AudioVisualizer analyser={analyserRef.current} active={appState === 'TRANSMITTING' || appState === 'RECEIVING'} color={appState === 'TRANSMITTING' ? '#ef4444' : currentTheme.primary} />
        </div>

        {/* CONTROLES */}
        <div className="flex flex-col items-center">
            {appState === 'IDLE' ? (
                <div className="w-full max-w-lg space-y-4 sm:space-y-8 p-6 sm:p-12 border-2 border-current/30 bg-current/5 hud-corner top-left bottom-right backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95">
                    <div className="space-y-2 sm:space-y-4">
                        <div className="flex justify-between items-end px-1 sm:px-2">
                            <label className="text-[9px] sm:text-[11px] font-black tracking-[3px] sm:tracking-[6px] opacity-40 uppercase">Mission Code</label>
                            <button onClick={generateCode} className="text-[8px] sm:text-[10px] font-black text-white px-2 py-0.5 bg-white/10 hover:bg-white hover:text-black transition-all rounded uppercase">Auto-Gen</button>
                        </div>
                        <input 
                            type="text" 
                            placeholder="DEPLOY_ID" 
                            value={config.roomName} 
                            maxLength={6}
                            onChange={e => setConfig({...config, roomName: e.target.value.toUpperCase()})} 
                            className="w-full bg-black/90 border-2 border-current/40 p-3 sm:p-6 font-black tracking-[10px] sm:tracking-[20px] text-center text-xl sm:text-3xl outline-none focus:border-current transition-all placeholder:text-current/10"
                        />
                    </div>
                    <button onClick={connect} className="w-full py-4 sm:py-6 bg-current text-black font-black uppercase tracking-[8px] sm:tracking-[12px] text-sm sm:text-lg active:scale-95 transition-all hover:bg-white">
                        Establish Uplink
                    </button>
                </div>
            ) : (
                <div className="w-full max-w-3xl flex flex-col gap-6 sm:gap-10">
                    <form onSubmit={(e) => { e.preventDefault(); if(textMsg.trim() && clientRef.current) { clientRef.current.publish(`talkie/premium/v2/${config.roomName}/text`, JSON.stringify({ sender: myId.current, senderName: config.username, text: textMsg })); addLog(textMsg, 'text', 'YOU'); setTextMsg(''); } }} className="flex border-2 border-current/30 p-1 bg-black/60 shadow-xl overflow-hidden">
                        <input value={textMsg} onChange={e => setTextMsg(e.target.value)} type="text" placeholder="TRANSMIT PACKET..." className="flex-1 bg-transparent p-3 sm:p-5 font-black text-xs sm:text-sm outline-none tracking-[0.1em] sm:tracking-[0.2em] min-w-0" />
                        <button className="bg-current text-black px-4 sm:px-10 font-black text-[10px] sm:text-sm tracking-[0.1em] sm:tracking-[0.3em] active:scale-95 transition-all uppercase whitespace-nowrap">SEND</button>
                    </form>

                    <div className="flex justify-center py-4 sm:py-8 relative">
                        <button 
                            onMouseDown={startTalking} onMouseUp={stopTalking} onTouchStart={startTalking} onTouchEnd={stopTalking}
                            className={`w-36 h-36 sm:w-52 sm:h-52 rounded-full border-4 flex flex-col items-center justify-center shadow-2xl transition-all relative z-10 active:scale-90 ${appState === 'TRANSMITTING' ? 'ptt-active-glow border-red-600 bg-red-950/40 text-red-500' : 'border-current bg-black/95 text-current'}`}
                        >
                            <div className={`absolute inset-0 rounded-full border-2 border-current opacity-20 ${appState === 'TRANSMITTING' ? 'animate-ping' : ''}`}></div>
                            <i className={`fa-solid ${appState === 'TRANSMITTING' ? 'fa-microphone-lines' : 'fa-microphone'} text-4xl sm:text-7xl mb-2 sm:mb-4`}></i>
                            <span className="text-[8px] sm:text-[12px] font-black tracking-[4px] sm:tracking-[8px] uppercase">{appState === 'TRANSMITTING' ? 'TX_ON' : 'PTT_ACTIVE'}</span>
                        </button>
                        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-44 h-44 sm:w-64 sm:h-64 border-2 border-current/10 rounded-full ${appState === 'RECEIVING' ? 'animate-ping' : ''}`}></div>
                    </div>
                </div>
            )}
        </div>
      </main>

      <footer className="p-3 sm:p-4 border-t-2 border-current/20 bg-black text-[8px] sm:text-[10px] font-black tracking-[2px] sm:tracking-[4px] flex flex-col sm:flex-row justify-between items-center gap-2 sm:gap-4 z-[60]">
          <div className="flex items-center gap-4 sm:gap-6 opacity-60 overflow-hidden w-full sm:w-auto justify-center sm:justify-start">
              <span className="text-black bg-current px-2 py-0.5 rounded-sm uppercase whitespace-nowrap">PREMIUM_v4.8</span>
              <span className="text-white/40 truncate">OPERATOR: {config.username}</span>
          </div>
          <div className="flex gap-6 sm:gap-10 items-center opacity-40">
              <div className="flex gap-2 items-center">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                <span>COMMS_OK</span>
              </div>
              <span className="hidden sm:inline">RSA_AES_256_ACTIVE</span>
          </div>
      </footer>

      {showSettings && (
          <div className="fixed inset-0 z-[200] bg-black/98 p-6 sm:p-10 flex flex-col items-center justify-center backdrop-blur-3xl animate-in fade-in zoom-in-95 duration-500 overflow-y-auto">
              <div className="w-full max-w-xl space-y-8 sm:space-y-12 py-10">
                  <div className="text-center space-y-2 sm:space-y-3">
                    <h2 className="text-2xl sm:text-4xl font-black italic tracking-[10px] sm:tracking-[25px] text-current">SYSTEM_CONFIG</h2>
                    <p className="text-[9px] sm:text-[11px] font-bold opacity-30 tracking-[4px] sm:tracking-[6px] uppercase">Wolf Tactical Labs Interface</p>
                  </div>
                  
                  <div className="space-y-6 sm:space-y-10">
                      <div className="space-y-2 sm:space-y-4">
                        <label className="text-[9px] sm:text-[11px] font-black opacity-30 uppercase tracking-[4px] sm:tracking-[6px] ml-1">Unit_Designation</label>
                        <input type="text" value={config.username} onChange={e => setConfig({...config, username: e.target.value.toUpperCase()})} className="w-full bg-white/5 p-4 sm:p-6 border-2 border-current/20 text-lg sm:text-xl font-black outline-none focus:border-current transition-all" />
                      </div>
                      
                      <div className="flex justify-between items-center p-5 sm:p-8 bg-white/5 border-2 border-current/10 hud-corner top-left">
                        <div className="flex flex-col gap-1 sm:gap-2">
                            <span className="text-[12px] sm:text-[14px] font-black uppercase tracking-[2px] sm:tracking-[4px]">VOX_DETECTION</span>
                            <span className="text-[8px] sm:text-[10px] opacity-40 italic tracking-widest uppercase">Autonomous Uplink</span>
                        </div>
                        <button 
                            onClick={() => setConfig({...config, voxEnabled: !config.voxEnabled})} 
                            className={`w-16 h-8 sm:w-20 sm:h-10 border-2 p-1 sm:p-1.5 transition-all ${config.voxEnabled ? 'border-emerald-500 bg-emerald-500/20' : 'border-white/20'}`}
                        >
                            <div className={`w-5 h-5 sm:w-6 sm:h-6 transition-all ${config.voxEnabled ? 'translate-x-7 sm:translate-x-10 bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-white/20'}`}></div>
                        </button>
                      </div>

                      <div className="space-y-4">
                        <label className="text-[9px] sm:text-[11px] font-black opacity-30 uppercase tracking-[4px] sm:tracking-[6px] ml-1">Visual_Matrix</label>
                        <div className="grid grid-cols-3 gap-3 sm:gap-6">
                            {THEMES.map(t => (
                                <button 
                                    key={t.id} 
                                    onClick={() => { setCurrentTheme(t); document.documentElement.style.setProperty('--primary', t.primary); }} 
                                    className={`h-14 sm:h-20 border-2 flex flex-col items-center justify-center transition-all ${currentTheme.id === t.id ? 'border-white scale-105 shadow-xl' : 'border-transparent opacity-40 hover:opacity-100'}`} 
                                    style={{ backgroundColor: t.primary }}
                                >
                                    <span className="text-[8px] sm:text-[10px] text-black font-black uppercase tracking-tight">{t.name}</span>
                                </button>
                            ))}
                        </div>
                      </div>

                      {/* AUTORÍA DE Mc Wolf */}
                      <div className="p-5 sm:p-8 border-2 border-current/20 bg-black/40 space-y-4 sm:space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-current text-black flex items-center justify-center font-black rounded-sm">W</div>
                            <div className="flex flex-col">
                                <span className="text-[12px] sm:text-[14px] font-black uppercase tracking-[2px] sm:tracking-[4px]">{AUTHOR_INFO.name}</span>
                                <span className="text-[8px] sm:text-[9px] opacity-40 font-bold uppercase tracking-[2px]">System Architect</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                            <a href={AUTHOR_INFO.facebook} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 sm:py-4 border-2 border-current/30 hover:bg-current hover:text-black transition-all font-black text-[9px] sm:text-[11px] uppercase tracking-widest">
                                <i className="fa-brands fa-facebook-f text-base sm:text-lg"></i>
                                FB
                            </a>
                            <a href={AUTHOR_INFO.instagram} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 sm:py-4 border-2 border-current/30 hover:bg-current hover:text-black transition-all font-black text-[9px] sm:text-[11px] uppercase tracking-widest">
                                <i className="fa-brands fa-instagram text-base sm:text-lg"></i>
                                IG
                            </a>
                        </div>
                      </div>
                  </div>

                  <button onClick={() => setShowSettings(false)} className="w-full py-4 sm:py-6 border-2 border-current text-current font-black uppercase text-xs sm:text-sm tracking-[8px] sm:tracking-[15px] hover:bg-current hover:text-black transition-all shadow-2xl mb-10">
                      Recalibrate_Core
                  </button>
              </div>
          </div>
      )}
    </div>
  );
};

export default App;
