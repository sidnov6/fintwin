/** OpenAI unified WebRTC + Node-only sideband. Never import this in a worker.
 * API documentation verified 2026-09-04. No live verification implied. */
import WebSocket from 'ws';
import {createHash,randomUUID} from 'node:crypto';

const bounded=(value,fallback,min,max)=>{const n=Number(value??fallback);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;};
const allowedVoices=new Set(['marin','cedar','alloy','ash','ballad','coral','echo','sage','shimmer','verse']);
export function realtimeProblem(error,language='en'){
  const de=language==='de';
  if(error?.type==='insufficient_quota'||['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached'].includes(error?.code))return{code:'openai_billing_required',message:de?'OpenAI meldet ein Abrechnungs- oder Kontingentproblem. Prüfen Sie das API-Konto und dessen Limits.':'OpenAI reported a billing or quota problem. Check the API account and its limits.'};
  if(error?.type==='invalid_request_error')return{code:'realtime_request_invalid',message:de?'Die Sprach-Anfrage wurde abgelehnt. Das ist ein Integrationsfehler, keine Guthabenmeldung. Sie können weiter tippen.':'The voice request was rejected. This is an integration error, not a credit-balance message. You can continue typing.'};
  return{code:'realtime_provider_failed',message:de?'Die Sprachantwort wurde unterbrochen. Ihre Angaben bleiben gespeichert; Sie können weiter tippen oder neu verbinden.':'The voice reply was interrupted. Your facts are saved; continue typing or reconnect.'};
}
export function sessionConfiguration(env,bridge,state,ptt=false){
  const voice=env.OPENAI_REALTIME_VOICE||'marin';
  if(!allowedVoices.has(voice))throw new Error('Unsupported configured Realtime voice.');
  return{type:'realtime',model:env.OPENAI_REALTIME_MODEL||'gpt-realtime-2.1',instructions:bridge.instructions(state),tools:bridge.tools,tool_choice:'auto',output_modalities:['audio'],max_output_tokens:512,
    truncation:{type:'retention_ratio',retention_ratio:0.8,token_limits:{post_instructions:8000}},
    audio:{input:{transcription:{model:'gpt-4o-mini-transcribe',language:state.profile?.language??'de'},turn_detection:ptt?null:{type:'semantic_vad',eagerness:'high',create_response:false,interrupt_response:true}},output:{voice}}};
}
export function createRealtimeHost(env,bridge,{fetcher=fetch,Socket=WebSocket}={}){
  const sessions=new Map();
  const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
  const fail=(error,status=503)=>json({ok:false,error},status);
  const active=s=>!s.closed&&sessions.get(s.userId)===s;
  function emit(s,event){if(s.closed&&event.type!=='ended')return;const next={...event,sessionId:s.id,generation:s.generation,seq:++s.seq};for(const listener of s.listeners)listener(next);}
  function send(s,event){if(active(s)&&s.socket?.readyState===1)s.socket.send(JSON.stringify(event));}
  async function end(s,reason='ended'){
    if(s.closed)return;s.closed=true;s.abort.abort();s.turnAbort?.abort();s.generation++;
    clearTimeout(s.durationTimer);clearTimeout(s.idleTimer);clearTimeout(s.connectTimer);
    if(s.socket?.readyState===1){if(s.activeResponse&&s.responses.has(s.activeResponse))s.socket.send(JSON.stringify({type:'response.cancel',response_id:s.activeResponse}));if(s.playing)s.socket.send(JSON.stringify({type:'output_audio_buffer.clear'}));}
    // Closing a sideband alone does NOT hang up WebRTC. The documented REST
    // hangup explicitly terminates both SIP and WebRTC calls.
    if(s.callId)try{await fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(s.callId)}/hangup`,{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(5000)});}catch{/* outstanding provider charges remain covered by reservations */}
    s.socket?.close();emit(s,{type:'ended',reason});s.listeners.clear();if(sessions.get(s.userId)===s)sessions.delete(s.userId);
    if(s.captureReservation)await bridge.settle(env,s.captureReservation,null);
  }
  function idle(s){clearTimeout(s.idleTimer);s.idleTimer=setTimeout(()=>void end(s,'idle_timeout'),bounded(env.FINTWIN_REALTIME_IDLE_SECONDS,90,15,600)*1000);}
  function interrupt(s){s.generation++;s.turnAbort?.abort();s.transcript='';s.ctx=null;if(s.activeResponse&&s.responses.has(s.activeResponse))send(s,{type:'response.cancel',response_id:s.activeResponse});if(s.playing)send(s,{type:'output_audio_buffer.clear'});s.activeResponse=null;s.playing=false;emit(s,{type:'status',status:'interrupted'});}
  async function failProvider(s,error){
    const problem=realtimeProblem(error,s.config.audio.input.transcription.language);
    // Fixed categories only. Never log upstream messages, prompts or credentials.
    console.warn('FinTwin Realtime:',problem.code);
    emit(s,{type:'error',...problem});await end(s,problem.code);
  }
  async function response(s,generation){
    if(!active(s)||generation!==s.generation)return;
    if(++s.responseCount>bounded(env.FINTWIN_REALTIME_MAX_RESPONSES,30,1,360)){await end(s,'response_limit');return;}
    const reservation=await bridge.reserve(env,s.userId,'realtime_response','openai-realtime',1);
    if(!active(s)||generation!==s.generation){await bridge.settle(env,reservation,null);return;}
    s.pendingReservations.push({id:reservation,generation});
    send(s,{type:'response.create',response:{metadata:{session_id:s.id,generation:String(generation)}}});emit(s,{type:'status',status:'processing'});
  }
  async function begin(s,text,itemId){
    if(!active(s)||!text?.trim())return;
    if(text.length>4000){emit(s,{type:'error',message:'That turn was too long. Please try a shorter message.'});return;}
    const generation=s.generation;
    s.turnAbort?.abort();s.turnAbort=new AbortController();
    const turnId=`voice-${s.id}-${itemId}`;
    const ctx=await bridge.begin(env,s.userId,turnId,text,s.turnAbort.signal,e=>{if(active(s)&&generation===s.generation)emit(s,e);});
    if(!active(s)||generation!==s.generation)return;
    s.ctx=ctx;
    s.instructions=bridge.instructions(s.ctx.state,turnId,s.ctx.intake?.question,s.ctx.intake?.scenarioInputs,s.ctx.conversation);
    send(s,{type:'session.update',session:{type:'realtime',instructions:s.instructions}});
    await response(s,generation);idle(s);
  }
  async function incoming(s,event){
    if(!active(s))return;
    if(event.type==='input_audio_buffer.speech_started'){interrupt(s);s.speechItemId=event.item_id;idle(s);emit(s,{type:'status',status:'listening'});return;}
    if(event.type==='input_audio_buffer.speech_stopped'){emit(s,{type:'status',status:'processing'});return;}
    if(event.type==='conversation.item.input_audio_transcription.completed'){
      if(s.speechItemId&&event.item_id!==s.speechItemId)return;
      if(s.seenItems.has(event.item_id))return;s.seenItems.add(event.item_id);
      await begin(s,event.transcript,event.item_id);return;
    }
    if(event.type==='conversation.item.input_audio_transcription.failed'){emit(s,{type:'error',message:'I could not hear that clearly. Try again or type it.'});return;}
    if(event.type==='response.created'){
      const pending=s.pendingReservations.shift();
      // A browser cannot obtain authorized extra generations through its DC.
      if(!pending){await end(s,'unexpected_generation');return;}
      s.responses.set(event.response.id,pending);if(pending.generation===s.generation)s.activeResponse=event.response.id;else{send(s,{type:'response.cancel',response_id:event.response.id});send(s,{type:'output_audio_buffer.clear'});}return;
    }
    if(event.type==='response.output_audio_transcript.delta'){
      const r=s.responses.get(event.response_id);if(r?.generation!==s.generation)return;
      s.transcript+=event.delta||'';emit(s,{type:'transcript',text:s.transcript});return;
    }
    if(event.type==='output_audio_buffer.started'){if(event.response_id===s.activeResponse){s.playing=true;emit(s,{type:'status',status:'speaking'});}return;}
    if(event.type==='output_audio_buffer.stopped'){
      if(event.response_id!==s.activeResponse)return;
      s.playing=false;
      if(s.ctx && s.transcript){const text=s.transcript;s.transcript='';const ctx=s.ctx,generation=s.generation;try{const message=await bridge.finish(ctx,text,s.config.model);if(active(s)&&generation===s.generation)emit(s,{type:'done',message});}catch{/* superseded */}}
      emit(s,{type:'status',status:'ready'});return;
    }
    if(event.type==='response.done'){
      const r=s.responses.get(event.response?.id);if(!r)return;s.responses.delete(event.response.id);
      const usage=event.response.usage;
      // Keep reservation when model pricing or usage is unreported; never call
      // an absent usage object free. Token totals contain no financial payload.
      await bridge.settle(env,r.id,usage?{input_tokens:usage.input_tokens,output_tokens:usage.output_tokens,total_tokens:usage.total_tokens}:null,bridge.realtimeCost?.(s.config.model,usage));
      if(r.generation!==s.generation)return;
      if(['failed','incomplete'].includes(event.response.status)){await failProvider(s,event.response.status_details?.error);return;}
      if(event.response.status!=='completed'||!s.ctx)return;
      let usedTool=false;
      for(const call of event.response.output??[]){if(call.type!=='function_call')continue;
        let args;try{args=JSON.parse(call.arguments);}catch{args={};}
        const ctx=s.ctx,output=await bridge.tool(ctx,call.name,args,call.call_id);
        if(!active(s)||r.generation!==s.generation)return;
        send(s,{type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)}});usedTool=true;
      }
      if(usedTool)await response(s,r.generation);
      return;
    }
    if(event.type==='session.updated'){
      const cfg=event.session;
      if(cfg && (cfg.model!==s.config.model || cfg.max_output_tokens>512 || cfg.truncation?.token_limits?.post_instructions>8000 || cfg.instructions!==s.instructions))await end(s,'configuration_changed');
      return;
    }
    if(event.type==='error' && !['response_cancel_not_active','output_audio_buffer_clear_empty'].includes(event.error?.code)){
      await failProvider(s,event.error);
    }
  }
  async function initialize(request,userId){
    if(env.FINTWIN_ALLOW_PAID!=='1'||env.FINTWIN_VOICE_MODE!=='realtime'||!env.OPENAI_API_KEY)return fail('Realtime is not enabled. Continue in text.');
    if(sessions.has(userId))await end(sessions.get(userId),'replaced');
    if(sessions.size>=3)return fail('All demo voice slots are currently in use.',429);
    const body=await request.json();
    if(typeof body.sdp!=='string'||body.sdp.length>50000||!body.sdp.startsWith('v=0'))return fail('Invalid voice connection request.',422);
    if(Object.keys(body).some(k=>!['sdp','pushToTalk'].includes(k)))return fail('Voice configuration is owned by the server.',422);
    const state=await bridge.state(env,userId),config=sessionConfiguration(env,bridge,state,body.pushToTalk===true);
    const s={id:randomUUID(),userId,config,instructions:config.instructions,generation:0,seq:0,closed:false,listeners:new Set(),responses:new Map(),seenItems:new Set(),pendingReservations:[],transcript:'',responseCount:0,abort:new AbortController()};sessions.set(userId,s);
    request.signal.addEventListener('abort',()=>{if(!s.connected)void end(s,'initialization_cancelled');},{once:true});
    try{
      s.captureReservation=await bridge.reserve(env,userId,'realtime_capture','openai-realtime',bounded(env.FINTWIN_REALTIME_RESERVE_USD,2,2,10));
      const form=new FormData();form.set('sdp',body.sdp);form.set('session',JSON.stringify(config));
      const reply=await fetcher('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`,'OpenAI-Safety-Identifier':createHash('sha256').update(userId).digest('hex')},body:form,signal:AbortSignal.any([s.abort.signal,AbortSignal.timeout(15000)])});
      if(!reply.ok){
        const problem=await reply.json().catch(()=>null);
        if(problem?.error?.type==='insufficient_quota'||['insufficient_quota','credit_balance_exhausted','billing_hard_limit_reached'].includes(problem?.error?.code))throw new Error('openai_billing_required');
        throw new Error('initialization_failed');
      }
      const location=reply.headers.get('location')||'';
      const callId=location.match(/\/v1\/realtime\/calls\/(rtc_[a-zA-Z0-9_-]+)$/)?.[1];
      if(!callId)throw new Error('missing_owned_call');s.callId=callId;
      const sdp=await reply.text();
      s.socket=new Socket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,{headers:{authorization:`Bearer ${env.OPENAI_API_KEY}`},maxPayload:1000000});
      s.socket.on('message',raw=>{let event;try{event=JSON.parse(raw.toString());}catch{return;}void incoming(s,event).catch(()=>void end(s,'tool_or_budget_failure'));});
      await new Promise((resolve,reject)=>{s.connectTimer=setTimeout(()=>reject(new Error('sideband_timeout')),10000);s.socket.once('open',()=>{clearTimeout(s.connectTimer);resolve();});s.socket.once('error',reject);});
      s.socket.on('close',()=>{if(active(s))void end(s,'network_lost');});s.socket.on('error',()=>void end(s,'network_lost'));
      if(!active(s))throw new Error('cancelled');s.connected=true;
      // OpenAI's maximum is 60 minutes. Leave headroom; rehearsal reconnects
      // are explicit and still share the same persistent usage allowance.
      const seconds=bounded(env.FINTWIN_REALTIME_MAX_SECONDS,300,30,3300);
      s.durationTimer=setTimeout(()=>void end(s,'duration_limit'),seconds*1000);idle(s);
      return json({ok:true,data:{sessionId:s.id,sdp,expiresAt:new Date(Date.now()+seconds*1000).toISOString(),model:config.model,voice:config.audio.output.voice}});
    }catch(error){await end(s,'connection_failed');return error.message==='openai_billing_required'?fail('OpenAI API credits or quota are unavailable. Check API billing; creating a key does not add credits.',402):fail('Voice could not connect. Continue in text or try again.');}
  }
  return{
    async handle(request,userId){const path=new URL(request.url).pathname;
      if(path==='/v1/realtime/start'&&request.method==='POST')return initialize(request,userId);
      const s=sessions.get(userId);if(!s)return fail('Voice session ended. Reconnect to continue.',410);
      if(path==='/v1/realtime/events'&&request.method==='GET'){
        const encoder=new TextEncoder();let listener;
        const stream=new ReadableStream({start(controller){listener=event=>{try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));if(event.type==='ended')controller.close();}catch{s.listeners.delete(listener);}};s.listeners.add(listener);listener({type:'status',status:'ready',sessionId:s.id,generation:s.generation,seq:++s.seq});},cancel(){s.listeners.delete(listener);}});
        request.signal.addEventListener('abort',()=>{s.listeners.delete(listener);},{once:true});
        return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store','x-accel-buffering':'no'}});
      }
      if(path==='/v1/realtime/control'&&request.method==='POST'){
        const body=await request.json();if(body.sessionId!==s.id)return fail('Voice session was replaced.',409);
        if(body.command==='end'){await end(s);return json({ok:true,data:{ended:true}});}
        if(body.command==='interrupt')interrupt(s);
        else if(body.command==='text'){if(typeof body.text!=='string'||!body.text.trim()||body.text.length>4000)return fail('Invalid voice text turn.',422);interrupt(s);const id=randomUUID();send(s,{type:'conversation.item.create',item:{id:`item_${id.replaceAll('-','').slice(0,24)}`,type:'message',role:'user',content:[{type:'input_text',text:body.text}]}});await begin(s,body.text,id);}
        else if(body.command==='ptt_start'){interrupt(s);s.speechItemId=null;send(s,{type:'input_audio_buffer.clear'});idle(s);}
        else if(body.command==='ptt_end'){send(s,{type:'input_audio_buffer.commit'});idle(s);}
        else if(body.command!=='interrupt')return fail('Unknown voice control.',422);
        return json({ok:true,data:{accepted:true}});
      }
      return fail('Unknown voice route.',404);
    },
    async sync(userId){const s=sessions.get(userId);if(!s)return;interrupt(s);const state=await bridge.state(env,userId);s.instructions=bridge.instructions(state);send(s,{type:'session.update',session:{type:'realtime',instructions:s.instructions,audio:{input:{transcription:{model:'gpt-4o-mini-transcribe',language:state.profile?.language??'de'}}}}});emit(s,{type:'state',state});emit(s,{type:'status',status:'ready'});},
    async stop(userId){const s=sessions.get(userId);if(s)await end(s);},
    async stopAll(){await Promise.all([...sessions.values()].map(s=>end(s)));},
  };
}
