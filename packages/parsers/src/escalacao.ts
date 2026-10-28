/**
 * Leitor de escalações (Flashscore, SuperScore, SofaScore → aba Escalações). O OCR guarda a
 * posição de cada nome e a linha do meio de campo: campo deitado → esquerda = mandante;
 * campo em pé → em cima = mandante. Prints antigos (duas metades, "### ESQUERDA" /
 * "### DIREITA") continuam lidos. Só nomes de jogadores; nada vira número.
 */
import type { NomesTimes, Time } from '@pe/engine';
import { semAcento } from './texto';
import { similaridadeTime, tokensDoNome } from './times';

export const MARCA_ESQUERDA = '### ESQUERDA';
export const MARCA_DIREITA = '### DIREITA';
/** formato atual do OCR: linhas "@x,y texto" + "### MEIO <x|y> <milésimos>" */
export const MARCA_POSICOES = '### POSICOES';
export const MARCA_MEIO = '### MEIO';

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
  /^(escala\w*|provav\w*|confirmad\w*|substitut\w*|reservas?|banco|treinador|tecnico|formac\w*|ausentes?|lesionad\w*|suspens\w*|duvida|nota|media|campo|lista|mostrar|ver|mais|jogadores?|titulares?|gol(eiro)?|defensor|meio|atacante|minutos?|sofascore|valor|mercado|idade|altura|camisa|capitao|desconhecido|motivo|lesao|outro|prevista|previstas?|atualizad\w*|equipe|time|partida|jogo|sub|min|eles|este|esta|ele|ela|que|com|para)$/;

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
    // "15V." / "22H.": número da camisa grudado na inicial
    const limpo = t
      .replace(/^\d+(?=[A-ZÀ-Ú])/, '')
      .replace(/^[.,;:'-]+|[,;:'-]+$/g, '')
      .replace(/(\.{2,}|…)$/, '')
      // "Mathea." (reticências lidas como um ponto só): palavra de 4+ letras não é abreviação
      .replace(/^([A-Za-zÀ-ú]{4,})\.$/, '$1');
    if (!limpo) continue;
    // abreviação ("G.", "Bu.") ou palavra com letra maiúscula + 2 letras ou mais
    const inicial = /^[A-ZÀ-Ú][a-zà-ú]{0,2}\.$/.test(limpo);
    // toda em maiúsculas com 4+ letras é marca/interface ("FLASHSCORE"), não jogador
    const palavra =
      /^[A-ZÀ-Ú][a-zà-úA-ZÀ-Ú'’-]{1,}$/.test(limpo) &&
      !/\d/.test(limpo) &&
      !/^[A-ZÀ-Ú]{4,}$/.test(limpo);
    const particula = partes.length > 0 && /^(de|da|do|dos|das|di|van|von|el|al)$/i.test(limpo);
    if (inicial || palavra || particula) {
      if (palavra && INTERFACE.test(semAcento(limpo))) continue;
      partes.push(limpo);
    } else if (partes.length) {
      break; // o nome acabou (veio número, nota ou lixo)
    }
  }
  // no fim: partícula solta ou pedaço de até 2 letras sem ponto ("Tiquinho Er", "Alan La")
  while (
    partes.length > 1 &&
    (/^(de|da|do|dos|das|di|van|von|el|al)$/i.test(partes[partes.length - 1]) ||
      /^[A-Za-zÀ-ú]{1,2}$/.test(partes[partes.length - 1]))
  )
    partes.pop();
  const nome = partes.join(' ');
  const letras = nome.replace(/[^A-Za-zÀ-ú]/g, '');
  if (letras.length < 3) return null;
  // só pedaços curtos ("Ne Be Ao") é ícone lido como texto
  if (!partes.some((p) => p.replace(/[^A-Za-zÀ-ú]/g, '').length >= 3)) return null;
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
  if (linhas[0] === MARCA_POSICOES) return lerPorPosicao(linhas, jogo);
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

function statusDoTexto(texto: string): StatusEscalacao | undefined {
  const t = semAcento(texto);
  return /provav|possive/.test(t) ? 'provavel' : /confirmad/.test(t) ? 'confirmada' : undefined;
}

/** Mais de 11: o que sobra costuma ser lixo de selo/nota ("Lio 6.9"), palavra solta curta. */
function cortarExcesso(nomes: string[]): string[] {
  const curto = (n: string) => !n.includes(' ') && n.replace(/[^A-Za-zÀ-ú]/g, '').length <= 3;
  const r = [...nomes];
  while (r.length > 11 && r.some(curto)) r.splice(r.findIndex(curto), 1);
  return r;
}

/** Nome mais limpo: palavras de 3+ letras e abreviações contam; pedaço curto solto desconta. */
function qualidade(nome: string): number {
  return nome
    .split(' ')
    .reduce(
      (s, p) =>
        s +
        (/^[A-ZÀ-Ú][a-zà-ú]{0,2}\.$/.test(p) || p.replace(/\W/g, '').length >= 3 ? p.length : -4),
      0,
    );
}

