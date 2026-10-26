import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthProvider'
import { FavoritesProvider } from './contexts/FavoritesProvider'
import { captureResetToken } from './utils/resetToken'

// Xóa fragment trước khi Router/Provider mount và tạo bất kỳ HTTP request nào.
captureResetToken()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FavoritesProvider>
          <App />
        </FavoritesProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
