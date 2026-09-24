import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './contexts/AuthContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import { PreferencesProvider } from './contexts/PreferencesContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/chat-call.css';
import './styles/a11y.css';
import './styles/brand.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <PreferencesProvider>
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          </PreferencesProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
