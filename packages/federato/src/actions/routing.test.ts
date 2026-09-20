import { describe, expect, it } from 'vitest';
import type { UnderwriterRecord } from '../types';
import { regionForState, route } from './routing';

/** The eight live underwriters (LIVE_DATA_FACTS: Underwriter = 8), as normalised records. */
const UNDERWRITERS: UnderwriterRecord[] = [
  { id: 1, name: 'F. Adeyemi', email: 'f@x.example.com', team: 'National Accounts', region: 'West', authorityLimit: 25_000_000 },
  { id: 2, name: 'P. Delgado', email: 'p@x.example.com', team: 'Small Commercial', region: 'Midwest', authorityLimit: 2_500_000 },
  { id: 3, name: 'Z. Ishikawa', email: 'z@x.example.com', team: 'Specialty Lines', region: 'West', authorityLimit: 10_000_000 },
  { id: 4, name: 'N. Vaughn', email: 'n@x.example.com', team: 'Specialty Lines', region: 'Southeast', authorityLimit: 5_000_000 },
  { id: 5, name: 'T. Tanaka', email: 't@x.example.com', team: 'Specialty Lines', region: 'Midwest', authorityLimit: 10_000_000 },
  { id: 6, name: 'M. Raman', email: 'm@x.example.com', team: 'National Accounts', region: 'South', authorityLimit: 1_000_000 },
  { id: 7, name: 'O. Tanaka', email: 'o@x.example.com', team: 'Middle Market', region: 'South', authorityLimit: 10_000_000 },
  { id: 8, name: 'A. Delgado', email: 'a@x.example.com', team: 'Small Commercial', region: 'South', authorityLimit: 10_000_000 },
];

describe('regionForState', () => {
  it('maps every state in the live data onto a region', () => {
    // LIVE_DATA_FACTS Location.state values.
    expect(regionForState('CA')).toBe('West');
    expect(regionForState('AZ')).toBe('West');
    expect(regionForState('WA')).toBe('West');
    expect(regionForState('CO')).toBe('West');
    expect(regionForState('TX')).toBe('South');
    expect(regionForState('TN')).toBe('Southeast');
    expect(regionForState('FL')).toBe('Southeast');
    expect(regionForState('GA')).toBe('Southeast');
    expect(regionForState('IL')).toBe('Midwest');
    expect(regionForState('MO')).toBe('Midwest');
    expect(regionForState('NJ')).toBe('Northeast');
    expect(regionForState('MA')).toBe('Northeast');
  });

  it('trims and upper-cases (G-7), and returns null for a non-state', () => {
    expect(regionForState(' ca ')).toBe('West');
    expect(regionForState('ZZ')).toBeNull();
    expect(regionForState('')).toBeNull();
  });
});

describe('route', () => {
  it('assigns the tightest in-region authority that covers the limit', () => {
    const d = route({ submissionId: 's1', primaryState: 'CA', requestedLimit: 10_000_000, underwriters: UNDERWRITERS });
    // West: #1 (25M) and #3 (10M) both cover 10M; the tighter one wins. Inclusive "covers".
    expect(d.assigned?.id).toBe(3);
    expect(d.needsSeniorReferral).toBe(false);
    expect(d.candidates).toHaveLength(8);
    const c1 = d.candidates.find((c) => c.underwriter.id === 1);
    expect(c1?.regionMatches).toBe(true);
    expect(c1?.authorityCovers).toBe(true);
    const c2 = d.candidates.find((c) => c.underwriter.id === 2);
    expect(c2?.regionMatches).toBe(false);
    expect(c2?.authorityCovers).toBe(false);
  });

  it('breaks an authority tie by lower id', () => {
    const d = route({ submissionId: 's2', primaryState: 'TX', requestedLimit: 2_000_000, underwriters: UNDERWRITERS });
    // South: #6 1M (too low), #7 10M, #8 10M -> #7.
    expect(d.assigned?.id).toBe(7);
  });

  it('flags senior referral when the limit exceeds every in-region authority', () => {
    // A real property account: requested 112,568,000 in CA.
    const d = route({ submissionId: 's3', primaryState: 'CA', requestedLimit: 112_568_000, underwriters: UNDERWRITERS });
    expect(d.assigned).toBeNull();
    expect(d.needsSeniorReferral).toBe(true);
    expect(d.reason).toContain('senior authority');
    expect(d.reason).toContain('$25,000,000');
  });

  it('flags senior referral when no underwriter covers the region', () => {
    const d = route({ submissionId: 's4', primaryState: 'NJ', requestedLimit: 1_000_000, underwriters: UNDERWRITERS });
    expect(d.assigned).toBeNull();
    expect(d.needsSeniorReferral).toBe(true);
    expect(d.reason).toContain('Northeast');
    expect(d.candidates.every((c) => !c.regionMatches)).toBe(true);
  });

  it('flags senior referral for an unknown state or an unknown limit', () => {
    const a = route({ submissionId: 's5', primaryState: null, requestedLimit: 1_000_000, underwriters: UNDERWRITERS });
    expect(a.needsSeniorReferral).toBe(true);
    expect(a.primaryState).toBeNull();
    const b = route({ submissionId: 's6', primaryState: 'CA', requestedLimit: null, underwriters: UNDERWRITERS });
    expect(b.needsSeniorReferral).toBe(true);
    expect(b.candidates.filter((c) => c.regionMatches).map((c) => c.underwriter.id)).toEqual([1, 3]);
    expect(b.candidates.every((c) => !c.authorityCovers)).toBe(true);
  });

  it('covers a limit exactly equal to the authority', () => {
    const d = route({ submissionId: 's7', primaryState: 'IL', requestedLimit: 2_500_000, underwriters: UNDERWRITERS });
    expect(d.assigned?.id).toBe(2);
  });
});
