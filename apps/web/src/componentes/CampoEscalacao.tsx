/**
 * Campo com as duas escalações, montado pela formação: mandante à esquerda, visitante à direita,
 * cada um com as cores do time (ver coresTimes.ts). O primeiro da lista é o goleiro; depois, da defesa para o ataque, na ordem
 * em que o leitor entrega (e em que o usuário corrige). Os jogadores entram fileira por fileira.
 */
import type { CSSProperties } from 'react';
import { bolasDoCampo, coresDoTime, useCoresEscolhidas } from '../coresTimes';

export const FORMACOES = [
  '4-4-2',
  '4-3-3',
  '4-2-3-1',
  '4-1-4-1',
  '4-4-1-1',
  '4-3-2-1',
  '4-5-1',
  '3-5-2',
  '3-4-3',
  '3-4-2-1',
  '3-4-1-2',
  '5-3-2',
  '5-4-1',
];

export interface TimeNoCampo {
  nome: string;
  titulares: string[];
  formacao?: string;
  /** posição de cada um no print (% do campo deitado): o campo repete o desenho do print */
  posicoes?: { nome: string; x: number; y: number }[];
  /** formação escolhida à mão: monta pela formação mesmo havendo posições */
  formacaoEscolhida?: boolean;
  /** cores da camisa lidas do print */
  cores?: { cor1: string; cor2?: string };
}

const igual = (a: string, b: string) =>
  a.replace(/[^A-Za-zÀ-ú]/g, '').toLowerCase() === b.replace(/[^A-Za-zÀ-ú]/g, '').toLowerCase();

interface Vaga {
  nome: string;
  x: number;
  y: number;
  fileira: number;
}

/** "3-4-2-1" → fileiras de linha; inválida (soma ≠ 10) → 4-4-2 */
function fileiras(formacao?: string): number[] {
  const f = (formacao ?? '').split('-').map(Number);
  return f.length >= 2 && f.every((n) => n > 0) && f.reduce((a, b) => a + b, 0) === 10
    ? f
    : [4, 4, 2];
}

