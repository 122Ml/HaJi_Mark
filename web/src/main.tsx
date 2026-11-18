import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'dayjs/locale/zh-cn';
import { App } from './app/App';
import { theme } from './app/theme';
import './styles.css';

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (listener: () => void) => {
  reducedMotion.addEventListener('change', listener);
  return () => reducedMotion.removeEventListener('change', listener);
};
function UIProvider({ children }: { children: React.ReactNode }) {
  const reduce = React.useSyncExternalStore(subscribeMotion, () => reducedMotion.matches);
  return <ConfigProvider locale={zhCN} button={{ autoInsertSpace: false }} theme={{ ...theme, token: { ...theme.token, motion: !reduce } }}><AntApp>{children}</AntApp></ConfigProvider>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UIProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </UIProvider>
  </React.StrictMode>,
);
