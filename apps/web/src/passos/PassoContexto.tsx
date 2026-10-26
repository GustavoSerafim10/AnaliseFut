import type { ContextoAnalise } from '@pe/engine';
import type { Dispatch, SetStateAction } from 'react';
import type { Rascunho } from '../estado';

const FLAGS: [keyof ContextoAnalise, string][] = [
  [
    'favoritoLigaMaisForte',
    'Favorito de liga mais forte contra time de liga mais fraca (viés 16.3)',
  ],
  ['mercadoMuitoLiquido', 'Mercado muito líquido (top europeias, Champions) — w −0,10'],
  ['mercadoPoucoLiquido', 'Mercado pouco líquido — gate +1 pp'],
  ['escalacaoIncerta', 'Escalação incerta — w −0,10, gate +1 pp, Kelly 1/8'],
  ['modelosDivergentes', 'Modelos divergentes — gate +1 pp'],
  ['lambdaLargo', 'λ com faixa larga — gate +1 pp'],
  ['priorNeutro', 'Prior neutro (sem rating/Elo) — Confidence no máximo Baixa'],
];

const ARMADILHAS = [
  'favorito popular',
  'sequência inflada',
  'H2H enganoso',
  'eficiência insustentável',
  'preço comprimido',
  'desfalque subestimado',
  'narrativa exagerada',
  'objetivo resolvido',
  'tabela inflada por resultado atípico',
];

interface Props {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
}

export function PassoContexto({ r, setR }: Props) {
  const ctx = (campo: keyof ContextoAnalise, v: boolean | string) =>
    setR((x) => ({ ...x, contexto: { ...x.contexto, [campo]: v || undefined } }));
  const rt = r.redTeam;
  const setRt = (m: Partial<Rascunho['redTeam']>) =>
    setR((x) => ({ ...x, redTeam: { ...x.redTeam, ...m } }));

  return (
    <section className="passo">
      <h2>4. Contexto e red team</h2>
      <p className="dica">Só marque com evidência. Falta de informação nunca vira confiança.</p>
      {FLAGS.map(([campo, rotulo]) => (
        <label key={campo} className="check">
          <input
            type="checkbox"
            checked={!!r.contexto[campo]}
            onChange={(e) => ctx(campo, e.target.checked)}
          />
          {rotulo}
        </label>
      ))}
      <label>
        Limitação conhecida do modelo (9.4)
        <input
          value={r.contexto.limitacaoConhecida ?? ''}
          onChange={(e) => ctx('limitacaoConhecida', e.target.value)}
          placeholder="ex.: amostra curta, prior neutro, liga mais fraca"
        />
      </label>
      <label>
        Fato concreto e verificável que justifica divergir do mercado
        <input
          value={r.contexto.explicacaoDivergencia ?? ''}
          onChange={(e) => ctx('explicacaoDivergencia', e.target.value)}
          placeholder="deixe vazio se não houver: o motor move o λ para o mercado"
        />
      </label>

      <h3>Trap detector</h3>
      <p className="dica">Revise antes do red team: {ARMADILHAS.join(' · ')}.</p>

      <h3>Red team</h3>
      <p className="dica">
        Pelo menos 3 argumentos contra a aposta, e pelo menos 1 atacando a premissa do modelo.
      </p>
      {rt.argumentos.map((a, i) => (
        <input
          key={i}
          value={a}
          placeholder={`Argumento contra ${i + 1}`}
          onChange={(e) =>
            setRt({ argumentos: rt.argumentos.map((x, j) => (j === i ? e.target.value : x)) })
          }
        />
      ))}
      <button onClick={() => setRt({ argumentos: [...rt.argumentos, ''] })}>+ argumento</button>
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

      <h3>Banca</h3>
      <label>
        Banca atual (R$) — usada só para calcular o valor da stake
        <input
          inputMode="decimal"
          value={r.banca}
          onChange={(e) => setR((x) => ({ ...x, banca: e.target.value }))}
        />
      </label>
    </section>
  );
}
