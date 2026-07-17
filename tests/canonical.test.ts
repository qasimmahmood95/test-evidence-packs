import { describe, expect, it } from 'vitest';
import { canonicalJson, canonicalJsonPretty, sha256Hex, sortDeep } from '../src/canonical.js';

describe('canonical JSON', () => {
  it('sorts object keys recursively', () => {
    const value = { b: 1, a: { z: true, y: [{ q: 1, p: 2 }] } };
    expect(canonicalJson(value)).toBe('{"a":{"y":[{"p":2,"q":1}],"z":true},"b":1}');
  });

  it('is independent of key insertion order', () => {
    const a = { x: 1, y: 2 };
    const b: Record<string, number> = {};
    b['y'] = 2;
    b['x'] = 1;
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('drops undefined-valued keys', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('sorts by codepoint, never by locale', () => {
    expect(canonicalJson({ ä: 1, z: 2 })).toBe('{"z":2,"ä":1}');
  });

  it('pretty form ends with a newline', () => {
    expect(canonicalJsonPretty({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('sortDeep does not mutate its input', () => {
    const value = { b: 1, a: 2 };
    sortDeep(value);
    expect(Object.keys(value)).toEqual(['b', 'a']);
  });
});

describe('sha256Hex', () => {
  it('matches the NIST test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes bytes and equivalent strings identically', () => {
    expect(sha256Hex(Buffer.from('abc', 'utf8'))).toBe(sha256Hex('abc'));
  });
});
