/** Lançar à mão uma odd que o print não trouxe: só entra na análise ao confirmar. */
import { descreverAposta, type LinhaOdd, type NomesTimes, type TipoMercado } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { useState } from 'react';
import { isoLocal } from '../estado';
import { montarOddManual, type RascunhoOdd } from '../oddsDaCasa';
import { LADOS } from './CartaoOdd';

const OPCOES: [TipoMercado, string][] = [
  ['AH', 'Handicap'],
  ['1X2', 'Resultado (1X2)'],
  ['DC', 'Dupla chance'],
  ['DNB', 'Empate anula'],
  ['total', 'Total de gols'],
  ['total_time', 'Gols de um time'],
  ['ambas', 'Ambas marcam'],
  ['primeiro_gol', 'Primeiro gol'],
  ['escanteios_total', 'Total de escanteios'],
  ['escanteios_time', 'Escanteios de um time'],
  ['escanteios_ah', 'Handicap de escanteios'],
  ['escanteios_1x2', 'Quem tem mais escanteios'],
  ['cartoes_total', 'Total de cartões'],
  ['cartoes_time', 'Cartões de um time'],
];
const COM_LINHA = new Set<TipoMercado>([
  'AH',
  'total',
  'total_time',
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'cartoes_total',
  'cartoes_time',
]);
const POR_TIME = new Set<TipoMercado>(['total_time', 'escanteios_time', 'cartoes_time']);
const novo: RascunhoOdd = {
  mercado: 'AH',
  periodo: 'FT',
  lado: 'casa',
  time: '',
  linha: '',
  odd: '',
};

export function FormOddManual({
  casa,
  nomes,
  onAdicionar,
}: {
  casa: string;
  nomes: NomesTimes;
  onAdicionar: (l: OddLine) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState(novo);
  const [feito, setFeito] = useState<string | null>(null);
  const r = montarOddManual(v, casa, isoLocal(new Date()));
  const preenchido = v.odd.trim() !== '';
  const rotulo = (lado: string) =>
    ({
      casa: nomes.casa,
      fora: nomes.fora,
      '1': nomes.casa,
      '2': nomes.fora,
      X: 'Empate',
      over: 'Mais',
      under: 'Menos',
      sim: 'Sim',
      nao: 'Não',
      nenhum: 'Nenhum',
      '1X': `${nomes.casa} ou empate`,
      '12': `${nomes.casa} ou ${nomes.fora}`,
      X2: `Empate ou ${nomes.fora}`,
    })[lado] ?? lado;
  if (!aberto)
    return (
      <>
        <button
          onClick={() => {
            setAberto(true);
            setFeito(null);
          }}
        >
          + Adicionar odd à mão
        </button>
        {feito && <div className="caixa ok miudo">{feito}</div>}
      </>
    );
  return (
    <div className="caixa form-odd">
      <h3>Adicionar odd à mão</h3>
      <div className="form-odd-campos">
        <label>
          Mercado
          <select
            value={v.mercado}
            onChange={(e) => {
              const mercado = e.target.value as TipoMercado;
              setV({ ...v, mercado, lado: LADOS[mercado]?.[0] ?? '', time: '', linha: '' });
            }}
          >
            {OPCOES.map(([m, nome]) => (
              <option key={m} value={m}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          Período
          <select
            value={v.periodo}
            onChange={(e) => setV({ ...v, periodo: e.target.value as RascunhoOdd['periodo'] })}
          >
            <option value="FT">Jogo inteiro</option>
            <option value="1T">1º tempo</option>
            <option value="2T">2º tempo</option>
          </select>
        </label>
        {POR_TIME.has(v.mercado) && (
          <label>
            Time
            <select
              value={v.time}
              onChange={(e) => setV({ ...v, time: e.target.value as RascunhoOdd['time'] })}
            >
              <option value="">Selecione</option>
              <option value="casa">{nomes.casa}</option>
              <option value="fora">{nomes.fora}</option>
            </select>
          </label>
        )}
        <label>
          Aposta
          <select value={v.lado} onChange={(e) => setV({ ...v, lado: e.target.value })}>
            {(LADOS[v.mercado] ?? []).map((l) => (
              <option key={l} value={l}>
                {rotulo(l)}
              </option>
            ))}
          </select>
        </label>
        {COM_LINHA.has(v.mercado) && (
          <label>
            Linha
            <input
              inputMode="decimal"
              placeholder="ex.: 0 ou -0,25"
              value={v.linha}
              onChange={(e) => setV({ ...v, linha: e.target.value })}
            />
          </label>
        )}
        <label>
          Odd
          <input
            inputMode="decimal"
            placeholder="ex.: 1,55"
            value={v.odd}
            onChange={(e) => setV({ ...v, odd: e.target.value })}
          />
        </label>
      </div>
      {preenchido &&
        ('erro' in r ? (
          <p className="miudo alerta-txt">{r.erro}</p>
        ) : (
          <p className="form-odd-previa">{descreverAposta(r.linha as LinhaOdd, nomes)}</p>
        ))}
      <div className="linha-acoes">
        <button
          className="primario"
          disabled={'erro' in r}
          onClick={() => {
            if ('erro' in r) return;
            onAdicionar(r.linha);
            setFeito(`Odd adicionada: ${descreverAposta(r.linha as LinhaOdd, nomes)}`);
            setV(novo);
            setAberto(false);
          }}
        >
          Adicionar
        </button>
        <button className="discreto" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
