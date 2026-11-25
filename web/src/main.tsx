import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { App } from './app/App';
import { preloadPathRoute, preloadWorkspace } from './app/route-preload';
import { darkTheme, theme } from './app/theme';
import { ThemeModeProvider, useThemeMode } from './app/theme-mode';
import { APIError, requestJSON } from './shared/api';
import { primeInitialSession } from './shared/session';
import './styles.css';
import './live/styles.css';
import './live/workspace.css';
import './live/knowledge.css';
import './live/agent.css';
import './styles/kit.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);
let lastRouterPathname = router.state.location.pathname;
router.subscribe((state) => {
  if (state.location.pathname !== lastRouterPathname) {
    lastRouterPathname = state.location.pathname;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }
});

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError(error) {
      if (error instanceof APIError && error.status === 401) {
        window.dispatchEvent(new Event('haji:unauthorized'));
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry(failureCount, error) {
        if (error instanceof APIError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 1;
      },
      staleTime: 30_000,
    },
  },
});

const bootPath = window.location.pathname;
if (bootPath.startsWith('/teacher') || bootPath.startsWith('/student')) {
  void preloadWorkspace();
  preloadPathRoute(bootPath);
}
void primeInitialSession()
  .then(({ data }) => {
    const rolePrefix = data.user.role === 'teacher' ? '/teacher' : '/student';
    if (bootPath.startsWith(rolePrefix)) {
      void queryClient.prefetchQuery({
        queryKey: ['courses', data.user.id],
        queryFn: async () => (await requestJSON<{ data: unknown }>('/me/courses')).data,
      });
    }
  })
  .catch(() => {});

function UIProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  const baseTheme = mode === 'dark' ? darkTheme : theme;
  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      theme={{ ...baseTheme, cssVar: { key: 'haji-theme' } }}
    >
      {children}
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeModeProvider>
      <UIProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </UIProvider>
    </ThemeModeProvider>
  </React.StrictMode>,
);
