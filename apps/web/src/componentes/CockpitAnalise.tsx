/**
 * Painel de decisão no topo da Análise. Só resume o que o motor já calculou; sem dado, cada
 * quadro diz o que falta.
 */
import { matrizPlacares, type Lambdas } from '@pe/engine';
import type { Derivado } from '../dados';
import { Arco, Painel } from './CentroComando';
import { Numero } from './ui';

const p0 = (x: number) => `${Math.round(x * 100)}%`;
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');
const GOLS = [0, 1, 2, 3, 4];

export interface ItemSituacao {
  nome: string;
  ok: boolean;
  obrigatorio: boolean;
  detalhe?: string;
}

interface Tres {
  casa: number;
  empate: number;
  fora: number;
}

function Linha1x2({ nome, p }: { nome: string; p: Tres }) {
  const partes = [
    ['casa', 'mandante', p.casa],
    ['empate', 'empate', p.empate],
    ['fora', 'visitante', p.fora],
  ] as const;
  return (
    <div className="cc-1x2-linha">
      <span className="cc-1x2-nome">{nome}</span>
      <div className="cc-1x2-barra">
        {partes.map(([id, rotulo, v]) => (
          <i
            key={id}
            className={`cc-1x2-${id}`}
            style={{ flexGrow: v }}
            title={`${rotulo}: ${p1(v)}`}
          >
            {v >= 0.12 && p0(v)}
          </i>
        ))}
      </div>
    </div>
  );
}

function LinhaGols({ nome, over }: { nome: string; over: number }) {
  return (
    <div className="cc-1x2-linha">
      <span className="cc-1x2-nome">{nome}</span>
      <div className="cc-1x2-barra">
        <i className="cc-1x2-casa" style={{ flexGrow: over }} title={`mais de 2,5: ${p1(over)}`}>
          {over >= 0.12 && p0(over)}
        </i>
        <i
          className="cc-1x2-empate"
          style={{ flexGrow: 1 - over }}
          title={`menos de 2,5: ${p1(1 - over)}`}
        >
          {1 - over >= 0.12 && p0(1 - over)}
        </i>
      </div>
    </div>
  );
}

