#!/usr/bin/env node
/** Safe, zero-provider local entrypoint. No existing user database is opened. */
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const env={...process.env,NEXT_PUBLIC_API_URL:'',FINTWIN_HOST:'127.0.0.1',FINTWIN_PUBLIC_ORIGIN:'',FINTWIN_ALLOWED_ORIGIN:'',FINTWIN_LOCAL_OPEN:'0',FINTWIN_DB:':memory:',FINTWIN_NO_PROVIDERS:'1',FINTWIN_ALLOW_PAID:'0',FINTWIN_VOICE_MODE:'text',FINTWIN_DEMO_PASSPHRASE:'local-synthetic-demo-only'};
const build=spawn('corepack',['pnpm','build:web'],{cwd:root,env,stdio:'inherit'});
build.on('exit',code=>{if(code){process.exitCode=code;return;}console.info('\nLocal synthetic demo passphrase: local-synthetic-demo-only\nThis demo is provider-free and in memory; it resets when stopped.');const host=spawn(process.execPath,['scripts/dev-api.mjs'],{cwd:root,env,stdio:'inherit'});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>host.kill(signal));host.on('exit',code=>{process.exitCode=code??0;});});
