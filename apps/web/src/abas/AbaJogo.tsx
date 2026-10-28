import fundoEstadio from '../assets/estadio-dados.webp';
import { EditorFigurinhas } from '../componentes/Figurinhas';
import { Icone, type NomeIcone } from '../componentes/ui';
import type { Rascunho } from '../estado';
import type { PropsAba } from './tipos';

const OPCOES: [keyof Rascunho['config'], string, string][] = [
  [
    'ligaTop',
    'Liga bem coberta',
    'Brasileirão, top 5 europeias, Champions, Libertadores… Necessário para DQ A.',
  ],
  [
    'escalacaoProvavel',
    'Escalação provável conferida',
    'Marca sozinho quando a escalação dos dois times é lida em Tabela e escalações. Necessário para DQ A.',
  ],
  [
    'escalacaoIncerta',
    'Escalação incerta',
    'Muita dúvida de quem joga: o modelo pesa menos e o gate sobe.',
  ],
  [
    'mercadoMuitoLiquido',
    'Mercado muito líquido',
    'Jogo grande, muito apostado (Champions, top europeias): o mercado erra menos.',
  ],
  [
    'favoritoLigaMaisForte',
    'Favorito de liga mais forte',
    'Só em jogo entre ligas diferentes (copas continentais): corrige o viés conhecido do modelo (16.3).',
  ],
];

/** Só os nomes das etapas reais do motor (decoração do banner, sem estado). */
const ETAPAS = ['Contexto', 'Modelo', 'De-vig', 'Referência', 'Value', 'Decisão'];

type EstadoItem = 'ok' | 'parcial' | 'erro' | 'pendente';
const ROTULO_ESTADO: Record<EstadoItem, string> = {
  ok: 'Pronto',
  parcial: 'Parcial',
  erro: 'Com erro',
  pendente: 'Pendente',
};

