/**
 * Comparação estrutural do conteúdo reproduzido com o gravado. Nenhuma normalização que esconda
 * divergência: ausente, null, NaN, ±Infinity e {$invalido} são TIPOS diferentes entre si. A
 * tolerância (D3) só vale entre dois números finitos fora dos campos de decisão.
 */
import {
  CAMPOS_DECISAO,
  TOLERANCIA,
  type Diferenca,
  type TipoValor,
  type ValorComparado,
} from './contrato';

const AUSENTE = Symbol('ausente');

export function tipoDe(x: unknown): TipoValor {
  if (x === AUSENTE || x === undefined) return 'ausente';
  if (x === null) return 'null';
  if (typeof x === 'number') {
    if (Number.isNaN(x)) return 'NaN';
    if (x === Infinity) return 'Infinity';
    if (x === -Infinity) return '-Infinity';
    return 'numero';
  }
  if (typeof x === 'string') return 'texto';
  if (typeof x === 'boolean') return 'booleano';
  if (Array.isArray(x)) return 'lista';
  if (typeof x === 'object') {
    const ks = Object.keys(x);
    const o = x as Record<string, unknown>;
    if (ks.length === 1 && ks[0] === '$invalido') {
      const v = o.$invalido;
      if (v === 'NaN' || v === 'Infinity' || v === '-Infinity') return `invalido:${v}`;
    }
    if (ks.length === 1 && ks[0] === '$omitido') return 'omitido';
    return 'objeto';
  }
  return 'objeto';
}

const descrever = (x: unknown): ValorComparado => {
  const tipo = tipoDe(x);
  if (tipo === 'numero' || tipo === 'texto' || tipo === 'booleano')
    return { tipo, valor: x as number | string | boolean };
  if (tipo === 'lista') return { tipo, tamanho: (x as unknown[]).length };
  return { tipo };
};

export const dentroDaTolerancia = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(TOLERANCIA, TOLERANCIA * Math.max(Math.abs(a), Math.abs(b)));

/** Caminho é campo de decisão, está dentro de um, ou é pai de um (o campo sumiu junto). */
export function ehCampoDecisao(caminho: string): boolean {
  const p = caminho.replace(/\[\d+\]/g, '[*]');
  return CAMPOS_DECISAO.some(
    (c) =>
      c === p ||
      c.startsWith(`${p}.`) ||
      c.startsWith(`${p}[`) ||
      p.startsWith(`${c}.`) ||
      p.startsWith(`${c}[`),
  );
}

export function compararConteudos(original: unknown, reproduzido: unknown): Diferenca[] {
  const difs: Diferenca[] = [];
  const add = (caminho: string, tipo: Diferenca['tipo'], a: unknown, b: unknown) =>
    difs.push({
      caminho,
      tipo,
      original: descrever(a),
      reproduzido: descrever(b),
      decisao: ehCampoDecisao(caminho),
    });
  const andar = (a: unknown, b: unknown, caminho: string) => {
    const ta = tipoDe(a);
    const tb = tipoDe(b);
    if (ta !== tb) return add(caminho, 'tipo', a, b);
    if (ta === 'numero') {
      const x = a as number;
      const y = b as number;
      if (Object.is(x, y)) return;
      return add(
        caminho,
        dentroDaTolerancia(x, y) ? 'numero-na-tolerancia' : 'numero-fora-da-tolerancia',
        x,
        y,
      );
    }
    if (ta === 'texto' || ta === 'booleano') {
      if (a !== b) add(caminho, 'valor', a, b);
      return;
    }
    if (ta === 'omitido') {
      const va = (a as { $omitido: unknown }).$omitido;
      const vb = (b as { $omitido: unknown }).$omitido;
      if (va !== vb) add(caminho, 'valor', a, b);
      return;
    }
    if (ta === 'lista') {
      const la = a as unknown[];
      const lb = b as unknown[];
      for (let i = 0; i < Math.max(la.length, lb.length); i++)
        andar(i < la.length ? la[i] : AUSENTE, i < lb.length ? lb[i] : AUSENTE, `${caminho}[${i}]`);
      return;
    }
    if (ta === 'objeto') {
      const oa = a as Record<string, unknown>;
      const ob = b as Record<string, unknown>;
      const chaves = [...new Set([...Object.keys(oa), ...Object.keys(ob)])].sort();
      for (const k of chaves)
        andar(
          Object.hasOwn(oa, k) ? oa[k] : AUSENTE,
          Object.hasOwn(ob, k) ? ob[k] : AUSENTE,
          caminho ? `${caminho}.${k}` : k,
        );
    }
    // ausente/null/NaN/±Infinity/{$invalido} do mesmo tipo: iguais
  };
  andar(original, reproduzido, '');
  return difs;
}

/** Contagem por prefixo de dois níveis (ex.: "avaliacao.v4"), para quando a lista é cortada. */
export function porPrefixo(difs: Diferenca[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const d of difs) {
    const k = d.caminho.split(/[.[]/).slice(0, 2).join('.') || '(raiz)';
    r[k] = (r[k] ?? 0) + 1;
  }
  // ordem por código de caractere: não depende da localidade de quem roda
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
