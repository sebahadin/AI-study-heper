import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import App from './App';
import { applyTheme, readTheme } from './theme/preferences';
import './styles/style.css';
import './styles/courses.css';
import './styles/flashcards.css';
import './styles/study-workspace.css';
import './styles/discovery.css';
import './styles/themes.css';
import './styles/tactile.css';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></StrictMode>,
);
