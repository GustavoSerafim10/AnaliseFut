import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/exo-2/latin-400.css';
import '@fontsource/exo-2/latin-500.css';
import '@fontsource/exo-2/latin-600.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
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
