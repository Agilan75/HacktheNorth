import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ROUTES } from '../routes.js';
import '../styles/tour.css';
import { AgentGroup, TestingGroup } from './tour-dossier.js';
import { ANCHOR_IDS, createHouseScene, webglAvailable } from './tour-house.js';
import { RulesGroup } from './tour-rules.js';
const BEATS = [
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
    {
        id: 'lift',
        kicker: 'Out of the room',
        title: 'That room is now data.',
        body: [
            'Everything the camera saw left as a typed observation with a confidence and a compass bearing. The engine receives no prose and no price.',
            'From far enough back the apartment is one of two sources feeding the engine.',
        ],
        note: 'sweep \u00b7 12 frames \u00b7 6 observations',
    },
];
/** The floating tags that track an object in the room. Desktop only, decorative. */
const BADGES = {
    heater: { label: 'portable_heater', value: 'confidence 0.91' },
    curtain: { label: 'curtain', value: 'combustible · 14°' },
    bed: { label: 'bedding', value: 'combustible · 31°' },
    detector: { label: 'smoke_detector', value: 'absent · ceiling seen' },
    desk: { label: 'verdict', value: 'REFER · rule cited' },
    fix: { label: 'fix verified', value: 'estimate −$38 / yr' },
};
/** The dossier's section index — the chips that make the page one click deep. */
const INDEX = [
    { href: '#rules', label: 'Rulebook & weights' },
    { href: '#agent', label: 'The Federato agent' },
    { href: '#testing', label: 'Testing & limits' },
];
/* -------------------------------------------------------------------------- */
/* The film                                                                   */
/* -------------------------------------------------------------------------- */
/*
 * The story plays itself. Scroll does not drive the camera and cannot skip it:
 * on arrival the page holds still for ten seconds while the camera runs the
 * rail at a constant pace and the beats cross-fade past, and only then does
 * the page unlock and the dossier become reachable. It is the walk the visitor
 * used to do by scrolling, done for them at an even speed.
 *
 * Under `prefers-reduced-motion` none of this happens: nothing plays, nothing
 * locks, and the page is the plain document it has always been underneath.
 */
/** How long the film runs, in seconds, from the door to the way out. */
const RUNTIME_S = 10;
/**
 * The beat the film stops on: `out`, the last one taken from inside the
 * apartment. Everything after it leaves the room, and the visitor drives that
 * part by scrolling — forwards to follow the room into the engine, backwards
 * to come back to it.
 */
const LAST_FILMED = BEATS.findIndex((b) => b.id === 'out');
/**
 * Stops on the camera rail in `tour-house.ts` (the length of its `EYES`).
 * The beats used to be one per stop; they no longer are — the story ends at
 * the lift shot, and the rail's last stops, the flight down into the engine,
 * are no longer part of it. Beat *i* is still rail stop *i*, so the two stay
 * in step; there are simply fewer beats than stops.
 */
const RAIL_STOPS = 11;
/** Where the film stops on the camera rail, and where scroll picks it up. */
const FILM_RAIL = LAST_FILMED / (RAIL_STOPS - 1);
/**
 * The story still runs the rail to the end. Past the last beat there is no
 * card left — the room lifts away, the Federato stream and the engine's
 * pipeline draw themselves, and that stretch is watched rather than read.
 */
const RAIL_END = 1;
/**
 * Screens of scroll the camera rail gets: the film's own, one for the beat
 * that lifts out of the room, and two more for the wordless flight down the
 * pipeline into the engine.
 */
const RAIL_SCREENS = BEATS.length - LAST_FILMED + 2;
/** One more screen after the rail ends, in which the scene dissolves into the
 *  paper. The dossier is opaque and slides up from below, so without this it
 *  wiped across a full-strength room; now it arrives over an empty page. */
