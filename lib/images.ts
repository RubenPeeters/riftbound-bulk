/**
 * Card art comes from Sanity's image pipeline, which resizes and re-encodes on request.
 *
 * The originals are 744x1039 PNGs of roughly 800 kB, so a 60-card page pulled about 47 MB
 * of images. The same page at w=400 in webp is under 2 MB, and the cards are drawn at
 * roughly 200 px wide, so nothing is lost that anyone can see.
 *
 * Resizing is done by Riot's CDN rather than by us: the art stays theirs, referenced and
 * never rehosted, which is the same reason there is no image proxy in this app.
 */
export function cardImage(url: string | null | undefined, width: number): string | undefined {
  if (!url) return undefined;
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}&fm=webp&q=75`;
}

/** Widths used across the app, named so the call sites read as intent. */
export const THUMB = 120;
export const TILE = 400;
