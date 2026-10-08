/**
 * Draws the playground into a page and wires its fields to a `Draft`. Everything typed by a person is put on the page as
 * text (never as HTML), and every field has a visible label.
 */
import { MAX_CONDITIONS } from '@sorogate/sdk/model';

import {
  emptyDraft,
  newCondition,
  run,
  sameDraft,
  sliderRange,
  sources,
  withReadings,
  type ConditionDraft,
  type Draft,
  type Outcome,
  type ReadingDraft,
  type Source,
} from './draft';
import type { Example } from './examples';
import { decodeDraft, encodeDraft, SHARE_PREFIX } from './share';

type Attributes = Record<string, string | boolean | undefined>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  element.append(...children);
  return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small status mark. Built node by node, never from a string, and hidden from assistive technology: the words next to it
 * say the same thing. */
function icon(kind: 'ok' | 'no' | 'na'): HTMLElement {
  const wrap = h('span', { class: `icon ${kind}`, 'aria-hidden': 'true' });
  if (kind === 'na') return wrap;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', kind === 'ok' ? 'M3 8.5l3.2 3.2L13 4.8' : 'M4 4l8 8M12 4l-8 8');
  svg.append(path);
  wrap.append(svg);
  return wrap;
}

type TrailState = 'holds' | 'fails' | 'skipped';

/**
 * The logo as the answer: a gate with one bar for each condition. A bar lights up as its condition holds, turns red where it
 * fails, and stays dim for the conditions never reached, and the gate fills with light only when every one holds. It is a
 * picture of the trail beside it, so assistive technology skips it.
 */
function gate(states: readonly TrailState[], allowed: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', `gate ${allowed ? 'allowed' : 'denied'}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = 'M26 110 V56 a34 34 0 0 1 68 0 V110';
  const light = document.createElementNS(SVG_NS, 'path');
  light.setAttribute('d', `${shape} Z`);
  light.setAttribute('class', 'gate-light');
  const arch = document.createElementNS(SVG_NS, 'path');
  arch.setAttribute('d', shape);
  arch.setAttribute('class', 'gate-arch');
  arch.setAttribute('fill', 'none');
  arch.setAttribute('stroke', 'currentColor');
  arch.setAttribute('stroke-width', '9');
  arch.setAttribute('stroke-linecap', 'round');
  arch.setAttribute('stroke-linejoin', 'round');
  svg.append(light, arch);
  const shown = states.slice(0, MAX_CONDITIONS);
  const spacing = Math.min(15, 54 / Math.max(shown.length, 1));
  const thickness = Math.max(3, Math.min(7, spacing - 3));
  shown.forEach((state, index) => {
    const bar = document.createElementNS(SVG_NS, 'rect');
    bar.setAttribute('x', '43');
    bar.setAttribute('width', '34');
    bar.setAttribute('height', String(thickness));
    bar.setAttribute('rx', String(thickness / 2));
    bar.setAttribute('y', String(50 + index * spacing));
    bar.setAttribute('class', `gate-bar ${state}`);
    bar.setAttribute('style', `--i: ${index}`);
    svg.append(bar);
  });
  return svg;
}

function heading(id: string, step: number, text: string): HTMLElement {
  return h('h2', { id }, h('span', { class: 'step' }, String(step)), text);
}

const CONDITION_LABELS: Record<ConditionDraft['type'], string> = {
  token_balance: 'Holds at least some of a token',
  nft_balance: 'Holds at least some items of a collection',
  time_window: 'The ledger time is inside a window',
};

