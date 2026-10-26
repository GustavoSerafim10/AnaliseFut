import { descreverAposta, MERCADOS, type LinhaOdd, type TipoMercado } from '@pe/engine';
import { checarSanidade } from '@pe/parsers';
import { OddLineSchema, type OddLine } from '@pe/schemas';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { FUSO, num, type Rascunho } from '../estado';

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
};

const hhmm = (iso?: string) => (iso ? iso.slice(11, 16) : '');

interface Props {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
}

export function PassoConferencia({ r, setR }: Props) {
  const [horarioLote, setHorarioLote] = useState('');
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  const problemas = useMemo(() => checarSanidade(r.linhas as LinhaOdd[]), [r.linhas]);
  const errosSchema = useMemo(
    () =>
      r.linhas.map(
        (l) =>
          OddLineSchema.safeParse(l).error?.issues.map(
            (i) => `${i.path.join('.')}: ${i.message}`,
          ) ?? [],
      ),
    [r.linhas],
  );
  const totalErros = problemas.filter((p) => p.nivel === 'erro').length + errosSchema.flat().length;

  const editar = (i: number, mudanca: Partial<OddLine>) =>
    setR((x) => ({
      ...x,
      conferido: false,
      linhas: x.linhas.map((l, j) => (j === i ? { ...l, ...mudanca } : l)),
    }));
  const remover = (i: number) =>
    setR((x) => ({ ...x, conferido: false, linhas: x.linhas.filter((_, j) => j !== i) }));
  const adicionar = () =>
    setR((x) => ({
      ...x,
      conferido: false,
      linhas: [
        ...x.linhas,
        {
          casa: x.linhas[0]?.casa ?? '1win',
          mercado: '1X2',
          lado: '1',
          odd: 2,
          periodo: 'FT',
          fonte: 'manual',
        },
      ],
    }));
  const isoDe = (h: string) => (h ? `${r.jogo.data}T${h}:00${FUSO}` : undefined);
  const aplicarHorario = () =>
    setR((x) => ({
      ...x,
      conferido: false,
      linhas: x.linhas.map((l) =>
        l.horarioColeta ? l : { ...l, horarioColeta: isoDe(horarioLote) },
      ),
    }));

  return (
    <section className="passo">
      <h2>3. Conferência</h2>
      <p className="dica">
        Confira <strong>casa, mercado, lado, linha e odd</strong> de cada linha. Leia o "Ganha se…":
        se não for o que o print diz, o lado está trocado.
      </p>

      <div className="linha-acoes">
        <input
          type="time"
          value={horarioLote}
          onChange={(e) => setHorarioLote(e.target.value)}
          aria-label="horário de coleta"
        />
        <button onClick={aplicarHorario} disabled={!horarioLote}>
          Aplicar horário às linhas sem horário
        </button>
      </div>

      {r.linhas.length === 0 && (
        <div className="caixa">Nenhuma odd ainda. Volte ao passo 2 ou adicione à mão.</div>
      )}

      {r.linhas.map((l, i) => {
        const probs = problemas.filter((p) => p.indice === i);
        const erro = probs.some((p) => p.nivel === 'erro') || errosSchema[i].length > 0;
        return (
          <div
            key={`${i}|${JSON.stringify(l)}`}
            className={`cartao-odd ${erro ? 'erro' : probs.length ? 'alerta' : ''}`}
          >
            <div className="ganha">{descreverAposta(l as LinhaOdd, nomes)}</div>
            <div className="campos">
              <label>
                Casa
                <input defaultValue={l.casa} onBlur={(e) => editar(i, { casa: e.target.value })} />
              </label>
              <label>
                Mercado
                <select
                  value={l.mercado}
                  onChange={(e) => editar(i, { mercado: e.target.value as TipoMercado })}
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
                  onChange={(e) => editar(i, { periodo: e.target.value as OddLine['periodo'] })}
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
                  onChange={(e) =>
                    editar(i, { time: (e.target.value || undefined) as OddLine['time'] })
                  }
                >
                  <option value="">—</option>
                  <option value="casa">{nomes.casa}</option>
                  <option value="fora">{nomes.fora}</option>
                </select>
              </label>
              <label>
                Lado
                <input
                  list={`lados-${l.mercado}`}
                  defaultValue={l.lado}
                  onBlur={(e) => editar(i, { lado: e.target.value })}
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
                  inputMode="decimal"
                  defaultValue={l.linha ?? ''}
                  onBlur={(e) => editar(i, { linha: num(e.target.value) })}
                />
              </label>
              <label>
                Odd
                <input
                  inputMode="decimal"
                  defaultValue={l.odd}
                  onBlur={(e) => editar(i, { odd: num(e.target.value) ?? 0 })}
                />
              </label>
              <label>
                Coleta
                <input
                  type="time"
                  defaultValue={hhmm(l.horarioColeta)}
                  onBlur={(e) => editar(i, { horarioColeta: isoDe(e.target.value) })}
                />
              </label>
            </div>
            {[...errosSchema[i], ...probs.map((p) => p.mensagem)].map((m) => (
              <div key={m} className="problema">
                ⚠️ {m}
              </div>
            ))}
            <div className="rodape-cartao">
              <span className="miudo">
                {l.fonte ?? 'manual'}
                {l.confianca !== undefined
                  ? ` · confiança da leitura ${Math.round(l.confianca * 100)}%`
                  : ''}
              </span>
              <button className="perigo" onClick={() => remover(i)}>
                Remover
              </button>
            </div>
          </div>
        );
      })}

      <button onClick={adicionar}>+ Adicionar linha</button>

      <label className={`confirmar ${totalErros ? 'bloqueado' : ''}`}>
        <input
          type="checkbox"
          checked={r.conferido}
          disabled={totalErros > 0 || r.linhas.length === 0}
          onChange={(e) => setR((x) => ({ ...x, conferido: e.target.checked }))}
        />
        Conferi todas as linhas com os prints{' '}
        {totalErros > 0 && `(corrija ${totalErros} erro(s) antes)`}
      </label>
    </section>
  );
}
