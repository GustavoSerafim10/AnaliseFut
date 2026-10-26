import { analisarJogo, type LinhaOdd, type ResultadoAnalise } from '@pe/engine';
import { useEffect, useMemo, useState } from 'react';
import {
  carregarRascunho,
  inicioIso,
  num,
  rascunhoNovo,
  salvarRascunho,
  type Rascunho,
} from './estado';
import { lambdaDoRascunho } from './lambda';
import { PassoConferencia } from './passos/PassoConferencia';
import { PassoContexto } from './passos/PassoContexto';
import { PassoJogo } from './passos/PassoJogo';
import { PassoOdds } from './passos/PassoOdds';
import { PassoResultado } from './passos/PassoResultado';

const PASSOS = ['Jogo', 'Prints', 'Conferência', 'Contexto', 'Resultado'] as const;

function calcular(r: Rascunho): { resultado: ResultadoAnalise | null; pendencias: string[] } {
  const pendencias: string[] = [];
  if (!r.jogo.casa || !r.jogo.fora) pendencias.push('preencher os times (passo 1)');
  const lam = lambdaDoRascunho(r);
  if (!lam.ok) pendencias.push(`λ do modelo: ${lam.erro} (passo 1)`);
  if (!r.linhas.length) pendencias.push('incluir odds (passo 2)');
  if (!r.conferido) pendencias.push('confirmar a conferência das odds (passo 3)');
  if (pendencias.length || !lam.ok) return { resultado: null, pendencias };

  const argumentos = r.redTeam.argumentos.map((a) => a.trim()).filter(Boolean);
  const fezRedTeam = argumentos.length > 0 || r.redTeam.sobreviveu;
  const resultado = analisarJogo({
    jogo: { casa: r.jogo.casa, fora: r.jogo.fora, inicio: inicioIso(r) },
    dq: r.dq,
    lambdaModelo: lam.lambdas,
    linhas: r.linhas as LinhaOdd[],
    contexto: { ...r.contexto, priorNeutro: r.contexto.priorNeutro || lam.priorNeutro },
    redTeam: fezRedTeam ? { ...r.redTeam, argumentos } : undefined,
    banca: num(r.banca),
  });
  return { resultado, pendencias };
}

export function App() {
  const [r, setR] = useState<Rascunho>(carregarRascunho);
  const [passo, setPasso] = useState(0);

  useEffect(() => salvarRascunho(r), [r]);
  const { resultado, pendencias } = useMemo(
    () => (passo === 4 ? calcular(r) : { resultado: null, pendencias: [] }),
    [r, passo],
  );

  function novaAnalise() {
    if (confirm('Começar uma nova análise? O rascunho atual será apagado.')) {
      setR(rascunhoNovo());
      setPasso(0);
    }
  }

  return (
    <>
      <header className="topo">
        <div>
          <strong>Pricing Engine V3.3</strong>
          <span className="miudo"> · NO BET é o padrão</span>
        </div>
        <button className="discreto" onClick={novaAnalise}>
          Nova análise
        </button>
      </header>
      <nav className="passos">
        {PASSOS.map((p, i) => (
          <button key={p} className={i === passo ? 'ativo' : ''} onClick={() => setPasso(i)}>
            {i + 1}. {p}
          </button>
        ))}
      </nav>
      <main>
        {passo === 0 && <PassoJogo r={r} setR={setR} />}
        {passo === 1 && <PassoOdds r={r} setR={setR} />}
        {passo === 2 && <PassoConferencia r={r} setR={setR} />}
        {passo === 3 && <PassoContexto r={r} setR={setR} />}
        {passo === 4 && <PassoResultado resultado={resultado} pendencias={pendencias} />}
        <div className="navegacao">
          <button disabled={passo === 0} onClick={() => setPasso(passo - 1)}>
            ← Voltar
          </button>
          <button
            className="primario"
            disabled={passo === PASSOS.length - 1}
            onClick={() => setPasso(passo + 1)}
          >
            {passo === 3 ? 'Calcular →' : 'Avançar →'}
          </button>
        </div>
      </main>
    </>
  );
}
