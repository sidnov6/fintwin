import {afterEach, expect, it} from 'vitest';
import worker from '../src/index';
import {viewer} from '../src/access';
import {testEnv} from './harness';
import {localOpenEnabled} from '../../scripts/local-access.mjs';

const databases: ReturnType<typeof testEnv>['sqlite'][] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function setup(overrides = {}) {
  const {env, sqlite} = testEnv({FINTWIN_LOCAL_OPEN: '1', FINTWIN_DEMO_PASSPHRASE: 'synthetic-test-passphrase', ...overrides});
  databases.push(sqlite);
  const call = (path: string, init: RequestInit = {}, origin = 'http://127.0.0.1:8798') => worker.fetch(new Request(origin + path, {...init, headers: {'content-type': 'application/json', ...init.headers}}), env);
  return {env, call};
}

it('opens a local opaque session without a passphrase, retaining identity on renewal', async () => {
  const {env, call} = setup();
  expect(await (await call('/v1/session')).json()).toEqual({ok: true, data: {passphraseRequired: false}});
  expect((await call('/v1/state')).status).toBe(401);
  const response = await call('/v1/session', {method: 'POST', body: '{}'});
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toMatch(/^fintwin_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict;/);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  expect((await call('/v1/state', {headers: {cookie}})).status).toBe(200);
  const identity = (value: string) => viewer(new Request('http://127.0.0.1:8798/', {headers: {cookie: value}}), env);
  const original = await identity(cookie);
  const renewal = await call('/v1/session', {method: 'POST', headers: {cookie}, body: '{}'});
  expect(await identity(renewal.headers.get('set-cookie')!.split(';')[0])).toBe(original);
  const separate = await call('/v1/session', {method: 'POST', body: '{}'});
  expect(await identity(separate.headers.get('set-cookie')!.split(';')[0])).not.toBe(original);
});

it.each([
  [{FINTWIN_LOCAL_OPEN: '0'}, 'http://127.0.0.1:8798'],
  [{}, 'https://fintwin.test'],
  [{}, 'https://localhost.evil.test'],
  [{FINTWIN_ALLOWED_ORIGIN: 'https://example.test'}, 'http://127.0.0.1:8798'],
])('retains the gate outside explicit same-origin loopback mode: %j %s', async (overrides, origin) => {
  const {call} = setup(overrides);
  expect(await (await call('/v1/session', {}, origin)).json()).toEqual({ok: true, data: {passphraseRequired: true}});
  expect((await call('/v1/session', {method: 'POST', body: '{}'}, origin)).status).toBe(401);
});

it('still rejects cross-site requests and form submissions in local mode', async () => {
  const {call} = setup();
  expect((await call('/v1/session', {method: 'POST', body: '{}', headers: {origin: 'https://evil.test'}})).status).toBe(403);
  expect((await call('/v1/session', {method: 'POST', body: '', headers: {'content-type': 'application/x-www-form-urlencoded'}})).status).toBe(403);
});

it('enables the host flag only for loopback without any public/cross-origin configuration', () => {
  expect(localOpenEnabled({})).toBe(false);
  for (const host of ['127.0.0.1', 'localhost', '::1']) expect(localOpenEnabled({FINTWIN_LOCAL_OPEN: '1', FINTWIN_HOST: host})).toBe(true);
  for (const settings of [
    {FINTWIN_HOST: '0.0.0.0'}, {FINTWIN_HOST: '::'}, {FINTWIN_HOST: '192.168.1.2'},
    {FINTWIN_PUBLIC_ORIGIN: 'https://demo.test'}, {FINTWIN_ALLOWED_ORIGIN: 'http://localhost:3000'},
  ]) expect(() => localOpenEnabled({FINTWIN_LOCAL_OPEN: '1', ...settings})).toThrow('loopback');
});
