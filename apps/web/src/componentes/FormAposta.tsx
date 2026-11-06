/**
 * "Entrei nessa aposta": registra a aposta feita de verdade, com a odd e a casa que o usuário
 * pegou. Só o que passa por aqui conta no painel de entradas do Histórico.
 */
import { useState } from 'react';
import { isoLocal, num } from '../estado';
import type { ApostaFeita, ResumoAnalise } from '../historico';

export function FormAposta({
  entrada,
  decisao,
  daLista,
  aviso,
  onConfirmar,
  onCancelar,
}: {
  entrada: NonNullable<ResumoAnalise['entrada']>;
  decisao: ResumoAnalise['decisao'];
  /** escolhida pelo usuário na lista ou no seletor: não passa pela decisão da análise técnica */
  daLista?: boolean;
  /** o que o usuário precisa saber antes de confirmar esta aposta */
  aviso?: string;
  onConfirmar: (a: ApostaFeita) => void;
  onCancelar: () => void;
}) {
  const [odd, setOdd] = useState(String(entrada.odd));
  const [casa, setCasa] = useState(entrada.casa);
  const [valor, setValor] = useState(
    entrada.stakeValor !== undefined ? entrada.stakeValor.toFixed(2) : '',
  );
  const o = num(odd);
  const ok = o !== undefined && o > 1 && casa.trim() !== '';
  return (
    <div className="caixa form-aposta">
      <h3>Entrei nessa aposta</h3>
      <p>
        <strong>{entrada.descricao}</strong>
      </p>
      {decisao !== 'BET' && !daLista && (
        <div className="caixa alerta">
          O motor <strong>não aprovou</strong> esta entrada ({decisao ?? 'sem decisão'}). Ela vai
          contar no seu painel mesmo assim.
        </div>
      )}
      {aviso && <div className="caixa alerta">{aviso}</div>}
      <div className="grade3">
        <label>
          Odd que você pegou
          <input inputMode="decimal" value={odd} onChange={(x) => setOdd(x.target.value)} />
        </label>
        <label>
          Casa
          <input value={casa} onChange={(x) => setCasa(x.target.value)} />
        </label>
        <label>
          Valor (R$, opcional)
          <input
            inputMode="decimal"
            value={valor}
            placeholder="ex.: 20"
            onChange={(x) => setValor(x.target.value)}
          />
        </label>
      </div>
      {o !== undefined && o < entrada.odd && (
        <p className="miudo">
          Odd menor que a da análise ({entrada.odd}): a vantagem real ficou abaixo da calculada.
        </p>
      )}
      <div className="linha-acoes">
        <button
          className="primario"
          disabled={!ok}
          onClick={() =>
            onConfirmar({
              odd: o!,
              casa: casa.trim(),
              valor: num(valor),
              feitaEm: isoLocal(new Date()),
            })
          }
        >
          ✅ Confirmar entrada
        </button>
        <button className="discreto" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
