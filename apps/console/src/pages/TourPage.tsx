import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Link } from 'react-router';

import { ROUTES } from '../routes.js';
import '../styles/tour.css';
import { BriefGroup } from './tour-brief.js';
import { AgentGroup, TestingGroup } from './tour-dossier.js';
import { ANCHOR_IDS, createHouseScene, webglAvailable } from './tour-house.js';
import type { AnchorId, HouseScene } from './tour-house.js';
import { RulesGroup } from './tour-rules.js';

/**
 * One beat of the story. Scroll across the story maps linearly onto the beats,
 * and the beats map onto the camera rail in `tour-house.ts`, so beat *i* of *n*
 * is the camera at `i / (n - 1)`. Changing this list changes where the camera
 * stops, and `EYES`/`LOOKS` must stay the same length and in the same order.
 */
interface Beat {
  readonly id: string;
  readonly kicker: string;
  readonly title: string;
  readonly body: readonly string[];
  readonly note?: string;
}

const BEATS: readonly Beat[] = [
  {
    id: 'door',
    kicker: 'Retrofit',
    title: 'Pan your camera around your room.',
    body: [
      'We built the camera that checks. One engine serves two apps: a console that ranks a carrier\u2019s live submission book against its appetite guidelines, and a phone app where a camera sweep replaces most of the quote form.',
      'Scroll once and it walks the room it was built for. The architecture, the rulebook and the testing are below it.',
    ],
  },
  {
    id: 'sees',
    kicker: 'Step one',
    title: 'Gemini sees and labels objects.',
    body: [
      'A quality gate runs in code first \u2014 blur, brightness, clipping and duplicates \u2014 before any model call. What survives goes to Gemini, which returns a list of objects per frame from a fixed vocabulary, each with a confidence.',
      'It is never asked what a heater costs.',
    ],
    note: 'portable_heater, curtain, smoke_detector, bedding, \u2026',
  },
  {
    id: 'geometry',
    kicker: 'Step two',
    title: 'The engine deterministically decides.',
    body: [
      'Pure geometry places every object by compass bearing. A heater within \u00b120\u00b0 of fabric or bedding becomes heaterNearCombustible, a hazard the rulebook knows by name. The same photos always produce the same hazards.',
      'No model decides a verdict, a score, or a dollar amount.',
    ],
    note: 'bearing 14\u00b0 \u00b7 inside the \u00b120\u00b0 cone',
  },
  {
    id: 'absence',
    kicker: 'The hard case',
    title: 'What it could not see, it asks you.',
    body: [
      '\u201cNo smoke detector\u201d is worth nothing on its own. It counts as a hazard only if the ceiling was in frame. If it was not, the absence becomes a question the renter answers in one tap.',
      'The verdict page shows how many questions were skipped, and why.',
    ],
    note: 'ceiling visible \u00b7 smoke_detector absent',
  },
  {
    id: 'verdict',
    kicker: 'The output',
    title: 'Every verdict names its rule.',
    body: [
      'The engine applies the rulebook and the rating table, then returns the verdict, the estimate with its factor breakdown, the deciding rule quoted with its document and section, and the fix.',
      'Every number it used is on the page, so you can check it against the guideline yourself.',
    ],
    note: 'REFER \u00b7 rule quoted with document and section',
  },
  {
    id: 'fix',
    kicker: 'The loop',
    title: 'Fixing the hazard re-prices the room.',
    body: [
      'Verify my fix takes one new photo of the hazard, runs the same geometry, and re-prices. The renter sees the estimate change.',
      'The quote looks at the room and says what to change to lower it.',
    ],
    note: 'estimate, illustrative',
  },
  {
    id: 'out',
    kicker: 'The console',
    title: 'The same engine, from the carrier\u2019s side.',
    body: [
      'The console ranks the live book against the guidelines, cites the rule behind every position, and draws the appetite terrain the rules produce.',
      'It is the same engine that just read this room. Watch: the room becomes its input.',
    ],
  },
];

/** The floating tags that track an object in the room. Desktop only, decorative. */
const BADGES: Readonly<Record<AnchorId, { readonly label: string; readonly value: string }>> = {
  heater: { label: 'portable_heater', value: 'confidence 0.91' },
  curtain: { label: 'curtain', value: 'combustible · 14°' },
  bed: { label: 'bedding', value: 'combustible · 31°' },
  detector: { label: 'smoke_detector', value: 'absent · ceiling seen' },
  desk: { label: 'verdict', value: 'REFER · rule cited' },
  fix: { label: 'fix verified', value: 'estimate −$38 / yr' },
};

