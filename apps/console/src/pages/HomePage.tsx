import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { ROUTES } from '../routes.js';


/** The engine's stage chain, condensed to the six stages worth showing. */
const STAGES: readonly { readonly name: string; readonly gloss: string }[] = [
  { name: 'normalize', gloss: 'one canonical record' },
  { name: 'rollup', gloss: 'TIV, states, ages, losses' },
  { name: 'merge', gloss: 'enrichment, answers, camera' },
  { name: 'vectorize', gloss: 'values become tiers' },
  { name: 'evaluate', gloss: 'tiers become a score' },
  { name: 'price + verdict', gloss: 'premium and deciding rule' },
];

const RAIL: readonly { readonly to: string; readonly label: string; readonly gloss: string }[] = [
  { to: ROUTES.queue, label: 'Queue', gloss: '158 accounts, ranked' },
  { to: ROUTES.rules, label: 'Rules', gloss: 'the guidelines, quoted' },
  { to: ROUTES.aggregate, label: 'Aggregate', gloss: 'the book in numbers' },
  { to: ROUTES.explore, label: 'Explore', gloss: 'appetite terrain in 3D' },
  { to: ROUTES.verification, label: 'Verification', gloss: 'three layers of testing' },
];

const SPEC: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'Language', value: 'TypeScript ESM end to end, Node 24' },
  {
    label: 'Workspaces',
    value: 'npm, 8 packages — engine, federato, contracts, design, verify, api, console, mobile',
  },
  {
    label: 'Engine',
    value: 'packages/engine is pure: zero I/O, no clock, no randomness, no LLM SDK. Same input, same output.',
  },
  { label: 'Server', value: 'Hono with better-sqlite3 and Drizzle, one SQLite file' },
  { label: 'Console', value: 'Vite and React 19' },
  { label: 'Phone', value: 'Expo' },
  { label: 'Model', value: 'Gemini, reached only through the API server' },
  { label: 'Secrets', value: 'root .env only — nothing secret reaches the console or the phone' },
];

/**
 * The landing page at `/`: what Retrofit is, how the pipeline runs, what it
 * runs on, and five ways into the console. One screen plus a little scroll.
 */
export function HomePage(): ReactElement {
  return (
    <div className="rf-home">
      <section className="rf-home__hero" aria-labelledby="home-title">
        <h1 id="home-title">Retrofit</h1>
        <p className="rf-home__lede">
          One deterministic underwriting engine with two front doors: a console that ranks
          Federato&rsquo;s live submission book against the carrier&rsquo;s appetite guidelines, and a
          phone app where the camera replaces most of the quote form.
        </p>
        <p className="rf-home__thesis">
          Underwriting runs on what the broker typed. We built the camera that checks.
        </p>
        <p className="rf-home__principle">
          <strong>Gemini sees; the engine decides.</strong> No model decides a verdict, a score, or a
          dollar amount.
        </p>
        <p className="rf-home__cta">
          <Link to={ROUTES.queue} className="rf-button rf-button--primary">
            Open the queue
          </Link>
          <Link to={ROUTES.explore} className="rf-button">
            See the book in 3D
          </Link>
          <Link to={ROUTES.tour} className="rf-button">
            Walk the room
          </Link>
        </p>
      </section>

      <section className="rf-home__section" aria-labelledby="home-pipeline-title">
        <h2 id="home-pipeline-title">The pipeline</h2>
        <div className="rf-flow">
          <div className="rf-flow__rail">
            <div className="rf-flow__col">
              <div className="rf-flow__node">
                <span className="rf-flow__node-name">Federato API</span>
                <span className="rf-flow__node-gloss">schema first, then planned queries</span>
              </div>
              <div className="rf-flow__node">
                <span className="rf-flow__node-name">iPhone sweep</span>
                <span className="rf-flow__node-gloss">auto-capture as you turn</span>
              </div>
            </div>
            <div className="rf-flow__edge">
              <span className="rf-flow__edge-line">
                <span className="rf-flow__arrow" aria-hidden="true" />
                records + query trace
              </span>
              <span className="rf-flow__edge-line">
                <span className="rf-flow__arrow" aria-hidden="true" />
                photos + bearings
              </span>
            </div>
            <div className="rf-flow__col rf-flow__col--hub">
              <div className="rf-flow__node rf-flow__node--api">
                <span className="rf-flow__node-name">apps/api</span>
                <span className="rf-flow__node-gloss">
                  enrichment, image quality gate, Gemini calls, storage
                </span>
                <span className="rf-flow__node rf-flow__node--engine">
                  <span className="rf-flow__node-name">packages/engine</span>
                  <span className="rf-flow__node-gloss">pure, deterministic, numeric</span>
                </span>
              </div>
            </div>
            <div className="rf-flow__edge">
              <span className="rf-flow__edge-line">
                <span className="rf-flow__arrow" aria-hidden="true" />
                scores, verdicts, prices
              </span>
            </div>
            <div className="rf-flow__col">
              <div className="rf-flow__node">
                <span className="rf-flow__node-name">Console</span>
                <span className="rf-flow__node-gloss">the ranked book</span>
              </div>
              <div className="rf-flow__node">
                <span className="rf-flow__node-name">Phone</span>
                <span className="rf-flow__node-gloss">verdict, price, the fix</span>
              </div>
            </div>
          </div>
          <ol className="rf-stages" aria-label="Engine stages, in order">
            {STAGES.map((stage) => (
              <li key={stage.name}>
                <span className="rf-stage">
                  <span className="rf-stage__name">{stage.name}</span>
                  <span className="rf-stage__gloss">{stage.gloss}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="rf-home__section" aria-labelledby="home-planner-title">
        <h2 id="home-planner-title">How the agent plans its queries</h2>
        <ol className="rf-steps">
          <li>
            Read the live schema into a resource graph and locate every field the rulebook needs.
          </li>
          <li>
            Triage all 158 submissions in one query — 120 knocked out on line of business, each
            citing the rule.
          </li>
          <li>One deep hydrating <code>Policy</code> query returns all 27 property policies.</li>
          <li>
            Adapt on zero results — rewrite to <code>$elemMatch</code>, decline <code>over</code> —
            and record every query in a{' '}
            <Link to={ROUTES.queue}>trace</Link>.
          </li>
        </ol>
        <p className="rf-home__stat">
          <span>4 planner queries</span>
          <span>9.2 s</span>
          <span>158 submissions stored and scored</span>
        </p>
      </section>

      <section className="rf-home__section" aria-labelledby="home-infra-title">
        <h2 id="home-infra-title">Infrastructure</h2>
        <dl className="rf-spec">
          {SPEC.map((row) => (
            <div key={row.label} className="rf-spec__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rf-home__section" aria-labelledby="home-rail-title">
        <h2 id="home-rail-title">In the console</h2>
        <ul className="rf-rail">
          {RAIL.map((item) => (
            <li key={item.to}>
              <Link to={item.to}>
                <span className="rf-rail__label">{item.label}</span>
                <span className="rf-rail__gloss">{item.gloss}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
