import type { Movie, MovieSection } from '../types/movie'

// Dữ liệu mẫu của các giai đoạn trước, không dùng làm fallback cho TMDB.
export const movies: Movie[] = [
  {
    id: 'dune-part-two',
    title: 'Dune: Hành tinh cát — Phần hai',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    rating: 8.5,
    poster: '/images/movies/dune-part-two.jpg',
    backdrop: '/images/movies/dune-hero.jpg',
    genres: ['Khoa học viễn tưởng', 'Phiêu lưu'],
    description:
      'Giữa biển cát Arrakis, Paul Atreides sát cánh cùng Chani và người Fremen. Một hành trình định mệnh, nơi tình yêu và tương lai của cả vũ trụ đứng trước những lựa chọn không thể quay đầu.',
  },
  {
    id: 'interstellar',
    title: 'Hố đen tử thần',
    originalTitle: 'Interstellar',
    year: 2014,
    rating: 8.7,
    poster: '/images/movies/interstellar.jpg',
    genres: ['Khoa học viễn tưởng', 'Chính kịch'],
    description:
      'Một nhóm phi hành gia vượt qua giới hạn không gian để tìm mái nhà mới cho nhân loại.',
  },
  {
    id: 'oppenheimer',
    title: 'Oppenheimer',
    originalTitle: 'Oppenheimer',
    year: 2023,
    rating: 8.3,
    poster: '/images/movies/oppenheimer.jpg',
    genres: ['Tiểu sử', 'Chính kịch'],
    description:
      'Chân dung một nhà khoa học và những lựa chọn làm thay đổi thế giới mãi mãi.',
  },
  {
    id: 'spider-verse',
    title: 'Người Nhện: Du hành vũ trụ nhện',
    originalTitle: 'Across the Spider-Verse',
    year: 2023,
    rating: 8.6,
    poster: '/images/movies/across-the-spider-verse.jpg',
    genres: ['Hoạt hình', 'Phiêu lưu'],
    description:
      'Miles Morales bước vào đa vũ trụ và khám phá ý nghĩa của việc trở thành người hùng.',
  },
  {
    id: 'blade-runner',
    title: 'Tội phạm nhân bản 2049',
    originalTitle: 'Blade Runner 2049',
    year: 2017,
    rating: 8.0,
    poster: '/images/movies/blade-runner-2049.jpg',
    genres: ['Khoa học viễn tưởng', 'Bí ẩn'],
    description:
      'Một bí mật bị chôn giấu dẫn viên cảnh sát K đến cuộc tìm kiếm giữa thành phố tương lai.',
  },
  {
    id: 'inception',
    title: 'Kẻ đánh cắp giấc mơ',
    originalTitle: 'Inception',
    year: 2010,
    rating: 8.8,
    poster: '/images/movies/inception.jpg',
    genres: ['Khoa học viễn tưởng', 'Hành động'],
    description:
      'Một chuyên gia xâm nhập giấc mơ nhận nhiệm vụ gieo ý tưởng vào tâm trí người khác.',
  },
  {
    id: 'poor-things',
    title: 'Những kẻ đáng thương',
    originalTitle: 'Poor Things',
    year: 2023,
    rating: 7.8,
    poster: '/images/movies/poor-things.jpg',
    genres: ['Giả tưởng', 'Chính kịch'],
    description:
      'Bella bước ra thế giới với sự tò mò vô hạn trong một hành trình khám phá bản thân.',
  },
  {
    id: 'the-batman',
    title: 'Người Dơi',
    originalTitle: 'The Batman',
    year: 2022,
    rating: 7.8,
    poster: '/images/movies/the-batman.jpg',
    genres: ['Hành động', 'Trinh thám'],
    description:
      'Người Dơi lần theo những manh mối bí ẩn để vạch trần góc tối của thành phố Gotham.',
  },
  {
    id: 'everything-everywhere',
    title: 'Cuộc chiến đa vũ trụ',
    originalTitle: 'Everything Everywhere All at Once',
    year: 2022,
    rating: 7.8,
    poster: '/images/movies/everything-everywhere.jpg',
    genres: ['Phiêu lưu', 'Giả tưởng'],
    description:
      'Cuộc sống bình thường của một người mẹ bất ngờ trở thành chìa khóa của đa vũ trụ.',
  },
  {
    id: 'soul',
    title: 'Cuộc sống nhiệm màu',
    originalTitle: 'Soul',
    year: 2020,
    rating: 8.0,
    poster: '/images/movies/soul.jpg',
    genres: ['Hoạt hình', 'Gia đình'],
    description:
      'Một nhạc sĩ nhạc jazz tìm lại ý nghĩa cuộc sống qua những khoảnh khắc nhỏ bé.',
  },
  {
    id: 'dune',
    title: 'Dune: Hành tinh cát',
    originalTitle: 'Dune',
    year: 2021,
    rating: 8.0,
    poster: '/images/movies/dune.jpg',
    genres: ['Khoa học viễn tưởng', 'Phiêu lưu'],
    description:
      'Paul Atreides đến hành tinh sa mạc Arrakis, nơi số phận gia tộc và đế chế giao nhau.',
  },
  {
    id: 'arrival',
    title: 'Cuộc đổ bộ bí ẩn',
    originalTitle: 'Arrival',
    year: 2016,
    rating: 7.9,
    poster: '/images/movies/arrival.jpg',
    genres: ['Khoa học viễn tưởng', 'Bí ẩn'],
    description:
      'Một nhà ngôn ngữ học tìm cách giao tiếp với những vị khách đến từ ngoài Trái Đất.',
  },
]

export const heroMovie = movies[0]

// Mỗi nhóm tham chiếu cùng bộ dữ liệu, không cần sao chép thông tin phim.
export const movieSections: MovieSection[] = [
  {
    id: 'featured',
    title: 'Phim nổi bật',
    subtitle: 'Những câu chuyện xứng đáng với thời gian của bạn.',
    movies: movies.slice(0, 6),
  },
  {
    id: 'recent',
    title: 'Phim mới cập nhật',
    subtitle: 'Thêm một bộ phim, thêm một thế giới để khám phá.',
    movies: [
      movies[6],
      movies[7],
      movies[8],
      movies[9],
      movies[10],
      movies[11],
    ],
  },
  {
    id: 'popular',
    title: 'Phim phổ biến',
    subtitle: 'Những cái tên luôn được người yêu điện ảnh nhắc đến.',
    movies: [...movies]
      .sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
      .slice(0, 6),
  },
]