function textField(id: string, label: string, value: string, data: Attributes, hint?: string): HTMLElement {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  return h(
    'div',
    { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, type: 'text', value, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': hintId, ...data }),
    hint === undefined ? '' : h('small', { id: hintId }, hint),
  );
}

export function mount(root: HTMLElement, examples: readonly Example[]): void {
  const first = examples[0];
  if (first === undefined) throw new Error('The playground needs at least one example');

  let selected = 0;
  let draft: Draft = structuredClone(first.draft);

  // A policy sent as a link opens as it was sent. Anything in the address that is not a policy is ignored.
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const sent = hash.startsWith(SHARE_PREFIX) ? decodeDraft(hash) : null;
  if (sent !== null) {
    draft = sent;
    selected = examples.findIndex((example) => sameDraft(example.draft, sent));
  }

  root.replaceChildren();
  const exampleSelect = h('select', { id: 'example' });
  const policyActive = h('input', { id: 'policy-active', type: 'checkbox', 'data-scope': 'policy', 'data-prop': 'active' });
  const policyVersion = h('input', { id: 'policy-version', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-scope': 'policy', 'data-prop': 'version', 'aria-describedby': 'policy-version-hint' });
  const policyTime = h('input', { id: 'policy-time', type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-scope': 'policy', 'data-prop': 'timestamp', 'aria-describedby': 'policy-time-hint' });
  const conditionList = h('div', { id: 'conditions' });
  const addKind = h('select', { id: 'add-kind' });
  const sourceList = h('div', { id: 'sources' });
  const result = h('div', { id: 'result' });
  const announcement = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  // The examples as cards that can be swiped (or scrolled, or stepped with the buttons). The list below is the same choice for
  // anyone who would rather pick from a list, and for assistive technology.
  const cards = examples.map((example, index) =>
    h('button',
      {
        type: 'button',
        class: `example-card spot ${example.expected.allowed ? 'allowed' : 'denied'}`,
        'data-action': 'pick',
        'data-index': String(index),
        'aria-pressed': 'false',
      },
      h('span', { class: 'n' }, `Example ${index + 1} of ${examples.length}`),
      h('span', { class: 'name' }, example.name),
      h('span', { class: 'chip' }, example.expected.allowed ? 'Allowed' : `Denied: ${example.expected.reason}`),
    ),
  );
  const carousel = h('div', { class: 'carousel', role: 'group', 'aria-label': 'Examples: swipe or scroll sideways, or use the buttons', tabindex: '0' }, ...cards);
  const shareNote = h('small', { class: 'share-note', role: 'status', 'aria-live': 'polite' });

  for (const [index, example] of examples.entries()) exampleSelect.append(h('option', { value: String(index) }, example.name));
  exampleSelect.append(h('option', { value: '' }, 'Start from an empty policy'));
  for (const [type, label] of Object.entries(CONDITION_LABELS)) addKind.append(h('option', { value: type }, label));

  root.append(
    h('section', { 'aria-labelledby': 'example-heading' },
      heading('example-heading', 1, 'Pick an example'),
      h('p', {}, 'Each example is a case from the project’s shared test vectors. The contract’s own tests require it to give the answer shown beside the model’s. You can change anything below afterwards.'),
      h('div', { class: 'carousel-wrap' },
        carousel,
        h('div', { class: 'carousel-nav' },
          h('button', { type: 'button', class: 'quiet', 'data-action': 'earlier', 'aria-label': 'Show earlier examples' }, '←'),
          h('button', { type: 'button', class: 'quiet', 'data-action': 'later', 'aria-label': 'Show later examples' }, '→'),
        ),
      ),
      h('div', { class: 'field' }, h('label', { for: 'example' }, 'Example'), exampleSelect),
    ),
    h('section', { 'aria-labelledby': 'policy-heading' },
      heading('policy-heading', 2, 'The policy'),
      h('div', { class: 'field check' }, policyActive, h('label', { for: 'policy-active' }, 'The owner has the policy switched on')),
      h('div', { class: 'field' },
        h('label', { for: 'policy-version' }, 'Policy version'),
        policyVersion,
        h('small', { id: 'policy-version-hint' }, 'Starts at 1 and goes up by one each time the owner changes the conditions.'),
      ),
      h('p', { id: 'conditions-intro' }, `All conditions must hold. A policy holds at most ${MAX_CONDITIONS}, and the first one that fails decides the answer.`),
      conditionList,
      h('div', { class: 'add' },
        h('label', { for: 'add-kind' }, 'Add a condition'),
        addKind,
        h('button', { type: 'button', 'data-action': 'add' }, 'Add'),
      ),
    ),
    h('section', { 'aria-labelledby': 'world-heading' },
      heading('world-heading', 3, 'The address being checked'),
      h('div', { class: 'field' },
        h('label', { for: 'policy-time' }, 'Ledger time (unix seconds)'),
        policyTime,
        h('small', { id: 'policy-time-hint' }, 'The time a time window is compared with.'),
      ),
      sourceList,
    ),
    h('section', { 'aria-labelledby': 'result-heading' },
      heading('result-heading', 4, 'What the model says'),
      announcement,
      result,
      h('div', { class: 'share' },
        h('button', { type: 'button', class: 'quiet', 'data-action': 'share' }, 'Copy a link to this policy'),
        shareNote,
      ),
    ),
  );

  function renderPolicy(): void {
    (policyActive as HTMLInputElement).checked = draft.active;
    (policyVersion as HTMLInputElement).value = draft.version;
    (policyTime as HTMLInputElement).value = draft.timestamp;
  }

  function conditionCard(condition: ConditionDraft, index: number): HTMLElement {
    const id = `c${index}`;
    const data = (prop: string): Attributes => ({ 'data-scope': 'condition', 'data-index': String(index), 'data-prop': prop });
    const typeSelect = h('select', { id: `${id}-type`, ...data('type') });
    for (const [type, label] of Object.entries(CONDITION_LABELS)) {
      typeSelect.append(h('option', { value: type, selected: type === condition.type }, label));
    }
    const fields: HTMLElement[] =
      condition.type === 'token_balance'
        ? [
            textField(`${id}-token`, 'Token (a name or an address)', condition.token, data('token')),
            textField(`${id}-min`, 'Minimum balance, in the token’s smallest unit', condition.min, data('min'), 'A whole number above zero.'),
          ]
        : condition.type === 'nft_balance'
          ? [
              textField(`${id}-collection`, 'Collection (a name or an address)', condition.collection, data('collection')),
              textField(`${id}-min`, 'Minimum number of items', condition.min, data('min'), 'A whole number above zero.'),
            ]
          : [
              textField(`${id}-notBefore`, 'Opens at (unix seconds)', condition.notBefore, data('notBefore'), 'Leave empty for no start.'),
              textField(`${id}-notAfter`, 'Closes at (unix seconds)', condition.notAfter, data('notAfter'), 'The window is open up to, but not including, this second. Leave empty for no end.'),
            ];
    return h('fieldset', { class: 'card' },
      h('legend', {}, `Condition ${index + 1}`),
      h('div', { class: 'field' }, h('label', { for: `${id}-type` }, 'Kind'), typeSelect),
      ...fields,
      h('button', { type: 'button', class: 'quiet', 'data-action': 'remove', 'data-index': String(index) }, `Remove condition ${index + 1}`),
    );
  }

  function renderConditions(): void {
    conditionList.replaceChildren(...draft.conditions.map(conditionCard));
  }

  /** A slider for one balance, with a line at the minimum: the most direct way to see where an answer flips. Nothing when the
   * minimum is not a number a slider can show. The text field beside it stays the exact value. */
  function fillOf(value: number, max: number): string {
    return `${Math.min(100, Math.max(0, (value / max) * 100))}%`;
  }

  function sliderField(source: Source, valueId: string, reading: ReadingDraft): HTMLElement | string {
    const range = sliderRange(draft.conditions, source);
    if (range === null) return '';
    const typed = reading.status === 'ok' ? reading.value.trim() : '';
    const current = /^\d+$/.test(typed) ? Math.min(Number(typed), range.max) : 0;
    const id = `${valueId}-slide`;
    return h('div', { class: 'field slider', style: `--at: ${range.minimum / range.max}` },
      h('label', { for: id }, 'Slide the balance and watch the answer change'),
      h('div', { class: 'slider-track' },
        h('input', {
          id,
          type: 'range',
          min: '0',
          max: String(range.max),
          step: String(range.step),
          value: String(current),
          style: `--fill: ${fillOf(current, range.max)}`,
          disabled: reading.status === 'unavailable',
          'data-scope': 'reading',
          'data-key': source.key,
          'data-prop': 'slide',
          'aria-describedby': `${id}-hint`,
        }),
        h('span', { class: 'slider-line', 'aria-hidden': 'true' }),
      ),
      h('small', { id: `${id}-hint` }, `The line marks the minimum, ${range.minimum}. Slide past it and the condition holds.`),
    );
  }

  function renderSources(): void {
    const list = sources(draft.conditions);
    if (list.length === 0) {
      sourceList.replaceChildren(h('p', { class: 'muted' }, 'No token or collection is named yet, so there is no balance to set.'));
      return;
    }
    sourceList.replaceChildren(
      ...list.map((source, index) => {
        const reading = draft.readings[source.key] ?? { status: 'ok', value: '0' };
        const name = source.name === '' ? '(unnamed)' : source.name;
        const unavailable = reading.status === 'unavailable';
        const data = (prop: string): Attributes => ({ 'data-scope': 'reading', 'data-key': source.key, 'data-prop': prop });
        const valueId = `reading-${index}`;
        return h('fieldset', { class: 'card' },
          h('legend', {}, `${source.kind === 'token' ? 'Token' : 'Collection'} ${name}`),
          h('div', { class: 'field' },
            h('label', { for: valueId }, source.kind === 'token' ? 'Balance of the address, in the smallest unit' : 'Number of items the address holds'),
            h('input', { id: valueId, type: 'text', inputmode: 'numeric', autocomplete: 'off', value: reading.status === 'ok' ? reading.value : '', disabled: unavailable, ...data('value') }),
          ),
          sliderField(source, valueId, reading),
          h('div', { class: 'field check' },
            h('input', { id: `${valueId}-unavailable`, type: 'checkbox', checked: unavailable, ...data('unavailable') }),
            h('label', { for: `${valueId}-unavailable` }, 'Reading the balance fails (the contract raises an error, has no balance function, or is not a token)'),
          ),
        );
      }),
    );
  }

  function renderOutcome(outcome: Outcome, play: boolean): HTMLElement[] {
    switch (outcome.kind) {
      case 'invalid-input':
        return [
          h('p', { class: 'notice' }, h('strong', {}, 'Fix these first:')),
          h('ul', {}, ...outcome.problems.map((problem) => h('li', {}, problem))),
        ];
      case 'refused':
        return [h('p', { class: 'notice' }, h('strong', {}, 'Not a valid policy. '), `The contract would refuse to store it (${outcome.error}). ${outcome.message}`)];
      case 'decision': {
        const { decision } = outcome;
        const verdict = decision.allowed ? 'Allowed' : 'Denied';
        // The conditions are worked out in order and the first that fails decides, so the ones after it were never looked at.
        const states: TrailState[] = outcome.described.map((_, index): TrailState => {
          const failedAt = decision.failedIndex;
          if (decision.allowed) return 'holds';
          if (decision.reason === 'Inactive' || failedAt === null) return 'skipped';
          return index < failedAt ? 'holds' : index === failedAt ? 'fails' : 'skipped';
        });
        const trail = outcome.described.map((sentence, index) => {
          const state = states[index] ?? 'skipped';
          const words =
            state === 'holds' ? 'Holds'
            : state === 'fails' ? `Fails: ${decision.reason}`
            : decision.reason === 'Inactive' ? 'Not checked: the policy is switched off'
            : 'Not reached: it stops at the first failure';
          return h('li', { class: state, style: `--i: ${index}` },
            icon(state === 'holds' ? 'ok' : state === 'fails' ? 'no' : 'na'),
            h('span', {}, sentence.charAt(0).toUpperCase() + sentence.slice(1), h('small', { class: 'state' }, words)),
          );
        });
        return [
          h('div', { class: `verdict-card ${decision.allowed ? 'allowed' : 'denied'}${play ? ' play' : ''}` },
            icon(decision.allowed ? 'ok' : 'no'),
            h('div', {}, h('strong', {}, verdict), h('span', { class: 'why' }, decision.allowed ? 'Every condition holds.' : `Reason: ${decision.reason}`)),
            gate(states, decision.allowed),
          ),
          h('p', {}, outcome.explanation),
          h('p', {}, h('strong', {}, 'How it was worked out')),
          h('ol', { class: `trail${play ? ' play' : ''}` }, ...trail),
          h('dl', { class: 'stats' },
            h('div', {}, h('dt', {}, 'Reason'), h('dd', {}, decision.reason)),
            h('div', {}, h('dt', {}, 'Failed condition'), h('dd', {}, decision.failedIndex === null ? 'none' : String(decision.failedIndex + 1))),
            h('div', {}, h('dt', {}, 'Policy version'), h('dd', {}, String(decision.version))),
            h('div', {}, h('dt', {}, 'Ledger time'), h('dd', {}, outcome.ledgerTime)),
          ),
        ];
      }
    }
  }

  function renderComparison(outcome: Outcome): HTMLElement {
    const example = examples[selected];
    if (example === undefined || !sameDraft(draft, example.draft)) {
      return h('p', { class: 'expected' }, h('strong', {}, 'No contract answer is fixed for this input. '),
        'The contract’s tests fix its answer only for the examples exactly as they are listed; this input is different. For a real policy, the contract’s own answer is the one that counts.');
    }
    const { expected } = example;
    const expectedText = `${expected.allowed ? 'Allowed' : 'Denied'} (reason ${expected.reason})`;
    const same =
      outcome.kind === 'decision' &&
      outcome.decision.allowed === expected.allowed &&
      outcome.decision.reason === expected.reason &&
      outcome.decision.failedIndex === expected.failedIndex &&
      outcome.decision.version === expected.version;
    return h('p', { class: same ? 'expected' : 'expected differs' },
      h('strong', {}, 'The contract’s tests require: '), expectedText, '. ',
      same ? 'The model gives the same answer.' : 'The model gives a DIFFERENT answer. That is a bug; please report it.');
  }

  /** One short line for a screen reader, spoken only when it differs from the last one. */
  function summary(outcome: Outcome): string {
    switch (outcome.kind) {
      case 'invalid-input':
        return 'Some values need fixing.';
      case 'refused':
        return `Not a valid policy: ${outcome.message}`;
      case 'decision':
        return outcome.decision.allowed ? 'Allowed.' : `Denied: ${outcome.decision.reason}.`;
    }
  }

  // The result animates in when the outcome changes (a different verdict, a different failing condition), not on every
  // keystroke that leaves it as it was.
  let lastShape = '';

  function renderResult(): void {
    const outcome = run(draft);
    const shape =
      outcome.kind === 'decision'
        ? `${outcome.decision.allowed}|${outcome.decision.reason}|${String(outcome.decision.failedIndex)}|${outcome.described.length}`
        : outcome.kind;
    const play = shape !== lastShape;
    lastShape = shape;
    result.replaceChildren(...renderOutcome(outcome, play), renderComparison(outcome));
    const line = summary(outcome);
    if (announcement.textContent !== line) announcement.textContent = line;
  }

  function reducedMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Runs a change to the page as a view transition in a browser that has them, and straight away in one that does not, or for
   * a person who asked for less motion. */
  function change(update: () => void): void {
    const start = (document as Document & { startViewTransition?: (callback: () => void) => unknown }).startViewTransition;
    if (typeof start !== 'function' || reducedMotion()) {
      update();
      return;
    }
    // The page must never be left showing the old answer. A browser runs the callback when it has a frame to take a picture
    // of, which can be late (a tab in the background) or not at all, so the update is also made on a timer, and only once.
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      update();
    };
    try {
      start.call(document, once);
    } catch {
      once();
    }
    setTimeout(once, 400);
  }

  function markSelected(): void {
    cards.forEach((card, index) => card.setAttribute('aria-pressed', index === selected ? 'true' : 'false'));
  }

  function renderAll(): void {
    renderPolicy();
    renderConditions();
    renderSources();
    renderResult();
    markSelected();
  }

  /** Starts from example `index`, or from an empty policy for -1. */
  function choose(index: number, centreCard: boolean): void {
    selected = index;
    draft = index === -1 ? emptyDraft() : structuredClone((examples[index] as Example).draft);
    (exampleSelect as HTMLSelectElement).value = index === -1 ? '' : String(index);
    change(renderAll);
    const card = cards[index];
    if (centreCard && card !== undefined && typeof carousel.scrollTo === 'function') {
      carousel.scrollTo({ left: card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  /** On a narrow screen the result is a long way below the cards, so bring it up. */
  function showResult(): void {
    const section = result.closest('section');
    const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 63.99rem)').matches;
    if (section !== null && narrow && typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  async function share(): Promise<void> {
    const fragment = `${SHARE_PREFIX}${encodeDraft(draft)}`;
    window.history.replaceState(null, '', fragment);
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}${fragment}`);
      shareNote.textContent = 'Link copied. Anyone who opens it sees this policy.';
    } catch {
      shareNote.textContent = 'Could not copy it for you. The link is now in your address bar.';
    }
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target === exampleSelect) {
      const value = (target as HTMLSelectElement).value;
      choose(value === '' ? -1 : Number(value), true);
      return;
    }
    const { scope, prop } = target.dataset;
    const text = target.value;
    if (scope === 'policy' && target instanceof HTMLInputElement) {
      if (prop === 'active') draft.active = target.checked;
      else if (prop === 'version') draft.version = text;
      else if (prop === 'timestamp') draft.timestamp = text;
    } else if (scope === 'condition') {
      const index = Number(target.dataset['index']);
      const condition = draft.conditions[index];
      if (condition === undefined || prop === undefined) return;
      if (prop === 'type') {
        draft.conditions[index] = newCondition(text as ConditionDraft['type']);
        draft = withReadings(draft);
        renderConditions();
        renderSources();
      } else {
        (condition as unknown as Record<string, string>)[prop] = text;
        if (prop === 'token' || prop === 'collection') {
          draft = withReadings(draft);
          renderSources();
        } else if (prop === 'min') {
          // A balance slider reaches twice the minimum, so it has to follow the minimum.
          renderSources();
        }
      }
    } else if (scope === 'reading' && target instanceof HTMLInputElement) {
      const key = target.dataset['key'];
      if (key === undefined) return;
      const escaped = CSS.escape(key);
      if (prop === 'unavailable') {
        draft.readings[key] = target.checked ? { status: 'unavailable' } : { status: 'ok', value: '0' };
        renderSources();
      } else if (prop === 'slide') {
        draft.readings[key] = { status: 'ok', value: text };
        const field = root.querySelector<HTMLInputElement>(`input[data-scope="reading"][data-prop="value"][data-key="${escaped}"]`);
        if (field !== null) field.value = text;
        target.style.setProperty('--fill', fillOf(Number(text), Number(target.max)));
      } else {
        draft.readings[key] = { status: 'ok', value: text };
        const slider = root.querySelector<HTMLInputElement>(`input[data-prop="slide"][data-key="${escaped}"]`);
        if (slider !== null && /^\d+$/.test(text.trim())) {
          slider.value = String(Math.min(Number(text.trim()), Number(slider.max)));
          slider.style.setProperty('--fill', fillOf(Number(slider.value), Number(slider.max)));
        }
      }
    }
    renderResult();
  }

  function onClick(event: Event): void {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const target = origin.closest('button');
    if (target === null) return;
    const action = target.dataset['action'];
    if (action === 'pick') {
      choose(Number(target.dataset['index']), false);
      showResult();
      return;
    }
    if (action === 'earlier' || action === 'later') {
      if (typeof carousel.scrollBy === 'function') {
        carousel.scrollBy({ left: (action === 'later' ? 1 : -1) * carousel.clientWidth * 0.85, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      return;
    }
    if (action === 'share') {
      void share();
      return;
    }
    if (action === 'add') {
      draft.conditions.push(newCondition((addKind as HTMLSelectElement).value as ConditionDraft['type']));
    } else if (action === 'remove') {
      draft.conditions.splice(Number(target.dataset['index']), 1);
    } else {
      return;
    }
    draft = withReadings(draft);
    renderConditions();
    renderSources();
    renderResult();
  }

  root.addEventListener('input', onInput);
  root.addEventListener('click', onClick);
  (exampleSelect as HTMLSelectElement).value = selected === -1 ? '' : String(selected);
  renderAll();
}
