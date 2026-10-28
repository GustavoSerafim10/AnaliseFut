/**
 * Leitor de escalações (SofaScore → aba Escalações). O OCR lê o print em duas metades
 * (marcadores "### ESQUERDA" / "### DIREITA"): esquerda = mandante, direita = visitante,
 * salvo quando o nome do time aparece trocado. Só nomes de jogadores; nada vira número.
 */
import type { NomesTimes, Time } from '@pe/engine';
import { semAcento } from './texto';
import { similaridadeTime, tokensDoNome } from './times';

export const MARCA_ESQUERDA = '### ESQUERDA';
export const MARCA_DIREITA = '### DIREITA';

export type StatusEscalacao = 'provavel' | 'confirmada';

export interface LadoEscalacao {
  titulares: string[];
  reservas: string[];
  formacao?: string;
  tecnico?: string;
}

export interface LeituraEscalacao {
  casa: LadoEscalacao;
  fora: LadoEscalacao;
  /** o que o próprio print diz ("Escalações prováveis" / "confirmadas") */
  status?: StatusEscalacao;
  /** true quando o visitante estava na metade esquerda */
  ladosInvertidos: boolean;
  avisos: string[];
}

/** Palavras da interface do site que não são jogador. */
const INTERFACE =
  /^(escala\w*|provav\w*|confirmad\w*|substitut\w*|reservas?|banco|treinador|tecnico|formac\w*|ausentes?|lesionad\w*|suspens\w*|duvida|nota|media|campo|lista|mostrar|ver|mais|jogadores?|titulares?|gol(eiro)?|defensor|meio|atacante|minutos?|sofascore|valor|mercado|idade|altura|camisa|capitao|desconhecido|motivo|lesao|outro|prevista|previstas?|atualizad\w*|equipe|time|partida|jogo|sub|min)$/;

const RE_FORMACAO = /\b([3-5])\s?-\s?(\d)\s?-\s?(\d)(?:\s?-\s?(\d))?\b/;

function ladoVazio(): LadoEscalacao {
  return { titulares: [], reservas: [] };
}

