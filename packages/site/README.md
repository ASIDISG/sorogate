# @sorogate/site

A static page, built with [Astro](https://astro.build), that works an access policy out in the browser and sets the
result beside the answer the Soroban contract is recorded as giving for the same input.

It has **no server, no wallet, no keys and makes no network calls**. It uses only the pure part of the SDK
(`@sorogate/sdk/model`), so the page does not ship the Stellar SDK.

## Where the examples come from

The examples are the cases in [`spec/vectors/evaluate.json`](../../spec/vectors/evaluate.json): the same cases the
contract (`contracts/access-policy/tests/vectors.rs`) and the SDK (`packages/sdk/test/vectors.test.ts`) are run against.
Nothing is written for the page. Each example carries the decision the contract is recorded as giving, and the page
shows it next to the model's only while the input is exactly the example; change a value and the page says that nothing
is recorded for that input.

`test/examples.test.ts` checks that every vector appears as an example and that the model, run through the page's own
code, gives the recorded answer for each. If a vector is added or changed, the page follows it.

## Layout

| Path | What it is |
| --- | --- |
| `src/pages/index.astro` | The page: introduction, what the page cannot tell you, and the mount point |
| `src/playground/draft.ts` | What is typed, how it is read, and how it becomes an outcome. No page code, fully tested |
| `src/playground/examples.ts` | The vectors as examples |
| `src/playground/view.ts` | The form and the result, drawn with the DOM; typed text is only ever put on the page as text |
| `src/styles/site.css` | Light and dark colours; the contrast of every pair was checked against WCAG AA |
| `test/` | Logic tests, the examples against the model, and a jsdom test that drives the real page code |

## Develop

Building needs Node 22.12 or newer (Astro's requirement; the SDK alone needs 20.11). The tests also use jsdom, which asks
for 22.22.2, 24.15 or newer; on 22.22.1 npm prints a warning and the tests still passed. CI uses the latest 22.

```bash
npm ci                              # from the repository root
npm run dev -w @sorogate/site       # http://localhost:4321
npm test -w @sorogate/site
npm run build -w @sorogate/site     # static files in packages/site/dist
```

The page imports the SDK's source, not its build, so `npm test` and `npm run typecheck` do not need the SDK to be built
first.

## What the tests do not cover

- **Real browsers.** The page test runs in jsdom. It checks behaviour, labels and that typed text is not turned into HTML,
  but not layout, focus order on a real screen, or what a screen reader says. Do those by hand before a release.
- **Colour contrast in context.** The palette was checked pair by pair, not by measuring the rendered page.
- **Deployment.** Nothing publishes the site yet. When it is published, set `site` (and `base` for a project page) in
  `astro.config.mjs`.
