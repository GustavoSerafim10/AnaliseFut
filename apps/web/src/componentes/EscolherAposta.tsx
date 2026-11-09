/**
 * "Entrei nessa aposta" no Histórico: mostra as apostas lidas daquele jogo, não só a melhor da
 * análise. Relê os prints guardados, então uma leitura já corrigida vale sem abrir a análise.
 */
import { lerOddsCasaConsenso } from '@pe/parsers';
import type { OddLine } from '@pe/schemas';
import { useMemo, useState } from 'react';
import { derivar, type Derivado } from '../dados';
import { FUSO, type Rascunho } from '../estado';
import { chaveDaAposta, type ApostaFeita, type EntradaHistorico } from '../historico';
import { chaveDaPerna } from '../multiplas';
import { aplicarLeitura } from '../oddsDaCasa';
import { FormAposta } from './FormAposta';

const dec = (x: number) => x.toFixed(2).replace('.', ',');
const sem = (s: string) => s.replace('Ganha se: ', '');

/** O rascunho com as odds relidas dos prints; o que foi corrigido à mão continua. */
export function rascunhoRelido(r: Rascunho): Rascunho {
  const jogo = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  return {
    ...r,
    odds: r.casas.reduce((odds, casa) => {
      const prints = r.prints[`odds:${casa}`] ?? [];
      if (!prints.length) return odds;
      const lidas = lerOddsCasaConsenso(prints, {
        jogo,
        data: r.jogo.data,
        fuso: FUSO,
        casa,
        horariosPadrao: prints.map((p) => p.capturadoEm),
      }).linhas;
      return aplicarLeitura(odds, casa, lidas);
    }, r.odds),
  };
}

export function EscolherAposta({
  e,
  registradas,
  onConfirmar,
  onCancelar,
}: {
  e: EntradaHistorico;
  /** apostas já registradas neste jogo */
  registradas: EntradaHistorico[];
  onConfirmar: (a: ApostaFeita, r: Rascunho, d: Derivado) => void;
  onCancelar: () => void;
}) {
  const relido = useMemo(() => rascunhoRelido(e.rascunho), [e.rascunho]);
  const d = useMemo(() => derivar(relido), [relido]);
  const ja = new Set(registradas.map(chaveDaAposta));
  const livres = d.opcoes.filter((o) => !ja.has(o.chave));
  // as da lista "Melhores entradas" guardada na análise vêm primeiro
  const daLista = new Set(
    (e.resumo.confianca ?? []).map((c) => chaveDaPerna({ casa: c.casa, linha: c.linha })),
  );
  const melhores = livres.filter((o) => daLista.has(o.chave));
  const outras = livres.filter((o) => !daLista.has(o.chave));
  const [chave, setChave] = useState('');
  const o = livres.find((x) => x.chave === chave);
  const rotulo = (x: (typeof livres)[number]) =>
    `${sem(x.descricao)} @ ${dec(x.odd)} · ${x.casa}${x.temEstimativa ? ` · green ${Math.round(x.chanceGreen * 100)}%` : ''}`;
  if (!livres.length)
    return (
      <div className="caixa">
        <p className="miudo">Nenhuma outra aposta lida neste jogo.</p>
        <button className="discreto" onClick={onCancelar}>
          Fechar
        </button>
      </div>
    );
  return (
    <div className="escolher-aposta">
      <label>
        Em qual aposta você entrou?
        <select value={chave} onChange={(x) => setChave(x.target.value)}>
          <option value="">Selecione a aposta</option>
          {melhores.length > 0 && (
            <optgroup label="Melhores entradas">
              {melhores.map((x) => (
                <option key={x.chave} value={x.chave}>
                  {rotulo(x)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Todas as apostas lidas">
            {outras.map((x) => (
              <option key={x.chave} value={x.chave}>
                {rotulo(x)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {o ? (
        <FormAposta
          key={o.chave}
          entrada={{
            linha: o.linha as OddLine,
            descricao: sem(o.descricao),
            odd: o.odd,
            casa: o.casa,
            ev: o.ev,
            pFinal: o.chance,
          }}
          decisao={e.resumo.decisao}
          daLista
          onCancelar={onCancelar}
          onConfirmar={(a) =>
            onConfirmar(
              {
                ...a,
                entrada: {
                  linha: o.linha as OddLine,
                  descricao: sem(o.descricao),
                  odd: o.odd,
                  casa: o.casa,
                  ev: o.ev,
                  pFinal: o.chance,
                },
              },
              relido,
              d,
            )
          }
        />
      ) : (
        <button className="discreto" onClick={onCancelar}>
          Cancelar
        </button>
      )}
    </div>
  );
}