/** "G. Arrascaeta 7.4" → "G. Arrascaeta"; "10 Hugo Souza" → "Hugo Souza"; lixo → null. */
export function nomeDeJogador(linha: string): string | null {
  const tokens = linha
    .replace(/[|[\]{}()<>«»“”"_=+*#~^]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const partes: string[] = [];
  for (const t of tokens) {
    // "Ricar..." / "Ricar…": nome cortado pelo site; o ponto único fica (inicial "G.")
    const limpo = t.replace(/^[.,;:'-]+|[,;:'-]+$/g, '').replace(/(\.{2,}|…)$/, '');
    if (!limpo) continue;
    // abreviação ("G.", "Bu.") ou palavra com letra maiúscula + 2 letras ou mais
    const inicial = /^[A-ZÀ-Ú][a-zà-ú]{0,2}\.$/.test(limpo);
    const palavra = /^[A-ZÀ-Ú][a-zà-úA-ZÀ-Ú'’-]{1,}$/.test(limpo) && !/\d/.test(limpo);
    const particula = partes.length > 0 && /^(de|da|do|dos|das|di|van|von|el|al)$/i.test(limpo);
    if (inicial || palavra || particula) {
      if (palavra && INTERFACE.test(semAcento(limpo))) continue;
      partes.push(limpo);
    } else if (partes.length) {
      break; // o nome acabou (veio número, nota ou lixo)
    }
  }
  while (partes.length && /^(de|da|do|dos|das|di|van|von|el|al)$/i.test(partes[partes.length - 1]))
    partes.pop();
  const nome = partes.join(' ');
  const letras = nome.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letras.length < 3) return null;
  // uma palavra só, curta e toda maiúscula costuma ser sigla/lixo ("VAR", "OK")
  if (partes.length === 1 && /^[A-ZÀ-Ú]{2,4}$/.test(nome)) return null;
  return nome;
}

function citaTime(texto: string, nome: string): boolean {
  const marcas = tokensDoNome(nome).filter((t) => t.length >= 4);
  if (!marcas.length) return false;
  const palavras = semAcento(texto)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/);
  return palavras.some((p) => marcas.some((m) => similaridadeTime(p, m) === 1));
}

function lerLado(linhas: string[], jogo: NomesTimes): LadoEscalacao {
  const lado = ladoVazio();
  let modo: 'titulares' | 'reservas' | 'tecnico' | 'ignorar' = 'titulares';
  for (const bruta of linhas) {
    const t = semAcento(bruta);
    const f = RE_FORMACAO.exec(bruta);
    if (f && !lado.formacao) lado.formacao = f.slice(1).filter(Boolean).join('-');
    if (/substitut|reservas|banco de reservas/.test(t)) {
      modo = 'reservas';
      continue;
    }
    if (/treinador|tecnico/.test(t)) {
      modo = 'tecnico';
      const resto = nomeDeJogador(bruta.replace(/treinador|t[ée]cnico/gi, ' '));
      if (resto) {
        lado.tecnico = resto;
        modo = 'reservas';
      }
      continue;
    }
    if (/ausentes|lesionad|suspens|nao relacionad/.test(t)) {
      modo = 'ignorar';
      continue;
    }
    if (modo === 'ignorar') continue;
    if (citaTime(bruta, jogo.casa) || citaTime(bruta, jogo.fora)) continue;
    const nome = nomeDeJogador(bruta);
    if (!nome) continue;
    if (modo === 'tecnico') {
      lado.tecnico = nome;
      modo = 'reservas';
      continue;
    }
    const lista = modo === 'reservas' ? lado.reservas : lado.titulares;
    if (!lado.titulares.includes(nome) && !lado.reservas.includes(nome)) lista.push(nome);
  }
  // mais de 11: o que sobra costuma ser lixo de selo/nota ("Lio 6.9"), palavra solta curta
  const curto = (n: string) => !n.includes(' ') && n.replace(/[^A-Za-zÀ-ú]/g, '').length <= 3;
  while (lado.titulares.length > 11 && lado.titulares.some(curto))
    lado.titulares.splice(lado.titulares.findIndex(curto), 1);
  return lado;
}

/** Junta dois lados (vários prints da mesma escalação, rolando a página). */
function juntarLado(a: LadoEscalacao, b: LadoEscalacao): LadoEscalacao {
  const ja = new Set([...a.titulares, ...a.reservas]);
  return {
    titulares: [...a.titulares, ...b.titulares.filter((n) => !ja.has(n))],
    reservas: [...a.reservas, ...b.reservas.filter((n) => !ja.has(n))],
    formacao: a.formacao ?? b.formacao,
    tecnico: a.tecnico ?? b.tecnico,
  };
}

export function lerEscalacao(texto: string, jogo: NomesTimes): LeituraEscalacao {
  const avisos: string[] = [];
  const linhas = texto
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const iE = linhas.indexOf(MARCA_ESQUERDA);
  const iD = linhas.indexOf(MARCA_DIREITA);
  if (iE < 0 || iD < 0) {
    avisos.push(
      'print lido sem a divisão em lados: envie de novo para separar mandante e visitante',
    );
    return { casa: ladoVazio(), fora: ladoVazio(), ladosInvertidos: false, avisos };
  }
  const esq = linhas.slice(iE + 1, iD);
  const dir = linhas.slice(iD + 1);
  const tudo = semAcento(linhas.join(' '));
  const status: StatusEscalacao | undefined = /provav/.test(tudo)
    ? 'provavel'
    : /confirmad/.test(tudo)
      ? 'confirmada'
      : undefined;

  // nome do visitante na metade esquerda (ou do mandante na direita) → lados trocados
  const cita = (ls: string[], t: Time) => ls.some((l) => citaTime(l, jogo[t]));
  const ladosInvertidos =
    (cita(esq, 'fora') && !cita(esq, 'casa')) || (cita(dir, 'casa') && !cita(dir, 'fora'));
  if (ladosInvertidos)
    avisos.push(`${jogo.fora} aparece à esquerda: lados trocados automaticamente`);

  const ladoE = lerLado(esq, jogo);
  const ladoD = lerLado(dir, jogo);
  return {
    casa: ladosInvertidos ? ladoD : ladoE,
    fora: ladosInvertidos ? ladoE : ladoD,
    status,
    ladosInvertidos,
    avisos,
  };
}

/** Vários prints → uma escalação por time. */
export function juntarEscalacoes(leituras: LeituraEscalacao[]): LeituraEscalacao | null {
  if (!leituras.length) return null;
  return leituras.slice(1).reduce(
    (a, b) => ({
      casa: juntarLado(a.casa, b.casa),
      fora: juntarLado(a.fora, b.fora),
      // "confirmada" em qualquer print vale mais que "provável"
      status:
        a.status === 'confirmada' || b.status === 'confirmada'
          ? 'confirmada'
          : (a.status ?? b.status),
      ladosInvertidos: a.ladosInvertidos || b.ladosInvertidos,
      avisos: [...a.avisos, ...b.avisos],
    }),
    leituras[0],
  );
}

/** Mesma pessoa? Compara o sobrenome (última palavra) sem acento; tolera "G. Arrascaeta". */
export function mesmoJogador(a: string, b: string): boolean {
  const ult = (s: string) =>
    semAcento(s)
      .replace(/[^a-z ]/g, ' ')
      .trim()
      .split(/\s+/)
      .pop() ?? '';
  const ua = ult(a);
  const ub = ult(b);
  return ua.length >= 3 && ua === ub;
}
