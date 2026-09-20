import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode, RefObject, SyntheticEvent } from 'react';

import { formatPercent } from '@retrofit/contracts';

import { useApi } from '../api/useApi.js';
import { READOUTS, createAgentScene } from './tour-agent.js';
import type { AgentScene, BadgeId } from './tour-agent.js';
import { NODES, STEP_IDS } from './tour-agent-graph.js';
import type { StepId } from './tour-agent-graph.js';
import { webglAvailable } from './tour-house.js';
import { TestBench } from './tour-testbench.js';

/**
 * The dossier: everything on `/tour` past the 3D story. It covers the weighted
 * rulebook, the Federato planner, the testing and the limits. Architecture is
 * not here: the camera rail above tells that story. Panels are collapsed by
 * default so the page opens as a table of contents rather than a wall.
 *
 * Nothing here is decorative: the weights come from the live `GET /rules`, and
 * every prose number is one the README, VERIFICATION.md or the engine already
 * states. Where a number is fitted, invented or unmeasured, the panel says so.
 */

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Arm one element for a scroll reveal and drop the observer again once it has
 * played. Everything is visible without this: the hidden state is only ever
 * applied by `rf-reveal`, which JS adds, and only when the reader has not asked
 * for reduced motion and the browser has an IntersectionObserver.
 *
 * Shared by the whole dossier — the group heads, the figure rows, the panels
 * and the rule sheets all arrive the same way, so the page reads as one pass
 * of a pen rather than four different animations.
 */
export function useReveal<T extends HTMLElement>(): (node: T | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  return useCallback((node: T | null): void => {
    if (node === null) {
      observer.current?.disconnect();
      observer.current = null;
      return;
    }
    if (typeof IntersectionObserver === 'undefined' || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true) return;
    node.classList.add('rf-reveal');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );
    io.observe(node);
    observer.current = io;
  }, []);
}

