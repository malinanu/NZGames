/**
 * Campaign / brand layer. Everything brand-specific lives here so the games stay
 * re-skinnable. Official logo files and brand colours must come from the client's
 * brand kit: set `logoUrl` to a file under /public/brand once supplied.
 */
export const brand = {
  presenter: 'Mentos',
  campaign: 'Mystery Flavours',
  /** Path under /public (e.g. 'brand/logo.svg'). Empty = text-only lockup. */
  logoUrl: '',
  /** Placeholder "mystery flavour" colours, to be replaced by the brand kit values. */
  palette: ['#ff4fa3', '#9be22d', '#27c4f5', '#ffd23f', '#8b5cf6', '#ff7a1a'],
  /** Jandal colours: [footbed, sole, strap]. */
  jandal: ['#27c4f5', '#1d2a6b', '#ff4fa3'] as [string, string, string],
};
