import { useEffect, useMemo, useState } from 'react';
import { AbaAnalise } from './abas/AbaAnalise';
import { AbaFlashscore } from './abas/AbaFlashscore';
import { AbaHistorico } from './abas/AbaHistorico';
import { AbaJogo } from './abas/AbaJogo';
import { AbaOdds } from './abas/AbaOdds';
import { AbaPromocoes } from './abas/AbaPromocoes';
import { AbaStats } from './abas/AbaStats';
import { AbaTabela } from './abas/AbaTabela';
import { AbaUltimas } from './abas/AbaUltimas';
import { Estadio } from './componentes/Estadio';
import { GaleriaFundo } from './componentes/GaleriaFundo';
import { MatchCenter } from './componentes/MatchCenter';
import { Icone, type NomeIcone } from './componentes/ui';
import {
  carregarFigurinhas,
  carregarGaleria,
  gravarFigurinhas,
  gravarGaleria,
  type Figurinhas,
} from './figurinhas';
import { derivar } from './dados';
import { abaDoExemplo, ehExemplo, rascunhoExemplo } from './exemplo';
import { carregarRascunho, rascunhoNovo, salvarRascunho, type Rascunho } from './estado';
import {
  carregarBancaInicial,
  carregarHistorico,
  gravarBancaInicial,
  gravarHistorico,
  salvarNoHistorico,
  travasDoHistorico,
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
        | 'historico'
        | 'promocoes';
    }
  | { id: 'odds'; casa: string };

const chave = (a: Aba) => (a.id === 'odds' ? `odds:${a.casa}` : a.id);

const ICONE_ABA: Partial<Record<Aba['id'], NomeIcone>> = {
  jogo: 'bola',
  sofascore: 'barras',
  superscore: 'barras',
  flashscore: 'barras',
  tabela: 'barras',
  ultimas: 'barras',
  odds: 'mercado',
  analise: 'alvo',
  historico: 'historico',
  promocoes: 'presente',
};

const DECISAO_CLASSE: Record<string, string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
};

