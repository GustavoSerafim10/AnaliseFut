/**
 * Radar de preços: a mesma seleção em todas as casas, com a que paga mais em destaque.
 * Só aparece com seleções cotadas em duas casas ou mais.
 */
import { chaveSelecao, descreverAposta, type LinhaOdd } from '@pe/engine';
import { familiaMercado } from '../camadas';
import { Painel } from './CentroComando';

const n2 = (x: number) => x.toFixed(2).replace('.', ',');

export interface LinhaRadar {
  chave: string;
  linha: LinhaOdd;
  precos: Record<string, number>;
  melhor: number;
  /** quanto a melhor odd paga acima da média das outras */
  vantagem: number;
}

export function montarRadar(linhas: LinhaOdd[]): { casas: string[]; linhas: LinhaRadar[] } {
  const grupos = new Map<string, LinhaOdd[]>();
  for (const l of linhas) {
    const k = chaveSelecao(l);
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const saida: LinhaRadar[] = [];
  for (const [chave, ls] of grupos) {
    const precos: Record<string, number> = {};
    for (const l of ls) precos[l.casa] = Math.max(precos[l.casa] ?? 0, l.odd);
    const valores = Object.values(precos);
    if (valores.length < 2) continue;
    const melhor = Math.max(...valores);
    const resto = [...valores];
    resto.splice(resto.indexOf(melhor), 1);
    const media = resto.reduce((s, x) => s + x, 0) / resto.length;
    saida.push({ chave, linha: ls[0], precos, melhor, vantagem: melhor / media - 1 });
  }
  saida.sort(
    (a, b) =>
      familiaMercado(a.linha.mercado).localeCompare(familiaMercado(b.linha.mercado)) ||
      b.vantagem - a.vantagem,
  );
  return {
    casas: [...new Set(saida.flatMap((l) => Object.keys(l.precos)))],
    linhas: saida,
  };
}

export function RadarOdds({
  linhas,
  nomes,
}: {
  linhas: LinhaOdd[];
  nomes: { casa: string; fora: string };
}) {
  const r = montarRadar(linhas);
  if (!r.linhas.length) return null;
  return (
    <Painel
      titulo="Radar de preços: quem paga mais"
      icone="mercado"
      extra={<span className="cc-extra-texto">{r.linhas.length} seleções</span>}
    >
      <div className="tabela-rolavel cc-radar-rolagem">
        <table className="cc-radar">
          <thead>
            <tr>
              <th>Aposta</th>
              {r.casas.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th title="quanto a melhor odd paga acima da média das outras casas">Vantagem</th>
            </tr>
          </thead>
          <tbody>
            {r.linhas.map((l) => (
              <tr key={l.chave}>
                <th scope="row">
                  <small>{familiaMercado(l.linha.mercado)}</small>
                  {descreverAposta(l.linha, nomes).replace('Ganha se: ', '')}
                </th>
                {r.casas.map((c) => (
                  <td key={c} className={l.precos[c] === l.melhor ? 'cc-radar-melhor' : ''}>
                    {l.precos[c] === undefined ? '·' : n2(l.precos[c])}
                  </td>
                ))}
                <td className="cc-radar-vant">
                  +{(l.vantagem * 100).toFixed(1).replace('.', ',')}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Painel>
  );
}