export function AbaJogo({
  r,
  setR,
  d,
  abrirExemplo,
  figurinhas,
  setFigurinhas,
  galeria,
  setGaleria,
  verLance,
  abrir,
}: PropsAba) {
  const jogo = (campo: keyof Rascunho['jogo'], v: string) =>
    setR((x) => ({ ...x, jogo: { ...x.jogo, [campo]: v } }));
  const config = <K extends keyof Rascunho['config']>(campo: K, v: Rascunho['config'][K]) =>
    setR((x) => ({ ...x, config: { ...x.config, [campo]: v } }));
  const vazio = !r.jogo.casa && !r.jogo.fora;

  // checklist: cada item lê o estado real do rascunho e do que o motor já derivou
  const partidaOk = !!(r.jogo.casa && r.jogo.fora && r.jogo.hora);
  const temStats = !!(d.modeloCasa.stats && d.modeloFora.stats);
  const algumaStat = [d.sofa, d.sup].some((l) => !!l && Object.keys(l.campos).length > 0);
  const checklist: {
    nome: string;
    detalhe: string;
    icone: NomeIcone;
    estado: EstadoItem;
    ir?: () => void;
  }[] = [
    {
      nome: 'Partida identificada',
      detalhe: partidaOk
        ? `${r.jogo.casa} × ${r.jogo.fora} · ${r.jogo.hora}`
        : 'Times e hora do início',
      icone: 'trofeu',
      estado: partidaOk ? 'ok' : vazio ? 'pendente' : 'parcial',
    },
    {
      nome: 'Estatísticas',
      detalhe: 'SofaScore / SuperScore',
      icone: 'barras',
      estado: temStats ? 'ok' : algumaStat ? 'parcial' : 'pendente',
      ir: abrir && (() => abrir('sofascore')),
    },
    {
      nome: 'Odds das casas',
      detalhe: r.odds.length
        ? `${r.odds.length} odds · ${r.casas.length} casa(s)`
        : 'Referência + casa onde vai apostar',
      icone: 'mercado',
      estado: !r.odds.length
        ? 'pendente'
        : !d.oddsValidas.length
          ? 'erro'
          : d.errosOdds
            ? 'parcial'
            : 'ok',
      ir: abrir && (() => abrir('odds')),
    },
    {
      nome: 'Desfalques e escalações',
      detalhe:
        [
          d.escalacao.conferida &&
            `escalação ${d.escalacao.status === 'confirmada' ? 'confirmada' : 'lida'}`,
          d.desfalques.length > 0 && `${d.desfalques.length} desfalque(s)`,
        ]
          .filter(Boolean)
          .join(' · ') || 'Confirmar quem joga',
      icone: 'pessoas',
      estado:
        d.escalacao.conferida || r.config.escalacaoProvavel
          ? 'ok'
          : d.desfalques.length
            ? 'parcial'
            : 'pendente',
      ir: abrir && (() => abrir('tabela')),
    },
  ];
  // "Iniciar análise" leva ao primeiro passo que ainda falta
  const proximo = !temStats
    ? { rotulo: 'Estatísticas', ir: () => abrir?.('sofascore') }
    : !r.odds.length
      ? { rotulo: 'Odds', ir: () => abrir?.('odds') }
      : { rotulo: 'Análise', ir: () => abrir?.('analise') };

  return (
    <section className="passo aba-jogo">
      {vazio && (
        <div className="nova-analise" style={{ backgroundImage: `url(${fundoEstadio})` }}>
          <div className="na-lado na-esquerda" aria-hidden="true">
            <span>Análise quantitativa</span>
            <span>Precisão</span>
            <span>Valor</span>
            <span>Disciplina</span>
          </div>
          <div className="na-centro">
            <span className="na-selo">Motor quantitativo • Pré-live</span>
            <h2>
              Nova <em>análise</em>
            </h2>
            <p>Comece pelo jogo. O preço decide.</p>
          </div>
          <ol className="na-lado na-direita" aria-label="Etapas do motor">
            {ETAPAS.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="grade-jogo">
        <section className="painel">
          <div className="painel-titulo titulo-grande">
            <Icone nome="bola" tamanho={26} />
            <div>
              Cadastro da partida
              <span className="titulo-sub">
                Os nomes servem para o leitor saber de que time é cada número e cada odd.
              </span>
            </div>
          </div>
          <div className="times-cadastro">
            <label>
              <span className="rotulo-campo">
                <Icone nome="casa" tamanho={16} /> Mandante
              </span>
              <span className="campo-com-icone">
                <Icone nome="escudo" />
                <input
                  value={r.jogo.casa}
                  placeholder="Time mandante"
                  onChange={(e) => jogo('casa', e.target.value)}
                />
              </span>
            </label>
            <label>
              <span className="rotulo-campo">
                <Icone nome="aviao" tamanho={16} /> Visitante
              </span>
              <span className="campo-com-icone">
                <Icone nome="escudo" />
                <input
                  value={r.jogo.fora}
                  placeholder="Time visitante"
                  onChange={(e) => jogo('fora', e.target.value)}
                />
              </span>
            </label>
          </div>
          <div className="grade2">
            <label>
              <span className="rotulo-campo">
                <Icone nome="trofeu" tamanho={16} /> Competição
              </span>
              <input
                value={r.jogo.competicao}
                placeholder="Ex.: Brasileirão"
                onChange={(e) => jogo('competicao', e.target.value)}
              />
            </label>
            <label>
              <span className="rotulo-campo">
                <Icone nome="calendario" tamanho={16} /> Data
              </span>
              <input
                type="date"
                value={r.jogo.data}
                onChange={(e) => jogo('data', e.target.value)}
              />
            </label>
            <label>
              <span className="rotulo-campo">
                <Icone nome="relogio" tamanho={16} /> Hora do início
              </span>
              <input
                type="time"
                value={r.jogo.hora}
                onChange={(e) => jogo('hora', e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="painel">
          <div className="painel-titulo titulo-grande">
            <Icone nome="prancheta" tamanho={26} />
            <div>
              Checklist pré-live
              <span className="titulo-sub">O que já chegou ao motor. Toque para completar.</span>
            </div>
          </div>
          <ul className="checklist">
            {checklist.map((c) => {
              const conteudo = (
                <>
                  <span className="cl-icone">
                    <Icone nome={c.icone} tamanho={20} />
                  </span>
                  <span className="cl-texto">
                    <strong>{c.nome}</strong>
                    <span>{c.detalhe}</span>
                  </span>
                  <span className={`cl-estado cl-${c.estado}`}>
                    <Icone
                      nome={
                        c.estado === 'ok' ? 'check' : c.estado === 'erro' ? 'alerta' : 'relogio'
                      }
                      tamanho={14}
                    />
                    {ROTULO_ESTADO[c.estado]}
                  </span>
                </>
              );
              return (
                <li key={c.nome}>
                  {c.ir ? (
                    <button className="cl-linha" onClick={c.ir}>
                      {conteudo}
                    </button>
                  ) : (
                    <div className="cl-linha">{conteudo}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="painel contexto-jogo">
        <div className="painel-titulo titulo-grande">
          <Icone nome="escudo" tamanho={26} />
          <div>
            Contexto e qualidade dos dados
            <span className="titulo-sub">Entram na nota de Data Quality e no gate.</span>
          </div>
        </div>
        <div className="opcoes-contexto">
          {OPCOES.map(([campo, rotulo, dica]) => (
            <label key={campo} className="check">
              <input
                type="checkbox"
                checked={!!r.config[campo]}
                onChange={(e) => config(campo, e.target.checked)}
              />
              <span>
                {rotulo}
                <span className="dica bloco">{dica}</span>
              </span>
            </label>
          ))}
        </div>

        <details className="parametros">
          <summary>
            <Icone nome="engrenagem" /> <strong>Parâmetros do modelo</strong>
            <span className="dica">Médias da liga e mando de campo</span>
          </summary>
          <div className="grade2">
            <label>
              Média de gols por time na liga
              <input
                inputMode="decimal"
                value={r.config.mediaGols}
                onChange={(e) => config('mediaGols', e.target.value)}
              />
            </label>
            <label>
              Fator mando de campo
              <input
                inputMode="decimal"
                value={r.config.mando}
                onChange={(e) => config('mando', e.target.value)}
              />
            </label>
            <label>
              Média de escanteios por time na liga
              <input
                inputMode="decimal"
                value={r.config.mediaEscanteios}
                onChange={(e) => config('mediaEscanteios', e.target.value)}
              />
            </label>
            <label>
              Média de cartões amarelos por time na liga
              <input
                inputMode="decimal"
                value={r.config.mediaCartoes}
                onChange={(e) => config('mediaCartoes', e.target.value)}
              />
            </label>
          </div>
          <p className="dica">
            Padrão do protocolo: 1,30 gols por time e mando 1,12 (1,00 em campo neutro). Escanteios
            (5,0) e cartões (2,2) por time servem de base para os mercados de nível 3.
          </p>
        </details>

        <div className="acoes-jogo">
          <button
            className="primario grande"
            disabled={!partidaOk || !abrir}
            onClick={proximo.ir}
            title={partidaOk ? `Próximo passo: ${proximo.rotulo}` : 'Preencha os times e a hora'}
          >
            <Icone nome="seta" /> {temStats && r.odds.length ? 'Ver a análise' : 'Iniciar análise'}
          </button>
          {abrirExemplo && (
            <button className="contorno" onClick={abrirExemplo}>
              <Icone nome="livro" /> Ver jogo de exemplo
            </button>
          )}
          <span className="dica">
            {partidaOk
              ? `Próximo passo: ${proximo.rotulo}.`
              : 'Preencha os times e a hora do início.'}{' '}
            Sem preço, <strong>NO BET</strong>.
          </span>
        </div>
      </section>

      <details className="caixa">
        <summary>Modo estádio (animação e figurinhas)</summary>
        <p className="dica">
          A tabela 10 → 11 → 10 com chapéu e golaço, em tela cheia. Pura diversão: não mexe na
          análise.
        </p>
        {verLance && (
          <button className="primario" onClick={verLance}>
            ▶ Ver o lance
          </button>
        )}
        {figurinhas && setFigurinhas && galeria && setGaleria && (
          <EditorFigurinhas
            figurinhas={figurinhas}
            setFigurinhas={setFigurinhas}
            galeria={galeria}
            setGaleria={setGaleria}
          />
        )}
      </details>
    </section>
  );
}
