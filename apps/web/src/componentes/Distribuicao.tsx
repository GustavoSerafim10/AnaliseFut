/**
 * Distribuição 1X2: P_true da V4.0 quando o 1X2 foi avaliado contra a referência; senão a
 * previsão final do motor de apoio (V3.3). A fonte usada aparece no rodapé.
 */
import type { Derivado } from '../dados';
import { Icone } from './ui';

export function Distribuicao({ d, nomes }: { d: Derivado; nomes: { casa: string; fora: string } }) {
  const doV4 = (lado: string) =>
    d.v4?.avaliadas.find(
      (a) =>
        a.linha.mercado === '1X2' &&
        a.linha.periodo === 'FT' &&
        a.linha.lado.toUpperCase() === lado,
    )?.pTrue;
  const v4 = ['1', 'X', '2'].map(doV4);
  const final = d.resultado?.previsao?.p1x2.final;
  const [probs, fonte] = v4.every((x) => x !== undefined)
    ? [v4 as number[], 'P_true da V4.0 (referência sem margem)']
    : final
      ? [
          [final.casa, final.empate, final.fora],
          'previsão do motor de apoio V3.3 (blend modelo × mercado)',
        ]
      : [null, ''];
  const linhas: [string, string][] = [
    [nomes.casa, 'var(--amarelo)'],
    ['Empate', 'var(--ciano)'],
    [nomes.fora, 'var(--violeta)'],
  ];
  return (
    <section className="painel">
      <div className="painel-titulo">
        <Icone nome="barras" /> Distribuição de probabilidades (1X2)
      </div>
      {!probs ? (
        <p className="vazio">Aguardando odds de 1X2 ou estatísticas para o modelo.</p>
      ) : (
        <>
          {linhas.map(([rotulo, cor], i) => (
            <div key={rotulo} className="dist-linha">
              <span className="dist-rotulo">{rotulo}</span>
              <span className="dist-trilho">
                <span
                  className="dist-barra"
                  style={{
                    width: `${probs[i] * 100}%`,
                    background: cor,
                    animationDelay: `${i * 90}ms`,
                  }}
                />
              </span>
              <span className="dist-valor">{Math.round(probs[i] * 100)}%</span>
            </div>
          ))}
          <p className="miudo">Fonte: {fonte}</p>
        </>
      )}
    </section>
  );
}
