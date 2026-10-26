type IconName =
  'search' | 'menu' | 'close' | 'play' | 'info' | 'star' | 'arrow' | 'heart'

type IconProps = {
  name: IconName
  className?: string
}

const paths: Record<IconName, string> = {
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  search: 'M21 21l-4.35-4.35M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm6 6 12 12M6 18 18 6',
  play: 'm8 5 11 7-11 7V5Z',
  info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  star: 'm12 3 2.78 5.63 6.22.91-4.5 4.38 1.06 6.19L12 17.19l-5.56 2.92 1.06-6.19L3 9.54l6.22-.91L12 3Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
}

export function Icon({ name, className = '' }: IconProps) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill={name === 'play' || name === 'star' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
