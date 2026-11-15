/**
 * Trap Line rules, with no rendering: a small hex bush block, three predator species
 * that each travel in their own way, and nests that only fledge if nothing reaches them.
 * Kept pure and deterministic so it can be tested headlessly and replayed from a seed.
 *
 * NOTE: the species behaviour here is a simplified model for play. It should be checked
 * by someone from DOC or a community trapping group before launch.
 */
import { hashString, mulberry32, shuffle, type Rng } from '../../shared/rng.ts';

export type Terrain = 'bush' | 'water' | 'farm' | 'pohutukawa' | 'bach';
export type Species = 'rat' | 'stoat' | 'possum';
export type Tool = 'trap' | 'tunnel';

export interface Tile {
  q: number;
  r: number;
  terrain: Terrain;
  nest: boolean;
  /** On the outside ring of the block. */
  edge: boolean;
  /** Next to the stream: stoats use stream banks as highways. */
  bank: boolean;
}

export interface Predator {
  id: number;
  species: Species;
  q: number;
  r: number;
}

export interface PredatorNight {
  id: number;
  species: Species;
  /** Tile at each step of the night; index 0 is where it started. */
  steps: { q: number; r: number }[];
  /** Step index at which it was trapped, if it was. */
  caughtAt: number | null;
  /** True if it came in over the boundary tonight. */
  arrived: boolean;
}

export interface NightReport {
  night: number;
  predators: PredatorNight[];
  /** Nest tile key -> species that raided it first. */
  raided: Map<string, Species>;
  /** Tracking tunnel tile key -> species that left prints. */
  prints: Map<string, Species[]>;
  caught: Record<Species, number>;
  nestsSafe: number;
  nestsTotal: number;
  birdsGained: number;
}

export const RADIUS = 3;
export const NIGHTS = 5;
export const SPECIES: Species[] = ['rat', 'stoat', 'possum'];

/** Tiles a predator covers in one night: stoats range far, possums amble. */
const STEPS: Record<Species, number> = { rat: 3, stoat: 5, possum: 2 };

const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
] as const;

export const key = (q: number, r: number): string => `${q},${r}`;

/** Birds return in this order as the total number of fledged nests grows. */
export const CHORUS = [
  { id: 'tui', name: 'Tūī', at: 6 },
  { id: 'korimako', name: 'Korimako', at: 10 },
  { id: 'piwakawaka', name: 'Pīwakawaka', at: 14 },
  { id: 'kereru', name: 'Kererū', at: 18 },
  { id: 'kiwi', name: 'Kiwi', at: 22 },
] as const;

