import { describe, expect, it } from 'vitest';

import { emptyDraft, newCondition, parseDraft, run, sameDraft, sources, withReadings, type Draft } from '../src/playground/draft';

const draftWith = (overrides: Partial<Draft>): Draft => withReadings({ ...emptyDraft(), ...overrides });

describe('run', () => {
  it('allows a balance that meets the minimum and denies one below it', () => {
    const at = (balance: string) =>
      run(
        draftWith({
          conditions: [{ type: 'token_balance', token: 'gold', min: '100' }],
          readings: { 'token_balance:gold': { status: 'ok', value: balance } },
        }),
      );
    expect(at('100')).toMatchObject({ kind: 'decision', decision: { allowed: true, reason: 'None' } });
    expect(at('99')).toMatchObject({ kind: 'decision', decision: { allowed: false, reason: 'BelowMinimum', failedIndex: 0 } });
  });

  it('reports an unreadable balance as unavailable, not as zero', () => {
    const outcome = run(
      draftWith({
        conditions: [{ type: 'token_balance', token: 'gold', min: '1' }],
        readings: { 'token_balance:gold': { status: 'unavailable' } },
      }),
    );
    expect(outcome).toMatchObject({ kind: 'decision', decision: { reason: 'BalanceUnavailable' } });
  });

  it('treats a balance nobody entered as zero, as the contract does for an address the token has never seen', () => {
    const outcome = run(draftWith({ conditions: [{ type: 'token_balance', token: 'gold', min: '1' }], readings: {} }));
    expect(outcome).toMatchObject({ kind: 'decision', decision: { allowed: false, reason: 'BelowMinimum' } });
  });

  it('opens a time window at its start and closes it at its end, the end not included', () => {
    const at = (timestamp: string) =>
      run(draftWith({ timestamp, conditions: [{ type: 'time_window', notBefore: '100', notAfter: '200' }] }));
    expect(at('99')).toMatchObject({ decision: { reason: 'BeforeWindow' } });
    expect(at('100')).toMatchObject({ decision: { allowed: true } });
    expect(at('199')).toMatchObject({ decision: { allowed: true } });
    expect(at('200')).toMatchObject({ decision: { reason: 'AfterWindow' } });
  });

  it('accepts a window with only one bound', () => {
    const only = (notBefore: string, notAfter: string) =>
      run(draftWith({ timestamp: '5', conditions: [{ type: 'time_window', notBefore, notAfter }] }));
    expect(only('', '10')).toMatchObject({ decision: { allowed: true } });
    expect(only('10', '')).toMatchObject({ decision: { reason: 'BeforeWindow' } });
  });

  it('denies an inactive policy whatever the balance', () => {
    const outcome = run(draftWith({ active: false, readings: { 'token_balance:token': { status: 'ok', value: '1000' } } }));
    expect(outcome).toMatchObject({ decision: { allowed: false, reason: 'Inactive', failedIndex: null } });
  });

  it('refuses the policies the contract would refuse to store, and says which rule', () => {
    const refused = (conditions: Draft['conditions']) => run(draftWith({ conditions }));
    expect(refused([])).toMatchObject({ kind: 'refused', error: 'NoConditions' });
    expect(refused([{ type: 'token_balance', token: 't', min: '0' }])).toMatchObject({ kind: 'refused', error: 'InvalidMinimum' });
    expect(refused([{ type: 'token_balance', token: 't', min: '-5' }])).toMatchObject({ kind: 'refused', error: 'InvalidMinimum' });
    expect(refused([{ type: 'nft_balance', collection: 'c', min: '0' }])).toMatchObject({ kind: 'refused', error: 'InvalidMinimum' });
    expect(refused([{ type: 'time_window', notBefore: '', notAfter: '' }])).toMatchObject({ kind: 'refused', error: 'InvalidTimeWindow' });
    expect(refused([{ type: 'time_window', notBefore: '10', notAfter: '10' }])).toMatchObject({ kind: 'refused', error: 'InvalidTimeWindow' });
    const nine = Array.from({ length: 9 }, () => ({ type: 'time_window' as const, notBefore: '1', notAfter: '' }));
    expect(refused(nine)).toMatchObject({ kind: 'refused', error: 'TooManyConditions' });
  });

  it('explains a decision in words and names the condition that failed', () => {
    const outcome = run(
      draftWith({
        conditions: [
          { type: 'time_window', notBefore: '', notAfter: '10' },
          { type: 'token_balance', token: 'gold', min: '5' },
        ],
        readings: { 'token_balance:gold': { status: 'ok', value: '1' } },
      }),
    );
    expect(outcome.kind).toBe('decision');
    if (outcome.kind !== 'decision') return;
    expect(outcome.explanation).toContain('condition 2 of 2');
    expect(outcome.described).toHaveLength(2);
    expect(outcome.ledgerTime).toBe('1970-01-01 00:00:00 UTC');
  });

  it('starts a new token or collection condition as a valid one, and a new window as the rule it still has to satisfy', () => {
    const outcomeFor = (type: Parameters<typeof newCondition>[0]) => run(withReadings({ ...emptyDraft(), conditions: [newCondition(type)] }));
    expect(outcomeFor('token_balance').kind).toBe('decision');
    expect(outcomeFor('nft_balance').kind).toBe('decision');
    expect(outcomeFor('time_window')).toMatchObject({ kind: 'refused', error: 'InvalidTimeWindow' });
  });
});

