/**
 * Centro de decisão (V4.0). Cada estado tem ícone, título e frase próprios, além da cor, e a
 * justificativa vem dos motivos do motor. NO BET é tratado como resultado legítimo.
 */
import { NOMES_ESTRATEGIA, NOMES_REFERENCIA, type ResultadoV4 } from '@pe/engine';
import type { Derivado } from '../dados';
import { Dica, Icone, Numero, type NomeIcone } from './ui';

type Decisao = ResultadoV4['decisao'];

const ESTADO: Record<Decisao, { classe: string; icone: NomeIcone; titulo: string; frase: string }> =
  {
    BET: {
      classe: 'bet',
      icone: 'alvo',
      titulo: 'BET',
      frase: 'Preço acima do justo, com folga sobre o gate',
    },
    WATCHLIST: {
      classe: 'watch',
      icone: 'olho',
      titulo: 'WATCHLIST',
      frase: 'Falta uma condição para entrar',
    },
    INVESTIGAR: {
      classe: 'investigar',
      icone: 'lupa',
      titulo: 'INVESTIGAR',
      frase: 'Bom demais para ser verdade: conferir antes',
    },
    NO_BET: {
      classe: 'nobet',
      icone: 'proibido',
      titulo: 'NO BET',
      frase: 'Preço justo não superado',
    },
    EXCLUIDO: {
      classe: 'nobet',
      icone: 'relogio',
      titulo: 'EXCLUÍDO',
      frase: 'Jogo iniciado: somente pré-live',
    },
  };

const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
/** EV com sinal, como no comparativo ("+3,8%"): vermelho sem sinal parecia negativo */
const p1s = (x: number) => `${x > 0 ? '+' : ''}${p1(x)}`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const hora = (iso?: string) => (iso ? iso.slice(11, 16) : '—');

export function CentroDecisao({ d }: { d: Derivado }) {
  const v = d.v4;
  if (!v) {
    return (
      <section className="painel decisao-centro pendente" aria-live="polite">
        <div className="painel-titulo">
          <Icone nome="alvo" /> Decisão final
        </div>
        <div className="decisao-corpo">
          <div className="decisao-selo">
            <Icone nome="relogio" tamanho={56} />
          </div>
          <div>
            <div className="decisao-titulo">AGUARDANDO DADOS</div>
            <ul className="decisao-motivos">
              {d.pendenciasV4.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    );
  }
  const e = ESTADO[v.decisao];
  const m = v.melhor;
  const margem = m?.oddMinima ? m.melhorOdd / m.oddMinima - 1 : null;
  const alertas = [
    ...v.avisos,
    ...(m?.stake?.ajustes ?? []),
    ...d.pendencias.filter((p) => !d.pendenciasV4.includes(p)).map((p) => `apoio V3.3: ${p}`),
  ];
  return (
    <section className={`painel decisao-centro ${e.classe}`} aria-live="polite">
      <div className="painel-titulo">
        <Icone nome="alvo" /> Decisão final
        <span className="painel-sub">{NOMES_REFERENCIA[v.referencia.nivel]}</span>
      </div>
      <div className="decisao-duas">
        <div className="decisao-corpo">
          <div className="decisao-selo" aria-hidden="true">
            <Icone nome={e.icone} tamanho={56} />
          </div>
          <div className="decisao-texto">
            <div className="decisao-titulo">{e.titulo}</div>
            <div className="decisao-frase">{e.frase}</div>
            {v.gatilho && <div className="decisao-gatilho">{v.gatilho}</div>}
          </div>
        </div>
        <div className="decisao-analise">
          <div className="painel-sub-titulo">
            <span className="meia-lua" aria-hidden="true" /> Análise
          </div>
          <ul className="decisao-motivos">
            {v.motivos.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div className="decisao-nota">
            <Icone nome="info" tamanho={15} />
            {v.decisao === 'NO_BET'
              ? 'Paciência também é estratégia.'
              : v.decisao === 'BET'
                ? 'Só entre se a odd mínima segurar.'
                : 'Conferir antes de qualquer entrada.'}
          </div>
        </div>
      </div>

      {m && (
        <dl className="decisao-numeros">
          <div className="dn-largo">
            <dt>Mercado avaliado</dt>
            <dd>{m.descricao.replace('Ganha se: ', '')}</dd>
          </div>
          <div>
            <dt>Odd disponível</dt>
            <dd>
              {m.melhorOdd} <small>{m.casaMelhorOdd}</small>
            </dd>
          </div>
          <div>
            <dt>
              Odd justa <Dica termo="justa" />
            </dt>
            <dd>
              <Numero valor={m.oddJusta} formato={n2} />
            </dd>
          </div>
          <div>
            <dt>
              EV <Dica termo="ev" />
            </dt>
            <dd
              className={
                m.ev < 0
                  ? 'negativo'
                  : m.evMinimo !== null && m.ev >= m.evMinimo
                    ? 'positivo'
                    : 'abaixo-gate'
              }
            >
              <Numero valor={m.ev} formato={p1s} />
              <small> gate {m.evMinimo === null ? '—' : p1(m.evMinimo)}</small>
            </dd>
          </div>
          <div>
            <dt>
              Odd mínima <Dica termo="minima" />
            </dt>
            <dd>
              {m.oddMinima ? n2(m.oddMinima) : '—'}
              {margem !== null && (
                <small className={margem >= 0 ? 'positivo' : 'negativo'}>
                  {' '}
                  {margem >= 0 ? `folga ${p1(margem)}` : `faltam ${p1(-margem)} na odd`}
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>
              P_true <Dica termo="ptrue" />
            </dt>
            <dd>
              {p1(m.pTrue)} <small>{m.fonteP}</small>
            </dd>
          </div>
          <div>
            <dt>Estratégia</dt>
            <dd>{NOMES_ESTRATEGIA[m.estrategia]}</dd>
          </div>
          <div>
            <dt>Coleta</dt>
            <dd>
              {hora(m.horarioColeta)}
              {m.horarioReferencia && <small> ref. {hora(m.horarioReferencia)}</small>}
            </dd>
          </div>
          {m.stake && (
            <div>
              <dt>Stake</dt>
              <dd>
                {p1(m.stake.fracaoBanca)}
                {m.stake.valor !== undefined && <small> R$ {n2(m.stake.valor)}</small>}
              </dd>
            </div>
          )}
        </dl>
      )}

      {alertas.length > 0 && (
        <ul className="decisao-alertas">
          {alertas.map((a) => (
            <li key={a}>
              <Icone nome="alerta" tamanho={14} /> {a}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
