import {describe,expect,it} from 'vitest';
import {SpokenTurnDelivery} from './voice-captions';
import type {VoiceEvent} from './realtime';

describe('audio-first captions',()=>{
  it('holds text and cards until the spoken reply finishes',()=>{
    const events:VoiceEvent[]=[],delivery=new SpokenTurnDelivery(e=>events.push(e));
    delivery.playbackReady();
    delivery.accept({type:'transcript',generation:1,text:'Not spoken yet'});
    delivery.accept({type:'card',generation:1});expect(events).toHaveLength(0);
    delivery.accept({type:'status',status:'speaking',generation:1});expect(events).toHaveLength(1);
    delivery.accept({type:'done',generation:1,message:{id:'one',role:'assistant',text:'Now spoken',cards:[],createdAt:''}});
    expect(events.map(e=>e.type)).toEqual(['status','done']);
  });
  it('does not present captions as spoken when the browser blocked sound',()=>{
    const events:VoiceEvent[]=[],delivery=new SpokenTurnDelivery(e=>events.push(e));
    delivery.accept({type:'status',status:'speaking',generation:1});
    delivery.accept({type:'done',generation:1});expect(events.some(e=>e.type==='done')).toBe(false);
    delivery.playbackReady();expect(events.at(-1)?.type).toBe('done');
  });
  it('discards an interrupted reply instead of showing unspoken words',()=>{
    const events:VoiceEvent[]=[],delivery=new SpokenTurnDelivery(e=>events.push(e));
    delivery.accept({type:'status',status:'speaking',generation:1});delivery.accept({type:'done',generation:1});
    delivery.accept({type:'status',status:'interrupted',generation:2});delivery.playbackReady();
    expect(events.some(e=>e.type==='done')).toBe(false);
  });
});