describe('typed values', () => {
  const problemsOf = (draft: Draft): string[] => {
    const parsed = parseDraft(draft);
    return parsed.ok ? [] : parsed.problems;
  };
  const withMin = (min: string): Draft => draftWith({ conditions: [{ type: 'token_balance', token: 'gold', min }] });

  it.each(['', '   ', 'abc', '1.5', '1e3', '0x10', '0b11', '--1', '1 2'])('does not read %j as a whole number', (text) => {
    expect(problemsOf(withMin(text))).toEqual(['Condition 1: the minimum must be a whole number.']);
  });

  it('reads whole numbers with surrounding space, and ones far beyond 53 bits, exactly', () => {
    const parsed = parseDraft(withMin('  170141183460469231731687303715884105727 '));
    expect(parsed.ok && parsed.rules.conditions[0]).toMatchObject({ min: 170141183460469231731687303715884105727n });
  });

  it('rejects values outside the range the contract stores', () => {
    expect(problemsOf(withMin('170141183460469231731687303715884105728'))[0]).toContain('must be between');
    expect(problemsOf(draftWith({ conditions: [{ type: 'nft_balance', collection: 'c', min: '4294967296' }] }))[0]).toContain('must be between');
    expect(problemsOf(draftWith({ timestamp: '18446744073709551616' }))[0]).toContain('must be between');
    expect(problemsOf(draftWith({ version: '0' }))[0]).toContain('must be between');
  });

  it('lists every problem, once each, rather than the first', () => {
    const problems = problemsOf(
      draftWith({
        version: 'x',
        timestamp: '',
        conditions: [
          { type: 'token_balance', token: ' ', min: 'q' },
          { type: 'nft_balance', collection: 'c', min: '' },
        ],
      }),
    );
    expect(problems).toEqual([
      'The policy version must be a whole number.',
      'The ledger time must be a whole number.',
      'Condition 1: name the token.',
      'Condition 1: the minimum must be a whole number.',
      'Condition 2: the minimum must be a whole number.',
    ]);
  });

  it('reports a bad balance once even when two conditions name the same token', () => {
    const problems = problemsOf(
      draftWith({
        conditions: [
          { type: 'token_balance', token: 'gold', min: '1' },
          { type: 'token_balance', token: 'gold', min: '2' },
        ],
        readings: { 'token_balance:gold': { status: 'ok', value: 'lots' } },
      }),
    );
    expect(problems).toEqual(['The balance in token gold must be a whole number.']);
  });

  it('keeps a token and a collection with the same name apart', () => {
    const list = sources([
      { type: 'token_balance', token: 'x', min: '1' },
      { type: 'nft_balance', collection: 'x', min: '1' },
    ]);
    expect(list.map((s) => s.key)).toEqual(['token_balance:x', 'nft_balance:x']);
  });
});

describe('sameDraft', () => {
  it('ignores spacing and readings of sources that are no longer named', () => {
    const a = draftWith({
      conditions: [{ type: 'token_balance', token: 'gold', min: '100' }],
      readings: { 'token_balance:gold': { status: 'ok', value: '5' } },
    });
    const b: Draft = {
      ...a,
      conditions: [{ type: 'token_balance', token: ' gold ', min: '100 ' }],
      readings: { 'token_balance:gold': { status: 'ok', value: '5' }, 'token_balance:old': { status: 'ok', value: '9' } },
    };
    expect(sameDraft(a, b)).toBe(true);
  });

  it('notices any real change', () => {
    const a = draftWith({});
    expect(sameDraft(a, { ...a, active: false })).toBe(false);
    expect(sameDraft(a, { ...a, timestamp: '1' })).toBe(false);
    expect(sameDraft(a, { ...a, readings: { 'token_balance:token': { status: 'unavailable' } } })).toBe(false);
    expect(sameDraft(a, { ...a, conditions: [{ type: 'token_balance', token: 'token', min: '101' }] })).toBe(false);
  });
});
