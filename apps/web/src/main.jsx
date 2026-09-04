import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

import { App } from './mount';

createRoot(document.getElementById('root')).render(
  createElement(StrictMode, null, createElement(App))
);
