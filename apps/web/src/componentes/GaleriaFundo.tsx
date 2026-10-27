import { useEffect, useState } from 'react';

const TROCA_MS = 7000;

/** Fotos da galeria (só locais) trocando devagar atrás do gramado animado. */
export function GaleriaFundo({ fotos }: { fotos: string[] }) {
  const [atual, setAtual] = useState(0);
  useEffect(() => {
    if (fotos.length < 2) return;
    const t = setInterval(() => setAtual((i) => (i + 1) % fotos.length), TROCA_MS);
    return () => clearInterval(t);
  }, [fotos.length]);
  if (!fotos.length) return null;
  return (
    <div className="galeria-fundo" aria-hidden="true">
      {fotos.map((f, i) => (
        <div
          key={i}
          className={`galeria-foto ${i === atual % fotos.length ? 'visivel' : ''}`}
          style={{ backgroundImage: `url(${f})` }}
        />
      ))}
    </div>
  );
}
