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
  sources,
  withReadings,
  type ConditionDraft,
  type Draft,
  type Outcome,
} from './draft';
import type { Example } from './examples';

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

  for (const [index, example] of examples.entries()) exampleSelect.append(h('option', { value: String(index) }, example.name));
  exampleSelect.append(h('option', { value: '' }, 'Start from an empty policy'));
  for (const [type, label] of Object.entries(CONDITION_LABELS)) addKind.append(h('option', { value: type }, label));

  root.append(
    h('section', { 'aria-labelledby': 'example-heading' },
      h('h2', { id: 'example-heading' }, '1. Pick an example'),
      h('p', {}, 'Each example is a case from the project’s shared test vectors. The contract has been run on every one of them and its answer recorded. You can change anything below afterwards.'),
      h('div', { class: 'field' }, h('label', { for: 'example' }, 'Example'), exampleSelect),
    ),
    h('section', { 'aria-labelledby': 'policy-heading' },
      h('h2', { id: 'policy-heading' }, '2. The policy'),
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
      h('h2', { id: 'world-heading' }, '3. The address being checked'),
      h('div', { class: 'field' },
        h('label', { for: 'policy-time' }, 'Ledger time (unix seconds)'),
        policyTime,
        h('small', { id: 'policy-time-hint' }, 'The time a time window is compared with.'),
      ),
      sourceList,
    ),
    h('section', { 'aria-labelledby': 'result-heading' },
      h('h2', { id: 'result-heading' }, '4. What the model says'),
      announcement,
      result,
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
          h('div', { class: 'field check' },
            h('input', { id: `${valueId}-unavailable`, type: 'checkbox', checked: unavailable, ...data('unavailable') }),
            h('label', { for: `${valueId}-unavailable` }, 'Reading the balance fails (the contract raises an error, has no balance function, or is not a token)'),
          ),
        );
      }),
    );
  }

  function renderOutcome(outcome: Outcome): HTMLElement[] {
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
        return [
          h('p', { class: `verdict ${decision.allowed ? 'allowed' : 'denied'}` }, h('strong', {}, verdict)),
          h('p', {}, outcome.explanation),
          h('dl', {},
            h('dt', {}, 'Reason'), h('dd', {}, decision.reason),
            h('dt', {}, 'Failed condition'), h('dd', {}, decision.failedIndex === null ? 'none' : String(decision.failedIndex + 1)),
            h('dt', {}, 'Policy version'), h('dd', {}, String(decision.version)),
            h('dt', {}, 'Ledger time'), h('dd', {}, outcome.ledgerTime),
          ),
          h('p', {}, h('strong', {}, 'The policy, in words')),
          h('ol', {}, ...outcome.described.map((sentence) => h('li', {}, sentence))),
        ];
      }
    }
  }

  function renderComparison(outcome: Outcome): HTMLElement {
    const example = examples[selected];
    if (example === undefined || !sameDraft(draft, example.draft)) {
      return h('p', { class: 'recorded' }, h('strong', {}, 'No recorded contract answer. '),
        'Contract answers are recorded for the examples exactly as they are listed; this input is different. For a real policy, the contract’s own answer is the one that counts.');
    }
    const { recorded } = example;
    const recordedText = `${recorded.allowed ? 'Allowed' : 'Denied'} (reason ${recorded.reason})`;
    const same =
      outcome.kind === 'decision' &&
      outcome.decision.allowed === recorded.allowed &&
      outcome.decision.reason === recorded.reason &&
      outcome.decision.failedIndex === recorded.failedIndex &&
      outcome.decision.version === recorded.version;
    return h('p', { class: 'recorded' },
      h('strong', {}, 'Recorded contract answer: '), recordedText, '. ',
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

  function renderResult(): void {
    const outcome = run(draft);
    result.replaceChildren(...renderOutcome(outcome), renderComparison(outcome));
    const line = summary(outcome);
    if (announcement.textContent !== line) announcement.textContent = line;
  }

  function renderAll(): void {
    renderPolicy();
    renderConditions();
    renderSources();
    renderResult();
  }

  function onInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    if (target === exampleSelect) {
      const value = (target as HTMLSelectElement).value;
      selected = value === '' ? -1 : Number(value);
      draft = selected === -1 ? emptyDraft() : structuredClone((examples[selected] as Example).draft);
      renderAll();
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
        }
      }
    } else if (scope === 'reading' && target instanceof HTMLInputElement) {
      const key = target.dataset['key'];
      if (key === undefined) return;
      if (prop === 'unavailable') {
        draft.readings[key] = target.checked ? { status: 'unavailable' } : { status: 'ok', value: '0' };
        renderSources();
      } else {
        draft.readings[key] = { status: 'ok', value: text };
      }
    }
    renderResult();
  }

  function onClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset['action'] === 'add') {
      draft.conditions.push(newCondition((addKind as HTMLSelectElement).value as ConditionDraft['type']));
    } else if (target.dataset['action'] === 'remove') {
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
  (exampleSelect as HTMLSelectElement).value = '0';
  renderAll();
}
