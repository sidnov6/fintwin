"use client";
import {useEffect,useState} from 'react';
import type {Lang} from '@fintwin/contracts';

interface Props {lang:Lang;available:boolean;active:boolean;phase:'idle'|'requesting'|'listening'|'transcribing';speaking:boolean;thinking:boolean;level:number;device:string;voiceName:string;error:string;onDevice(value:string):void;onStart():void;onEnd():void;onStopRecording():void}
/** Hosted Workers use ordinary authenticated transcription/chat/speech calls,
 * not the Node-only Realtime sideband. Never offer a dead Realtime button. */
export function ChainedVoice({lang,available,active,phase,speaking,thinking,level,device,voiceName,error,onDevice,onStart,onEnd,onStopRecording}:Props){
  const de=lang==='de',[devices,setDevices]=useState<MediaDeviceInfo[]>([]);
  useEffect(()=>{const refresh=()=>{void navigator.mediaDevices?.enumerateDevices().then(list=>setDevices(list.filter(d=>d.kind==='audioinput'))).catch(()=>{});};refresh();navigator.mediaDevices?.addEventListener('devicechange',refresh);return()=>navigator.mediaDevices?.removeEventListener('devicechange',refresh);},[phase]);
  const recording=phase==='listening',working=active||phase!=='idle';
  const status=phase==='requesting'?(de?'Mikrofonfreigabe wird angefragt …':'Requesting microphone access…'):recording?(de?'Ich höre zu · kurze Pause zum Transkribieren':'Listening · pause briefly to transcribe'):phase==='transcribing'?(de?'Aufnahme wird transkribiert …':'Transcribing your recording…'):speaking?(de?'FinTwin spricht':'FinTwin is speaking'):thinking?(de?'Antwort wird vorbereitet …':'Preparing your reply…'):de?'Bereit':'Ready';
  return <section className={`voice-controls ${working?'voice-connected':''}`} aria-label={de?'Sprachgespräch':'Voice conversation'}>
    <div className="voice-heading"><div><strong>{de?'Einfach miteinander sprechen':'Let’s talk'}</strong><small>{available?`${voiceName} · ${de?'KI-Stimme · mit Transkription':'AI voice · with transcription'}`:de?'Sprache nicht konfiguriert. Sie können weiter tippen.':'Voice is not configured. You can keep typing.'}</small></div>
      {!working?<button className="btn primary sm" disabled={!available} onClick={onStart}>{de?'Sprachgespräch starten':'Start voice conversation'}</button>:<button className="btn sm" onClick={onEnd}>{de?'Beenden':'End voice'}</button>}
    </div>
    <p className="voice-hint">{de?'Sprechen, kurz pausieren, Antwort hören. Ihr Text erscheint nach der Pause. Mit „Beenden“ stoppen Sie Mikrofon und Antwort.':'Speak, pause briefly, then hear the reply. Your transcript appears after the pause. End voice stops both recording and playback.'}</p>
    <details><summary>{de?'Mikrofon & Optionen':'Microphone & options'}</summary>
      <div className="voice-options"><label>{de?'Mikrofon':'Microphone'}<select aria-label={de?'Mikrofon':'Microphone'} value={device} disabled={working} onChange={e=>onDevice(e.target.value)}><option value="">{de?'Systemstandard':'System default'}</option>{devices.filter(d=>d.deviceId&&d.deviceId!=='default').map((d,i)=><option key={d.deviceId} value={d.deviceId}>{d.label||(de?`Mikrofon ${i+1}`:`Microphone ${i+1}`)}</option>)}</select></label></div>
      <p className="note">{de?'Wählen Sie Ihr Computermikrofon, falls das System auf das Telefon wechselt. Die Aufnahme wird zur Transkription an den konfigurierten Anbieter gesendet.':'Choose your computer’s microphone if the system switches to your phone. Recordings are sent to the configured provider for transcription.'}</p>
    </details>
    {working&&<div className="voice-actions"><span role="status">{status}</span>{recording&&<><meter min="0" max="1" value={level} aria-label={de?'Mikrofonpegel':'Microphone level'}/><button className="btn sm" onClick={onStopRecording}>{de?'Jetzt transkribieren':'Transcribe now'}</button></>}</div>}
    {error&&<p className="error-line" role="alert">{error}</p>}
  </section>;
}