/** One collapsible panel. Native `<details>`, so it survives with JS disabled. */
export function Panel(props: {
  readonly title: string;
  readonly note?: string;
  readonly open?: boolean;
  /**
   * Fired when this panel is opened, never when it is closed. The agent
   * section uses it to move its scene to the matching step; every other
   * caller ignores it and keeps the plain `<details>` behaviour.
   */
  readonly onOpen?: () => void;
  /** Marks this panel as the one the agent scene is currently playing. */
  readonly active?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  const { onOpen } = props;
  const reveal = useReveal<HTMLDetailsElement>();
  const handleToggle = useCallback(
    (event: SyntheticEvent<HTMLDetailsElement>): void => {
      if (event.currentTarget.open) onOpen?.();
    },
    [onOpen],
  );

  return (
    <details
      ref={reveal}
      className={props.active ? 'rf-tour__panel rf-tour__panel--active' : 'rf-tour__panel'}
      open={props.open ?? false}
      onToggle={handleToggle}
    >
      <summary>
        <span className="rf-tour__caret" aria-hidden="true" />
        <span>{props.title}</span>
        {props.note ? <span className="rf-tour__panel-note">{props.note}</span> : null}
      </summary>
      <div className="rf-tour__panel-body">{props.children}</div>
    </details>
  );
}

/**
 * A titled group of panels, with one button that opens or closes all of them.
 * The button walks the group's own `<details>` elements rather than lifting
 * `open` into React state, so each panel keeps its own independent toggle.
 */
export function Group(props: {
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  readonly children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const reveal = useReveal<HTMLDivElement>();

  const setAll = useCallback((open: boolean): void => {
    const root = ref.current;
    if (!root) return;
    for (const panel of root.querySelectorAll('details')) panel.open = open;
  }, []);

  return (
    <section
      className="rf-tour__group"
      id={props.id}
      ref={ref}
      aria-labelledby={`${props.id}-title`}
    >
      <div className="rf-tour__group-head" ref={reveal}>
        <h2 id={`${props.id}-title`}>{props.title}</h2>
        <button type="button" className="rf-tour__chip" onClick={() => setAll(true)}>
          Open all
        </button>
        <button type="button" className="rf-tour__chip" onClick={() => setAll(false)}>
          Close all
        </button>
      </div>
      <p className="rf-tour__group-lede">{props.lede}</p>
      {props.children}
    </section>
  );
}

/** Big-number row. `value` is the number; `label` says what it counts. */
export function Figures(props: {
  readonly items: readonly { readonly value: string; readonly label: string }[];
}): ReactElement {
  const reveal = useReveal<HTMLUListElement>();
  return (
    <ul className="rf-tour__figures" ref={reveal}>
      {props.items.map((item, i) => (
        <li
          key={item.label}
          className="rf-tour__figure"
          style={{ '--rf-fig-i': i } as CSSProperties}
        >
          <span className="rf-tour__figure-value">{item.value}</span>
          <span className="rf-tour__figure-label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Term/value grid. */
export function Defs(props: {
  readonly rows: readonly { readonly term: string; readonly value: ReactNode }[];
}): ReactElement {
  return (
    <dl className="rf-tour__defs">
      {props.rows.map((row) => (
        <div key={row.term} className="rf-tour__def">
          <dt>{row.term}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Architecture                                                               */
/* -------------------------------------------------------------------------- */

const WORKSPACES: readonly { readonly term: string; readonly value: string }[] = [
  {
    term: 'packages/engine',
    value:
      'Pure. Zero I/O, no clock, no randomness, no LLM SDK, no import from apps/*. Same input, same output, forever. Every verdict, score and dollar amount is decided here.',
  },
  {
    term: 'packages/federato',
    value:
      'The agent: reads the live schema into a resource graph, plans its queries against it, and records a trace of every one.',
  },
  {
    term: 'packages/contracts',
    value: 'The DTOs and formatters shared by the API, the console and the phone. Zod at every boundary.',
  },
  { term: 'packages/design', value: 'The token source. Colour, type, spacing and radius, one definition, three consumers.' },
  { term: 'packages/verify', value: 'The differential harness: property tests and the independent second implementation.' },
  { term: 'apps/api', value: 'Hono + better-sqlite3 + Drizzle. Enrichment, the image quality gate, every Gemini call, and storage.' },
  { term: 'apps/console', value: 'Vite + React 19. The underwriter surface: the ranked book, the rules, the terrain.' },
  { term: 'apps/mobile', value: 'Expo. The renter surface: sweep, confirm, questions, verdict, verify my fix.' },
];

/* -------------------------------------------------------------------------- */
/* The Federato agent                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Local to this file on purpose: `TourPage` has its own copy for the story
 * canvas, and the two surfaces are independent — neither should have to import
 * the other to ask the browser one question.
 */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * The schema graph, pinned beside the six steps. Opening a panel moves the
 * camera; the scene plays that step's beat.
 *
 * The 3D is an illustration of the prose next to it and never a replacement
 * for it: the canvas is `aria-hidden`, nothing here is a control, and with no
 * WebGL the stage never mounts and the section is an ordinary document.
 */
function AgentStage(props: {
  readonly step: StepId | null;
  /** Filled in by this component so the group can scrub the film on a click. */
  readonly sceneRef: RefObject<AgentScene | null>;
  readonly onStep: (step: StepId) => void;
  readonly onEnd: () => void;
}): ReactElement | null {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { sceneRef, onStep, onEnd } = props;
  const badgeRefs = useRef(new Map<BadgeId, HTMLElement>());
  const [live, setLive] = useState(false);

  const bindBadge = useCallback((id: BadgeId, el: HTMLElement | null): void => {
    if (el) badgeRefs.current.set(id, el);
    else badgeRefs.current.delete(id);
    sceneRef.current?.bindBadge(id, el);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const frame = frameRef.current;
    if (!host || !frame || !webglAvailable()) return;

    const scene = createAgentScene(host, {
      reducedMotion: prefersReducedMotion(),
      onStep,
      onEnd,
    });
    sceneRef.current = scene;
    for (const [id, el] of badgeRefs.current) scene.bindBadge(id, el);
    setLive(true);

    // The tour already runs the house scene above this one. Only the section
    // actually on screen should be spinning a render loop.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) scene.setActive(entry.isIntersecting);
      },
      { rootMargin: '10% 0px' },
    );
    observer.observe(frame);

    return () => {
      observer.disconnect();
      sceneRef.current = null;
      setLive(false);
      scene.dispose();
    };
    // Built once and alive until unmount: `sceneRef` is a ref and `onStep` is
    // a stable state setter, so neither can invalidate this effect.
  }, [sceneRef, onStep, onEnd]);

  const readout = READOUTS[props.step ?? STEP_IDS[0]];

  return (
    <div
      className={live ? 'rf-agent__stage rf-agent__stage--live' : 'rf-agent__stage'}
      ref={frameRef}
      aria-hidden="true"
    >
      <div className="rf-agent__canvas" ref={hostRef} />
      {/*
        Labels exist only once the scene does. They are positioned by it and
        meaningless without it, so with no WebGL they are not rendered at all
        rather than left in the document as hidden furniture. The scene is
        created first and binds whatever is already here; these arrive on the
        re-render that `setLive` triggers and bind themselves on the way in.
      */}
      {live ? (
        <div className="rf-agent__badges">
          {NODES.map((node) => (
            <span
              key={node.id}
              className="rf-agent__badge"
              ref={(el) => bindBadge(node.id, el)}
            >
              {node.label}
            </span>
          ))}
          <span
            className="rf-agent__badge rf-agent__badge--readout"
            ref={(el) => bindBadge('readout', el)}
          >
            <span className="rf-agent__readout-label">{readout.label}</span>
            <span className="rf-agent__readout-value">{readout.value}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AgentGroup(): ReactElement {
  // Null until a scene exists and reports its first step. Nothing is playing
  // before that, so nothing should be highlighted as playing.
  const [step, setStep] = useState<StepId | null>(null);
  const sceneRef = useRef<AgentScene | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  /**
   * The scene plays itself and tells us where it got to; this is only the
   * echo of that, used to highlight the step being drawn and to label the
   * readout. Scroll does not scrub the film — it only starts and pauses it,
   * through the stage's own intersection observer.
   */
  const onStep = useCallback((next: StepId): void => {
    setStep((was) => (was === next ? was : next));
  }, []);

  /**
   * The film has finished, so stop holding the reader here.
   *
   * The track is 500vh so the section can pin while the film plays, but once
   * it has played that height is just distance to nowhere. Rather than
   * collapsing it — which would yank everything below up the page — the track
   * is frozen at exactly the height already scrolled through, so the pin
   * releases from this point on and nothing above the fold moves at all.
   */
  const onEnd = useCallback((): void => {
    const track = trackRef.current;
    if (!track) return;
    const top = track.getBoundingClientRect().top + window.scrollY;
    const used = window.scrollY - top + window.innerHeight;
    track.style.height = `${Math.round(Math.max(window.innerHeight, used))}px`;
  }, []);

  // Clicking a step scrubs the film to that chapter, which then carries on.
  const onOpen = useRef(
    new Map<StepId, () => void>(
      STEP_IDS.map((id) => [id, (): void => sceneRef.current?.setStep(id)]),
    ),
  ).current;

  return (
    <Group
      id="agent"
      title="The Federato agent"
      lede="The planner builds its queries from the live schema and records why it chose each one."
    >
      {/*
        The scroll track. Only tall once a scene is actually running: with no
        WebGL there is nothing to pin, and five empty screens would be a bug.
      */}
      <div
        className={step !== null ? 'rf-agent__track rf-agent__track--live' : 'rf-agent__track'}
        ref={trackRef}
      >
        <div className="rf-agent">
          <AgentStage step={step} sceneRef={sceneRef} onStep={onStep} onEnd={onEnd} />

          <div className="rf-agent__steps">
            <Figures
              items={[
                { value: '4', label: 'planner queries' },
                { value: '9.2 s', label: 'to seed the book' },
                { value: '158', label: 'submissions stored and scored' },
                { value: '158', label: 'with a query trace' },
              ]}
            />

            <div className="rf-agent__panels">
              <Panel title="1 · Read" note="schema into a resource graph" onOpen={onOpen.get('read')} active={step === 'read'}>
                <p>
                  The schema is read into a resource graph, and every field the rulebook and the rating
                  table need is collected up front.
                </p>
              </Panel>

              <Panel title="2 · Locate" note="synonyms, then graph search" onOpen={onOpen.get('locate')} active={step === 'locate'}>
                <p>
                  A synonym table first, then a shortest-path search through the graph. Anything the table
                  cannot place stays <strong>visibly unmapped</strong> in the trace rather than silently
                  dropped.
                </p>
                <p>
                  The planner also accepts an injected Gemini <span className="rf-tour__mono">schema-assist</span>{' '}
                  (matches accepted only at 0.8 confidence or higher), but it is{' '}
                  <strong>not enabled in the shipped ingest path</strong>: on this dataset the synonym table
                  and graph search place every field the rulebook needs except building-level protection
                  class, which Federato stores on the location.
                </p>
              </Panel>

              <Panel title="3 · Plan" note="158 → 38 in one query" onOpen={onOpen.get('triage')} active={step === 'triage'}>
                <p>
                  One query over all 158 submissions for id, status and line of business. 120 are knocked
                  out on line of business, each citing the rule that did it.
                </p>
              </Panel>

              <Panel title="4 · Collect" note="27 policies, one query" onOpen={onOpen.get('deep')} active={step === 'deep'}>
                <p>
                  One <span className="rf-tour__mono">Policy</span> query expanding insured, claims and
                  exposure units down to buildings returns all 27 property policies fully hydrated. The
                  trace records why <span className="rf-tour__mono">Submission</span> was rejected as root:
                  no premium, TIV or building fields.
                </p>
              </Panel>

              <Panel title="5 · Adapt" note="rewrites and retries" onOpen={onOpen.get('adapt')} active={step === 'adapt'}>
                <p>
                  On the live handler a dot-path through an array silently matches nothing —{' '}
                  <span className="rf-tour__mono">exposure_units.location.state: CA</span> returns 0 rows,
                  while the <span className="rf-tour__mono">$elemMatch</span> form returns 47. On zero
                  results the planner rewrites the clause into <span className="rf-tour__mono">$elemMatch</span>{' '}
                  form, or drops the narrowest filter, and records which.
                </p>
                <p>
                  It also <strong>declines <span className="rf-tour__mono">over</span></strong>: the docs
                  call it a GROUP BY, but the deployed handler returns one row per record and a constant{' '}
                  <span className="rf-tour__mono">$sum</span>. The planner strips it, writes the reason into
                  the trace, and the engine does every rollup itself.
                </p>
              </Panel>

              <Panel title="6 · Trace" note="shown as “How the agent got here”" onOpen={onOpen.get('trace')} active={step === 'trace'}>
                <p>
                  Each query is stored with its goal, the rule that needed it, the path and why, the
                  payload, the row count and the duration. The console shows the whole chain on the
                  account it produced.
                </p>
              </Panel>
            </div>
          </div>
        </div>
      </div>
    </Group>
  );
}

/* -------------------------------------------------------------------------- */
/* Testing and limits                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The verification counts, read live from `GET /verification` — the same
 * numbers the console's verification page reports. Silent when the API is
 * unreachable: the prose panels below still say what was run.
 */
function VerificationFigures(): ReactElement | null {
  const state = useApi((client) => client.getVerification(), []);
  const data = state.data;
  if (data === null) return null;

  const items: { readonly value: string; readonly label: string }[] = [];
  if (data.layersAB !== null) {
    items.push({ value: data.layersAB.completed.toLocaleString('en-US'), label: 'A+B cases run' });
    items.push({
      value: String(data.layersAB.invariantViolations),
      label: 'invariant violations',
    });
    items.push({ value: String(data.layersAB.disagreements), label: 'disagreements' });
  }
  if (data.layerC !== null) {
    items.push({
      value: formatPercent(data.layerC.agreement.point, { from: 'ratio', decimals: 1 }),
      label: `layer C agreement (${data.layerC.agreed} of ${data.layerC.judged})`,
    });
  }
  if (items.length === 0) return null;
  return <Figures items={items} />;
}

export function TestingGroup(): ReactElement {
  return (
    <Group
      id="testing"
      title="Testing, and what we did not prove"
      lede="Three layers of testing, and a list of what is still unverified. One layer was written by an agent that never saw the engine."
    >
      <VerificationFigures />
      <TestBench />

      <Panel title="Layers A and B — property tests and a second implementation" open>
        <p>
          Property tests, plus a naive second implementation written by an agent that never saw the
          engine code, working only from the guideline PDF and the shared interpretation contract.
          Because both implement the same contract, layer B catches arithmetic and logic errors but
          cannot catch an interpretation both sides share — which is what layer C is for. The counts
          above are the final run, live from the API: <strong>zero invariant violations and zero
          disagreements</strong> across every case.
        </p>
      </Panel>

      <Panel title="Layer C — a model that was never shown the answer" note="99.9% agreement">
        <p>
          A Gemini second opinion given only the guideline text and each account’s rolled-up facts —
          never the engine’s score, tier or verdict. <strong>1,331 of 1,332 agreed</strong> (99.9%,
          95% CI 99.6–100.0%), and all 38 real property accounts agreed.
        </p>
        <p>
          The single disagreement is exactly-50% acceptable construction, which the PDF genuinely
          leaves open: Acceptable needs “&gt;50%”, Not Acceptable is “&gt;50% other types”, and at
          exactly 50% neither holds. 706 of the planned 2,038 cases went unanswered when the Gemini
          credits ran out mid-run.
        </p>
      </Panel>

      <Panel title="The tests found real bugs" note="39 confirmed defects">
        <p>
          The differential started at 20,662 invariant violations and 1,369 disagreements, caused
          by a hole in our own interpretation contract and a peer-distance overflow. A review of the real
          data then found 39 confirmed defects, including every building assigned the first
          location’s id (wrong state on 11 of 27 accounts), only 38 of 158 submissions stored,
          broker answers silently dropped, and zero FIT accounts because a date conflict present on
          all 27 accounts was wrongly treated as blocking. All are fixed and logged.
        </p>
      </Panel>

      <Panel title="What is still not proven">
        <ul className="rf-tour__list">
          <li>
            <strong>No one has run the phone app on an iPhone.</strong> The camera sweep and its
            Skia coverage ring are unverified on real hardware. Every other screen has been driven
            end to end in a browser against the live API.
          </li>
          <li>
            <strong>The Gemini key’s prepaid credits are depleted</strong> (HTTP 402). Vision,
            broker-reply extraction, request drafting and narration fall back or fail until it is
            topped up. Scoring, ranking, template explanations and the whole engine are unaffected.
          </li>
          <li>
            <strong>Broker-reply extraction accuracy is unmeasured</strong> — the 30-fixture check
            ran after the credits ran out.
          </li>
          <li>
            <strong>Tenant rates are invented</strong> and labelled “estimate” everywhere they
            appear, including on this page.
          </li>
          <li>
            <strong>Enrichment is display-only.</strong> FEMA flood zones and fire-station distance
            are fetched and shown, but no rule, rating factor or contradiction reads them yet, so
            they move neither a score nor a price.
          </li>
          <li>
            <strong>The 3D coverage dome was cut</strong> from the phone app; it uses the 2D Skia
            ring, the PRD’s named fallback.
          </li>
          <li>
            <strong>Broker contacts are synthetic</strong>, so approving a request marks it sent.
            Nothing is emailed.
          </li>
        </ul>
      </Panel>
    </Group>
  );
}
