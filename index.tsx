
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Ocultar loader inmediatamente cuando el script carga
const hideLoader = () => {
  const loader = document.getElementById('boot-screen');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => { loader.style.display = 'none'; }, 800);
  }
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  // Llamar después de renderizar para suavidad
  setTimeout(hideLoader, 500);
}
