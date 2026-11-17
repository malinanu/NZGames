/**
 * Quality presets. Phones default to Low (hardware benchmarks in the browser are unreliable,
 * and many iPhones run the WebGL fallback); desktops default to High. A toggle in the map
 * sheet overrides it, and the choice is remembered on this device.
 */
export type QualityName = 'low' | 'high';

export interface QualityPreset {
  name: QualityName;
  maxPixelRatio: number;
  shadowMap: number;
  /** Grass blades in the patch around the player, and how wide each one is. */
  grassBlades: number;
  grassWidth: number;
  /** Depth tint and ripples on the water. */
  waterDetail: boolean;
  /** Flowers glow at night. */
  glow: boolean;
  /** Multiplies the follow camera distance (Low sits a little closer). */
  cameraDistance: number;
}

const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', maxPixelRatio: 1.5, shadowMap: 1024, grassBlades: 9000, grassWidth: 1.6, waterDetail: false, glow: false, cameraDistance: 0.9 },
  high: { name: 'high', maxPixelRatio: 2, shadowMap: 2048, grassBlades: 22000, grassWidth: 1, waterDetail: true, glow: true, cameraDistance: 1 },
};

const KEY = 'kiwi-christmas:quality';
const isMobile = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

function initial(): QualityName {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'low' || forced === 'high') return forced;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'low' || saved === 'high') return saved;
  } catch {
    // Storage blocked: use the default.
  }
  return isMobile ? 'low' : 'high';
}

export const quality = {
  preset: PRESETS[initial()],
  isMobile,
  /** Saves the choice; the page reloads to apply it (shadow maps and grass are built once). */
  set(name: QualityName): void {
    try {
      localStorage.setItem(KEY, name);
    } catch {
      // Not remembered.
    }
    location.reload();
  },
};
