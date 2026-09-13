import {describe,expect,it} from 'vitest';
import {inputErrorMessage,microphoneError,transcriptionError} from './voice-input';
describe('visible voice-input failures',()=>{
  it('distinguishes provider rejection from microphone permission',()=>{
    expect(transcriptionError('provider_auth_failed',502)).toBe('auth');
    expect(inputErrorMessage('auth','en')).toContain('private server key');
    expect(microphoneError({name:'NotAllowedError'})).toBe('permission');
    expect(microphoneError({name:'OverconstrainedError'})).toBe('device');
    expect(microphoneError({name:'NotReadableError'})).toBe('busy');
  });
  it('classifies billing, limits, expired sessions and invalid audio without reflecting provider text',()=>{
    expect(transcriptionError('openai_billing_required',402)).toBe('billing');
    expect(transcriptionError('budget_exhausted',429)).toBe('budget');
    expect(transcriptionError('provider_rate_limited',429)).toBe('rate');
    expect(transcriptionError(undefined,401)).toBe('session');
    expect(transcriptionError(undefined,422)).toBe('format');
    expect(transcriptionError('private upstream content',500)).toBe('failed');
  });
});
