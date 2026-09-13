import {describe,expect,it} from 'vitest';
import {SpeechGate} from './speech-gate';
describe('local speech gate — no provider calls',()=>{
  it('rejects silence and sustained low background noise',()=>{const gate=new SpeechGate();for(let ms=0;ms<7000;ms+=20)gate.sample(.01,ms);expect(gate.hasSpeech).toBe(false);});
  it('rejects an isolated click and a suspended analyser gap',()=>{const gate=new SpeechGate();gate.sample(0,0);gate.sample(.2,6000);expect(gate.hasSpeech).toBe(false);});
  it('accepts speech followed by silence',()=>{const gate=new SpeechGate();for(let ms=0;ms<600;ms+=20)gate.sample(.06,ms);gate.sample(0,2000);expect(gate.hasSpeech).toBe(true);});
  it('accepts a short yes without requiring a 400ms utterance',()=>{const gate=new SpeechGate();for(let ms=0;ms<=200;ms+=20)gate.sample(.06,ms);expect(gate.hasSpeech).toBe(true);});
});
