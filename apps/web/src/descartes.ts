/**
 * Descartados da V4.0 agrupados pelo motivo: a lista crua tem dezenas de linhas quase iguais e
 * esconde o que pede atenção (leitura incompleta costuma ser print mal lido).
 */
export interface Descartado {
  chave: string;
  descricao: string;
  motivo: string;
}

export interface GrupoDescartes {
  titulo: string;
  /** pede conferência do usuário */
  atencao: boolean;
  itens: Descartado[];
}

const GRUPOS: { re: RegExp; titulo: string; atencao?: boolean }[] = [
  {
    re: /mercado incompleto|sem 1X2 da mesma casa/,
    titulo: 'Leitura incompleta: falta um lado do mercado (confira os prints)',
    atencao: true,
  },
  { re: /liga principal sem referência/, titulo: 'Sem Pinnacle/Betfair ou 4+ casas' },
  { re: /DQ do modelo abaixo/, titulo: 'Sem referência e dados fracos (DQ abaixo de C)' },
  { re: /sem modelo para este mercado/, titulo: 'Sem referência e sem modelo para o mercado' },
  { re: /margem da referência/, titulo: 'Margem acima de 10%' },
  { re: /nicho exige/, titulo: 'Amostra pequena para o nicho' },
  { re: /não comparáveis/, titulo: 'Odds coletadas com muito tempo de diferença' },
];

export function agruparDescartes(lista: Descartado[]): GrupoDescartes[] {
  const mapa = new Map<string, GrupoDescartes>();
  for (const d of lista) {
    const g = GRUPOS.find((x) => x.re.test(d.motivo));
    const titulo = g?.titulo ?? d.motivo;
    const atual = mapa.get(titulo) ?? { titulo, atencao: !!g?.atencao, itens: [] };
    atual.itens.push(d);
    mapa.set(titulo, atual);
  }
  return [...mapa.values()].sort(
    (a, b) => Number(b.atencao) - Number(a.atencao) || b.itens.length - a.itens.length,
  );
}
