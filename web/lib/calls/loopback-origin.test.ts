import { describe, expect, it } from 'vitest';
import { declaredLoopbackOfficeOrigin } from './loopback-origin';

describe('declared loopback office origin', () => {
  it('is http://127.0.0.1 on DEMO_PORT, defaulting to 3000', () => {
    expect(declaredLoopbackOfficeOrigin(undefined)).toBe('http://127.0.0.1:3000');
    expect(declaredLoopbackOfficeOrigin('')).toBe('http://127.0.0.1:3000');
    expect(declaredLoopbackOfficeOrigin('3477')).toBe('http://127.0.0.1:3477');
    expect(declaredLoopbackOfficeOrigin('65535')).toBe('http://127.0.0.1:65535');
  });

  it('rejects other ports and never emits localhost', () => {
    for (const port of ['0', '65536', '03000', '3000 ', 'abc', '127.0.0.1', '-1', '1.2']) {
      expect(declaredLoopbackOfficeOrigin(port)).toBeUndefined();
    }
    expect(declaredLoopbackOfficeOrigin('3477')).not.toContain('localhost');
  });
});
