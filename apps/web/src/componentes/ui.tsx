/**
 * Peças de interface reutilizadas: ícones (SVG em linha, sem biblioteca), tooltip explicativo
 * e número com contagem animada. Nenhuma delas calcula nada: só exibem valores do motor.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const CAMINHOS = {
  bola: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7l3.5 2.5-1.3 4h-4.4l-1.3-4z M12 3v4 M15.5 9.5l4-1.5 M14.2 13.5l2.6 3.5 M9.8 13.5l-2.6 3.5 M8.5 9.5l-4-1.5" />
    </>
  ),
  barras: <path d="M5 20V12 M10 20V7 M15 20V10 M20 20V4" />,
  mercado: <path d="M3 17l5-5 4 3 8-8 M14 7h6v6" />,
  modelo: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="8" r="2" />
      <circle cx="10" cy="18" r="2" />
      <path d="M8 7l8 1 M7 8l2.5 8 M16.5 9.5l-5 7" />
    </>
  ),
  escudo: <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M9 12l2 2 4-4" />,
  relogio: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  raio: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  ev: <path d="M4 19h16 M6 15l4-4 3 3 5-6 M15 8h3v3" />,
  lambda: <path d="M6 20l6-10 M9 4c2 0 3 1 4 3l5 13" />,
  trofeu: (
    <path d="M8 4h8v4a4 4 0 01-8 0z M8 6H5a3 3 0 003 4 M16 6h3a3 3 0 01-3 4 M12 12v4 M8 20h8 M10 16h4v4h-4z" />
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12 M18 6L6 18" />,
  alerta: <path d="M12 4l9 16H3z M12 10v4 M12 17h.01" />,
  olho: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  proibido: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  lupa: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </>
  ),
  alvo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
  historico: <path d="M3 12a9 9 0 103-6.7 M3 4v5h5 M12 8v4l3 2" />,
  presente: <path d="M4 10h16v10H4z M3 7h18v3H3z M12 7v13 M12 7c-2-4-6-3-5 0 M12 7c2-4 6-3 5 0" />,
  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6 M12 7.5h.01" />
    </>
  ),
  cerebro: (
    <path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h1V4z M15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3h-1V4z M10 9H8 M10 14H7 M14 9h2 M14 14h3" />
  ),
  mais: <path d="M12 5v14 M5 12h14" />,
  casa: <path d="M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6" />,
  aviao: <path d="M21 4L3 11l7 2 2 7 3-5 4 3z M10 13l11-9" />,
  calendario: <path d="M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5" />,
  pessoas: (
    <path d="M9 11a3 3 0 100-6 3 3 0 000 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 5.5a3 3 0 010 5.5 M18 14.5c1.8.8 3 2.8 3 5.5" />
  ),
  prancheta: <path d="M8 4h8v3H8z M6 5H5v16h14V5h-1 M8 11h8 M8 15h6" />,
  seta: <path d="M5 12h14 M13 6l6 6-6 6" />,
  livro: <path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z M12 6v14" />,
} satisfies Record<string, ReactNode>;

export type NomeIcone = keyof typeof CAMINHOS;

export function Icone({ nome, tamanho = 18 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      className="icone"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CAMINHOS[nome]}
    </svg>
  );
}

/** Glossário dos termos técnicos que aparecem na tela. */
export const GLOSSARIO = {
  ev: 'EV (valor esperado): quanto a aposta rende em média por R$ 1. EV = P_true × odd − 1. Positivo e acima do gate = preço acima do justo.',
  devig:
    'De-vig: tirar a margem da casa das odds para chegar à probabilidade justa. No 1X2 da referência o motor usa o método de Shin.',
  lambda:
    'λ (lambda): gols esperados de cada time no jogo. Sai das estatísticas (modelo) ou de todas as linhas de gols do mercado.',
  edge: 'Edge: P_true − probabilidade implícita da odd (1/odd). Em pontos percentuais: quanto o preço justo supera o preço pago.',
  justa: 'Odd justa: 1 / P_true. Abaixo dela o preço não paga o risco.',
  ptrue:
    'P_true: probabilidade "verdadeira" usada na decisão. Vem da Pinnacle/Betfair sem margem (R1), do consenso de 4+ casas (R2) ou do modelo + consenso nos nichos (R3).',
  dq: 'Data Quality: nota A–E da qualidade das estatísticas (amostra, xG, fontes, desfalques, liga).',
  gate: 'Gate: EV mínimo exigido para BET, que depende da referência (2% contra a Pinnacle, 3,5% no consenso, 5% nos nichos) e da odd.',
  minima:
    'Odd mínima: abaixo dela o EV cai para baixo do gate. É a margem de segurança da entrada.',
} as const;

/** "?" com explicação: abre no hover, no foco do teclado e no toque. */
export function Dica({ termo }: { termo: keyof typeof GLOSSARIO }) {
  return (
    <span className="dica-termo" tabIndex={0} role="note" aria-label={GLOSSARIO[termo]}>
      <Icone nome="info" tamanho={13} />
      <span className="balao">{GLOSSARIO[termo]}</span>
    </span>
  );
}

const reduzirMovimento = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Número que conta até o valor novo (600 ms). Sem valor, mostra o texto `vazio`. */
export function Numero({
  valor,
  formato,
  vazio = '—',
}: {
  valor: number | null | undefined;
  formato: (x: number) => string;
  vazio?: string;
}) {
  const [mostrado, setMostrado] = useState(valor ?? 0);
  const anterior = useRef(valor ?? 0);
  useEffect(() => {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return;
    const de = anterior.current;
    anterior.current = valor;
    if (reduzirMovimento() || de === valor) {
      setMostrado(valor);
      return;
    }
    const inicio = performance.now();
    let quadro = 0;
    const passo = (t: number) => {
      const k = Math.min(1, (t - inicio) / 600);
      setMostrado(de + (valor - de) * (1 - (1 - k) ** 3));
      if (k < 1) quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [valor]);
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return <>{vazio}</>;
  return <>{formato(mostrado)}</>;
}

/** Barra de progresso animada (0–1). */
export function Barra({ valor, cor }: { valor: number; cor?: string }) {
  return (
    <span className="barra">
      <span
        className="barra-cheia"
        style={{ width: `${Math.max(0, Math.min(1, valor)) * 100}%`, background: cor }}
      />
    </span>
  );
}