const STORY_SCREENS = RAIL_SCREENS + 1;
/** How much of that last screen the dissolve takes; the rest is held empty. */
const DISSOLVE_SPAN = 0.75;
function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;
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
export function TourPage() {
    const hostRef = useRef(null);
    const storyRef = useRef(null);
    const sceneRef = useRef(null);
    const badgeRefs = useRef(new Map());
    const beatRefs = useRef([]);
    const [live, setLive] = useState(false);
    const [parked, setParked] = useState(false);
    const stageRef = useRef(null);
    /** Whether there is a film at all, and where it is: waiting for the first
     *  scroll, running (the page is held at the top), or over. */
    const [film, setFilm] = useState(false);
    const [phase, setPhase] = useState('waiting');
    const bindBadge = useCallback((id, el) => {
        if (el)
            badgeRefs.current.set(id, el);
        else
            badgeRefs.current.delete(id);
        sceneRef.current?.bindBadge(id, el);
    }, []);
    /**
     * The copy is pinned, not stacked: every beat sits in the same slot and the
     * film cross-fades between them, so the whole story reads as one continuous
     * animation rather than a stack of cards flying past. Written straight to the
     * DOM — this runs every frame and React must never see it.
     */
    const paintBeats = useCallback((progress) => {
        // Beat *i* is rail stop *i*, so the rail position names the beat directly.
        const at = Math.min(Math.max(progress, 0), 1) * (RAIL_STOPS - 1);
        beatRefs.current.forEach((el, i) => {
            if (!el)
                return;
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
            const card = el.firstElementChild;
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
        if (!host || !webglAvailable())
            return;
        const reduced = prefersReducedMotion();
        const scene = createHouseScene(host, reduced);
        sceneRef.current = scene;
        for (const [id, el] of badgeRefs.current)
            scene.bindBadge(id, el);
        setLive(true);
        // The story is pinned only when there is a film to pin it for. With no
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
        }
        else {
            story?.classList.add('rf-tour__story--pinned');
            setFilm(true);
            scene.setProgress(0);
            paintBeats(0);
            // The film is the page's opening, but it waits to be asked: the page is
            // held at the top from the start, and the first scroll — the visitor
            // saying they want to move — is what rolls it. Ten seconds is short
            // enough that this is an intro rather than a trap, and `--rolling` is
            // what does the holding, so it cannot outlive this effect.
            window.scrollTo(0, 0);
            document.documentElement.classList.add('rf-tour-rolling');
            setPhase('waiting');
        }
        // `overflow: hidden` stops the scrollbar but not every input, so the lock
        // is enforced here too: the wheel, a drag and the scrolling keys are all
        // refused while the film runs, and anything that gets past them is put
        // back at the top. Both are torn down with the effect, so the page cannot
        // be left locked.
        const rollingNow = () => document.documentElement.classList.contains('rf-tour-rolling');
        const SCROLL_KEYS = new Set([
            'ArrowDown',
            'ArrowUp',
            'PageDown',
            'PageUp',
            'Home',
            'End',
            ' ',
            'Spacebar',
        ]);
        // The gesture the lock refuses is also the one that starts the film: the
        // visitor asked to move, and the room moves for them.
        const block = (event) => {
            if (!rollingNow())
                return;
            event.preventDefault();
            begin();
        };
        const blockKey = (event) => {
            // Never swallow a key aimed at a control: only the page's own scrolling.
            const target = event.target;
            const typing = target?.closest('input, textarea, select, [contenteditable]') !== null;
            if (!rollingNow() || typing || !SCROLL_KEYS.has(event.key))
                return;
            event.preventDefault();
            begin();
        };
        const pinTop = () => {
            if (!rollingNow())
                return;
            // Anything that moved the page past the refusals above still counts as
            // the visitor asking to move: start the film, then put the page back.
            if (window.scrollY !== 0) {
                window.scrollTo(0, 0);
                begin();
            }
        };
        window.addEventListener('wheel', block, { passive: false });
        window.addEventListener('touchmove', block, { passive: false });
        window.addEventListener('keydown', blockKey);
        window.addEventListener('scroll', pinTop, { passive: true });
        let raf = 0;
        let started = 0;
        function begin() {
            if (reduced || started !== 0)
                return;
            started = performance.now();
            setPhase('rolling');
            raf = requestAnimationFrame(function frame(now) {
                // A constant pace through the room: the walk the visitor used to do by
                // scrolling, done for them at an even speed.
                const done = Math.min((now - started) / 1000 / RUNTIME_S, 1);
                const rail = done * FILM_RAIL;
                scene.setProgress(rail);
                paintBeats(rail);
                if (done < 1) {
                    raf = requestAnimationFrame(frame);
                    return;
                }
                // Out of the room. The page unlocks and scroll takes the camera on.
                document.documentElement.classList.remove('rf-tour-rolling');
                setPhase('done');
                onScroll();
            });
        }
        /*
         * Scroll owns the rail only past the film. While the film runs the page is
         * held at the top, so this contributes nothing; once it has ended, the
         * story's remaining screens carry the camera from the way out to the wide
         * shot — one screen per beat — and scrolling back up walks it in reverse,
         * as far as the door of the room the film already left.
         */
        const onScroll = () => {
            const el = storyRef.current;
            const vh = window.innerHeight;
            // The rail ends one screen before the story does; that screen is the dissolve.
            const span = (el?.offsetHeight ?? 0) - vh * 2;
            const past = span > 0 ? Math.min(Math.max(window.scrollY / span, 0), 1) : 0;
            if (!reduced && !rollingNow()) {
                const rail = FILM_RAIL + past * (RAIL_END - FILM_RAIL);
                scene.setProgress(rail);
                paintBeats(rail);
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
        const onResize = () => {
            scene.resize();
            onScroll();
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('wheel', block);
            window.removeEventListener('touchmove', block);
            window.removeEventListener('keydown', blockKey);
            window.removeEventListener('scroll', pinTop);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onResize);
            document.documentElement.classList.remove('rf-tour-rolling');
            story?.classList.remove('rf-tour__story--pinned');
            sceneRef.current = null;
            setLive(false);
            setFilm(false);
            setPhase('waiting');
            scene.dispose();
        };
    }, [paintBeats]);
    const className = ['rf-tour', live ? 'rf-tour--live' : null, parked ? 'rf-tour--parked' : null]
        .filter((c) => c !== null)
        .join(' ');
    return (_jsxs("div", { className: className, children: [_jsxs("div", { className: "rf-tour__stage", "aria-hidden": "true", ref: stageRef, children: [_jsx("div", { className: "rf-tour__canvas", ref: hostRef }), _jsx("div", { className: "rf-tour__badges", children: ANCHOR_IDS.map((id) => (_jsxs("span", { className: "rf-tour__badge", ref: (el) => bindBadge(id, el), children: [_jsx("span", { className: "rf-tour__badge-dot" }), _jsxs("span", { className: "rf-tour__badge-card", children: [_jsx("span", { className: "rf-tour__badge-label", children: BADGES[id].label }), _jsx("span", { className: "rf-tour__badge-value", children: BADGES[id].value })] })] }, id))) })] }), _jsxs("main", { id: "tour-main", children: [_jsx("div", { className: "rf-tour__story", ref: storyRef, style: { '--rf-tour-screens': STORY_SCREENS }, children: _jsxs("div", { className: "rf-tour__pin", children: [BEATS.map((beat, index) => (_jsx("section", { className: "rf-tour__beat", "aria-labelledby": `tour-${beat.id}-title`, ref: (el) => {
                                        beatRefs.current[index] = el;
                                    }, children: _jsxs("div", { className: "rf-tour__card", children: [_jsx("p", { className: "rf-tour__kicker", children: beat.kicker }), index === 0 ? (_jsx("h1", { id: `tour-${beat.id}-title`, className: "rf-tour__title", children: beat.title })) : (_jsx("h2", { id: `tour-${beat.id}-title`, className: "rf-tour__title", children: beat.title })), film
                                                ? null
                                                : beat.body.map((line) => (_jsx("p", { className: "rf-tour__body", children: line }, line.slice(0, 24)))), !film && beat.note ? _jsx("p", { className: "rf-tour__note", children: beat.note }) : null, index === BEATS.length - 1 ? (_jsxs("p", { className: "rf-tour__cta", children: [_jsx(Link, { to: ROUTES.queue, className: "rf-button rf-button--primary", children: "Open the queue" }), _jsx(Link, { to: ROUTES.explore, className: "rf-button", children: "See the book in 3D" })] })) : null] }) }, beat.id))), live && film ? (_jsx("p", { className: "rf-tour__hint", "data-phase": phase, children: phase === 'waiting'
                                        ? 'Scroll to walk the room'
                                        : phase === 'rolling'
                                            ? 'Walking the room\u2026'
                                            : parked
                                                ? 'Scroll up for the room'
                                                : 'Scroll on \u2014 the room becomes data' })) : null] }) }), _jsx("div", { className: "rf-tour__dossier", id: "tour-details", children: _jsxs("div", { className: "rf-tour__dossier-inner", children: [_jsxs("nav", { className: "rf-tour__index", "aria-label": "Sections", children: [INDEX.map((item) => (_jsx("a", { className: "rf-tour__chip", href: item.href, children: item.label }, item.href))), _jsx("a", { className: "rf-tour__chip rf-tour__chip--action", href: "#tour-main", children: "Back to the room" })] }), _jsx(RulesGroup, {}), _jsx(AgentGroup, {}), _jsx(TestingGroup, {}), _jsxs("section", { className: "rf-tour__group", "aria-labelledby": "tour-open-title", children: [_jsx("div", { className: "rf-tour__group-head", children: _jsx("h2", { id: "tour-open-title", children: "Open it" }) }), _jsx("p", { className: "rf-tour__group-lede", children: "Every number on this page comes from the same API these pages read." }), _jsxs("p", { className: "rf-tour__cta", children: [_jsx(Link, { to: ROUTES.queue, className: "rf-button rf-button--primary", children: "The ranked book" }), _jsx(Link, { to: ROUTES.rules, className: "rf-button", children: "Rules" }), _jsx(Link, { to: ROUTES.explore, className: "rf-button", children: "Appetite terrain in 3D" }), _jsx(Link, { to: ROUTES.aggregate, className: "rf-button", children: "The book in numbers" }), _jsx(Link, { to: ROUTES.verification, className: "rf-button", children: "Verification" }), _jsx(Link, { to: ROUTES.glossary, className: "rf-button", children: "Glossary" }), _jsx(Link, { to: ROUTES.home, className: "rf-button", children: "How it is built" })] })] })] }) })] })] }));
}
//# sourceMappingURL=TourPage.js.map