export class Sim {
  readonly tiles = new Map<string, Tile>();
  readonly traps = new Set<string>();
  readonly tunnels = new Set<string>();
  predators: Predator[] = [];
  /** Nights completed so far. */
  night = 0;
  birds = 0;
  trapsOwned = 5;
  tunnelsOwned = 2;
  private nextId = 1;
  private readonly rng: Rng;
  private readonly farmTiles: Tile[];
  private readonly streamMouths: Tile[];
  readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
    this.rng = mulberry32(hashString(`trap-line:${seed}`));
    this.generate();
    this.farmTiles = [...this.tiles.values()].filter((t) => t.terrain === 'farm');
    this.streamMouths = [...this.tiles.values()].filter((t) => t.edge && t.bank && t.terrain !== 'water');
  }

  // -- Map ------------------------------------------------------------------

  private generate(): void {
    const rng = this.rng;
    for (let q = -RADIUS; q <= RADIUS; q++) {
      for (let r = -RADIUS; r <= RADIUS; r++) {
        if (Math.abs(q + r) > RADIUS) continue;
        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
        this.tiles.set(key(q, r), { q, r, terrain: 'bush', nest: false, edge: ring === RADIUS, bank: false });
      }
    }
    // A stream rises in the middle of the block and runs out over the northern boundary.
    // It doesn't cut the block in two: predators walk round it, and stoats follow its banks in.
    let q = rng() < 0.5 ? 1 : 2;
    for (let r = -RADIUS; r <= 0; r++) {
      this.tiles.get(key(q, r))!.terrain = 'water';
      if (q > 0 && rng() < 0.6) q -= 1;
    }
    // Farmland runs down the western boundary: this is where reinvasion comes from.
    for (const t of this.tiles.values()) {
      if (t.edge && t.q + t.r / 2 < -1.4 && t.terrain === 'bush') t.terrain = 'farm';
    }
    // Pōhutukawa line the eastern (coast) edge, and the bach sits at the south-east corner.
    const east = [...this.tiles.values()].filter((t) => t.edge && t.q + t.r / 2 > 1.4 && t.terrain === 'bush');
    const bach = east.reduce((a, b) => (b.r > a.r ? b : a));
    bach.terrain = 'bach';
    const pohutukawa = shuffle(east.filter((t) => t !== bach), rng).slice(0, 3);
    for (const t of pohutukawa) {
      t.terrain = 'pohutukawa';
      t.nest = true;
    }
    for (const t of this.tiles.values()) {
      t.bank = t.terrain !== 'water' && this.neighbours(t).some((n) => n.terrain === 'water');
    }
    // Three more nests in the bush, away from the farm fence.
    const inner = shuffle(
      [...this.tiles.values()].filter(
        (t) => t.terrain === 'bush' && !t.edge && !this.neighbours(t).some((n) => n.terrain === 'farm' || n.nest),
      ),
      rng,
    );
    let placed = 0;
    for (const t of inner) {
      if (placed === 3) break;
      if (this.neighbours(t).some((n) => n.nest)) continue;
      t.nest = true;
      placed++;
    }
  }

  neighbours(t: { q: number; r: number }): Tile[] {
    const out: Tile[] = [];
    for (const [dq, dr] of DIRS) {
      const n = this.tiles.get(key(t.q + dq, t.r + dr));
      if (n) out.push(n);
    }
    return out;
  }

  private passable(t: Tile): boolean {
    return t.terrain !== 'water' && t.terrain !== 'bach';
  }

  /** Steps to the nearest tile matching `goal`, walking only over passable tiles. */
  private distanceField(goal: (t: Tile) => boolean): Map<string, number> {
    const dist = new Map<string, number>();
    const queue: Tile[] = [];
    for (const t of this.tiles.values()) {
      if (goal(t)) {
        dist.set(key(t.q, t.r), 0);
        queue.push(t);
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      const d = dist.get(key(t.q, t.r))!;
      for (const n of this.neighbours(t)) {
        if (!this.passable(n) || dist.has(key(n.q, n.r))) continue;
        dist.set(key(n.q, n.r), d + 1);
        queue.push(n);
      }
    }
    return dist;
  }

  // -- Player actions -------------------------------------------------------

  /** Gear can't go in the stream, on the bach, or right on a nest (it would disturb the birds). */
  canPlace(t: Tile): boolean {
    return this.passable(t) && !t.nest;
  }

  toolAt(k: string): Tool | null {
    return this.traps.has(k) ? 'trap' : this.tunnels.has(k) ? 'tunnel' : null;
  }

  remaining(tool: Tool): number {
    return tool === 'trap' ? this.trapsOwned - this.traps.size : this.tunnelsOwned - this.tunnels.size;
  }

  /** Places the tool, or picks up whatever is already on the tile. Returns what changed. */
  toggle(t: Tile, tool: Tool): 'placed' | 'removed' | 'none' {
    const k = key(t.q, t.r);
    if (this.traps.delete(k) || this.tunnels.delete(k)) return 'removed';
    if (!this.canPlace(t) || this.remaining(tool) <= 0) return 'none';
    (tool === 'trap' ? this.traps : this.tunnels).add(k);
    return 'placed';
  }

  get finished(): boolean {
    return this.night >= NIGHTS;
  }

  // -- Night ----------------------------------------------------------------

  private arrivals(night: number): Predator[] {
    const counts: Record<Species, number> = {
      rat: 2 + Math.floor(night / 2),
      stoat: night >= 4 ? 2 : night >= 2 ? 1 : 0,
      possum: night >= 3 ? 2 : 1,
    };
    const out: Predator[] = [];
    for (const species of SPECIES) {
      for (let i = 0; i < counts[species]; i++) {
        // Stoats come in where the stream crosses the boundary; the rest over the farm fence.
        const pool = species === 'stoat' && this.streamMouths.length ? this.streamMouths : this.farmTiles;
        const at = pool[Math.floor(this.rng() * pool.length)];
        out.push({ id: this.nextId++, species, q: at.q, r: at.r });
      }
    }
    return out;
  }

  private score(p: Predator, n: Tile, visited: Set<string>, fields: Fields, raided: Map<string, Species>): number {
    const k = key(n.q, n.r);
    const liveNest = n.nest && !raided.has(k);
    const toNest = fields.nest.get(k) ?? 9;
    let s = this.rng() * 0.7 - (visited.has(k) ? 3 : 0);
    if (p.species === 'rat') {
      // Rats stick to cover and climb to nests.
      s += (n.terrain === 'bush' || n.terrain === 'pohutukawa' ? 2 : 0) + (liveNest ? 4 : 0) - toNest * 0.9;
    } else if (p.species === 'stoat') {
      // Stoats run the edges and the stream banks, and take a nest if they pass one.
      s += (n.bank || n.edge ? 3 : 0) + (liveNest ? 3 : 0) - toNest * 0.4;
    } else {
      // Possums make for the pōhutukawa to browse it.
      s += (liveNest ? 2 : 0) - (fields.pohutukawa.get(k) ?? 9) * 1.5;
    }
    return s;
  }

  /** Runs one night with the tools as currently placed. */
  runNight(): NightReport {
    const night = this.night + 1;
    const arrived = this.arrivals(night);
    const arrivedIds = new Set(arrived.map((p) => p.id));
    this.predators.push(...arrived);

    const raided = new Map<string, Species>();
    const prints = new Map<string, Species[]>();
    const sprung = new Set<string>();
    const caught: Record<Species, number> = { rat: 0, stoat: 0, possum: 0 };
    const fields: Fields = {
      nest: this.distanceField((t) => t.nest),
      pohutukawa: this.distanceField((t) => t.terrain === 'pohutukawa'),
    };
    const tracks = new Map<number, PredatorNight>();
    const visited = new Map<number, Set<string>>();
    const alive = new Set<number>();

    const enter = (p: Predator, step: number): void => {
      const k = key(p.q, p.r);
      const track = tracks.get(p.id)!;
      if (this.tunnels.has(k)) {
        const list = prints.get(k) ?? [];
        if (!list.includes(p.species)) list.push(p.species);
        prints.set(k, list);
      }
      if (this.traps.has(k) && !sprung.has(k)) {
        // One trap, one catch per night: busy routes need more than one.
        sprung.add(k);
        caught[p.species]++;
        track.caughtAt = step;
        alive.delete(p.id);
        return;
      }
      const tile = this.tiles.get(k)!;
      if (tile.nest && !raided.has(k)) raided.set(k, p.species);
    };

    for (const p of this.predators) {
      tracks.set(p.id, { id: p.id, species: p.species, steps: [{ q: p.q, r: p.r }], caughtAt: null, arrived: arrivedIds.has(p.id) });
      visited.set(p.id, new Set([key(p.q, p.r)]));
      alive.add(p.id);
      // New arrivals walk onto their first tile; residents are already past its trap.
      if (arrivedIds.has(p.id)) enter(p, 0);
    }

    const maxSteps = Math.max(...Object.values(STEPS));
    for (let step = 1; step <= maxSteps; step++) {
      for (const p of this.predators) {
        if (!alive.has(p.id) || step > STEPS[p.species]) continue;
        const seen = visited.get(p.id)!;
        const options = this.neighbours(p).filter((n) => this.passable(n));
        if (!options.length) continue;
        let best = options[0];
        let bestScore = -Infinity;
        for (const n of options) {
          const s = this.score(p, n, seen, fields, raided);
          if (s > bestScore) {
            bestScore = s;
            best = n;
          }
        }
        p.q = best.q;
        p.r = best.r;
        seen.add(key(p.q, p.r));
        tracks.get(p.id)!.steps.push({ q: p.q, r: p.r });
        enter(p, tracks.get(p.id)!.steps.length - 1);
      }
    }

    this.predators = this.predators.filter((p) => alive.has(p.id));
    const nestsTotal = [...this.tiles.values()].filter((t) => t.nest).length;
    const nestsSafe = nestsTotal - raided.size;
    this.birds += nestsSafe;
    this.night = night;
    // More gear arrives each morning as the neighbours chip in.
    if (!this.finished) {
      this.trapsOwned += 2;
      if (night <= 2) this.tunnelsOwned += 1;
    }
    return { night, predators: [...tracks.values()], raided, prints, caught, nestsSafe, nestsTotal, birdsGained: nestsSafe };
  }

  chorus(): { id: string; name: string; at: number; here: boolean }[] {
    return CHORUS.map((c) => ({ ...c, here: this.birds >= c.at }));
  }
}

interface Fields {
  nest: Map<string, number>;
  pohutukawa: Map<string, number>;
}
