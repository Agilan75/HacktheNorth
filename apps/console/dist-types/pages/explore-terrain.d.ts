import type { Verdict } from '../panels/types.js';
import type { AppetiteBands, Band } from './appetite-bands.js';
/** One account's footprint on the floor: where it stands on the TIV/premium plane. */
export interface TerrainFootprint {
    readonly submissionId: string;
    readonly insuredName: string;
    readonly verdict: Verdict;
    readonly tiv: number | null;
    readonly premium: number | null;
    /** The engine's own sentence for this account, shown on hover: why it lands where it does. */
    readonly reason?: string | null;
    /** True for a row scored on another line of business (cyber, auto, ...), which these bands never applied to. */
    readonly otherLine?: boolean;
}
/** Everything the terrain needs about the account it is drawn for. */
export interface TerrainAccount extends TerrainFootprint {
    /** Appetite points from every factor except `tiv` and `total_premium`. */
    readonly basePoints: number;
    readonly tivWeight: number;
    readonly premiumWeight: number;
    /** A knockout on some other factor: no TIV or premium can rescue this ground. */
    readonly knockedOutElsewhere: boolean;
    /** Something other than these two factors forces a referral (missing data, a contradiction, a refer rule). */
    readonly refersElsewhere: boolean;
    /** The account's real score, for the pin label. */
    readonly appetiteScore: number;
}
export interface TerrainCell {
    readonly tivBand: Band;
    readonly premiumBand: Band;
    readonly score: number;
    readonly verdict: Verdict;
}
export interface TerrainHover {
    readonly kind: 'cell' | 'pin' | 'footprint';
    readonly cell?: TerrainCell;
    readonly footprint?: TerrainFootprint;
    readonly x: number;
    readonly y: number;
}
export interface TerrainCallbacks {
    readonly onHover: (info: TerrainHover | null) => void;
    readonly onSelect: (submissionId: string) => void;
    readonly onOpen: (submissionId: string) => void;
}
export interface TerrainScene {
    setData(account: TerrainAccount | null, footprints: readonly TerrainFootprint[], bands: AppetiteBands): void;
    resetView(): void;
    dispose(): void;
}
export declare function bandLabel(band: Band): string;
/** The appetite score this account would have with that TIV tier and premium tier. */
export declare function cellScore(account: TerrainAccount, tivBand: Band, premiumBand: Band): number;
/** The engine's verdict ladder (verdict.ts V-1..V-5) applied to one piece of ground. */
export declare function cellVerdict(account: TerrainAccount, tivBand: Band, premiumBand: Band): Verdict;
export declare function createTerrainScene(host: HTMLElement, callbacks: TerrainCallbacks): TerrainScene;
/**
 * Turn a submission detail into terrain input. Every number is the API's:
 * `basePoints` is the sum of the account's own factor points outside the two
 * swept factors, and the swept weights are the account's own weights, so the
 * pin's terrace height equals the appetite score the queue shows.
 */
export declare function terrainAccountOf(detail: TerrainDetail): TerrainAccount;
/** The slice of `SubmissionDetailView` the terrain reads. */
export interface TerrainDetail {
    readonly submissionId: string;
    readonly insuredName: string;
    readonly verdict: Verdict;
    readonly appetiteScore: number;
    readonly factors: readonly {
        readonly factorId: string;
        readonly weight: number;
        readonly points: number;
        readonly known: boolean;
        readonly knockout: boolean;
        readonly tier: string | null;
    }[];
    readonly rollup: {
        readonly totalTiv: number | null;
    };
    readonly pricing: {
        readonly quotedPremium: number | null;
    };
    readonly contradictions: readonly {
        readonly severity: string;
        readonly status: string;
    }[];
}
//# sourceMappingURL=explore-terrain.d.ts.map