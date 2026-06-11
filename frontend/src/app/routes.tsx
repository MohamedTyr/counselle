import { createBrowserRouter } from 'react-router-dom';
import Root from '~/routes/Root';
import Sampler from '@/app/Sampler';
import ChatView from '@/app/ChatView';

export const router = createBrowserRouter([
  {
    // FE-1: Root layout wraps all chat routes with UnifiedSidebar + Outlet.
    path: '/',
    element: <Root />,
    children: [
      {
        // Landing: empty chat area.
        index: true,
        element: <ChatView />,
      },
      {
        // Active conversation route.
        path: 'c/:conversationId',
        element: <ChatView />,
      },
    ],
  },
  {
    // FE-0 gate page: vendored primitives rendered in both themes.
    path: '/sampler',
    element: <Sampler />,
  },
]);
