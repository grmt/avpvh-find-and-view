import { describe, expect, it } from 'vitest';
import { diffWords } from '../../src/ts/diff';

describe('diffWords', () => {
  it('returns the text unchanged when nothing changed', () => {
    expect(diffWords('een twee', 'een twee')).toBe('een twee');
  });

  it('marks a replaced word as deleted and inserted', () => {
    expect(diffWords('de oude tekst', 'de nieuwe tekst')).toBe('de <del>oude</del><ins>nieuwe</ins> tekst');
  });

  it('marks words removed or added at the end', () => {
    expect(diffWords('a b c', 'a b')).toBe('a b<del> </del><del>c</del>');
    expect(diffWords('a b', 'a b c')).toBe('a b<ins> </ins><ins>c</ins>');
  });

  it('handles empty texts', () => {
    expect(diffWords('', '')).toBe('');
    expect(diffWords('', 'nieuw')).toBe('<ins>nieuw</ins>');
    expect(diffWords('oud', '')).toBe('<del>oud</del>');
  });

  it('escapes HTML in both texts', () => {
    expect(diffWords('<b>', '<i>')).toBe('<del>&lt;b&gt;</del><ins>&lt;i&gt;</ins>');
  });
});
