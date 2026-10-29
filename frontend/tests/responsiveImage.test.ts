import assert from 'node:assert/strict'
import test from 'node:test'
import { tmdbImageSrcSet } from '../src/utils/responsiveImage.ts'

test('poster candidates retain exactly the TMDB file and supported widths', () => {
  assert.equal(tmdbImageSrcSet('https://image.tmdb.org/t/p/w500/poster.jpg', 'poster'),
    [185, 342, 500, 780].map(width => `https://image.tmdb.org/t/p/w${width}/poster.jpg ${width}w`).join(', '))
})

test('backdrop candidates do not use poster-only sizes', () => {
  assert.equal(tmdbImageSrcSet('https://image.tmdb.org/t/p/w1280/backdrop.webp', 'backdrop'),
    [300, 780, 1280].map(width => `https://image.tmdb.org/t/p/w${width}/backdrop.webp ${width}w`).join(', '))
})

test('custom, local, missing and malformed image URLs remain untouched', () => {
  for (const url of [undefined, '', '/images/poster.jpg', 'https://example.com/w500/poster.jpg',
    'https://image.tmdb.org.evil.test/t/p/w500/poster.jpg', 'http://image.tmdb.org/t/p/w500/poster.jpg',
    'https://image.tmdb.org/t/p/w500/../poster.jpg', 'https://image.tmdb.org/t/p/w500/poster.svg',
    'https://image.tmdb.org/t/p/w500/poster.jpg?secret=example', 'https://image.tmdb.org/t/p/w500/folder/poster.jpg'])
    assert.equal(tmdbImageSrcSet(url, 'poster'), undefined)
})
