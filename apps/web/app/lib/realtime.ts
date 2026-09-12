import type { AppState, Card, Message } from '@fintwin/contracts';
import { API, authHeaders } from './api';
import { SpokenTurnDelivery } from './voice-captions';

export type VoiceStatus = 'connecting'|'ready'|'listening'|'processing'|'speaking'|'interrupted'|'ended'|'playback_blocked';
export interface VoiceEvent { type:string; sessionId?:string; generation?:number; seq?:number; status?:VoiceStatus; text?:string; turnId?:string; message?:Message|string; state?:AppState; card?:Card; reason?:string }

/** One capture owner and one output owner. Provider control stays on the server. */
export class RealtimeClient {
  private pc: RTCPeerConnection|null=null;
  private media: MediaStream|null=null;
  private audio: HTMLAudioElement|null=null;
  private controller=new AbortController();
  private sessionId='';
  private ended=false;
  private generation=-1;
  private seq=0;
  private muted=false;
  private ptt=false;
  private holding=false;
  private connected=false;
  private playbackBlocked=false;
  private captureCommand:Promise<void>=Promise.resolve();
  private delivery: SpokenTurnDelivery;
  constructor(private event:(event:VoiceEvent)=>void){this.delivery=new SpokenTurnDelivery(event);}

  async start(deviceId='',pushToTalk=false){
    this.ptt=pushToTalk; this.event({type:'status',status:'connecting'});
    try {
      // Own/unlock the output element in the Start click, before permissions or
      // networking. It is reused for the remote stream, not recreated later.
      const audio=new Audio();audio.autoplay=true;this.audio=audio;
      audio.src='data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==';
      void audio.play().catch(()=>{});
      const media=await navigator.mediaDevices.getUserMedia({audio:{...(deviceId?{deviceId:{exact:deviceId}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(this.ended){media.getTracks().forEach(track=>track.stop());return;}
      this.media=media;this.updateCapture();
      const pc=new RTCPeerConnection();this.pc=pc;
      pc.ontrack=e=>{if(this.ended)return;audio.srcObject=e.streams[0]??new MediaStream([e.track]);void this.resumePlayback();};
      pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)&&!this.ended)void this.end('network_lost');};
      for(const track of media.getAudioTracks())pc.addTrack(track,media);
      pc.createDataChannel('oai-events'); // Negotiation only. Never sends session/tool instructions.
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      if(this.ended)return;
      const response=await fetch(`${API}/v1/realtime/start`,{method:'POST',credentials:'include',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({sdp:offer.sdp,pushToTalk}),signal:this.controller.signal});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||'Voice connection failed.');
      this.sessionId=body.data.sessionId;
      if(this.ended){await this.closeServer();return;}
      await pc.setRemoteDescription({type:'answer',sdp:body.data.sdp});
      void this.events();
    } catch(error){
      if(!this.ended)this.event({type:'error',message:error instanceof Error?error.message:'Voice connection failed.'});
      await this.end('connection_failed');
    }
  }
  private async events(){
    try {
      const response=await fetch(`${API}/v1/realtime/events`,{credentials:'include',headers:authHeaders(),signal:this.controller.signal,cache:'no-store'});
      if(!response.ok||!response.body)throw new Error('Voice session lost.');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      while(!this.ended){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});const frames=buffer.split('\n\n');buffer=frames.pop()??'';
        for(const frame of frames){const line=frame.split('\n').find(line=>line.startsWith('data:'));if(!line)continue;let e:VoiceEvent;try{e=JSON.parse(line.slice(5));}catch{continue;}
          if(e.sessionId!==this.sessionId||(e.seq??0)<=this.seq||(e.generation??0)<this.generation)continue;
          this.seq=e.seq??this.seq;this.generation=e.generation??this.generation;
          if(e.type==='ended'){await this.end(e.reason,false);return;}
          if(e.type==='status'&&e.status==='ready'&&!this.connected){this.connected=true;this.updateCapture();}
          this.delivery.accept(this.playbackBlocked&&e.type==='status'?{...e,status:'playback_blocked'}:e);
        }
      }
      if(!this.ended)await this.end('connection_lost');
    }catch{if(!this.ended)await this.end('connection_lost');}
  }
  private async control(command:string,text?:string){
    if(this.ended||!this.sessionId)throw new Error('Voice is not ready yet.');
    const response=await fetch(`${API}/v1/realtime/control`,{method:'POST',credentials:'include',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({sessionId:this.sessionId,command,text}),signal:this.controller.signal});
    if(!response.ok)throw new Error('Voice control failed. End voice and continue in text.');
  }
  async text(text:string){await this.control('text',text);}
  async interrupt(){if(this.audio){this.audio.pause();}await this.control('interrupt');if(this.audio)void this.resumePlayback();}
  private updateCapture(){this.media?.getAudioTracks().forEach(track=>{track.enabled=this.connected&&!this.playbackBlocked&&!this.muted&&(!this.ptt||this.holding);});}
  mute(value:boolean){this.muted=value;this.updateCapture();}
  async press(){if(this.holding)return;this.holding=true;this.captureCommand=this.captureCommand.catch(()=>{}).then(()=>this.control('ptt_start'));await this.captureCommand;if(this.ended||!this.holding)return;this.updateCapture();this.event({type:'status',status:'listening'});}
  async release(){if(!this.holding)return;this.holding=false;this.updateCapture();this.captureCommand=this.captureCommand.catch(()=>{}).then(()=>this.control('ptt_end'));await this.captureCommand;}
  async resumePlayback(){
    try{await this.audio?.play();if(this.ended)return;const wasBlocked=this.playbackBlocked;this.playbackBlocked=false;this.delivery.playbackReady();this.updateCapture();if(wasBlocked)this.event({type:'status',status:'ready'});}
    catch{if(this.ended)return;this.playbackBlocked=true;this.updateCapture();this.delivery.playbackBlocked();this.delivery.accept({type:'status',status:'interrupted'});this.event({type:'status',status:'playback_blocked'});if(this.sessionId)void this.control('interrupt').catch(()=>{});}
  }
  private async closeServer(){if(!this.sessionId)return;try{await fetch(`${API}/v1/realtime/control`,{method:'POST',credentials:'include',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({sessionId:this.sessionId,command:'end'}),keepalive:true,signal:AbortSignal.timeout(5000)});}catch{/* server idle/duration limits also hang up */}}
  async end(reason='ended',notifyServer=true){
    if(this.ended)return;this.ended=true;
    this.controller.abort();this.media?.getTracks().forEach(track=>track.stop());this.media=null;
    if(this.pc){this.pc.ontrack=null;this.pc.onconnectionstatechange=null;this.pc.close();this.pc=null;}
    if(this.audio){this.audio.pause();this.audio.srcObject=null;this.audio=null;}
    this.delivery.accept({type:'ended',reason});
    if(notifyServer)await this.closeServer();
  }
}