function MapaPlacares({ lam, nomes }: { lam: Lambdas; nomes: { casa: string; fora: string } }) {
  const m = matrizPlacares(lam.casa, lam.fora);
  const valores = GOLS.flatMap((c) => GOLS.map((f) => m[c][f]));
  const max = Math.max(...valores);
  return (
    <>
      <div className="cc-placares" role="table" aria-label="Chance de cada placar, pelo modelo">
        <span className="cc-placares-canto">
          {nomes.casa} ↓ · {nomes.fora} →
        </span>
        {GOLS.map((g) => (
          <b key={`f${g}`} className="cc-placares-eixo">
            {g}
          </b>
        ))}
        {GOLS.map((c) => (
          <div key={c} className="cc-placares-linha" role="row">
            <b className="cc-placares-eixo">{c}</b>
            {GOLS.map((f) => {
              const v = m[c][f];
              return (
                <span
                  key={f}
                  role="cell"
                  className={v === max ? 'cc-placar-topo' : ''}
                  style={{
                    background: `color-mix(in srgb, var(--azul-tech) ${Math.round(8 + (v / max) * 62)}%, transparent)`,
                  }}
                  title={`${nomes.casa} ${c} × ${f} ${nomes.fora}: ${p1(v)}`}
                >
                  {p0(v)}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="cc-nota">Mais forte = mais provável, segundo as estatísticas.</p>
    </>
  );
}

export function CockpitAnalise({
  d,
  situacao,
  nomes,
}: {
  d: Derivado;
  situacao: ItemSituacao[];
  nomes: { casa: string; fora: string };
}) {
  const prontos = situacao.filter((s) => s.ok).length;
  const lista = d.entradas?.entradas ?? [];
  const recusadas = d.entradas?.recusadas.length ?? 0;
  const tecnica = d.v4?.melhor;
  const lam = d.lambda?.lambdas;
  const maxLam = Math.max(3, lam?.casa ?? 0, lam?.fora ?? 0);
  const prev = d.resultado?.previsao;
  const lamPlacar = d.resultado?.lambdaModelo.ajustado ?? lam;
  const temVence = !!(d.mercado1x2 || prev);
  const gate = tecnica?.evMinimo ?? null;
  const escalaEv = tecnica && gate !== null ? Math.max(tecnica.ev, gate, 0.01) * 1.25 : 1;
  return (
    <div className="cc cc-cockpit">
      <div className="cc-grade">
        <Painel titulo="Situação dos dados" icone="escudo" className="cc-g3">
          <Arco
            fracao={situacao.length ? prontos / situacao.length : 0}
            numero={d.dqFinal.dq}
            linhas={['DATA QUALITY', `${prontos} de ${situacao.length} itens`]}
            rotuloAria={`Data Quality ${d.dqFinal.dq}, ${prontos} de ${situacao.length} itens prontos`}
          />
          <div className="situacao">
            {situacao.map((s) => (
              <span key={s.nome} className={s.ok ? 'ok' : s.obrigatorio ? 'falta' : 'opcional'}>
                {s.ok ? '✓' : s.obrigatorio ? '✗' : '○'} {s.nome}
                {s.detalhe && <small> {s.detalhe}</small>}
              </span>
            ))}
          </div>
        </Painel>

        <Painel titulo="Melhores entradas" icone="trofeu" className="cc-g3 cc-destaque">
          <strong className="cc-grande">
            {d.entradas ? <Numero valor={lista.length} formato={(x) => `${Math.round(x)}`} /> : '—'}
          </strong>
          <span className="cc-grande-sub">
            {!d.entradas
              ? 'aguardando estatísticas e odds'
              : lista.length === 0
                ? 'sem entrada neste jogo'
                : lista.length > 1
                  ? 'entradas neste jogo'
                  : 'entrada neste jogo'}
          </span>
          <ul className="cc-top-entradas">
            {lista.slice(0, 3).map((e) => (
              <li key={e.chave}>
                <div>
                  <b>{p0(e.chanceGreen)}</b>
                  <span>{e.descricao.replace('Ganha se: ', '').replace(/\.$/, '')}</span>
                </div>
                <div className="cc-barra">
                  <i style={{ width: p0(e.chanceGreen) }} />
                </div>
                <small>
                  @ {n2(e.odd)} · {e.casa}
                  {e.forca === 'forte' ? ' · Sinal forte' : ''}
                </small>
              </li>
            ))}
          </ul>
          {recusadas > 0 && (
            <p className="cc-nota">
              {recusadas} {recusadas > 1 ? 'mercados ficaram' : 'mercado ficou'} de fora pelos
              filtros.
            </p>
          )}
        </Painel>

        <Painel titulo="Análise técnica" icone="alvo" className="cc-g3">
          <strong className="cc-rotulo-decisao">{d.v4?.rotulo ?? 'Aguardando odds'}</strong>
          {tecnica ? (
            <>
              <p className="cc-topo-entrada">{tecnica.descricao.replace('Ganha se: ', '')}</p>
              {gate !== null && (
                <div className="cc-ev" title={`EV ${p1(tecnica.ev)}; gate ${p1(gate)}`}>
                  <i
                    className={tecnica.ev >= gate ? 'passou' : ''}
                    style={{ width: `${(Math.max(0, tecnica.ev) / escalaEv) * 100}%` }}
                  />
                  <b style={{ left: `${(gate / escalaEv) * 100}%` }} />
                </div>
              )}
              <dl className="cc-numeros">
                <dt>EV</dt>
                <dd>{p1(tecnica.ev)}</dd>
                <dt>Gate</dt>
                <dd>{gate === null ? '—' : p1(gate)}</dd>
                <dt>Referência</dt>
                <dd>{tecnica.nivel}</dd>
              </dl>
            </>
          ) : (
            d.v4 && <p className="cc-nota">Nenhum mercado comparável.</p>
          )}
        </Painel>

        <Painel titulo="Gols esperados" icone="lambda" className="cc-g3">
          {lam ? (
            <div className="cc-lambdas">
              {(['casa', 'fora'] as const).map((t) => (
                <div key={t}>
                  <span>
                    {nomes[t]}
                    <b>
                      <Numero valor={lam[t]} formato={n2} />
                    </b>
                  </span>
                  <div className="cc-barra">
                    <i
                      className={t === 'casa' ? 'cc-lam-casa' : 'cc-lam-fora'}
                      style={{ width: `${(lam[t] / maxLam) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              <div className="cc-total-gols">
                <strong className="cc-grande">
                  <Numero valor={lam.casa + lam.fora} formato={n2} />
                </strong>
                <span className="cc-grande-sub">gols esperados no total</span>
              </div>
            </div>
          ) : (
            <p className="cc-vazio">Aparece quando as estatísticas dos dois times chegarem.</p>
          )}
        </Painel>

        {temVence && (
          <Painel
            titulo="Quem vence e quantos gols"
            icone="barras"
            className={lamPlacar ? 'cc-g8' : 'cc-g12'}
          >
            <ul className="cc-legenda">
              <li>
                <i className="cc-1x2-casa" /> {nomes.casa}
              </li>
              <li>
                <i className="cc-1x2-empate" /> Empate
              </li>
              <li>
                <i className="cc-1x2-fora" /> {nomes.fora}
              </li>
            </ul>
            {d.mercado1x2 && <Linha1x2 nome="Mercado" p={d.mercado1x2} />}
            {prev && <Linha1x2 nome="Modelo" p={prev.p1x2.modelo} />}
            {prev && (
              <>
                <ul className="cc-legenda cc-legenda-gols">
                  <li>
                    <i className="cc-1x2-casa" /> Mais de 2,5 gols
                  </li>
                  <li>
                    <i className="cc-1x2-empate" /> Menos de 2,5 gols
                  </li>
                </ul>
                {prev.over25.mercado !== null && (
                  <LinhaGols nome="Mercado" over={prev.over25.mercado} />
                )}
                <LinhaGols nome="Modelo" over={prev.over25.modelo} />
              </>
            )}
          </Painel>
        )}

        {lamPlacar && (
          <Painel titulo="Mapa de placares" icone="bola" className="cc-g4">
            <MapaPlacares lam={lamPlacar} nomes={nomes} />
          </Painel>
        )}
      </div>
    </div>
  );
}
