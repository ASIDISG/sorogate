/**
 * A policy in a link. The page address can carry a whole `Draft`, so a policy someone worked out can be sent to someone else
 * and opens exactly as it was.
 *
 * What comes back from an address is untrusted text from anyone. `decodeDraft` therefore never trusts its shape: it rebuilds a
 * `Draft` field by field from what it can check, limits every length and count, and gives up (returns `null`) on anything else.
 * What it returns is still only typed text; `run` in `draft.ts` is what judges whether it is a valid policy.
 */
import { MAX_CONDITIONS } from '@sorogate/sdk/model';

import { withReadings, type ConditionDraft, type Draft, type ReadingDraft } from './draft';

/** The address fragment a shared policy lives in: `#policy=<text>`. */
export const SHARE_PREFIX = '#policy=';

const MAX_ENCODED = 8000;
const MAX_FIELD = 200;
const MAX_READINGS = MAX_CONDITIONS * 2;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(text: string): string {
  const padded = text.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeDraft(draft: Draft): string {
  return toBase64Url(
    JSON.stringify({ a: draft.active, v: draft.version, t: draft.timestamp, c: draft.conditions, r: draft.readings }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_FIELD ? value : null;
}

function condition(value: unknown): ConditionDraft | null {
  if (!isRecord(value)) return null;
  switch (value['type']) {
    case 'token_balance': {
      const token = text(value['token']);
      const min = text(value['min']);
      return token === null || min === null ? null : { type: 'token_balance', token, min };
    }
    case 'nft_balance': {
      const collection = text(value['collection']);
      const min = text(value['min']);
      return collection === null || min === null ? null : { type: 'nft_balance', collection, min };
    }
    case 'time_window': {
      const notBefore = text(value['notBefore']);
      const notAfter = text(value['notAfter']);
      return notBefore === null || notAfter === null ? null : { type: 'time_window', notBefore, notAfter };
    }
    default:
      return null;
  }
}

function reading(value: unknown): ReadingDraft | null {
  if (!isRecord(value)) return null;
  if (value['status'] === 'unavailable') return { status: 'unavailable' };
  const amount = text(value['value']);
  return value['status'] === 'ok' && amount !== null ? { status: 'ok', value: amount } : null;
}

/** The `Draft` a fragment carries, or `null` if it is not one. Accepts the fragment with or without its `#policy=` prefix. */
export function decodeDraft(fragment: string): Draft | null {
  const encoded = fragment.startsWith(SHARE_PREFIX) ? fragment.slice(SHARE_PREFIX.length) : fragment;
  if (encoded.length === 0 || encoded.length > MAX_ENCODED || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const version = text(parsed['v']);
  const timestamp = text(parsed['t']);
  const rawConditions = parsed['c'];
  const rawReadings = parsed['r'];
  if (typeof parsed['a'] !== 'boolean' || version === null || timestamp === null) return null;
  if (!Array.isArray(rawConditions) || rawConditions.length > MAX_CONDITIONS) return null;
  if (!isRecord(rawReadings) || Object.keys(rawReadings).length > MAX_READINGS) return null;

  const conditions: ConditionDraft[] = [];
  for (const raw of rawConditions) {
    const checked = condition(raw);
    if (checked === null) return null;
    conditions.push(checked);
  }
  const readings: Record<string, ReadingDraft> = {};
  for (const [key, raw] of Object.entries(rawReadings)) {
    if (FORBIDDEN_KEYS.has(key) || key.length > MAX_FIELD) return null;
    const checked = reading(raw);
    if (checked === null) return null;
    readings[key] = checked;
  }
  return withReadings({ active: parsed['a'], version, timestamp, conditions, readings });
}
