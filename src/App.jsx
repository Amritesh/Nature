import { Suspense } from 'react'
import Experience from './components/Experience'

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Suspense fallback={null}>
        <Experience />
      </Suspense>
    </div>
  )
}

export default App