/**
 * Formato com posição ("@x,y texto", milésimos da imagem) e as candidatas a linha do meio de
 * campo achadas na imagem (vale a que divide os nomes ao meio). Campo em pé (meio em y):
 * mandante em cima. Deitado (meio em x): à esquerda. O campo é simétrico: vai do meio até o
 * goleiro de cada lado; o que passar disso (placar, abas, "Técnicos") fica de fora.
 */
function lerPorPosicao(linhas: string[], jogo: NomesTimes): LeituraEscalacao {
  const avisos: string[] = [];
  const candidatas = linhas
    .filter((l) => l.startsWith(MARCA_MEIO))
    .map((l) => {
      const [, , eixo, pos, forca] = l.split(' ');
      return {
        eixo: eixo === 'y' ? ('y' as const) : ('x' as const),
        pos: Number(pos),
        forca: Number(forca ?? 1),
      };
    });
  const nomes: { nome: string; x: number; y: number }[] = [];
  const formacoes: { f: string; x: number; y: number }[] = [];
  for (const l of linhas) {
    const p = /^@(\d+),(\d+) (.*)$/.exec(l);
    if (!p) continue;
    const [x, y, texto] = [Number(p[1]), Number(p[2]), p[3]];
    const f = RE_FORMACAO.exec(texto);
    if (f) formacoes.push({ f: f.slice(1).filter(Boolean).join('-'), x, y });
    if (citaTime(texto, jogo.casa) || citaTime(texto, jogo.fora)) continue;
    // "15 Vitor Bu. 19 Gabriel...": dois jogadores numa linha (o site já separa pela posição
    // das palavras; isto cobre prints antigos); o segundo fica um pouco à direita
    const trechos = texto.split(/\s(?=\d{1,2}\s+[A-ZÀ-Ú])/);
    for (const [k, trecho] of trechos.entries()) {
      // "N.Ferrares" → "N. Ferrares"
      const nome = nomeDeJogador(trecho.replace(/\b([A-ZÀ-Ú]\.)(?=[A-ZÀ-Ú])/g, '$1 '));
      if (!nome) continue;
      const xi = x + (k - (trechos.length - 1) / 2) * 60;
      // duas leituras da mesma imagem: o mesmo lugar é o mesmo jogador; fica o nome mais limpo
      const igual = nomes.findIndex((i) => Math.abs(i.y - y) < 20 && Math.abs(i.x - xi) < 45);
      if (igual < 0) nomes.push({ nome, x: xi, y });
      else if (qualidade(nome) > qualidade(nomes[igual].nome)) nomes[igual] = { nome, x: xi, y };
    }
  }
  // a linha do meio é a candidata forte que divide os nomes ao meio (a divisória do cabeçalho
  // deixa quase todos de um lado só)
  const coord = (i: { x: number; y: number }, eixo: 'x' | 'y') => (eixo === 'y' ? i.y : i.x);
  const nota = (c: (typeof candidatas)[number]) => {
    const antes = nomes.filter((i) => coord(i, c.eixo) < c.pos).length;
    return Math.min(antes, nomes.length - antes) * c.forca;
  };
  const melhor = candidatas.reduce<(typeof candidatas)[number] | undefined>(
    (a, c) => (!a || nota(c) > nota(a) ? c : a),
    undefined,
  );
  if (!melhor)
    avisos.push('linha do meio de campo não achada na imagem: times separados pelo centro');
  const eixo = melhor?.eixo ?? 'x';
  const meio = melhor?.pos ?? 500;
  const itens = nomes.map((i) => ({
    nome: i.nome,
    a: coord(i, eixo),
    b: eixo === 'y' ? i.x : i.y,
  }));
  const antes = itens.filter((i) => i.a < meio);
  const depois = itens.filter((i) => i.a >= meio);
  // o campo é simétrico: vai do meio até o goleiro de cada lado; o que passar disso fica fora
  const alcance =
    antes.length && depois.length
      ? Math.min(
          meio - Math.min(...antes.map((i) => i.a)),
          Math.max(...depois.map((i) => i.a)) - meio,
        ) + 50
      : 1000;
  const noCampo = (i: { a: number }) => Math.abs(i.a - meio) <= alcance;
  // ordem: do goleiro para frente, fileira por fileira
  const ordenar = (xs: typeof itens, doGol: 1 | -1) =>
    xs
      .filter(noCampo)
      .sort((p, q) => (Math.abs(p.a - q.a) > 15 ? doGol * (p.a - q.a) : p.b - q.b))
      .map((i) => i.nome);
  const lado = (xs: typeof itens, doGol: 1 | -1, ehAntes: boolean): LadoEscalacao => ({
    titulares: cortarExcesso([...new Set(ordenar(xs, doGol))]),
    reservas: [],
    formacao: formacoes.find((f) => coord(f, eixo) < meio === ehAntes)?.f,
  });
  return {
    casa: lado(antes, 1, true),
    fora: lado(depois, -1, false),
    status: statusDoTexto(linhas.join(' ')),
    ladosInvertidos: false,
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