export function App() {
  // #demo: jogo de exemplo, sem tocar no rascunho nem no histórico do aparelho
  const [demo] = useState(ehExemplo);
  const [r, setR] = useState<Rascunho>(() => (demo ? rascunhoExemplo() : carregarRascunho()));
  const [aba, setAba] = useState<Aba>(() =>
    demo ? ({ id: abaDoExemplo() } as Aba) : { id: 'jogo' },
  );
  useEffect(() => {
    if (!demo) salvarRascunho(r);
  }, [r, demo]);
  const irPara = (hash: string) => {
    location.hash = hash;
    location.reload();
  };
  const [historico, setHistoricoState] = useState<EntradaHistorico[]>(carregarHistorico);
  const [bancaInicial, setBancaInicialState] = useState<number | null>(carregarBancaInicial);
  const setBancaInicial = (v: number | null) => {
    setBancaInicialState(v);
    gravarBancaInicial(v);
  };
  // travas da banca (V4.0 seção 6) pelas apostas registradas, sem contar a análise aberta
  const travas = useMemo(
    () =>
      bancaInicial
        ? travasDoHistorico(
            historico.filter((e) => e.id !== r.idHistorico),
            bancaInicial,
          )
        : undefined,
    [historico, bancaInicial, r.idHistorico],
  );
  const d = useMemo(() => derivar(r, travas), [r, travas]);
  const [avisoHistorico, setAvisoHistorico] = useState<string | null>(null);
  const setHistorico = (h: EntradaHistorico[]) => {
    setHistoricoState(h);
    setAvisoHistorico(
      gravarHistorico(h) ? null : 'Não consegui gravar o histórico neste aparelho: exporte o JSON.',
    );
  };

  function salvarAnalise() {
    if (demo) {
      alert('Isto é só o jogo de exemplo: nada é salvo no histórico.');
      return;
    }
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
        { aba: { id: 'analise' }, rotulo: 'Análise' },
        {
          aba: { id: 'historico' },
          rotulo: 'Histórico',
          marca: historico.length ? String(historico.length) : undefined,
        },
        { aba: { id: 'promocoes' }, rotulo: 'Promoções' },
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

  // "Ver o lance": esconde o site e deixa o estádio animado em tela cheia (Esc volta)
  const [verLance, setVerLance] = useState(false);
  useEffect(() => {
    document.body.classList.toggle('so-lance', verLance);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setVerLance(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [verLance]);

  const [figurinhas, setFigurinhasState] = useState<Figurinhas>(carregarFigurinhas);
  const setFigurinhas = (f: Figurinhas) => {
    setFigurinhasState(f);
    if (!gravarFigurinhas(f))
      alert('Não consegui guardar a foto neste aparelho (armazenamento cheio ou aba privada).');
  };

  const [galeria, setGaleriaState] = useState<string[]>(carregarGaleria);
  const setGaleria = (g: string[]) => {
    if (!gravarGaleria(g)) {
      alert('Não coube no armazenamento deste aparelho: tire alguma foto da galeria.');
      return;
    }
    setGaleriaState(g);
  };

  const props = {
    r,
    setR,
    d,
    abrirExemplo: () => irPara('#demo/analise'),
    figurinhas,
    setFigurinhas,
    galeria,
    setGaleria,
    verLance: () => setVerLance(true),
  };
  const decisao = d.v4?.decisao;
  const temJogo = !!(r.jogo.casa || r.jogo.fora);
  const mostraMatchCenter = temJogo && aba.id !== 'historico' && aba.id !== 'promocoes';
  return (
    <>
      <div className="ambiente" aria-hidden="true" />
      {verLance && (
        <>
          <GaleriaFundo fotos={galeria} />
          <Estadio fotos={figurinhas} comGaleria={galeria.length > 0} />
          <button className="sair-lance" onClick={() => setVerLance(false)}>
            ✕ Voltar para a análise
          </button>
        </>
      )}
      <header className="topo">
        <div className="marca-topo">
          <svg className="logo" viewBox="0 0 40 40" aria-hidden="true">
            <path d="M6 30 L16 8 H34 L30 17 H22 L18 26 H26 L24 31 H10 Z" />
          </svg>
          <div className="nome-site">Pricing Engine</div>
          <span className="pilula-versao">PRÉ-LIVE • V4.0</span>
          {decisao && (
            <span className={`selo ${DECISAO_CLASSE[decisao] ?? 'nobet'}`}>
              {decisao.replace('_', ' ')}
            </span>
          )}
        </div>
        <button className="discreto" onClick={novaAnalise}>
          Nova análise
        </button>
      </header>
      {demo && (
        <div className="faixa-demo">
          Jogo de exemplo (odds fictícias): nada aqui é salvo.{' '}
          <button className="mini" onClick={() => irPara('')}>
            sair do exemplo
          </button>
        </div>
      )}
      <nav className="abas" aria-label="Seções">
        {grupos.map((g, gi) => (
          <div key={gi} className="grupo-abas">
            {g.titulo && <span className="titulo-grupo">{g.titulo}</span>}
            {g.abas.map(({ aba: a, rotulo, marca }) => (
              <button
                key={chave(a)}
                className={chave(a) === chave(aba) ? 'ativo' : ''}
                aria-current={chave(a) === chave(aba) ? 'page' : undefined}
                onClick={() => setAba(a)}
              >
                {ICONE_ABA[a.id] && <Icone nome={ICONE_ABA[a.id]!} tamanho={16} />}
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
      {mostraMatchCenter && <MatchCenter r={r} d={d} />}
      <main key={chave(aba)} className="conteudo-aba">
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
            bancaInicial={bancaInicial}
            setBancaInicial={setBancaInicial}
            travas={travas ?? null}
          />
        )}
        {aba.id === 'promocoes' && <AbaPromocoes {...props} />}
        {avisoHistorico && <div className="caixa alerta">{avisoHistorico}</div>}
      </main>
      <footer className="rodape">
        Pricing Engine V4.0 · referência afiada × casa mole · NO BET é o padrão
      </footer>
    </>
  );
}
