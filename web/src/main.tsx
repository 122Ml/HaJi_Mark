import '@ant-design/v5-patch-for-react-19';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { App } from './app/App';
import { darkTheme, theme } from './app/theme';
import { ThemeModeProvider, useThemeMode } from './app/theme-mode';
import { APIError } from './shared/api';
import './styles.css';
import './styles/kit.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

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

function UIProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  const baseTheme = mode === 'dark' ? darkTheme : theme;
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{ ...baseTheme, cssVar: { key: 'haji-theme' } }}
    >
      <AntApp>{children}</AntApp>
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
