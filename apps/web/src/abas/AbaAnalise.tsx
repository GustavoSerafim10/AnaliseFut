import {
  NOME_ESTATISTICA,
  NOMES_TESE,
  relatorioEmTexto,
  type Relatorio,
  type ResultadoAnalise,
} from '@pe/engine';
import { CAMPOS_STATS, DEF_CAMPO, dataDoPrint, type CampoStat } from '@pe/parsers';
import type { OddLine } from '@pe/schemas';
import { useState } from 'react';
import { montarPromptClaude } from '../claude';
import { Auditoria } from '../componentes/Auditoria';
import { CentroDecisao } from '../componentes/CentroDecisao';
import { ComparativoOdds } from '../componentes/ComparativoOdds';
import { Distribuicao } from '../componentes/Distribuicao';
import { FormAposta } from '../componentes/FormAposta';
import { GrafoDecisao } from '../componentes/GrafoDecisao';
import { Indicadores } from '../componentes/Indicadores';
import { MelhoresEntradas, type EscolhaEntrada } from '../componentes/MelhoresEntradas';
import { PainelV4 } from '../componentes/PainelV4';
import {
  dec,
  isoLocal,
  num,
  pct,
  ROTULO_DESFALQUE,
  type NivelDesfalque,
  type Rascunho,
} from '../estado';
import type { Derivado } from '../dados';
import {
  chaveDaAposta,
  resumir,
  type ApostaFeita,
  type EntradaHistorico,
  type ResumoAnalise,
} from '../historico';
import type { PropsAba } from './tipos';

const CLASSE: Record<ResultadoAnalise['decisao'], string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
  NO_BET: 'nobet',
  EXCLUIDO: 'nobet',
};

/** Campos que entram no modelo: aparecem sempre, mesmo vazios, para poderem ser preenchidos. */
const ESSENCIAIS: CampoStat[] = [
  'partidas',
  'golsMarcados',
  'golsSofridos',
  'xg',
  'chutesNoAlvo',
  'grandesChances',
  'defesasGoleiro',
  'escanteios',
  'cartoesAmarelos',
];

/**
 * Texto do "Copiar análise": a decisão final (V4.0) primeiro e o relatório do motor de apoio
 * (V3.3) depois. Sem isso o texto abria com o melhor mercado do modelo sozinho, que a V4.0 pode
 * ter tirado da decisão (liga principal sem referência: Athletico @ 2.97 com EV 2,5%).
 */
function textoAnalise(d: Derivado, rel: Relatorio, res: ResultadoAnalise): string {
  const v4 = d.v4;
  if (!v4) return relatorioEmTexto(rel);
  const sem = (t: string) => t.replace('Ganha se: ', '');
  const m = v4.melhor;
  const linhas = [
    `DECISÃO FINAL (V4.0): ${v4.rotulo}${v4.motivos[0] ? ` — ${v4.motivos[0]}` : ''}`,
  ];
  if (m)
    linhas.push(
      `- melhor mercado: ${sem(m.descricao)} @ ${m.melhorOdd} (${m.casaMelhorOdd}), EV ${pct(m.ev)}${m.evMinimo !== null ? `, gate ${pct(m.evMinimo)}` : ''}`,
    );
  linhas.push(`- ${v4.avaliadas.length} mercados avaliados, ${v4.descartados.length} descartados`);
  const fora = res.melhor && v4.descartados.find((x) => x.chave === res.melhor!.chave);
  if (fora)
    linhas.push(
      `- o melhor do motor de apoio ("${sem(fora.descricao)}") fica fora da decisão: ${fora.motivo}`,
    );
  return [
    ...linhas,
    '',
    'MOTOR DE APOIO (V3.3, modelo + mercado):',
    '',
    relatorioEmTexto(rel),
  ].join('\n');
}

const entradaDaLista = (e: EscolhaEntrada): NonNullable<ResumoAnalise['entrada']> => ({
  linha: e.linha as OddLine,
  descricao: e.descricao.replace('Ganha se: ', ''),
  odd: e.odd,
  casa: e.casa,
  ev: e.ev,
  pFinal: e.chance,
  stake: e.stake,
  stakeValor: e.stakeValor,
});

async function copiar(texto: string, aviso: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(texto);
    aviso('Copiado ✓');
  } catch {
    aviso('Não consegui copiar automaticamente: selecione o texto e copie.');
  }
}

