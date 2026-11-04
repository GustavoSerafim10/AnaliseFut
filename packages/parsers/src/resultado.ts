/**
 * Resultado de um jogo encerrado, lido do SofaScore (estatísticas da partida + fluxo da partida).
 *
 * - placar e intervalo: "FT 1-4" / "HT 1-2" do fluxo (o OCR troca 0 por O e 1 por i/l);
 *   sem FT, tenta o placar grande do topo ("Grêmio 2-0 Athletico").
 * - escanteios e cartões amarelos: a linha "6 Escanteios 4" da Visão geral; o número da
 *   esquerda é o último antes do rótulo, o da direita o primeiro depois. Número ilegível
 *   ("uy" no lugar de 4) fica vazio, nunca chutado: o usuário confere antes de salvar.
 */

export interface ParLido {
  casa?: number;
  fora?: number;
}

export interface ResultadoLido {
  placar?: ParLido;
  intervalo?: ParLido;
  escanteios?: ParLido;
  amarelos?: ParLido;
  vermelhos?: ParLido;
  /** o que não deu para ler, em português */
  faltando: string[];
}

/** dígito de placar com as trocas típicas do OCR */
const DIG = '[0-9OoIil|]';
const digito = (s: string) => Number(s.replace(/[Oo]/g, '0').replace(/[Iil|]/g, '1'));

function placarApos(texto: string, marca: 'FT' | 'HT'): ParLido | undefined {
  const m = texto.match(new RegExp(`\\b${marca}\\s*(${DIG}{1,2})\\s*[-–]\\s*(${DIG}{1,2})(?!\\d)`));
  return m ? { casa: digito(m[1]), fora: digito(m[2]) } : undefined;
}

/** placar grande do topo: linha com "N-N" logo antes de "Finalizado" */
function placarDoTopo(linhas: string[]): ParLido | undefined {
  const i = linhas.findIndex((l) => /finalizado/i.test(l));
  for (const l of linhas.slice(Math.max(0, i - 2), i + 1)) {
    const m = l.match(/(?:^|\s)(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s|$)/);
    if (m) return { casa: Number(m[1]), fora: Number(m[2]) };
  }
  return undefined;
}

const numero = (t: string | undefined, max: number) => {
  if (!t) return undefined;
  const s = t.replace(/[^\dA-Za-z]/g, '');
  if (!/^\d{1,2}$/.test(s)) return undefined;
  const n = Number(s);
  return n <= max ? n : undefined;
};

/** "esq Rótulo dir" em qualquer linha; fica com a que der mais números */
function linhaDeEstatistica(linhas: string[], rotulo: RegExp, max: number): ParLido | undefined {
  let melhor: ParLido | undefined;
  let nMelhor = 0;
  for (const l of linhas) {
    const m = l.match(rotulo);
    if (!m || m.index === undefined) continue;
    const antes = l.slice(0, m.index).trim().split(/\s+/);
    const depois = l
      .slice(m.index + m[0].length)
      .trim()
      .split(/\s+/);
    const par = { casa: numero(antes[antes.length - 1], max), fora: numero(depois[0], max) };
    const n = Number(par.casa !== undefined) + Number(par.fora !== undefined);
    if (n > nMelhor) {
      melhor = par;
      nMelhor = n;
    }
  }
  return melhor;
}

const completo = (p?: ParLido) => p?.casa !== undefined && p?.fora !== undefined;

export function lerResultado(textos: string[]): ResultadoLido {
  const texto = textos.join('\n');
  const linhas = texto.split('\n');
  const r: ResultadoLido = {
    placar: placarApos(texto, 'FT') ?? placarDoTopo(linhas),
    intervalo: placarApos(texto, 'HT'),
    escanteios: linhaDeEstatistica(linhas, /\bescanteios\b/i, 30),
    // "Cartões amarelos" chega como "Cariões smarios", "Cartdes amarelos"...
    amarelos: linhaDeEstatistica(linhas, /\bca\S{0,4}es\s+\S*mar\S*/i, 15),
    vermelhos: linhaDeEstatistica(linhas, /\bca\S{0,4}es\s+\S*verm\S*/i, 5),
    faltando: [],
  };
  const nomes: [keyof ResultadoLido, string][] = [
    ['placar', 'placar final (cole o print do fluxo da partida, com "FT")'],
    ['intervalo', 'placar do intervalo (fluxo da partida, "HT")'],
    ['escanteios', 'escanteios'],
    ['amarelos', 'cartões amarelos'],
  ];
  for (const [k, nome] of nomes) if (!completo(r[k] as ParLido | undefined)) r.faltando.push(nome);
  return r;
}
