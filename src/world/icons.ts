/**
 * One small authored icon set: 24px grid, 2px round strokes, currentColor.
 * Kept inline so the UI needs no icon font or extra request.
 */
const PATHS: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  share: '<path d="M12 3v12"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.5-6.5L15 17v4"/><path d="M8.5 11l3-3 3 2 2.5 1"/><path d="M11.5 8l1 6.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  map: '<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c1.4-3.6 4.2-5.3 7.5-5.3s6.1 1.7 7.5 5.3"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  trap: '<rect x="3.5" y="9" width="17" height="9" rx="1.5"/><path d="M3.5 12.5h17"/><path d="M15 9V6.5"/>',
  tunnel: '<path d="M3 18a9 9 0 0 1 18 0"/><path d="M3 18h18"/><path d="M8.5 15.5l.01 0M12 14.5l.01 0M15.5 15.5l.01 0"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  bird: '<path d="M4 15c3 0 5-2 6-5 1-2.7 3-4 5.5-4 1.5 0 2.5.8 3 1.8L21 8l-2.3 1.2c-.3 4.7-3.6 8.3-8.7 8.3H4z"/><path d="M15.5 8.3l.01 0"/>',
  sound: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a7.8 7.8 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/>',
};

export function icon(name: keyof typeof PATHS | string, size = 22): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? ''}</svg>`;
}
