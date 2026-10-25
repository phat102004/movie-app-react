// TMDB khai báo movie_id là int32. Không nhận số âm, số thập phân hoặc URL.
export function isValidMovieId(value: string | undefined): value is string {
  return Boolean(
    value && /^[1-9]\d*$/.test(value) && Number(value) <= 2_147_483_647,
  )
}
