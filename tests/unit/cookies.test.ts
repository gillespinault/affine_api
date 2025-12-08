import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  decodeLoadResponse,
  encodeUpdateToBase64,
  parseSetCookies,
  serializeCookies,
} from '../../src/client';

const SAMPLE_COOKIE =
  'affine_session=s%3Arandom.session.token.signature; Path=/; HttpOnly; SameSite=Lax';

describe('cookie utilities', () => {
  it('parses multiple Set-Cookie headers into a jar', () => {
    const jar = parseSetCookies([SAMPLE_COOKIE, 'affine_user_id=12345; Path=/']);
    expect(jar.get('affine_session')).toBe('s%3Arandom.session.token.signature');
    expect(jar.get('affine_user_id')).toBe('12345');
  });

  it('serializes jar back to a Cookie header', () => {
    const jar = parseSetCookies([SAMPLE_COOKIE, 'another=value; Path=/']);
    const header = serializeCookies(jar);
    expect(header.split('; ').sort()).toEqual(
      ['affine_session=s%3Arandom.session.token.signature', 'another=value'].sort(),
    );
  });
});

describe('Yjs helpers', () => {
  it('returns empty doc when payload missing fields', () => {
    const { doc, stateVector } = decodeLoadResponse({});
    expect(doc).toBeDefined();
    expect(stateVector).toBeNull();
  });

  it('decodes base64 update into Y.Doc', () => {
    const sourceDoc = new Y.Doc();
    sourceDoc.getText('test').insert(0, 'hi');
    const update = Buffer.from(Y.encodeStateAsUpdate(sourceDoc)).toString('base64');

    const { doc, stateVector } = decodeLoadResponse({ data: { missing: update } });
    expect(stateVector).toBeNull();
    expect(doc.getText('test').toString()).toBe('hi');
  });

  it('encodes update as base64 payload', () => {
    const sourceDoc = new Y.Doc();
    sourceDoc.getText('test').insert(0, 'affine');

    const encoded = encodeUpdateToBase64(sourceDoc, null);
    const buffer = Buffer.from(encoded, 'base64');
    const targetDoc = new Y.Doc();
    Y.applyUpdate(targetDoc, buffer);

    expect(targetDoc.getText('test').toString()).toBe('affine');
  });
});
