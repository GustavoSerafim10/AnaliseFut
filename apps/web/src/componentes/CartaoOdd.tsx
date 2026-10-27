import {
  descreverAposta,
  MERCADOS,
  type LinhaOdd,
  type NomesTimes,
  type TipoMercado,
} from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { FUSO, num } from '../estado';

const LADOS: Partial<Record<TipoMercado, string[]>> = {
  '1X2': ['1', 'X', '2'],
  DC: ['1X', '12', 'X2'],
  DNB: ['1', '2'],
  AH: ['casa', 'fora'],
  total: ['over', 'under'],
  total_time: ['over', 'under'],
  ambas: ['sim', 'nao'],
  par_impar: ['par', 'impar'],
  vencer_sem_sofrer: ['sim', 'nao'],
  marcar_2_tempos: ['sim', 'nao'],
  primeiro_gol: ['casa', 'fora', 'nenhum'],
  ultimo_gol: ['casa', 'fora', 'nenhum'],
  escanteios_total: ['over', 'under'],
  escanteios_time: ['over', 'under'],
  escanteios_ah: ['casa', 'fora'],
  escanteios_1x2: ['1', 'X', '2'],
  primeiro_escanteio: ['casa', 'fora', 'nenhum'],
  cartoes_total: ['over', 'under'],
  cartoes_time: ['over', 'under'],
  cartoes_ah: ['casa', 'fora'],
  cartoes_1x2: ['1', 'X', '2'],
};

const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : '');

interface Props {
  linha: OddLine;
  nomes: NomesTimes;
  data: string;
  problemas: { nivel: 'erro' | 'alerta'; mensagem: string }[];
  onMudar: (m: Partial<OddLine>) => void;
  onRemover: () => void;
}

/** Uma odd lida, editável, com o texto "Ganha se…" para conferir o lado. */
export function CartaoOdd({ linha: l, nomes, data, problemas, onMudar, onRemover }: Props) {
  const erro = problemas.some((p) => p.nivel === 'erro');
  const chave = JSON.stringify(l);
  return (
    <div key={chave} className={`cartao-odd ${erro ? 'erro' : problemas.length ? 'alerta' : ''}`}>
      <div className="ganha">
        {descreverAposta(l as LinhaOdd, nomes)} <span className="odd-grande">@ {l.odd}</span>
      </div>
      <details>
        <summary className="miudo">editar</summary>
        <div className="campos">
          <label>
            Mercado
            <select
              value={l.mercado}
              onChange={(e) => onMudar({ mercado: e.target.value as TipoMercado })}
            >
              {MERCADOS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Período
            <select
              value={l.periodo}
              onChange={(e) => onMudar({ periodo: e.target.value as OddLine['periodo'] })}
            >
              <option>FT</option>
              <option>1T</option>
              <option>2T</option>
            </select>
          </label>
          <label>
            Time
            <select
              value={l.time ?? ''}
              onChange={(e) => onMudar({ time: (e.target.value || undefined) as OddLine['time'] })}
            >
              <option value="">—</option>
              <option value="casa">{nomes.casa}</option>
              <option value="fora">{nomes.fora}</option>
            </select>
          </label>
          <label>
            Lado
            <input
              key={chave}
              list={`lados-${l.mercado}`}
              defaultValue={l.lado}
              onBlur={(e) => onMudar({ lado: e.target.value })}
            />
            <datalist id={`lados-${l.mercado}`}>
              {(LADOS[l.mercado] ?? []).map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          <label>
            Linha
            <input
              key={chave}
              inputMode="decimal"
              defaultValue={l.linha ?? ''}
              onBlur={(e) => onMudar({ linha: num(e.target.value) })}
            />
          </label>
          <label>
            Odd
            <input
              key={chave}
              inputMode="decimal"
              defaultValue={l.odd}
              onBlur={(e) => onMudar({ odd: num(e.target.value) ?? 0 })}
            />
          </label>
          <label>
            Coleta
            <input
              key={chave}
              type="time"
              defaultValue={hhmm(l.horarioColeta)}
              onBlur={(e) =>
                onMudar({
                  horarioColeta: e.target.value ? `${data}T${e.target.value}:00${FUSO}` : undefined,
                })
              }
            />
          </label>
          <button className="perigo" onClick={onRemover}>
            Remover
          </button>
        </div>
      </details>
      {problemas.map((p) => (
        <div key={p.mensagem} className={p.nivel === 'erro' ? 'problema' : 'problema alerta-txt'}>
          ⚠️ {p.mensagem}
        </div>
      ))}
    </div>
  );
}
