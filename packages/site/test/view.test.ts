// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { examples } from '../src/playground/examples';
import { mount } from '../src/playground/view';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app') as HTMLElement;
  mount(root, examples);
});

const byLabel = <T extends HTMLElement>(text: string | RegExp): T => {
  const label = [...root.querySelectorAll('label')].find((l) => (typeof text === 'string' ? l.textContent === text : text.test(l.textContent ?? '')));
  if (label === undefined) throw new Error(`no label matching ${String(text)}`);
  const target = root.querySelector<T>(`#${CSS.escape(label.getAttribute('for') ?? '')}`);
  if (target === null) throw new Error(`label ${String(text)} points at nothing`);
  return target;
};

const type = (field: HTMLInputElement, value: string): void => {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const toggle = (field: HTMLInputElement, checked: boolean): void => {
  field.checked = checked;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (field: HTMLSelectElement, value: string): void => {
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
};
const result = (): string => root.querySelector('#result')?.textContent ?? '';
const spoken = (): string => root.querySelector('[role="status"]')?.textContent ?? '';
const indexOfExample = (fragment: string): string => String(examples.findIndex((e) => e.name.includes(fragment)));

describe('the playground page', () => {
  it('starts on the first example with the model and the recorded contract answer agreeing', () => {
    expect(result()).toContain('Allowed');
    expect(result()).toContain('Recorded contract answer: Allowed (reason None)');
    expect(result()).toContain('The model gives the same answer.');
  });

  it('offers every example, plus an empty policy', () => {
    const options = byLabel<HTMLSelectElement>('Example').options;
    expect(options.length).toBe(examples.length + 1);
  });

  it('shows a denial with its reason and the condition that failed', () => {
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    expect(result()).toContain('Denied');
    expect(result()).toContain('BelowMinimum');
    expect(result()).toContain('Recorded contract answer: Denied (reason BelowMinimum)');
  });

  it('says nothing is recorded as soon as a value is changed', () => {
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '7');
    expect(result()).toContain('No recorded contract answer.');
    expect(result()).not.toContain('Recorded contract answer:');
  });

  it('recomputes the decision when the balance changes', () => {
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    expect(result()).toContain('Denied');
    type(byLabel<HTMLInputElement>(/^Balance of the address/), '100000');
    expect(result()).toContain('Allowed');
  });

  it('can mark the balance as unreadable, and that is a denial of its own kind', () => {
    toggle(byLabel<HTMLInputElement>(/^Reading the balance fails/), true);
    expect(byLabel<HTMLInputElement>(/^Balance of the address/).disabled).toBe(true);
    expect(result()).toContain('BalanceUnavailable');
  });

  it('lists what to fix instead of guessing when a value is not a whole number', () => {
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '1.5');
    expect(result()).toContain('Fix these first:');
    expect(result()).toContain('Condition 1: the minimum must be a whole number.');
  });

  it('refuses an empty policy the way the contract would', () => {
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    const remove = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Remove condition 1') as HTMLButtonElement;
    remove.click();
    expect(result()).toContain('NoConditions');
    expect(root.querySelectorAll('fieldset.card').length).toBe(0);
  });

  it('adds a condition of the chosen kind and asks for its balance', () => {
    choose(byLabel<HTMLSelectElement>('Add a condition'), 'nft_balance');
    ([...root.querySelectorAll('button')].find((b) => b.textContent === 'Add') as HTMLButtonElement).click();
    expect(root.textContent).toContain('Condition 2');
    expect(root.textContent).toContain('Number of items the address holds');
  });

  it('starts an empty policy that already works out a decision', () => {
    choose(byLabel<HTMLSelectElement>('Example'), '');
    expect(result()).toContain('Denied');
    expect(result()).toContain('No recorded contract answer.');
  });

  it('puts what is typed on the page as text, never as HTML', () => {
    const name = byLabel<HTMLInputElement>(/^Token \(a name/);
    type(name, '<img src=x onerror="document.title=\'hacked\'">');
    expect(root.querySelector('img')).toBeNull();
    expect(document.title).not.toBe('hacked');
    expect(root.textContent).toContain('<img src=x');
  });

  it('gives every field a visible label that points at it', () => {
    for (const field of root.querySelectorAll('input, select')) {
      const id = field.getAttribute('id');
      expect(id, field.outerHTML).toBeTruthy();
      expect(root.querySelector(`label[for="${CSS.escape(id as string)}"]`), field.outerHTML).not.toBeNull();
    }
    const ids = [...root.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says the verdict aloud once, and only when it changes', () => {
    const before = spoken();
    expect(before).toBe('Allowed.');
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '50');
    expect(spoken()).toBe(before);
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    expect(spoken()).toBe('Denied: BelowMinimum.');
  });
});
