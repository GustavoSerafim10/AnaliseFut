import type { Rascunho } from '../estado';
import type { PropsAba } from './tipos';

const OPCOES: [keyof Rascunho['config'], string, string][] = [
  [
    'ligaTop',
    'Liga bem coberta (top)',
    'Brasileirão, top 5 europeias, Champions, Libertadores… Necessário para DQ A.',
  ],
  [
    'escalacaoProvavel',
    'Escalação provável conferida',
    'Você viu as prováveis escalações (ex.: aba Formações do SofaScore). Necessário para DQ A.',
  ],
  [
    'escalacaoIncerta',
    'Escalação incerta',
    'Muita dúvida de quem joga: o modelo pesa menos e o gate sobe.',
  ],
  [
    'mercadoMuitoLiquido',
    'Mercado muito líquido',
    'Jogo grande, muito apostado (Champions, top europeias): o mercado erra menos.',
  ],
  [
    'favoritoLigaMaisForte',
    'Favorito de liga mais forte',
    'Só em jogo entre ligas diferentes (copas continentais): corrige o viés conhecido do modelo (16.3).',
  ],
];

export function AbaJogo({ r, setR }: PropsAba) {
  const jogo = (campo: keyof Rascunho['jogo'], v: string) =>
    setR((x) => ({ ...x, jogo: { ...x.jogo, [campo]: v } }));
  const config = <K extends keyof Rascunho['config']>(campo: K, v: Rascunho['config'][K]) =>
    setR((x) => ({ ...x, config: { ...x.config, [campo]: v } }));

  return (
    <section className="passo">
      <h2>Jogo</h2>
      <div className="grade2">
        <label>
          Mandante
          <input value={r.jogo.casa} onChange={(e) => jogo('casa', e.target.value)} />
        </label>
        <label>
          Visitante
          <input value={r.jogo.fora} onChange={(e) => jogo('fora', e.target.value)} />
        </label>
        <label>
          Competição
          <input value={r.jogo.competicao} onChange={(e) => jogo('competicao', e.target.value)} />
        </label>
        <label>
          Data
          <input type="date" value={r.jogo.data} onChange={(e) => jogo('data', e.target.value)} />
        </label>
        <label>
          Hora do início
          <input type="time" value={r.jogo.hora} onChange={(e) => jogo('hora', e.target.value)} />
        </label>
      </div>
      <p className="dica">
        Os nomes servem para o leitor saber de que time é cada número e cada odd.
      </p>

      <h3>Sobre o jogo</h3>
      {OPCOES.map(([campo, rotulo, dica]) => (
        <label key={campo} className="check">
          <input
            type="checkbox"
            checked={!!r.config[campo]}
            onChange={(e) => config(campo, e.target.checked)}
          />
          <span>
            {rotulo}
            <span className="dica bloco">{dica}</span>
          </span>
        </label>
      ))}

      <details>
        <summary>Parâmetros do modelo</summary>
        <div className="grade2">
          <label>
            Média de gols por time na liga
            <input
              inputMode="decimal"
              value={r.config.mediaGols}
              onChange={(e) => config('mediaGols', e.target.value)}
            />
          </label>
          <label>
            Fator mando de campo
            <input
              inputMode="decimal"
              value={r.config.mando}
              onChange={(e) => config('mando', e.target.value)}
            />
          </label>
          <label>
            Média de escanteios por time na liga
            <input
              inputMode="decimal"
              value={r.config.mediaEscanteios}
              onChange={(e) => config('mediaEscanteios', e.target.value)}
            />
          </label>
          <label>
            Média de cartões amarelos por time na liga
            <input
              inputMode="decimal"
              value={r.config.mediaCartoes}
              onChange={(e) => config('mediaCartoes', e.target.value)}
            />
          </label>
        </div>
        <p className="dica">
          Padrão do protocolo: 1,30 gols por time e mando 1,12 (1,00 em campo neutro). Escanteios
          (5,0) e cartões (2,2) por time servem de base para os mercados de nível 3.
        </p>
      </details>
    </section>
  );
}