/** iniciais para o círculo: "J. F. Aguirre" → "JA", "Leozinho" → "LE" */
function iniciais(nome: string): string {
  const p = nome.replace(/[.'’]/g, ' ').split(/\s+/).filter(Boolean);
  if (!p.length || nome === '?') return '?';
  return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
}

/**
 * Com as posições do print: cada titular onde estava no print. Quem não tem posição (o goleiro
 * que você digitou no começo da lista) vai para o gol; os 10 de linha sem goleiro deixam "?".
 */
function vagasDoPrint(t: TimeNoCampo, lado: 'casa' | 'fora'): Vaga[] | null {
  const pos = t.posicoes ?? [];
  if (t.formacaoEscolhida || pos.length < 8) return null;
  const gol = lado === 'casa' ? 4 : 96;
  const r: Vaga[] = [];
  let semPosicao = 0;
  for (const [i, nome] of t.titulares.entries()) {
    const p = pos.find((q) => igual(q.nome, nome));
    const prof = p ? Math.abs(50 - p.x) : 0;
    if (p) r.push({ nome, x: p.x, y: p.y, fileira: Math.round((50 - prof) / 10) });
    else if (i === 0) r.push({ nome, x: gol, y: 50, fileira: 0 });
    else semPosicao++;
  }
  // 10 de linha e nenhum goleiro na lista: o lugar dele fica marcado
  if (!r.some((v) => v.x === gol) && t.titulares.length - semPosicao <= 10)
    r.push({ nome: '?', x: gol, y: 50, fileira: 0 });
  return semPosicao > 2 ? null : r;
}

/** Pela formação. Com 10 nomes, falta o goleiro (o leitor não pegou): vaga "?". */
function vagas(t: TimeNoCampo, lado: 'casa' | 'fora'): Vaga[] {
  const doPrint = vagasDoPrint(t, lado);
  if (doPrint) return doPrint;
  const f = fileiras(t.formacao);
  const n = t.titulares.length;
  const goleiro = n >= 11 ? t.titulares[0] : '?';
  const linha = (n >= 11 ? t.titulares.slice(1, 11) : t.titulares.slice(0, 10)).concat(
    Array(10).fill('?'),
  );
  const espelho = (x: number) => (lado === 'casa' ? x : 100 - x);
  const r: Vaga[] = [{ nome: goleiro, x: espelho(5), y: 50, fileira: 0 }];
  let k = 0;
  f.forEach((qtd, i) => {
    // da defesa (perto do gol) até o ataque, que fica a um passo do meio de campo
    const x = 14 + ((i + 1) * 31) / f.length;
    for (let j = 0; j < qtd; j++)
      r.push({ nome: linha[k++], x: espelho(x), y: ((j + 1) * 100) / (qtd + 1), fileira: i + 1 });
  });
  return r;
}

export function CampoEscalacao({
  casa,
  fora,
  onFormacao,
}: {
  casa: TimeNoCampo;
  fora: TimeNoCampo;
  onFormacao: (lado: 'casa' | 'fora', f: string) => void;
}) {
  const seletor = (lado: 'casa' | 'fora', t: TimeNoCampo) => (
    <label className={`campo-formacao ${lado}`}>
      <span>
        {t.nome} {lado === 'casa' ? '(mandante)' : '(visitante)'}
      </span>
      <select value={t.formacao ?? ''} onChange={(e) => onFormacao(lado, e.target.value)}>
        {!t.formacao && <option value="">formação não lida — escolha</option>}
        {[...new Set([...(t.formacao ? [t.formacao] : []), ...FORMACOES])].map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
  useCoresEscolhidas();
  const bolas = bolasDoCampo(
    coresDoTime(casa.nome, casa.cores),
    coresDoTime(fora.nome, fora.cores),
  );
  const coresCss = Object.fromEntries(
    (['casa', 'fora'] as const).flatMap((t) => [
      [`--bola-${t}`, bolas[t].fundo],
      [`--bola-texto-${t}`, bolas[t].texto],
      [`--bola-contorno-${t}`, bolas[t].contorno],
      [`--rotulo-${t}`, bolas[t].rotulo],
    ]),
  ) as CSSProperties;
  // a chave muda com a escalação: a animação de entrada roda de novo quando ela muda
  const chave = [casa, fora].map((t) => `${t.formacao}|${t.titulares.join(',')}`).join('#');
  return (
    <div className="campo-escalacao caixa" style={coresCss}>
      <div className="campo-topo">
        {seletor('casa', casa)}
        {seletor('fora', fora)}
      </div>
      <div className="campo" key={chave} role="img" aria-label="Escalações no campo">
        <div className="campo-linhas" aria-hidden="true">
          <span className="campo-meio" />
          <span className="campo-circulo" />
          <span className="campo-area esquerda" />
          <span className="campo-area direita" />
          <span className="campo-pequena esquerda" />
          <span className="campo-pequena direita" />
        </div>
        {(['casa', 'fora'] as const).map((lado) =>
          vagas(lado === 'casa' ? casa : fora, lado).map((v, i) => (
            <div
              key={`${lado}-${i}`}
              className={`jogador-campo ${lado} ${v.nome === '?' ? 'vazio' : ''}`}
              style={
                {
                  // deitado (computador) e em pé (celular, mandante em cima)
                  '--x': `${v.x}%`,
                  '--y': `${v.y}%`,
                  '--vx': `${v.y}%`,
                  '--vy': `${v.x}%`,
                  '--atraso': `${v.fileira * 110 + (lado === 'fora' ? 60 : 0)}ms`,
                } as CSSProperties
              }
              title={v.nome === '?' ? 'não lido: complete a lista' : v.nome}
            >
              <span className="jogador-bola">{iniciais(v.nome)}</span>
              <span className="jogador-nome">{v.nome === '?' ? 'não lido' : v.nome}</span>
            </div>
          )),
        )}
      </div>
      <p className="miudo">
        O primeiro da lista é o goleiro; depois, da defesa para o ataque. Corrija a lista acima e o
        campo acompanha.
      </p>
    </div>
  );
}
