"use client";
import {useEffect,useRef,useState} from 'react';
import type {Lang} from '@fintwin/contracts';
import {RealtimeClient,type VoiceEvent,type VoiceStatus} from '../lib/realtime';

const labels:Record<Lang,Record<VoiceStatus,string>>={en:{connecting:'Connecting…',ready:'Ready to listen',listening:'Listening',processing:'Thinking',speaking:'Speaking',interrupted:'Interrupted',ended:'Voice ended',playback_blocked:'Tap to enable sound'},de:{connecting:'Verbindung wird hergestellt…',ready:'Bereit zum Zuhören',listening:'Ich höre zu',processing:'Ich denke nach',speaking:'FinTwin spricht',interrupted:'Unterbrochen',ended:'Sprachgespräch beendet',playback_blocked:'Ton per Klick aktivieren'}};
export function RealtimeVoice({lang,available,beforeStart,onClient,onEvent}:{lang:Lang;available:boolean;beforeStart():void;onClient(client:RealtimeClient|null):void;onEvent(event:VoiceEvent):void}){
  const de=lang==='de';const [devices,setDevices]=useState<MediaDeviceInfo[]>([]),[device,setDevice]=useState(''),[ptt,setPtt]=useState(false),[status,setStatus]=useState<VoiceStatus>('ended'),[muted,setMuted]=useState(false),[error,setError]=useState('');
  const client=useRef<RealtimeClient|null>(null),handlers=useRef({onClient,onEvent,beforeStart});handlers.current={onClient,onEvent,beforeStart};
  const refresh=()=>navigator.mediaDevices?.enumerateDevices().then(list=>setDevices(list.filter(d=>d.kind==='audioinput'))).catch(()=>{});
  useEffect(()=>{try{setDevice(localStorage.getItem('fintwin-microphone')??'');}catch{/* optional preference */}void refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);return()=>{navigator.mediaDevices?.removeEventListener('devicechange',refresh);void client.current?.end('navigation');};},[]);
  const active=status!=='ended';
  async function start(){
    if(client.current)return;handlers.current.beforeStart();setError('');setMuted(false);
    const next=new RealtimeClient(event=>{
      if(client.current!==next)return;
      if(event.type==='status'&&event.status)setStatus(event.status);
      if(event.type==='error')setError(typeof event.message==='string'?event.message:'');
      if(event.type==='ended'){setStatus('ended');client.current=null;handlers.current.onClient(null);if(event.reason&& !['ended','navigation'].includes(event.reason))setError(previous=>previous||(de?'Sprachverbindung beendet. Ihre Angaben bleiben gespeichert. Sie können weiter tippen oder neu verbinden.':'Voice ended. Your facts are saved. Keep typing or reconnect.'));}
      handlers.current.onEvent(event);
    });client.current=next;handlers.current.onClient(next);await next.start(device,ptt);void refresh();
  }
  async function action(run:()=>Promise<void>){try{await run();}catch{setError(de?'Sprachsteuerung nicht erreichbar. Beenden Sie das Gespräch und schreiben Sie weiter.':'Voice control is unavailable. End voice and continue in text.');}}
  return <section className={`voice-controls ${active?'voice-connected':''} ${available?'':'voice-unavailable'}`} aria-label={de?'Sprachgespräch':'Voice conversation'}>
    <div className="voice-heading"><div><strong>{de?'Einfach miteinander sprechen':'Let’s talk'}</strong><small>{!available?(de?'Text ist bereit · Sprache auf diesem Host nicht verfügbar':'Text is ready · voice unavailable on this host'):de?'Marin · KI-Stimme · Sie können jederzeit dazwischenreden.':'Marin · AI voice · You can interrupt naturally.'}</small></div>
    {!active&&<button className="btn primary sm" disabled={!available} onClick={()=>void start()}>{de?'Sprachgespräch starten':'Start voice conversation'}</button>}</div>
    <p className="voice-hint">{de?'Einmal starten, dann frei sprechen. Die Antwort hören Sie zuerst; danach erscheint der Text.':'Start once, then speak freely. You’ll hear the answer first; the transcript follows.'}</p>
    <details><summary>{de?'Mikrofon & Optionen':'Microphone & options'}</summary>
    <p>{de?'Die Stimme ist KI-generiert. Wählen Sie das Mikrofon Ihres Computers, wenn macOS zum iPhone wechselt. Die App ändert keine Systemeinstellungen.':'The voice is AI-generated. Choose your computer’s microphone if macOS switches to your iPhone. The app does not change system settings.'}</p>
    <div className="voice-options"><label>{de?'Mikrofon':'Microphone'}<select aria-label={de?'Mikrofon':'Microphone'} value={device} disabled={active} onChange={e=>{setDevice(e.target.value);try{localStorage.setItem('fintwin-microphone',e.target.value);}catch{/* optional preference */}}}><option value="">{de?'Systemstandard':'System default'}</option>{devices.filter(d=>d.deviceId&&d.deviceId!=='default').map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||(de?`Mikrofon ${i+1} (Name nach Freigabe)`:`Microphone ${i+1} (name after permission)`)}</option>)}</select></label>
    <label><input type="checkbox" checked={ptt} disabled={active} onChange={e=>setPtt(e.target.checked)}/>{de?'Zum Sprechen gedrückt halten':'Push to talk'}</label></div>
    </details>
    {active&&<div className="voice-actions">
      <span role="status">{labels[lang][status]}</span>
      {status==='playback_blocked'&&<button className="btn sm" onClick={()=>void client.current?.resumePlayback()}>{de?'Ton aktivieren':'Enable sound'}</button>}
      {ptt&&<button className="btn sm" disabled={muted||status==='connecting'} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);void action(()=>client.current!.press());}} onPointerUp={()=>void action(()=>client.current!.release())} onPointerCancel={()=>void action(()=>client.current!.release())} onKeyDown={e=>{if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();void action(()=>client.current!.press());}}} onKeyUp={e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();void action(()=>client.current!.release());}}} onBlur={()=>void client.current?.release()}>{de?'Zum Sprechen halten':'Hold to talk'}</button>}
      <button className="btn sm" aria-pressed={muted} onClick={()=>{client.current?.mute(!muted);setMuted(!muted);}}>{muted?(de?'Mikrofon an':'Unmute'):(de?'Stumm':'Mute')}</button>
      <button className="btn sm" onClick={()=>void client.current?.end()}>{de?'Beenden':'End voice'}</button>
    </div>}
    {error&&<p role="alert" className="error-line">{error}</p>}
  </section>;
}
