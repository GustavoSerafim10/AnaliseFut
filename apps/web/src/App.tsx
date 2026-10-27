import { useEffect, useMemo, useState } from 'react';
import { AbaAnalise } from './abas/AbaAnalise';
import { AbaFlashscore } from './abas/AbaFlashscore';
import { AbaHistorico } from './abas/AbaHistorico';
import { AbaJogo } from './abas/AbaJogo';
import { AbaOdds } from './abas/AbaOdds';
import { AbaStats } from './abas/AbaStats';
import { AbaTabela } from './abas/AbaTabela';
import { AbaUltimas } from './abas/AbaUltimas';
import { derivar } from './dados';
import { carregarRascunho, rascunhoNovo, salvarRascunho, type Rascunho } from './estado';
import {
  carregarHistorico,
  gravarHistorico,
  salvarNoHistorico,
  type EntradaHistorico,
} from './historico';

type Aba =
  | {
      id:
        | 'jogo'
        | 'sofascore'
        | 'superscore'
        | 'flashscore'
        | 'tabela'
        | 'ultimas'
        | 'analise'
        | 'historico';
    }
  | { id: 'odds'; casa: string };

const chave = (a: Aba) => (a.id === 'odds' ? `odds:${a.casa}` : a.id);

export function App() {
  const [r, setR] = useState<Rascunho>(carregarRascunho);
  const [aba, setAba] = useState<Aba>({ id: 'jogo' });
  useEffect(() => salvarRascunho(r), [r]);
  const d = useMemo(() => derivar(r), [r]);
  const [historico, setHistoricoState] = useState<EntradaHistorico[]>(carregarHistorico);
  const [avisoHistorico, setAvisoHistorico] = useState<string | null>(null);
  const setHistorico = (h: EntradaHistorico[]) => {
    setHistoricoState(h);
    setAvisoHistorico(
      gravarHistorico(h) ? null : 'Não consegui gravar o histórico neste aparelho: exporte o JSON.',
    );
  };

  function salvarAnalise() {
    const { lista, id } = salvarNoHistorico(historico, r, d);
    setHistorico(lista);
    setR((x) => ({ ...x, idHistorico: id }));
  }

  function abrirDoHistorico(salvo: Rascunho) {
    if (
      !confirm('Abrir esta análise? O rascunho atual será substituído (salve-o antes se quiser).')
    )
      return;
    setR({ ...rascunhoNovo(), ...salvo, config: { ...rascunhoNovo().config, ...salvo.config } });
    setAba({ id: 'analise' });
  }

  const contagem = (g: string) => (r.prints[g] ?? []).length;
  const grupos: { titulo: string; abas: { aba: Aba; rotulo: string; marca?: string }[] }[] = [
    { titulo: '', abas: [{ aba: { id: 'jogo' }, rotulo: 'Jogo' }] },
    {
      titulo: 'Estatísticas',
      abas: [
        {
          aba: { id: 'sofascore' },
          rotulo: 'SofaScore',
          marca: contagem('sofascore') ? String(contagem('sofascore')) : undefined,
        },
        {
          aba: { id: 'superscore' },
          rotulo: 'SuperScore',
          marca: contagem('superscore') ? String(contagem('superscore')) : undefined,
        },
        {
          aba: { id: 'flashscore' },
          rotulo: 'Flashscore',
          marca: r.flashscore.trim() ? '✓' : undefined,
        },
        { aba: { id: 'tabela' }, rotulo: 'Tabela e desfalques' },
        { aba: { id: 'ultimas' }, rotulo: 'Últimas partidas' },
      ],
    },
    {
      titulo: 'Odds',
      abas: r.casas.map((casa) => {
        const n = r.odds.filter((o) => o.casa === casa).length;
        return { aba: { id: 'odds', casa } as Aba, rotulo: casa, marca: n ? String(n) : undefined };
      }),
    },
    {
      titulo: '',
      abas: [
        { aba: { id: 'analise' }, rotulo: 'Análise ▶' },
        {
          aba: { id: 'historico' },
          rotulo: 'Histórico',
          marca: historico.length ? String(historico.length) : undefined,
        },
      ],
    },
  ];

  function novaCasa() {
    const nome = prompt('Nome da casa de apostas (ex.: Bet365, Betano, Superbet):')?.trim();
    if (!nome) return;
    if (!r.casas.includes(nome)) setR((x) => ({ ...x, casas: [...x.casas, nome] }));
    setAba({ id: 'odds', casa: nome });
  }

  function novaAnalise() {
    if (confirm('Começar uma nova análise? O rascunho atual será apagado.')) {
      setR(rascunhoNovo());
      setAba({ id: 'jogo' });
    }
  }

  const props = { r, setR, d };
  return (
    <>
      <header className="topo">
        <div>
          <strong>
            {r.jogo.casa && r.jogo.fora ? `${r.jogo.casa} × ${r.jogo.fora}` : 'Pricing Engine V3.3'}
          </strong>
          <span className="miudo"> · NO BET é o padrão</span>
        </div>
        <button className="discreto" onClick={novaAnalise}>
          Nova análise
        </button>
      </header>
      <nav className="abas">
        {grupos.map((g, gi) => (
          <div key={gi} className="grupo-abas">
            {g.titulo && <span className="titulo-grupo">{g.titulo}</span>}
            {g.abas.map(({ aba: a, rotulo, marca }) => (
              <button
                key={chave(a)}
                className={chave(a) === chave(aba) ? 'ativo' : ''}
                onClick={() => setAba(a)}
              >
                {rotulo}
                {marca && <span className="marca">{marca}</span>}
              </button>
            ))}
            {g.titulo === 'Odds' && (
              <button className="discreto" onClick={novaCasa}>
                + casa
              </button>
            )}
          </div>
        ))}
      </nav>
      <main>
        {aba.id === 'jogo' && <AbaJogo {...props} />}
        {aba.id === 'sofascore' && <AbaStats {...props} fonte="sofascore" />}
        {aba.id === 'superscore' && <AbaStats {...props} fonte="superscore" />}
        {aba.id === 'flashscore' && <AbaFlashscore {...props} />}
        {aba.id === 'tabela' && <AbaTabela {...props} />}
        {aba.id === 'ultimas' && <AbaUltimas {...props} />}
        {aba.id === 'odds' && r.casas.includes(aba.casa) && (
          <AbaOdds key={aba.casa} {...props} casa={aba.casa} />
        )}
        {aba.id === 'analise' && (
          <AbaAnalise
            {...props}
            onSalvar={salvarAnalise}
            salvoNoHistorico={!!historico.find((e) => e.id === r.idHistorico)}
          />
        )}
        {aba.id === 'historico' && (
          <AbaHistorico
            historico={historico}
            setHistorico={setHistorico}
            abrir={abrirDoHistorico}
          />
        )}
        {avisoHistorico && <div className="caixa alerta">{avisoHistorico}</div>}
      </main>
    </>
  );
}
