import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import { queryClient } from './lib/queryClient';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './auth/AuthProvider';
import { router } from './router';

// The provider stack, in one place, so main.jsx and the headless render check
// mount exactly the same tree. StrictMode is applied by the caller.
export function App() {
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      ToastProvider,
      null,
      createElement(AuthProvider, null, createElement(RouterProvider, { router }))
    )
  );
}

export function mount(container) {
  const root = createRoot(container);
  root.render(createElement(App));
  return root;
}

export { router, queryClient };
