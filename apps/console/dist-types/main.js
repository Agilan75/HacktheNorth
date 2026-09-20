import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/ledger.css';
import { App } from './App.js';
// FROZEN (W0-4). Entry point only — no application logic lives here.
const container = document.getElementById('root');
if (!container) {
    throw new Error('Retrofit console: #root is missing from index.html');
}
createRoot(container).render(_jsx(StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(App, {}) }) }));
//# sourceMappingURL=main.js.map