/** The dossier's section index — the chips that make the page one click deep. */
const INDEX: readonly { readonly href: string; readonly label: string }[] = [
  { href: '#rules', label: 'Rulebook & weights' },
  { href: '#agent', label: 'The Federato agent' },
  { href: '#testing', label: 'Testing & limits' },
  { href: '#brief', label: 'The brief, answered' },
];

/* -------------------------------------------------------------------------- */
/* The scrub                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Scroll is the transport. The story is one pinned screen over a tall track,
 * and the page's position in that track is the camera's position on the rail:
 * scrolling forwards walks the room, scrolling back walks it in reverse, and
 * stopping stops the camera. Nothing plays on a clock and nothing is locked —
 * the visitor is always exactly where they scrolled to.
 *
 * Under `prefers-reduced-motion` none of this happens: nothing is pinned, and
 * the page is the plain document it has always been underneath.
 */

/**
 * Stops on the camera rail in `tour-house.ts` (the length of its `EYES`).
 * Beat *i* is rail stop *i*; there are fewer beats than stops, because the
 * rail's last stops — the flight out of the room and down into the engine —
 * are watched rather than read.
 */
const RAIL_STOPS = 11;

/** The rail runs end to end under scroll: the door to the wide shot. */
const RAIL_END = 1;

/**
 * Screens of scroll the rail gets: one per stop, so a beat holds its own
 * screen and the wordless stops past the last beat get the same pace.
 */
const RAIL_SCREENS = RAIL_STOPS - 1;

/** One more screen after the rail ends, in which the scene dissolves into the
 *  paper. The dossier is opaque and slides up from below, so without this it
 *  wiped across a full-strength room; now it arrives over an empty page. */
const STORY_SCREENS = RAIL_SCREENS + 1;

/** How much of that last screen the dissolve takes; the rest is held empty. */
const DISSOLVE_SPAN = 0.75;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * True when the URL points into the dossier, e.g. `/tour#brief`.
 *
 * A deep link has to land where it points, and the pinned track is ten screens
 * of room between the top of the page and the dossier — so arriving with a
 * hash skips the scrub exactly as asking for less motion does. Someone sharing
 * `/tour#brief` before a five-minute demo is the reason this exists.
 */
function arrivedAtSection(): boolean {
  const hash = window.location.hash.replace('#', '').trim();
  return hash !== '' && hash !== 'tour-main';
}

/**
 * `/tour` — the presentation.
 *
 * The first screens are the story: one procedural apartment, scroll driving a
 * camera along a fixed rail through it, each object labelled, reasoned about
 * and priced in the order the engine actually does it. Past the last beat the
 * canvas fades out and the dossier takes over — architecture, the live
 * rulebook with its weights, the Federato planner, the testing and the limits,
 * every panel collapsed so the page opens as a table of contents.
 *
 * The 3D is background only: every word lives in real sections, the canvas is
 * `aria-hidden`, and with no WebGL the page is an ordinary scrolling document.
 */
