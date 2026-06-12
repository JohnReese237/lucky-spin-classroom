import { useEffect, useState } from 'react'
import DesktopApp from './DesktopApp'
import MobileApp from './MobileApp'

const MOBILE_QUERY = '(max-width: 760px)'

function App() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY)
    const handleChange = () => setIsMobile(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return isMobile ? <MobileApp /> : <DesktopApp />
}

export default App
