#!/usr/bin/env node
/** Read-only; never calls a provider or asks for microphone permission. */
const url=process.env.FINTWIN_CHECK_URL||'http://127.0.0.1:8787';
try{const response=await fetch(`${url}/health`,{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('unreachable');const health=await response.json();console.info(JSON.stringify({reachable:true,storage:health.storage,text:{configured:health.provider,model:health.model,enabled:health.live},voice:health.realtime,liveSmoke:'not performed by preflight'},null,2));}
catch{console.error('Host is not reachable. Run pnpm demo, or configure and start pnpm start:production.');process.exitCode=1;}
