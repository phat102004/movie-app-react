// Only resize URLs produced by our TMDB mapper; keep local/custom images intact.
export function tmdbImageSrcSet(src: string | undefined, kind: 'poster' | 'backdrop') {
  const match = src?.match(/^https:\/\/image\.tmdb\.org\/t\/p\/w\d+(\/[a-zA-Z0-9._-]+\.(?:jpg|jpeg|png|webp))$/i)
  if (!match) return undefined
  const widths = kind === 'poster' ? [185, 342, 500, 780] : [300, 780, 1280]
  return widths.map((width) => `https://image.tmdb.org/t/p/w${width}${match[1]} ${width}w`).join(', ')
}

// Native auto sizes uses the actual laid-out width for lazy images (including
// Favorites' different grid breakpoints). Older browsers use a generous fallback.
export const moviePosterSizes = 'auto, (max-width: 639px) 50vw, (max-width: 959px) 33vw, (max-width: 1279px) 25vw, 288px'
export const heroImageSizes = '(max-width: 760px) calc(100vw - clamp(40px, 9vw, 144px)), (max-width: 1050px) calc((100vw - clamp(40px, 9vw, 144px) - 32px) * 0.535), (max-width: 1440px) calc((100vw - clamp(40px, 9vw, 144px) - 56px) * 0.535), 672px'
