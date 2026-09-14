import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {VoiceAudioPlayer} from './voice-playback';

class AudioMock {
  static instances:AudioMock[]=[];
  src='';volume=0;muted=true;onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
  play=vi.fn(async()=>{});pause=vi.fn();removeAttribute=vi.fn(()=>{this.src='';});
  constructor(){AudioMock.instances.push(this);}
}
class BufferMock extends EventTarget {
  appendBuffer=vi.fn(()=>queueMicrotask(()=>this.dispatchEvent(new Event('updateend'))));
}
class MediaSourceMock extends EventTarget {
  static instances:MediaSourceMock[]=[];
  static isTypeSupported=()=>true;
  readyState='open';buffer=new BufferMock();
  addSourceBuffer=vi.fn(()=>this.buffer);
  endOfStream=vi.fn();
  constructor(){super();MediaSourceMock.instances.push(this);queueMicrotask(()=>this.dispatchEvent(new Event('sourceopen')));}
}
const clip=()=>new Blob(['synthetic-audio'],{type:'audio/wav'});
beforeEach(()=>{AudioMock.instances=[];vi.stubGlobal('Audio',AudioMock);vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:owned');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('voice playback lifecycle (mock audio, no provider)',()=>{
  it('plays an audible, unmuted clip and releases it on completion',async()=>{
    const started=vi.fn(),player=new VoiceAudioPlayer(vi.fn(),started);
    const finished=player.play(clip(),new AbortController().signal),audio=AudioMock.instances[0];
    await vi.waitFor(()=>expect(started).toHaveBeenCalledOnce());expect(audio.volume).toBe(1);expect(audio.muted).toBe(false);
    audio.onended?.();await finished;expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:owned');
  });
  it('retains blocked audio and resumes the same clip without fetching or creating it again',async()=>{
    const blocked=vi.fn(),started=vi.fn(),player=new VoiceAudioPlayer(blocked,started);
    player.prepare();await Promise.resolve();const audio=AudioMock.instances[0];audio.play.mockClear();
    audio.play.mockRejectedValueOnce(new DOMException('User activation needed','NotAllowedError'));
    const finished=player.play(clip(),new AbortController().signal);
    await vi.waitFor(()=>expect(blocked).toHaveBeenCalledOnce());expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    player.resume();await vi.waitFor(()=>expect(started).toHaveBeenCalledOnce());expect(audio.play).toHaveBeenCalledTimes(2);expect(URL.createObjectURL).toHaveBeenCalledOnce();
    audio.onended?.();await finished;
  });
  it('aborting blocked audio removes the retry and releases resources',async()=>{
    const blocked=vi.fn(),player=new VoiceAudioPlayer(blocked,vi.fn());player.prepare();await Promise.resolve();
    const audio=AudioMock.instances[0];audio.play.mockClear();audio.play.mockRejectedValueOnce(new DOMException('blocked','NotAllowedError'));
    const controller=new AbortController(),finished=player.play(clip(),controller.signal);
    await vi.waitFor(()=>expect(blocked).toHaveBeenCalledOnce());controller.abort();await finished;player.resume();
    expect(audio.play).toHaveBeenCalledOnce();expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('reports decoder errors rather than pretending speech ended successfully',async()=>{
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn()),finished=player.play(clip(),new AbortController().signal);
    const assertion=expect(finished).rejects.toThrow('playback_failed');AudioMock.instances[0].onerror?.();await assertion;
  });
  it('rejects empty and non-audio responses',async()=>{
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn());
    await expect(player.play(new Blob([],{type:'audio/wav'}),new AbortController().signal)).rejects.toThrow('invalid_audio');
    await expect(player.play(new Blob(['{}'],{type:'application/json'}),new AbortController().signal)).rejects.toThrow('invalid_audio');
  });
  it('does not start a cancelled clip',async()=>{
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn()),controller=new AbortController();controller.abort();await player.play(clip(),controller.signal);expect(AudioMock.instances).toHaveLength(0);
  });
  it('a late silent unlock completion cannot pause the real clip',async()=>{
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn());player.prepare();const audio=AudioMock.instances[0];
    const finished=player.play(clip(),new AbortController().signal);audio.pause.mockClear();await Promise.resolve();expect(audio.pause).not.toHaveBeenCalled();
    audio.onended?.();await finished;
  });
  it('starts MP3 playback before the response finishes downloading',async()=>{
    MediaSourceMock.instances=[];vi.stubGlobal('MediaSource',MediaSourceMock);
    let stream!:ReadableStreamDefaultController<Uint8Array>;
    const response=new Response(new ReadableStream({start(c){stream=c;}}),{headers:{'content-type':'audio/mpeg'}});
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn());
    const done=player.playResponse(response,new AbortController().signal);
    stream.enqueue(new Uint8Array([1,2,3]));
    await vi.waitFor(()=>expect(MediaSourceMock.instances[0].buffer.appendBuffer).toHaveBeenCalledOnce());
    expect(AudioMock.instances[0].play).toHaveBeenCalledOnce();expect(MediaSourceMock.instances[0].endOfStream).not.toHaveBeenCalled();
    stream.enqueue(new Uint8Array([4,5]));stream.close();
    await vi.waitFor(()=>expect(MediaSourceMock.instances[0].endOfStream).toHaveBeenCalledOnce());
    AudioMock.instances[0].onended?.();await done;expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('cancels a streaming download and retains no stale audio owner',async()=>{
    vi.stubGlobal('MediaSource',MediaSourceMock);const cancel=vi.fn();
    const response=new Response(new ReadableStream({cancel}),{headers:{'content-type':'audio/mpeg'}});
    const owner=new AbortController(),player=new VoiceAudioPlayer(vi.fn(),vi.fn());
    const done=player.playResponse(response,owner.signal);await Promise.resolve();owner.abort();await done;
    expect(cancel).toHaveBeenCalledOnce();expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it('uses the same downloaded response as a blob when streaming MP3 is unsupported',async()=>{
    vi.stubGlobal('MediaSource',{isTypeSupported:()=>false});const response=new Response(clip());
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn());const done=player.playResponse(response,new AbortController().signal);
    await vi.waitFor(()=>expect(AudioMock.instances[0]?.play).toHaveBeenCalledOnce());AudioMock.instances[0].onended?.();await done;
  });
  it('surfaces streaming decode failures and cancels the pending download',async()=>{
    vi.stubGlobal('MediaSource',MediaSourceMock);const cancel=vi.fn();
    const response=new Response(new ReadableStream({cancel}),{headers:{'content-type':'audio/mpeg'}});
    const player=new VoiceAudioPlayer(vi.fn(),vi.fn());const done=player.playResponse(response,new AbortController().signal);
    const assertion=expect(done).rejects.toThrow('playback_failed');AudioMock.instances[0].onerror?.();await assertion;expect(cancel).toHaveBeenCalledOnce();
  });
});
