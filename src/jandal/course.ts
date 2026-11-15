import { hashString, mulberry32, shuffle, type Rng } from '../shared/rng';

/** Something the jandal can be landed on. */
export interface TargetType {
  id: string;
  label: string;
  /** Model path under /models, or 'proc:<name>' for a procedurally built prop. */
  model: string;
  /** Longest horizontal side in metres. */
  width: number;
  /** Round targets are checked by radius rather than by rectangle. */
  round?: boolean;
  /** Flat-on-the-ground targets get no collider: the lawn is the landing surface. */
  flat?: boolean;
  /** 1 (easy) to 3 (hard): used to order the holes. */
  difficulty: number;
}

export const TARGET_TYPES: TargetType[] = [
  { id: 'rug', label: 'Picnic rug', model: 'holiday/carpet_round_large', width: 1.9, round: true, flat: true, difficulty: 1 },
  { id: 'pallet', label: 'Pallet', model: 'hexagon/pallet', width: 1.2, difficulty: 1 },
  { id: 'chilly', label: 'Chilly bin', model: 'proc:chillybin', width: 0.95, difficulty: 2 },
  { id: 'lowtable', label: 'Deck table', model: 'furniture/table_low', width: 1.3, difficulty: 2 },
  { id: 'footstool', label: 'Footstool', model: 'holiday/footstool_red', width: 0.9, difficulty: 2 },
  { id: 'pavtable', label: 'Pav table', model: 'furniture/table_medium_long', width: 1.9, difficulty: 3 },
  { id: 'stool', label: 'Stool', model: 'holiday/stool', width: 0.75, difficulty: 3 },
];

export interface Hole {
  type: TargetType;
  /** Distance from the launch spot in metres. */
  distance: number;
  /** Bearing from straight ahead in radians (positive = right). */
  angle: number;
  /** Rotation of the prop about Y. */
  rotation: number;
}

export interface Course {
  seed: string;
  holes: Hole[];
  rng: Rng;
}

export const HOLES_PER_COURSE = 5;
export const FLICKS_PER_HOLE = 3;

/** Same seed string => same course for everyone, which is what makes scores comparable. */
export function buildCourse(seed: string): Course {
  const rng = mulberry32(hashString(`jandal-flip:${seed}`));
  const types = shuffle(TARGET_TYPES, rng)
    .slice(0, HOLES_PER_COURSE)
    .sort((a, b) => a.difficulty - b.difficulty);
  const slots = shuffle([-34, -17, 0, 17, 34], rng);
  const holes: Hole[] = types.map((type, i) => {
    const t = i / (HOLES_PER_COURSE - 1);
    return {
      type,
      distance: 3.6 + t * 3.2 + rng() * 0.9,
      angle: ((slots[i] + (rng() - 0.5) * 6) * Math.PI) / 180,
      rotation: (rng() - 0.5) * 0.7,
    };
  });
  return { seed, holes, rng };
}
