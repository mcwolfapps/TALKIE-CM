
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

// Función para remover el loader manualmente si React carga con éxito
const removeBootScreen = () => {
  const loader = document.getElementById('boot-screen');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
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
  
  // Intentar remover el loader tras un breve retraso del renderizado
  setTimeout(removeBootScreen, 1000);
}
