import * as RadixToast from '@radix-ui/react-toast';
import { Toast, ThemeProvider, ToastProvider } from '@librechat/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/app/routes';

// Provider stack cloned from upstream client/src/App.jsx, minus the strips:
// RecoilRoot, DndProvider, LanguageSync, ScreenshotProvider, WakeLockManager,
// QueryDevtoolsGate (jotai needs no provider; no file uploads; English-only).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RadixToast.Provider>
          <ToastProvider>
            <RouterProvider router={router} />
            <Toast />
            <RadixToast.Viewport className="pointer-events-none fixed inset-0 z-[1000] mx-auto my-2 flex max-w-[560px] flex-col items-stretch justify-start md:pb-5" />
          </ToastProvider>
        </RadixToast.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
