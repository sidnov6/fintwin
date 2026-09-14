import {describe,expect,it,vi} from 'vitest';
import {playSpeechQueue} from './speech-queue';
import {replySpeechChunks,SILENCE_MS} from './voice';

const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

describe('low-latency completed-answer playback',()=>{
  it('makes the first sentence its own short clip without corrupting money or abbreviations',()=>{
    const text='At 2.15%, your payment is €1,431.23. That includes €200 extra. The model excludes fees.';
    const chunks=replySpeechChunks(text,800);
    expect(chunks[0]).toBe('At 2.15%, your payment is €1,431.23.');
    expect(chunks.join(' ')).toBe(text);
    expect(replySpeechChunks('Ca. 1.500 € bleiben übrig. Das ist ein Modell.',190)[0]).toBe('Ca. 1.500 € bleiben übrig.');
    expect(replySpeechChunks('',800)).toEqual([]);
    expect(SILENCE_MS).toBe(800);
  });
  it('keeps an overlong first sentence and all later text in order within provider limits',()=>{
    const text=('This is a long clause, '.repeat(30)+'with €2,500.50 saved. Another sentence.').trim();
    const chunks=replySpeechChunks(text,190);
    expect(chunks[0].length).toBeLessThanOrEqual(180);
    expect(chunks.every(c=>c.length<=190)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
  it('plays the first clip before the second finishes and only prefetches one ahead',async()=>{
    const first=deferred<string>(),second=deferred<string>(),third=deferred<string>(),playing=deferred<void>();
    const load=vi.fn((text:string)=>({first,second,third}[text]!.promise));
    const play=vi.fn((clip:string)=>clip==='one'?playing.promise:Promise.resolve());
    const done=playSpeechQueue(['first','second','third'],new AbortController().signal,load,play);
    await tick();expect(load.mock.calls.map(c=>c[0])).toEqual(['first']);
    first.resolve('one');await tick();expect(play.mock.calls[0][0]).toBe('one');expect(load.mock.calls.map(c=>c[0])).toEqual(['first','second']);
    second.resolve('two');await tick();expect(load).toHaveBeenCalledTimes(2);expect(play).toHaveBeenCalledOnce();
    playing.resolve();await tick();expect(play.mock.calls[1][0]).toBe('two');expect(load).toHaveBeenCalledTimes(3);
    third.resolve('three');await done;expect(play.mock.calls.map(c=>c[0])).toEqual(['one','two','three']);
  });
  it('cancels playback and prefetch without starting a third paid request',async()=>{
    const owner=new AbortController(),prefetch=deferred<string>();let linked:AbortSignal|undefined;
    const load=vi.fn((text:string,signal:AbortSignal)=>{linked=signal;return text==='one'?Promise.resolve(text):prefetch.promise;});
    const play=vi.fn((_clip:string,signal:AbortSignal)=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true})));
    const done=playSpeechQueue(['one','two','three'],owner.signal,load,play);await tick();
    owner.abort();await done;expect(linked!.aborted).toBe(true);expect(load).toHaveBeenCalledTimes(2);
    prefetch.resolve('two');await tick();expect(play).toHaveBeenCalledOnce();
  });
  it('handles prefetch rejection without unhandled promises or switching voices',async()=>{
    const playing=deferred<void>();
    const load=vi.fn(async(text:string)=>{if(text==='two')throw new Error('budget');return text;});
    const play=vi.fn(()=>playing.promise);
    const done=playSpeechQueue(['one','two','three'],new AbortController().signal,load,play);
    const assertion=expect(done).rejects.toThrow('budget');await tick();expect(play).toHaveBeenCalledOnce();
    playing.resolve();await assertion;expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not fetch when cancelled before playback',async()=>{
    const owner=new AbortController();owner.abort();const load=vi.fn(),play=vi.fn();
    await playSpeechQueue(['one'],owner.signal,load,play);expect(load).not.toHaveBeenCalled();expect(play).not.toHaveBeenCalled();
  });
});
