import { NOMES_TESE, relatorioEmTexto, type ResultadoAnalise } from '@pe/engine';
import { CAMPOS_STATS, DEF_CAMPO, type CampoStat } from '@pe/parsers';
import { useState } from 'react';
import { montarPromptClaude } from '../claude';
import { dec, num, pct, ROTULO_DESFALQUE, type NivelDesfalque, type Rascunho } from '../estado';
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
];

async function copiar(texto: string, aviso: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(texto);
    aviso('Copiado ✓');
  } catch {
    aviso('Não consegui copiar automaticamente: selecione o texto e copie.');
  }
}

export function AbaAnalise({ r, setR, d }: PropsAba) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const res = d.resultado;
  const rel = d.relatorio;
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
  const pedeRedTeam =
    res?.gatilho === 'completar o red team' || rt.argumentos.some((a) => a.trim());

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
      ok: r.odds.length > 0 && !d.errosOdds,
      obrigatorio: true,
      detalhe: r.odds.length ? `${r.odds.length} · ${r.casas.length} casa(s)` : '',
    },
  ];

  return (
    <section className="passo">
      <h2>Análise</h2>
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

      {d.pendencias.length > 0 && (
        <div className="caixa alerta">
          <strong>Falta para analisar:</strong>
          <ul>
            {d.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {res && rel && (
        <>
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
                <dt>Odd mínima p/ entrar</dt>
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

          <div className="linha-acoes">
            <button onClick={() => copiar(relatorioEmTexto(rel), setCopiado)}>
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
          <label>
            Banca atual (R$), para calcular o valor da stake
            <input
              inputMode="decimal"
              value={r.banca}
              onChange={(e) => setR((x) => ({ ...x, banca: e.target.value }))}
            />
          </label>
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
                  const duvida = !!v && (v.divergente || v.avisos.length > 0);
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
          Data Quality calculada: <strong>{d.dq.dq}</strong>
        </p>
        <ul className="miudo">
          {d.dq.motivos.map((m) => (
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
                      <div className="miudo">{NOMES_TESE[a.tese]}</div>
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
