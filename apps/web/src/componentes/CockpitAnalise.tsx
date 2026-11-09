/**
 * Painel de decisão no topo da Análise. Só resume o que o motor já calculou; sem dado, cada
 * quadro diz o que falta.
 */
import type { Derivado } from '../dados';
import { Arco, Painel } from './CentroComando';

const p0 = (x: number) => `${Math.round(x * 100)}%`;
const p1 = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;
const n2 = (x: number) => x.toFixed(2).replace('.', ',');

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
  const melhor = lista[0];
  const tecnica = d.v4?.melhor;
  const lam = d.lambda?.lambdas;
  const maxLam = Math.max(3, lam?.casa ?? 0, lam?.fora ?? 0);
  const modelo1x2 = d.resultado?.previsao?.p1x2.modelo;
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
          <strong className="cc-grande">{d.entradas ? lista.length : '—'}</strong>
          {melhor ? (
            <>
              <span className="cc-grande-sub">
                {lista.length > 1 ? 'entradas neste jogo' : 'entrada neste jogo'}
              </span>
              <p className="cc-topo-entrada">
                <b>{p0(melhor.chanceGreen)}</b> {melhor.descricao.replace('Ganha se: ', '')}
              </p>
              <div className="cc-barra">
                <i style={{ width: p0(melhor.chanceGreen) }} />
              </div>
              <p className="cc-nota">
                @ {n2(melhor.odd)} na {melhor.casa} ·{' '}
                {melhor.forca === 'forte' ? 'Sinal forte' : 'Sinal médio'}
              </p>
            </>
          ) : (
            <span className="cc-grande-sub">
              {d.entradas ? 'sem entrada neste jogo' : 'aguardando estatísticas e odds'}
            </span>
          )}
        </Painel>

        <Painel titulo="Análise técnica" icone="alvo" className="cc-g3">
          <strong className="cc-rotulo-decisao">{d.v4?.rotulo ?? 'Aguardando odds'}</strong>
          {tecnica ? (
            <dl className="cc-numeros">
              <dt>EV</dt>
              <dd>{p1(tecnica.ev)}</dd>
              <dt>Gate</dt>
              <dd>{tecnica.evMinimo === null ? '—' : p1(tecnica.evMinimo)}</dd>
              <dt>Referência</dt>
              <dd>{tecnica.nivel}</dd>
            </dl>
          ) : (
            d.v4 && <p className="cc-nota">Nenhum mercado comparável.</p>
          )}
          {tecnica && <p className="cc-nota">{tecnica.descricao.replace('Ganha se: ', '')}</p>}
        </Painel>

        <Painel titulo="Gols esperados" icone="lambda" className="cc-g3">
          {lam ? (
            <div className="cc-lambdas">
              {(['casa', 'fora'] as const).map((t) => (
                <div key={t}>
                  <span>
                    {nomes[t]} <b>{n2(lam[t])}</b>
                  </span>
                  <div className="cc-barra">
                    <i
                      className={t === 'casa' ? 'cc-lam-casa' : 'cc-lam-fora'}
                      style={{ width: `${(lam[t] / maxLam) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="cc-nota">Total esperado: {n2(lam.casa + lam.fora)} gols</p>
            </div>
          ) : (
            <p className="cc-vazio">Aparece quando as estatísticas dos dois times chegarem.</p>
          )}
        </Painel>

        {(d.mercado1x2 || modelo1x2) && (
          <Painel titulo="Quem vence: mercado × modelo" icone="barras" className="cc-g12">
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
            {modelo1x2 && <Linha1x2 nome="Modelo" p={modelo1x2} />}
          </Painel>
        )}
      </div>
    </div>
  );
}