export function AbaAnalise({
  r,
  setR,
  d,
  onSalvar,
  onEntrar,
  salvoNoHistorico,
  apostas = [],
}: PropsAba & {
  onSalvar: () => void;
  onEntrar: (a: ApostaFeita) => void;
  salvoNoHistorico: boolean;
  /** as apostas já registradas neste jogo */
  apostas?: EntradaHistorico[];
}) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const [daLista, setDaLista] = useState<{ e: EscolhaEntrada; aviso?: string } | null>(null);
  const resumo = d.v4 || d.resultado ? resumir(r, d) : null;
  const [salvo, setSalvo] = useState(false);
  const res = d.resultado;
  const rel = d.relatorio;
  // data certa do jogo: a escrita nos prints da casa; sem ela, hoje
  const dataCerta =
    Object.entries(r.prints)
      .filter(([g]) => g.startsWith('odds:'))
      .flatMap(([, ls]) => ls.map((l) => dataDoPrint(l.texto)))
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? isoLocal(new Date()).slice(0, 10);
  const corrigirData = () =>
    setR((x) => ({
      ...x,
      jogo: { ...x.jogo, data: dataCerta },
      // as odds já lidas foram coletadas no dia certo, não no dia errado do cadastro
      odds: x.odds.map((l) =>
        l.horarioColeta?.startsWith(x.jogo.data)
          ? { ...l, horarioColeta: dataCerta + l.horarioColeta.slice(x.jogo.data.length) }
          : l,
      ),
    }));
  const nome = (t: 'casa' | 'fora') => r.jogo[t] || (t === 'casa' ? 'Mandante' : 'Visitante');

  const corrigir = (campo: CampoStat, time: 'casa' | 'fora', valor: string) =>
    setR((x) => {
      const correcoes = { ...x.correcoes };
      const n = num(valor);
      if (n === undefined) delete correcoes[`${campo}.${time}`];
      else correcoes[`${campo}.${time}`] = n;
      return { ...x, correcoes };
    });
  const desfalque = (
    tipo: 'desfalqueAtaque' | 'desfalqueDefesa',
    t: 'casa' | 'fora',
    v: NivelDesfalque,
  ) => setR((x) => ({ ...x, [tipo]: { ...x[tipo], [t]: v } }));
  const rt = r.redTeam;
  const setRt = (m: Partial<Rascunho['redTeam']>) =>
    setR((x) => ({ ...x, redTeam: { ...x.redTeam, ...m } }));
  // só a decisão final pede o red team: a opinião do modelo sozinho não
  const pedeRedTeam =
    d.v4?.gatilho === 'completar o red team' || rt.argumentos.some((a) => a.trim());

  const campos = CAMPOS_STATS.filter((c) => d.tabela[c.campo] || ESSENCIAIS.includes(c.campo));

  const nCampos = (l: typeof d.sofa) => (l ? Object.keys(l.campos).length : 0);
  const nUltimas =
    (r.prints['ultimas:casa'] ?? []).length + (r.prints['ultimas:fora'] ?? []).length;
  const situacao = [
    { nome: 'Jogo', ok: !!(r.jogo.casa && r.jogo.fora && r.jogo.hora), obrigatorio: true },
    {
      nome: 'SofaScore',
      ok: nCampos(d.sofa) > 0,
      obrigatorio: false,
      detalhe: nCampos(d.sofa) ? `${nCampos(d.sofa)} dados` : '',
    },
    {
      nome: 'SuperScore',
      ok: nCampos(d.sup) > 0,
      obrigatorio: false,
      detalhe: nCampos(d.sup) ? `${nCampos(d.sup)} dados` : '',
    },
    {
      nome: 'Estatísticas p/ o modelo',
      ok: !!(d.modeloCasa.stats && d.modeloFora.stats),
      obrigatorio: true,
    },
    { nome: 'Flashscore', ok: !!d.flash, obrigatorio: false },
    { nome: 'Desfalques', ok: d.desfalques.length > 0, obrigatorio: false },
    { nome: 'Classificação', ok: d.classificacao.length > 0, obrigatorio: false },
    { nome: 'Últimas partidas', ok: nUltimas > 0, obrigatorio: false },
    {
      nome: 'Odds',
      ok: d.oddsValidas.length > 0,
      obrigatorio: true,
      detalhe: r.odds.length
        ? `${r.odds.length} · ${r.casas.length} casa(s)${d.errosOdds ? ` · ${d.errosOdds} com erro fora` : ''}`
        : '',
    },
  ];

  return (
    <section className="passo">
      <MelhoresEntradas
        d={d}
        registradas={new Set(apostas.map(chaveDaAposta))}
        dataErrada={
          dataCerta > r.jogo.data
            ? { atual: r.jogo.data, certa: dataCerta, corrigir: corrigirData }
            : undefined
        }
        onEntrar={(e, aviso) => {
          setEntrando(false);
          const outras = apostas.length
            ? `Você já tem ${apostas.length} aposta${apostas.length > 1 ? 's' : ''} neste jogo: apostas do mesmo jogo costumam ganhar ou perder juntas, então o risco aumenta.`
            : undefined;
          setDaLista({ e, aviso: [aviso, outras].filter(Boolean).join(' ') || undefined });
        }}
      />
      {daLista && (
        <FormAposta
          key={daLista.e.chave}
          entrada={entradaDaLista(daLista.e)}
          aviso={daLista.aviso}
          decisao={resumo?.decisao ?? null}
          daLista
          onCancelar={() => setDaLista(null)}
          onConfirmar={(ap) => {
            onEntrar({ ...ap, entrada: entradaDaLista(daLista.e) });
            setDaLista(null);
            setSalvo(true);
          }}
        />
      )}
      {(d.v4 || res) && (
        <>
          <div className="linha-acoes">
            <button
              onClick={() => {
                onSalvar();
                setCopiado(null);
                setSalvo(true);
              }}
            >
              💾 {salvoNoHistorico ? 'Atualizar no histórico' : 'Salvar no histórico'}
            </button>
            {resumo?.entrada && resumo.decisao === 'BET' && !apostas.length && (
              <button
                className={resumo.decisao === 'BET' ? 'primario' : ''}
                onClick={() => {
                  setDaLista(null);
                  setEntrando(true);
                }}
              >
                ✅ Entrei na melhor da análise técnica
              </button>
            )}
          </div>
          {apostas.length > 0 && (
            <div className="dica">
              Suas apostas neste jogo:
              <ul>
                {apostas.map((a) => (
                  <li key={a.id}>
                    {a.resumo.entrada?.descricao} @ {String(a.aposta!.odd).replace('.', ',')} na{' '}
                    {a.aposta!.casa}
                    {a.aposta!.valor !== undefined && ` (R$ ${dec(a.aposta!.valor)})`}
                  </li>
                ))}
              </ul>
              O resultado se registra na aba Histórico.
            </div>
          )}
          {entrando && resumo?.entrada && !apostas.length && (
            <FormAposta
              entrada={resumo.entrada}
              decisao={resumo.decisao}
              onCancelar={() => setEntrando(false)}
              onConfirmar={(ap) => {
                onEntrar(ap);
                setEntrando(false);
                setSalvo(true);
              }}
            />
          )}
          {(salvo || salvoNoHistorico) && (
            <p className="dica">
              Salva no Histórico ✓ Com odds lidas, ela se atualiza sozinha até o início do jogo.
              Depois do jogo, registre o placar e o fechamento da referência por lá.
            </p>
          )}
          <label>
            Banca atual (R$), usada se a banca separada não estiver definida no Histórico
            <input
              inputMode="decimal"
              value={r.banca}
              onChange={(e) => setR((x) => ({ ...x, banca: e.target.value }))}
            />
          </label>
        </>
      )}

      <details className="caixa analise-tecnica">
        <summary>
          Análise técnica: preço contra a referência
          {d.v4 && <span className="marca">{d.v4.rotulo}</span>}
        </summary>
        <p className="dica">
          É o critério mais rígido do site: só aprova com Pinnacle/Betfair ou 4+ casas. Serve para
          conferir o preço. Pode dizer NO BET mesmo com entrada na lista acima.
        </p>
        <Indicadores d={d} />
        <div className="grade-analise">
          <div className="coluna">
            <CentroDecisao d={d} />
            <Distribuicao d={d} nomes={{ casa: nome('casa'), fora: nome('fora') }} />
          </div>
          <div className="coluna">
            <ComparativoOdds d={d} />
            <Auditoria r={r} d={d} />
          </div>
        </div>
        <GrafoDecisao d={d} />
        <PainelV4 r={r} setR={setR} d={d} />
      </details>

      <h3>Situação dos dados</h3>
      <p className="dica">
        Esta aba se atualiza sozinha: cada print, texto ou correção nas outras abas recalcula tudo
        na hora.
      </p>
      <div className="situacao">
        {situacao.map((s) => (
          <span key={s.nome} className={s.ok ? 'ok' : s.obrigatorio ? 'falta' : 'opcional'}>
            {s.ok ? '✓' : s.obrigatorio ? '✗' : '○'} {s.nome}
            {s.detalhe && <small> {s.detalhe}</small>}
          </span>
        ))}
      </div>

      {!d.pendenciasV4.length && d.pendencias.length > 0 && (
        <div className="caixa">
          <strong>Motor de apoio (V3.3) desligado:</strong> sem ele não há filtro do modelo, preço
          de nicho (R3) nem previsão.
          <ul className="miudo">
            {d.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {res && rel && (
        <>
          <details className="caixa opiniao-modelo">
            <summary>
              Opinião do modelo sozinho, fora da decisão: {res.rotulo} · DQ {res.dq.efetiva}
            </summary>
            <p className="dica">
              Isto é o motor de apoio (V3.3) sem a referência de mercado. Quem decide é o quadro
              Decisão Final, lá em cima.
            </p>
            <div className={`decisao ${CLASSE[res.decisao]}`}>
              <div className="rotulo">{res.rotulo}</div>
              <p>{rel.resumo}</p>
              {res.gatilho && <div className="gatilho">Gatilho: {res.gatilho}</div>}
              <div className="miudo">
                DQ {res.dq.efetiva} · Confidence {res.confianca} · Risco {res.risco}
              </div>
            </div>

            {res.melhor && (
              <div className="caixa">
                <h3>Melhor entrada encontrada</h3>
                <p>
                  <strong>{res.melhor.descricao.replace('Ganha se: ', '')}</strong>
                </p>
                <dl className="numeros">
                  <dt>Odd</dt>
                  <dd>
                    {res.melhor.melhorOdd} ({res.melhor.casaMelhorOdd})
                  </dd>
                  <dt>Odd justa</dt>
                  <dd>{dec(res.melhor.oddJusta)}</dd>
                  <dt title="usa o lado pessimista da probabilidade do modelo: por isso fica acima da odd mínima da decisão final">
                    Odd mínima (P pessimista)
                  </dt>
                  <dd>{dec(res.melhor.priceGate?.oddMinima)}</dd>
                  <dt>Probabilidade (final)</dt>
                  <dd>{pct(res.melhor.pFinal)}</dd>
                  <dt>EV</dt>
                  <dd>
                    {pct(res.melhor.ev)} (mínimo {pct(res.melhor.evMinimo)})
                  </dd>
                  <dt>Stake</dt>
                  <dd>
                    {res.melhor.stake
                      ? `${pct(res.melhor.stake.fracaoBanca, 2)} da banca${res.melhor.stake.valor !== undefined ? ` = R$ ${res.melhor.stake.valor.toFixed(2)}` : ''}`
                      : '—'}
                  </dd>
                </dl>
              </div>
            )}
            <div className="relatorio">
              {rel.secoes.map((s) => (
                <div key={s.titulo} className="caixa">
                  <h3>{s.titulo}</h3>
                  <ul>
                    {s.linhas.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>

          {pedeRedTeam && (
            <div className="caixa alerta">
              <h3>Red team</h3>
              <p className="dica">
                Existe um candidato a aposta. Antes de entrar: escreva pelo menos 3 argumentos
                contra, um deles atacando a premissa do modelo. Armadilhas comuns: favorito popular,
                sequência inflada, H2H enganoso, eficiência insustentável, preço comprimido,
                desfalque subestimado, narrativa exagerada, objetivo já resolvido.
              </p>
              {rt.argumentos.map((a, i) => (
                <input
                  key={i}
                  value={a}
                  placeholder={`Argumento contra ${i + 1}`}
                  onChange={(e) =>
                    setRt({
                      argumentos: rt.argumentos.map((x, j) => (j === i ? e.target.value : x)),
                    })
                  }
                />
              ))}
              <button onClick={() => setRt({ argumentos: [...rt.argumentos, ''] })}>
                + argumento
              </button>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rt.atacaPremissa}
                  onChange={(e) => setRt({ atacaPremissa: e.target.checked })}
                />
                Pelo menos 1 argumento ataca a premissa do modelo
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={rt.sobreviveu}
                  onChange={(e) => setRt({ sobreviveu: e.target.checked })}
                />
                A tese sobreviveu ao red team
              </label>
            </div>
          )}

          <div className="linha-acoes">
            <button onClick={() => copiar(textoAnalise(d, rel, res), setCopiado)}>
              📋 Copiar análise
            </button>
            <button
              className="primario"
              onClick={() => copiar(montarPromptClaude(r, d), setCopiado)}
            >
              🤖 Copiar para o Claude
            </button>
          </div>
          {copiado && (
            <p className="dica">
              {copiado} Cole no chat do Claude para uma análise complementar (a decisão continua
              sendo a do motor).
            </p>
          )}
        </>
      )}

      <h3>Dados consolidados</h3>
      <p className="dica">
        Valor usado (pequeno: o que cada site mostrou). Vermelho = fontes divergem ou leitura
        duvidosa. Digite para corrigir; apague para voltar ao valor lido.
      </p>
      <div className="tabela-rolavel">
        <table className="consolidada">
          <thead>
            <tr>
              <th>Dado</th>
              <th>{nome('casa')}</th>
              <th>{nome('fora')}</th>
            </tr>
          </thead>
          <tbody>
            {campos.map((c) => (
              <tr key={c.campo}>
                <td>{DEF_CAMPO[c.campo].rotulo}</td>
                {(['casa', 'fora'] as const).map((t) => {
                  const v = d.tabela[c.campo]?.[t];
                  // vermelho só para o que pede conferência: sites divergem, ou aviso de leitura
                  // que não seja rotina (ponto decimal reposto); os dois sites concordando, ou
                  // valor corrigido à mão, não é dúvida
                  const concordam =
                    v?.porFonte.sofascore !== undefined &&
                    v?.porFonte.superscore !== undefined &&
                    !v.divergente;
                  const duvida =
                    !!v &&
                    v.fonte !== 'manual' &&
                    (v.divergente ||
                      (!concordam &&
                        v.avisos.some((a) => !/ponto decimal perdido|confirmado/.test(a))));
                  // total vazio: sugere média × partidas (só dica; o modelo já usa a média)
                  const media = {
                    golsMarcados: 'golsPorJogo',
                    golsSofridos: 'golsSofridosPorJogo',
                  }[c.campo as 'golsMarcados' | 'golsSofridos'] as CampoStat | undefined;
                  const mediaLida = media && d.tabela[media]?.[t]?.valor;
                  const jogos = d.tabela.partidas?.[t]?.valor;
                  const dica =
                    v?.valor === undefined && mediaLida !== undefined && jogos
                      ? `≈ ${Math.round(mediaLida * jogos)} (${String(mediaLida).replace('.', ',')} × ${jogos})`
                      : undefined;
                  return (
                    <td
                      key={t}
                      className={
                        duvida ? 'celula-duvida' : v?.valor === undefined ? 'celula-vazia' : ''
                      }
                      title={v?.avisos.join('\n')}
                    >
                      <input
                        key={`${c.campo}-${t}-${v?.valor}`}
                        inputMode="decimal"
                        defaultValue={v?.valor !== undefined ? Number(v.valor.toFixed(2)) : ''}
                        placeholder={dica}
                        onBlur={(e) => corrigir(c.campo, t, e.target.value)}
                      />
                      <div className="miudo">
                        {v?.porFonte.sofascore !== undefined && `Sofa ${v.porFonte.sofascore} `}
                        {v?.porFonte.superscore !== undefined && `Super ${v.porFonte.superscore}`}
                        {v?.fonte === 'manual' && ' · manual'}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Impacto dos desfalques</h3>
      <p className="dica">
        Automático: só ajusta quando o texto do Flashscore cita um jogador ausente como peça
        importante (principal, artilheiro, destaque, titular). Sem essa evidência fica sem ajuste, o
        que é conservador: o mercado já precifica desfalques conhecidos.
      </p>
      {(['casa', 'fora'] as const).map((t) => (
        <div key={t} className="caixa">
          <strong>{nome(t)}</strong>: {d.impacto[t].motivo}
          {r.desfalqueAtaque[t] !== 'auto' && (
            <div className="miudo alerta-txt">
              Você escolheu manualmente: {ROTULO_DESFALQUE[r.desfalqueAtaque[t]]}
            </div>
          )}
        </div>
      ))}
      <details>
        <summary>Ajustar manualmente (só se você conhece o elenco)</summary>
        <div className="grade2">
          {(['casa', 'fora'] as const).map((t) => (
            <div key={t}>
              <strong>{nome(t)}</strong>
              {(['desfalqueAtaque', 'desfalqueDefesa'] as const).map((tipo) => (
                <label key={tipo}>
                  {tipo === 'desfalqueAtaque'
                    ? 'No ataque (menos gols dele)'
                    : 'Na defesa (mais gols do adversário)'}
                  <select
                    value={r[tipo][t]}
                    onChange={(e) => desfalque(tipo, t, e.target.value as NivelDesfalque)}
                  >
                    {(Object.keys(ROTULO_DESFALQUE) as NivelDesfalque[])
                      .filter((n) => tipo === 'desfalqueAtaque' || n !== 'auto')
                      .map((n) => (
                        <option key={n} value={n}>
                          {ROTULO_DESFALQUE[n]}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
          ))}
        </div>
      </details>

      <h3>Modelo</h3>
      <div className="caixa">
        <p>
          Data Quality: <strong>{d.dqFinal.dq}</strong> (estatísticas {d.dq.dq})
        </p>
        <ul className="miudo">
          {[...d.dq.motivos, ...d.dqFinal.motivos].map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        {d.lambda && (
          <>
            <p>
              λ do modelo: <strong>{dec(d.lambda.lambdas.casa)}</strong> ×{' '}
              <strong>{dec(d.lambda.lambdas.fora)}</strong>
            </p>
            <ul className="miudo">
              {[
                ...d.modeloCasa.declaracoes.map((x) => `${nome('casa')}: ${x}`),
                ...d.modeloFora.declaracoes.map((x) => `${nome('fora')}: ${x}`),
                ...d.lambda.declaracoes,
              ].map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {(['escanteios', 'cartoes'] as const).map((e) => {
          const c = d.contagens[e];
          return (
            <div key={e}>
              <p>
                λ de {NOME_ESTATISTICA[e]} (nível 3):{' '}
                {c ? (
                  <>
                    <strong>{dec(c.lambdas.casa)}</strong> × <strong>{dec(c.lambdas.fora)}</strong>
                  </>
                ) : (
                  <span className="miudo">
                    sem o dado dos dois times: esses mercados ficam só como informação
                  </span>
                )}
              </p>
              {c && (
                <ul className="miudo">
                  {c.declaracoes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <label>
          Fato concreto que justifica discordar do mercado (opcional)
          <input
            value={r.explicacaoDivergencia}
            onChange={(e) => setR((x) => ({ ...x, explicacaoDivergencia: e.target.value }))}
            placeholder="vazio = o motor aproxima o modelo do mercado quando eles divergem muito"
          />
        </label>
      </div>

      {res?.varredura && (
        <details className="caixa">
          <summary>Detalhes técnicos (top 5, todos os mercados, sensibilidade)</summary>
          <div className="tabela-rolavel">
            <table>
              <thead>
                <tr>
                  <th>Mercado</th>
                  <th>Odd</th>
                  <th>P_mod</th>
                  <th>P_mkt</th>
                  <th>P_final</th>
                  <th>EV</th>
                </tr>
              </thead>
              <tbody>
                {res.varredura.top5.map((a) => (
                  <tr key={a.chave}>
                    <td>
                      {a.descricao.replace('Ganha se: ', '')}
                      <div className="miudo">
                        {NOMES_TESE[a.tese]}
                        {a.nivel === 3 && ' · nível 3 (modelo pesa até 30%)'}
                      </div>
                    </td>
                    <td>
                      {a.melhorOdd}
                      <div className="miudo">{a.casaMelhorOdd}</div>
                    </td>
                    <td>{pct(a.pModelo)}</td>
                    <td>{pct(a.pMercado)}</td>
                    <td>{pct(a.pFinal)}</td>
                    <td className={a.ev > 0 ? 'positivo' : 'negativo'}>{pct(a.ev)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h4>Todos os avaliados ({res.varredura.avaliadas.length})</h4>
          <ul className="miudo">
            {res.varredura.avaliadas.map((a) => (
              <li key={a.chave}>
                {a.descricao.replace('Ganha se: ', '')} @ {a.melhorOdd}: EV {pct(a.ev)} · margem{' '}
                {pct(a.margem)} · de-vig {a.metodoDevig}
              </li>
            ))}
          </ul>
          <h4>Descartados ({res.varredura.descartados.length})</h4>
          <ul className="miudo">
            {res.varredura.descartados.map((x, i) => (
              <li key={`${x.chave}-${i}`}>
                {x.descricao.replace('Ganha se: ', '')}: {x.motivo}
              </li>
            ))}
          </ul>
          {res.sensibilidade && (
            <>
              <h4>Sensibilidade: {res.sensibilidade.classe}</h4>
              <ul className="miudo">
                {res.sensibilidade.cenarios.map((c) => (
                  <li key={c.nome}>
                    {c.nome}: EV {pct(c.ev)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}
    </section>
  );
}
