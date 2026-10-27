import {
  evApostaGratis,
  evBonusRollover,
  evOddTurbinada,
  evSemRisco,
  type ResultadoPromocao,
} from '@pe/engine';
import { useState } from 'react';
import { dec, num, pct } from '../estado';
import type { PropsAba } from './tipos';

type Tipo = 'turbinada' | 'gratis' | 'semRisco' | 'bonus';

const NOMES: Record<Tipo, string> = {
  turbinada: 'Odd turbinada',
  gratis: 'Aposta grátis (freebet)',
  semRisco: 'Aposta "sem risco" / cashback',
  bonus: 'Bônus com rollover',
};

function Resultado({ r }: { r: ResultadoPromocao | null }) {
  if (!r) return <p className="miudo">Preencha os campos.</p>;
  return (
    <div className={`caixa ${r.aceitar ? 'ok' : 'alerta'}`}>
      <strong>{r.aceitar ? 'Aceitar' : 'Recusar'}</strong>: EV de R$ {dec(r.ev)} (
      {pct(r.evRelativo)})<div className="miudo">{r.explicacao}</div>
    </div>
  );
}

/** S4 — EV real de promoções, contra o P_true da referência. */
export function AbaPromocoes({ d }: PropsAba) {
  const [tipo, setTipo] = useState<Tipo>('turbinada');
  const [v, setV] = useState<Record<string, string>>({
    pTrue: '',
    odd: '',
    valor: '',
    reembolso: '1',
    bonus: '',
    deposito: '',
    multiplicador: '',
    margem: '4',
    base: 'bonus',
  });
  const campo = (k: string, rotulo: string, dica?: string) => (
    <label>
      {rotulo}
      <input
        inputMode="decimal"
        value={v[k]}
        placeholder={dica}
        onChange={(e) => setV({ ...v, [k]: e.target.value })}
      />
    </label>
  );
  const pTrue = (() => {
    const p = num(v.pTrue);
    return p === undefined ? undefined : p > 1 ? p / 100 : p;
  })();
  const odd = num(v.odd);
  const valor = num(v.valor);

  let r: ResultadoPromocao | null = null;
  if (tipo === 'turbinada' && pTrue && odd) r = evOddTurbinada(pTrue, odd, valor ?? 1);
  if (tipo === 'gratis' && pTrue && odd && valor) r = evApostaGratis(valor, odd, pTrue);
  if (tipo === 'semRisco' && pTrue && odd && valor)
    r = evSemRisco(valor, odd, pTrue, num(v.reembolso) ?? 1);
  if (tipo === 'bonus') {
    const bonus = num(v.bonus);
    const mult = num(v.multiplicador);
    const margem = num(v.margem);
    if (bonus && mult && margem !== undefined)
      r = evBonusRollover({
        bonus,
        deposito: num(v.deposito) ?? 0,
        multiplicador: mult,
        base: v.base === 'bonus' ? 'bonus' : 'deposito+bonus',
        margem: margem / 100,
      });
  }

  const doJogo = d.v4?.avaliadas ?? [];
  return (
    <section className="passo">
      <h2>Promoções (S4)</h2>
      <p className="dica">
        Calcule o EV real antes de aceitar: odd turbinada, freebet, aposta sem risco e bônus com
        rollover. Use o P_true da referência (Pinnacle/consenso), nunca a odd da própria casa.
      </p>
      <div className="abas-mini">
        {(Object.keys(NOMES) as Tipo[]).map((t) => (
          <button key={t} className={t === tipo ? 'ativo' : ''} onClick={() => setTipo(t)}>
            {NOMES[t]}
          </button>
        ))}
      </div>

      {tipo !== 'bonus' && (
        <>
          {doJogo.length > 0 && (
            <label>
              P_true de um mercado do jogo atual
              <select
                value=""
                onChange={(e) => {
                  const a = doJogo.find((x) => x.chave === e.target.value);
                  if (a) setV({ ...v, pTrue: (a.pTrue * 100).toFixed(1) });
                }}
              >
                <option value="">escolher…</option>
                {doJogo.map((a) => (
                  <option key={a.chave} value={a.chave}>
                    {a.descricao.replace('Ganha se: ', '')} — {pct(a.pTrue)} ({a.nivel})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grade2">
            {campo('pTrue', 'P_true (%)', 'ex.: 52,3')}
            {campo('odd', tipo === 'turbinada' ? 'Odd turbinada' : 'Odd da aposta')}
            {campo('valor', tipo === 'turbinada' ? 'Stake (R$, opcional)' : 'Valor (R$)')}
            {tipo === 'semRisco' &&
              campo('reembolso', 'Reembolso se perder (0–1)', '1 = dinheiro · 0,7 = freebet')}
          </div>
        </>
      )}
      {tipo === 'bonus' && (
        <div className="grade2">
          {campo('bonus', 'Bônus (R$)')}
          {campo('deposito', 'Depósito (R$)')}
          {campo('multiplicador', 'Rollover (vezes)', 'ex.: 10')}
          <label>
            Rollover incide sobre
            <select value={v.base} onChange={(e) => setV({ ...v, base: e.target.value })}>
              <option value="bonus">só o bônus</option>
              <option value="deposito+bonus">depósito + bônus</option>
            </select>
          </label>
          {campo('margem', 'Margem dos mercados usados (%)', 'ex.: 4 em mercado principal')}
        </div>
      )}
      <Resultado r={r} />
      {tipo === 'bonus' && (
        <p className="dica">
          Cumpra o rollover em mercados de margem baixa e respeite a odd mínima exigida. O prazo não
          entra na conta: se for curto demais para o seu volume normal, recuse.
        </p>
      )}
    </section>
  );
}
