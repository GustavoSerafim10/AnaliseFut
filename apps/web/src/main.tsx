import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './estilos.css';
import { iniciarHistorico } from './historico';

// o histórico vem do banco do navegador, que é assíncrono: abre antes de desenhar o site
void iniciarHistorico().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
