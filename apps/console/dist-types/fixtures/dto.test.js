import { describe, expect, it } from 'vitest';
import { fixtureQueue, fixtureSubmission } from './dto';
const KINDS = ['fit', 'refer', 'dnf', 'no-policy'];
/** INTERPRETATIONS W-1, in the §2 factor order. */
const WEIGHTS = {
    submission_type: 0.1,
    line_of_business: 0.15,
    primary_risk_state: 0.15,
    tiv: 0.15,
    total_premium: 0.15,
    building_age: 0.1,
    construction_type: 0.1,
    loss_value: 0.1,
};
/** INTERPRETATIONS P-5, null terms dropped and weights renormalised. */
function quality(s) {
    const p = s.pricing;
    const terms = [
        [0.5, s.appetiteScore],
        [0.1, s.completeness],
        [0.05, s.confidence * 100],
    ];
    if (p.adequacy !== null)
        terms.push([0.2, (Math.min(Math.max(p.adequacy, 0), 2) / 2) * 100]);
    if (p.expectedLoss !== null && p.quotedPremium !== null) {
        const lr = p.expectedLoss / p.quotedPremium;
        terms.push([0.15, Math.min(Math.max(1 - lr, 0), 1) * 100]);
    }
    const w = terms.reduce((a, [wi]) => a + wi, 0);
    return terms.reduce((a, [wi, v]) => a + wi * v, 0) / w;
}
describe('fixtureSubmission', () => {
    it.each(KINDS)('%s: points are 100·w·t and sum to the appetite score', (kind) => {
        const s = fixtureSubmission(kind);
        expect(s.factors.map((f) => f.factorId)).toEqual(Object.keys(WEIGHTS));
        for (const f of s.factors) {
            expect(f.weight).toBe(WEIGHTS[f.factorId]);
            expect(f.points).toBeCloseTo(f.known ? 100 * f.weight * (f.tierValue ?? NaN) : 0, 9);
            if (!f.known)
                expect(f.tierValue).toBeNull();
        }
        expect(s.factors.reduce((a, f) => a + f.points, 0)).toBeCloseTo(s.appetiteScore, 9);
        expect(s.explanation.verdict).toBe(s.verdict);
    });
    it('FIT is worked case B1: 84.0, complete, no knockout', () => {
        const s = fixtureSubmission('fit');
        expect(s.verdict).toBe('FIT');
        expect(s.appetiteScore).toBe(84);
        expect(s.completeness).toBe(100);
        expect(s.factors.map((f) => f.tierValue)).toEqual([1, 1, 1, 0.6, 0.6, 0.6, 1, 1]);
        expect(s.factors.some((f) => f.knockout)).toBe(false);
        expect(s.flip.distanceToAppetite).toBe(0);
        // V-8: lowest tier value, ties by highest weight, then factor order -> tiv.
        expect(s.explanation.decidingFactorId).toBe('tiv');
    });
    it('REFER is worked case B6: 84.0, building_age stays 0.6 and refers', () => {
        const s = fixtureSubmission('refer');
        expect(s.verdict).toBe('REFER');
        expect(s.appetiteScore).toBe(84);
        expect(s.rollup.pctTivPre1990).toBe(0.5);
        expect(s.factors.find((f) => f.factorId === 'building_age')).toMatchObject({ tier: 'refer', tierValue: 0.6, knockout: false });
        expect(s.buildings.filter((b) => (b.yearBuilt ?? 9999) < 1990).map((b) => b.id)).toEqual(['B-1']);
        expect(s.sweep).not.toBeNull();
        expect(s.drafts).toHaveLength(1);
    });
    it('DNF is worked case B2: tiv knockout, 75.0, one move from FIT', () => {
        const s = fixtureSubmission('dnf');
        expect(s.verdict).toBe('DOES_NOT_FIT');
        expect(s.appetiteScore).toBe(75);
        expect(s.rollup.totalTiv).toBe(150000000.01);
        expect(s.buildings.reduce((a, b) => a + (b.tiv ?? 0), 0)).toBeCloseTo(150000000.01, 4);
        expect(s.factors.filter((f) => f.knockout).map((f) => f.factorId)).toEqual(['tiv']);
        expect(s.flip).toMatchObject({ available: true, verdictAfter: 'FIT', scoreAfter: 84, distanceToAppetite: 1 });
        expect(s.flip.moves).toHaveLength(1);
        expect(s.flip.moves[0]).toMatchObject({ componentKey: 'totalTiv', to: 150000000 });
        expect(s.vector.components.find((c) => c.key === 'totalTiv')?.immovable).toBe(false);
    });
    it('no-policy: only line of business known, 15.0, completeness 1/9, REFER', () => {
        const s = fixtureSubmission('no-policy');
        expect(s.verdict).toBe('REFER');
        expect(s.appetiteScore).toBe(15);
        expect(s.completeness).toBeCloseTo((100 * 1) / 9, 9);
        expect(s.factors.filter((f) => f.known).map((f) => f.factorId)).toEqual(['line_of_business']);
        expect(s.pricing.predictedPremium).toBeNull();
        expect(s.buildings).toEqual([]);
        expect(s.vector.components.filter((c) => c.mask === 1).map((c) => c.key)).toEqual(['isPropertyLine']);
    });
    it.each(KINDS)('%s: vector masks agree with raw/tier nulls and the pricing ratios', (kind) => {
        const s = fixtureSubmission(kind);
        expect(s.vector.components).toHaveLength(11);
        for (const c of s.vector.components) {
            expect(c.mask === 0).toBe(c.raw === null);
            if (c.mask === 0)
                expect(c.tier).toBeNull();
        }
        const p = s.pricing;
        if (p.quotedPremium !== null && p.predictedPremium !== null) {
            expect(p.adequacy).toBeCloseTo(p.quotedPremium / p.predictedPremium, 12);
        }
        if (p.predictedPremium !== null && s.rollup.totalTiv !== null) {
            expect(p.ratePer100Tiv).toBeCloseTo((p.predictedPremium / s.rollup.totalTiv) * 100, 12);
        }
    });
    it('returns a fresh object each call', () => {
        expect(fixtureSubmission('fit')).not.toBe(fixtureSubmission('fit'));
        expect(fixtureSubmission('fit')).toEqual(fixtureSubmission('fit'));
    });
});
describe('fixtureQueue', () => {
    const queue = fixtureQueue();
    it('carries each fixture submission plus one out-of-appetite line row', () => {
        expect(queue.map((r) => r.submissionId)).toEqual(['sub-fit', 'sub-refer', 'sub-no-policy', 'sub-dnf', 'sub-cyber']);
        expect(queue.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
        expect(queue.filter((r) => r.outOfAppetiteLine).map((r) => r.lineOfBusiness)).toEqual(['cyber']);
    });
    it('quality index matches P-5 for every fixture submission', () => {
        for (const kind of KINDS) {
            const s = fixtureSubmission(kind);
            const row = queue.find((r) => r.submissionId === s.submissionId);
            expect(row?.qualityIndex).toBeCloseTo(quality(s), 9);
            expect(row?.appetiteScore).toBe(s.appetiteScore);
            expect(row?.verdict).toBe(s.verdict);
        }
    });
    it('orders by P-6: non-knockouts by quality desc, then knockouts by distance (null last)', () => {
        const nonKo = queue.filter((r) => r.verdict !== 'DOES_NOT_FIT');
        const q = nonKo.map((r) => r.qualityIndex);
        expect([...q].sort((a, b) => b - a)).toEqual(q);
        const ko = queue.filter((r) => r.verdict === 'DOES_NOT_FIT');
        expect(Math.min(...ko.map((r) => r.rank))).toBeGreaterThan(Math.max(...nonKo.map((r) => r.rank)));
        expect(ko.map((r) => r.oneFlipFromFit)).toEqual([true, false]);
    });
});
//# sourceMappingURL=dto.test.js.map