import { Link } from 'react-router'
import './NotFoundPage.css'

type NotFoundPageProps = { title?: string; message?: string }

export function NotFoundPage({
  title = 'Trang này chưa có trong thước phim.',
  message = 'Đường dẫn bạn vừa mở không tồn tại. Hãy trở về trang chủ để tiếp tục khám phá.',
}: NotFoundPageProps) {
  return (
    <section
      className="not-found page-container"
      aria-labelledby="not-found-title"
    >
      <p className="not-found-number" aria-hidden="true">
        404<span>.</span>
      </p>
      <p className="details-eyebrow">CINEVERSE / KHÔNG TÌM THẤY</p>
      <h1 id="not-found-title">{title}</h1>
      <p className="not-found-description">{message}</p>
      <Link className="button button-primary" to="/">
        Về trang chủ
      </Link>
    </section>
  )
}
