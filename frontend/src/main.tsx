import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { UnauthorizedError } from './lib/api'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import 'preline/non-auto'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed — offline support unavailable
    })
  })
}

const queryClient = new QueryClient({
  // A single toast for any failed query. Most pages render only their empty
  // state on error, so without this an unreachable API was silent -- the UI
  // just looked empty. Deduped by key so a 5s poll can't spam the user.
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof UnauthorizedError) return // handled by AuthProvider
      const message = error instanceof Error ? error.message : 'Request failed'
      toast.error(message, { id: `query-error-${String(query.queryKey[0])}` })
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

window.HSStaticMethods?.autoInit()
