
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  
  // Renderizamos la aplicación
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // Una vez que React toma el control, ocultamos el loader con un pequeño delay
  // para asegurar que el primer renderizado ya esté en pantalla.
  setTimeout(() => {
    const loader = document.getElementById('boot-screen');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => { loader.style.display = 'none'; }, 500);
    }
  }, 800);
}
