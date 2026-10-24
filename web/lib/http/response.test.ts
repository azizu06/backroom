import { describe, expect, it } from 'vitest';
import { jsonObject, outageMessage, serverError } from './response';

const res = (body: string, type = 'application/json') => new Response(body, { status: 200, headers: { 'content-type': type } });

describe('jsonObject', () => {
  it('returns a JSON object body', async () => {
    expect(await jsonObject(res('{"error":"X","n":1}'))).toEqual({ error: 'X', n: 1 });
  });
  it('rejects HTML, empty, null, arrays and primitives without throwing', async () => {
    for (const body of ['<html>Bad gateway</html>', '', 'null', '[1]', '"x"', '42'])
      expect(await jsonObject(res(body, body.startsWith('<') ? 'text/html' : 'application/json'))).toBeUndefined();
  });
});

describe('messages', () => {
  it('names the HTTP status', () => {
    expect(outageMessage(502)).toBe('Backroom is not responding right now (HTTP 502). Try again in a moment.');
  });
  it('reads only a string error', () => {
    expect(serverError({ error: 'Operator code rejected.' })).toBe('Operator code rejected.');
    expect(serverError({ error: { nested: true } })).toBeUndefined();
    expect(serverError({})).toBeUndefined();
  });
});
