import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppRouter } from '@/router'

export default function App() {
  return (
    <TooltipProvider>
      <AppRouter />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