export function TourPage(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HouseScene | null>(null);
  const badgeRefs = useRef(new Map<AnchorId, HTMLElement>());
  const beatRefs = useRef<(HTMLElement | null)[]>([]);
  const [live, setLive] = useState(false);
  const [parked, setParked] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** Whether the room is being scrubbed at all, and where the scrub is: at the
   *  door, somewhere along the rail, or past its end. */
  const [film, setFilm] = useState(false);
  const [phase, setPhase] = useState<'waiting' | 'rolling' | 'done'>('waiting');

  const bindBadge = useCallback((id: AnchorId, el: HTMLElement | null): void => {
    if (el) badgeRefs.current.set(id, el);
    else badgeRefs.current.delete(id);
    sceneRef.current?.bindBadge(id, el);
  }, []);

  /**
   * The copy is pinned, not stacked: every beat sits in the same slot and the
   * scrub cross-fades between them, so the story reads as one continuous
   * animation rather than a stack of cards flying past. Written straight to the
   * DOM — this runs every frame and React must never see it.
   */
  const paintBeats = useCallback((progress: number): void => {
    // Beat *i* is rail stop *i*, so the rail position names the beat directly.
    const at = Math.min(Math.max(progress, 0), 1) * (RAIL_STOPS - 1);
    beatRefs.current.forEach((el, i) => {
      if (!el) return;
      const d = at - i;
      const away = Math.abs(d);
      // Opaque for most of the beat's screen, then a short hand-off near the
      // boundary. The copy sits over a busy room, so translucent *text* is a
      // contrast failure: the crossfade has to be quick and it has to end.
      // Smoothstep across a narrow band either side of the midpoint: a beat is
      // fully opaque for ~84% of its screen and the exchange is over quickly,
      // instead of two half-transparent cards sharing most of the scroll.
      const x = Math.min(Math.max((away - 0.42) / 0.16, 0), 1);
      const opacity = 1 - x * x * (3 - 2 * x);
      const card = el.firstElementChild as HTMLElement | null;
      el.style.opacity = String(opacity);
      el.style.visibility = opacity <= 0.01 ? 'hidden' : 'visible';
      // Anything inside the beat that plays once on arrival keys off this
      // class: removing it on the way out rewinds the animation for next time.
      el.classList.toggle('rf-tour__beat--active', away < 0.5);
      if (card) {
        // The leaving beat drifts up, the arriving one comes from below.
        card.style.transform = `translate3d(0, ${(-d * 3.2).toFixed(2)}rem, 0)`;
        card.style.pointerEvents = away < 0.5 ? 'auto' : 'none';
      }
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !webglAvailable()) return;

    // Either reason skips the film: the visitor asked for less motion, or they
    // asked for a particular section and the film is in the way of it.
    const reduced = prefersReducedMotion() || arrivedAtSection();
    const scene = createHouseScene(host, reduced);
    sceneRef.current = scene;
    for (const [id, el] of badgeRefs.current) scene.bindBadge(id, el);
    setLive(true);

    // The story is pinned only when there is a room to pin it for. With no
    // WebGL, and for a reader who asked for less motion, the beats stay an
    // ordinary stack of readable sections — which is also what a reader with
    // no JS at all gets.
    const story = storyRef.current;

    // Asked for less motion: nothing plays, nothing locks, nothing is pinned,
    // and the room sits at the wide shot behind a page that is just a page.
    if (reduced) {
      scene.setProgress(1);
      setFilm(false);
      setPhase('done');
      // The browser already tried to honour the hash before React mounted the
      // dossier, so ask again now that the target exists.
      if (arrivedAtSection()) {
        const target = document.getElementById(window.location.hash.replace('#', ''));
        target?.scrollIntoView();
      }
    } else {
      story?.classList.add('rf-tour__story--pinned');
      setFilm(true);
      scene.setProgress(0);
      paintBeats(0);
      setPhase('waiting');
    }

    /*
     * Scroll owns the rail, end to end. The story's screens carry the camera
     * from the door to the wide shot — one screen per rail stop — and
     * scrolling back up walks it in reverse, all the way back to the door.
     */
    const onScroll = (): void => {
      const el = storyRef.current;
      const vh = window.innerHeight;
      // The rail ends one screen before the story does; that screen is the dissolve.
      const span = (el?.offsetHeight ?? 0) - vh * 2;
      const past = span > 0 ? Math.min(Math.max(window.scrollY / span, 0), 1) : 0;
      if (!reduced) {
        const rail = past * RAIL_END;
        scene.setProgress(rail);
        paintBeats(rail);
        // The hint is the only chrome: an invitation at the door, a cue once
        // the room is moving, and a way back once the dossier has arrived.
        setPhase((was) => {
          const now = past <= 0.001 ? 'waiting' : past >= 1 ? 'done' : 'rolling';
          return now === was ? was : now;
        });
      }
      const bottom = el?.getBoundingClientRect().bottom ?? 0;
      // The dossier enters when the story's bottom edge reaches the bottom of
      // the screen. The scene is gone by then: it fades over the screen before.
      const stage = stageRef.current;
      if (stage !== null && vh > 0) {
        const x = Math.min(Math.max((vh * 2 - bottom) / (vh * DISSOLVE_SPAN), 0), 1);
        const opacity = 1 - x * x * (3 - 2 * x);
        stage.style.opacity = String(opacity);
        stage.style.visibility = opacity <= 0.01 ? 'hidden' : 'visible';
      }
      setParked((was) => {
        const now = bottom <= 8;
        return now === was ? was : now;
      });
    };
    const onResize = (): void => {
      scene.resize();
      onScroll();
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      story?.classList.remove('rf-tour__story--pinned');
      sceneRef.current = null;
      setLive(false);
      setFilm(false);
      setPhase('waiting');
      scene.dispose();
    };
  }, [paintBeats]);

  const className = ['rf-tour', live ? 'rf-tour--live' : null, parked ? 'rf-tour--parked' : null]
    .filter((c): c is string => c !== null)
    .join(' ');

  return (
    <div className={className}>
      <div className="rf-tour__stage" aria-hidden="true" ref={stageRef}>
        <div className="rf-tour__canvas" ref={hostRef} />
        <div className="rf-tour__badges">
          {ANCHOR_IDS.map((id) => (
            <span key={id} className="rf-tour__badge" ref={(el) => bindBadge(id, el)}>
              <span className="rf-tour__badge-dot" />
              <span className="rf-tour__badge-card">
                <span className="rf-tour__badge-label">{BADGES[id].label}</span>
                <span className="rf-tour__badge-value">{BADGES[id].value}</span>
              </span>
            </span>
          ))}
        </div>
      </div>

      <main id="tour-main">
        <div
          className="rf-tour__story"
          ref={storyRef}
          style={{ '--rf-tour-screens': STORY_SCREENS } as CSSProperties}
        >
          <div className="rf-tour__pin">
            {BEATS.map((beat, index) => (
              <section
                key={beat.id}
                className="rf-tour__beat"
                aria-labelledby={`tour-${beat.id}-title`}
                ref={(el) => {
                  beatRefs.current[index] = el;
                }}
              >
                <div className="rf-tour__card">
                  <p className="rf-tour__kicker">{beat.kicker}</p>
                  {index === 0 ? (
                    <h1 id={`tour-${beat.id}-title`} className="rf-tour__title">
                      {beat.title}
                    </h1>
                  ) : (
                    <h2 id={`tour-${beat.id}-title`} className="rf-tour__title">
                      {beat.title}
                    </h2>
                  )}
                  {/* The room is the argument: over it each beat is one
                      line, and the prose only appears when there is no room to
                      carry it (no WebGL, or reduced motion), where the page
                      has to be a readable document on its own. */}
                  {film
                    ? null
                    : beat.body.map((line) => (
                        <p key={line.slice(0, 24)} className="rf-tour__body">
                          {line}
                        </p>
                      ))}
                  {!film && beat.note ? <p className="rf-tour__note">{beat.note}</p> : null}
                </div>
              </section>
            ))}

            {/* The only chrome the room carries: what to do, and then where
                to go next. It says so and gets out of the way. */}
            {live && film ? (
              <p className="rf-tour__hint" data-phase={phase}>
                {phase === 'waiting'
                  ? 'Scroll to walk the room'
                  : phase === 'rolling'
                    ? 'Keep scrolling \u2014 the camera follows'
                    : parked
                      ? 'Scroll up for the room'
                      : 'Scroll on \u2014 the room becomes data'}
              </p>
            ) : null}
          </div>
        </div>

        <div className="rf-tour__dossier" id="tour-details">
          <div className="rf-tour__dossier-inner">
            <nav className="rf-tour__index" aria-label="Sections">
              {INDEX.map((item) => (
                <a key={item.href} className="rf-tour__chip" href={item.href}>
                  {item.label}
                </a>
              ))}
              <a className="rf-tour__chip rf-tour__chip--action" href="#tour-main">
                Back to the room
              </a>
            </nav>

            <RulesGroup />
            <AgentGroup />
            <TestingGroup />

            <BriefGroup />

            <section className="rf-tour__group" aria-labelledby="tour-open-title">
              <div className="rf-tour__group-head">
                <h2 id="tour-open-title">Open it</h2>
              </div>
              <p className="rf-tour__group-lede">
                Every number on this page comes from the same API these pages read.
              </p>
              <p className="rf-tour__cta">
                <Link to={ROUTES.queue} className="rf-button rf-button--primary">
                  The ranked book
                </Link>
                <Link to={ROUTES.rules} className="rf-button">
                  Rules
                </Link>
                <Link to={ROUTES.explore} className="rf-button">
                  Appetite terrain in 3D
                </Link>
                <Link to={ROUTES.aggregate} className="rf-button">
                  The book in numbers
                </Link>
                <Link to={ROUTES.verification} className="rf-button">
                  Verification
                </Link>
                <Link to={ROUTES.glossary} className="rf-button">
                  Glossary
                </Link>
                <Link to={ROUTES.home} className="rf-button">
                  How it is built
                </Link>
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
