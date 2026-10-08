// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { examples } from '../src/playground/examples';
import { decodeDraft, encodeDraft, SHARE_PREFIX } from '../src/playground/share';
import { mount } from '../src/playground/view';

let root: HTMLElement;

beforeEach(() => {
  window.location.hash = '';
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
  it('starts on the first example with the model and the answer the contract’s tests require agreeing', () => {
    expect(result()).toContain('Allowed');
    expect(result()).toContain('The contract’s tests require: Allowed (reason None)');
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
    expect(result()).toContain('The contract’s tests require: Denied (reason BelowMinimum)');
  });

  it('says no contract answer is fixed as soon as a value is changed', () => {
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '7');
    expect(result()).toContain('No contract answer is fixed for this input.');
    expect(result()).not.toContain('The contract’s tests require:');
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
    expect(result()).toContain('No contract answer is fixed for this input.');
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

describe('the cards, the slider, the gate and the link', () => {
  const cards = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.example-card')];
  const remount = (): void => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    mount(root, examples);
  };
  const shareButton = (): HTMLButtonElement =>
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy a link to this policy') as HTMLButtonElement;

  afterEach(() => {
    window.location.hash = '';
    vi.unstubAllGlobals();
  });

  it('offers every example as a card, and marks the one in use', () => {
    expect(cards().length).toBe(examples.length);
    expect(cards()[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(cards().filter((card) => card.getAttribute('aria-pressed') === 'true').length).toBe(1);
    expect(cards()[0]?.textContent).toContain('Allowed');
  });

  it('loads an example when its card is clicked, and keeps the list in step', () => {
    const index = Number(indexOfExample('one below the minimum'));
    cards()[index]?.click();
    expect(result()).toContain('Denied');
    expect(byLabel<HTMLSelectElement>('Example').value).toBe(String(index));
    expect(cards()[index]?.getAttribute('aria-pressed')).toBe('true');
    expect(cards()[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('also loads the example when a part inside the card is clicked', () => {
    const index = Number(indexOfExample('one below the minimum'));
    cards()[index]?.querySelector<HTMLElement>('.name')?.click();
    expect(result()).toContain('Denied');
  });

  it('flips the answer as a balance is slid across the minimum', () => {
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    expect(result()).toContain('Denied');
    const slider = byLabel<HTMLInputElement>(/^Slide the balance/);
    expect(slider.max).toBe('200');
    type(slider, '100');
    expect(result()).toContain('Allowed');
    expect(byLabel<HTMLInputElement>(/^Balance of the address/).value).toBe('100');
    type(slider, '99');
    expect(result()).toContain('Denied');
  });

  it('moves the slider when the balance is typed instead', () => {
    type(byLabel<HTMLInputElement>(/^Balance of the address/), '150');
    expect(byLabel<HTMLInputElement>(/^Slide the balance/).value).toBe('150');
  });

  it('keeps the slider as long as the minimum, and disables it when the balance cannot be read', () => {
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '1000');
    expect(byLabel<HTMLInputElement>(/^Slide the balance/).max).toBe('2000');
    toggle(byLabel<HTMLInputElement>(/^Reading the balance fails/), true);
    expect(byLabel<HTMLInputElement>(/^Slide the balance/).disabled).toBe(true);
  });

  it('offers no slider when the minimum is not a number a slider could show', () => {
    type(byLabel<HTMLInputElement>(/^Minimum balance/), 'lots');
    expect(root.querySelector('input[type="range"]')).toBeNull();
  });

  it('draws the gate with one bar for each condition, marked by what happened to it', () => {
    expect(root.querySelectorAll('.gate-bar').length).toBe(1);
    expect(root.querySelector('.gate-bar')?.getAttribute('class')).toContain('holds');
    choose(byLabel<HTMLSelectElement>('Example'), indexOfExample('one below the minimum'));
    expect(root.querySelector('.gate-bar')?.getAttribute('class')).toContain('fails');
    expect(root.querySelector('.gate')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('copies a link that carries the policy as it stands', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    type(byLabel<HTMLInputElement>(/^Minimum balance/), '77');
    shareButton().click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const link = String(writeText.mock.calls[0]?.[0]);
    expect(link).toContain(SHARE_PREFIX);
    const carried = decodeDraft(link.slice(link.indexOf(SHARE_PREFIX)));
    expect(carried?.conditions[0]).toMatchObject({ type: 'token_balance', min: '77' });
    await vi.waitFor(() => expect(root.querySelector('.share-note')?.textContent).toContain('Link copied'));
    expect(window.location.hash.startsWith(SHARE_PREFIX)).toBe(true);
  });

  it('says so, and does not fail, when the link cannot be copied', async () => {
    vi.stubGlobal('navigator', {});
    shareButton().click();
    await vi.waitFor(() => expect(root.querySelector('.share-note')?.textContent).toContain('address bar'));
  });

  it('opens a policy that was sent as a link, exactly as it was', () => {
    const sent = structuredClone((examples[0] as (typeof examples)[number]).draft);
    sent.conditions = [{ type: 'token_balance', token: 'silver', min: '5' }];
    sent.readings = { 'token_balance:silver': { status: 'ok', value: '4' } };
    window.location.hash = `${SHARE_PREFIX}${encodeDraft(sent)}`;
    remount();
    expect(byLabel<HTMLInputElement>(/^Token \(a name/).value).toBe('silver');
    expect(result()).toContain('Denied');
    expect(result()).toContain('No contract answer is fixed for this input.');
  });

  it('finds the example again when the link carries one unchanged', () => {
    const index = Number(indexOfExample('one below the minimum'));
    window.location.hash = `${SHARE_PREFIX}${encodeDraft((examples[index] as (typeof examples)[number]).draft)}`;
    remount();
    expect(byLabel<HTMLSelectElement>('Example').value).toBe(String(index));
    expect(result()).toContain('The contract’s tests require: Denied');
  });

  it('ignores an address fragment that is not a policy', () => {
    window.location.hash = `${SHARE_PREFIX}this-is-not-a-policy`;
    remount();
    expect(result()).toContain('Allowed');
    expect(byLabel<HTMLSelectElement>('Example').value).toBe('0');
  });

  describe('where the browser has view transitions', () => {
    const pickBelowMinimum = (): void => {
      cards()[Number(indexOfExample('one below the minimum'))]?.click();
    };

    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(document, 'startViewTransition');
    });

    it('still shows the new answer when the transition never runs its callback', () => {
      vi.useFakeTimers();
      Object.defineProperty(document, 'startViewTransition', { value: vi.fn(), configurable: true });
      pickBelowMinimum();
      vi.advanceTimersByTime(500);
      expect(result()).toContain('Denied');
    });

    it('still shows the new answer when starting a transition throws', () => {
      vi.useFakeTimers();
      Object.defineProperty(document, 'startViewTransition', {
        value: () => {
          throw new Error('not now');
        },
        configurable: true,
      });
      pickBelowMinimum();
      expect(result()).toContain('Denied');
    });

    it('makes the change once when the transition does run its callback', () => {
      vi.useFakeTimers();
      const start = vi.fn((callback: () => void) => callback());
      Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true });
      const before = root.querySelectorAll('.verdict-card').length;
      pickBelowMinimum();
      expect(start).toHaveBeenCalledTimes(1);
      expect(result()).toContain('Denied');
      const nodes = root.querySelectorAll('.verdict-card');
      vi.advanceTimersByTime(500);
      expect(root.querySelectorAll('.verdict-card')[0]).toBe(nodes[0]);
      expect(before).toBe(1);
    });
  });
});
