import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';

const rootElement = document.getElementById('root');
const bootScreen = document.getElementById('boot-screen');

const hideBoot = () => {
  if (bootScreen) {
    bootScreen.style.opacity = '0';
    setTimeout(() => {
      bootScreen.style.visibility = 'hidden';
    }, 600);
  }
};

if (rootElement) {
  try {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    // Intentamos ocultar el loader tras un breve delay si el render inició
    setTimeout(hideBoot, 500);
  } catch (error) {
    console.error("Error fatal durante el montaje de React:", error);
    hideBoot(); // Quitamos la pantalla negra para que al menos se vea el error en consola o el fondo
  }
} else {
  hideBoot();
}