import { createBrowserRouter } from 'react-router-dom';
import AppShell from '@/app/AppShell';
import Sampler from '@/app/Sampler';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
  },
  {
    // FE-0 gate page: vendored primitives rendered in both themes.
    path: '/sampler',
    element: <Sampler />,
  },
]);
