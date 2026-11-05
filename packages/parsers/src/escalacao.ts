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
/** "### GOLEIRO esquerda <texto>": leitura extra do canto do gol (recorte ampliado) */
export const MARCA_GOLEIRO = '### GOLEIRO';
/** "### CAMISA esquerda #rrggbb [#rrggbb]": cores da camisa desenhada abaixo da formação */
export const MARCA_CAMISA = '### CAMISA';

/**
 * Nome do goleiro no texto do recorte ("Mycael/ 33", "À - L. Jardim"): o melhor nome que não é
 * de um jogador já lido (o recorte pega pedaços dos defensores ao lado: "Renan", "Pereira").
 */
function goleiroDoCanto(textos: string[], jaLidos: string[]): string | undefined {
  let melhor: string | undefined;
  for (const t of textos) {
    const limpo = t
      .replace(/([A-ZÀ-Ú]\.)(?=[A-ZÀ-Ú])/g, '$1 ')
      .replace(/[^A-Za-zÀ-ú. ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const nome = nomeDeJogador(limpo);
    if (
      nome &&
      nome.replace(/[^A-Za-zÀ-ú]/g, '').length >= 4 &&
      // jogador já lido, ou pedaço do nome de um time ("Athl." do cabeçalho)
      !jaLidos.some(
        (j) =>
          mesmoJogador(j, nome) ||
          semAcento(j)
            .replace(/[^a-z]/g, '')
            .startsWith(semAcento(nome).replace(/[^a-z]/g, '')),
      ) &&
      (!melhor || qualidade(nome) > qualidade(melhor))
    )
      melhor = nome;
  }
  return melhor;
}

export type StatusEscalacao = 'provavel' | 'confirmada';

export interface LadoEscalacao {
  titulares: string[];
  reservas: string[];
  formacao?: string;
  tecnico?: string;
  /**
   * onde cada titular está no print, em % do campo inteiro deitado (x: 0 = gol do mandante,
   * 100 = gol do visitante; y: 0 = lateral de cima): o campo do site repete o desenho do print
   */
  posicoes?: { nome: string; x: number; y: number }[];
  /** cores da camisa no print, quando ele mostra a camisa */
  cores?: { cor1: string; cor2?: string };
}

/**
 * Colunas do campo: jogadores a menos de 50 milésimos um do outro na distância do meio são a
 * mesma fileira (no SofaScore as fileiras ficam ~100 apart; o lixo do OCR no fim do nome, como
 * "Aquirre Q", desloca o centro da linha em ~40). Devolve, para cada jogador, a distância média
 * da coluna dele, e a formação (do gol para frente, sem o goleiro; só com os 10 de linha).
 */
function colunasDoCampo(dist: number[]): {
  alinhada: number[];
  formacao?: string;
  /** índice do goleiro: sozinho atrás de uma linha de 3+ (só "o mais fundo" não basta: a
   * defesa inteira pode estar na mesma coluna) */
  goleiro?: number;
} {
  const ordem = dist.map((d, i) => ({ d, i })).sort((p, q) => q.d - p.d);
  const grupos: { d: number; i: number }[][] = [];
  let ultimo = Infinity;
  for (const o of ordem) {
    if (ultimo - o.d > 50) grupos.push([]);
    grupos[grupos.length - 1].push(o);
    ultimo = o.d;
  }
  const alinhada = [...dist];
  for (const g of grupos) {
    const media = g.reduce((a, o) => a + o.d, 0) / g.length;
    for (const o of g) alinhada[o.i] = media;
  }
  const linha = grupos.map((g) => g.length);
  const temGoleiro = linha[0] === 1 && (linha[1] ?? 0) >= 3;
  if (temGoleiro) linha.shift();
  const formacao =
    linha.reduce((a, n) => a + n, 0) === 10 && linha.length >= 3 && linha.length <= 5
      ? linha.join('-')
      : undefined;
  return { alinhada, formacao, goleiro: temGoleiro ? grupos[0][0].i : undefined };
}

const formacaoValida = (f?: string) =>
  !!f && f.split('-').reduce((a, n) => a + Number(n), 0) === 10;

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
    // "0'Dowda": o OCR troca o O do apóstrofo por zero (e às vezes dobra o apóstrofo)
    .replace(/(^|\s)0(?=['’]+[A-Z])/g, '$1O')
    .replace(/['’]{2,}/g, "'")
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
    posicoes: a.posicoes ?? b.posicoes,
    cores: a.cores ?? b.cores,
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

/** Distância de edição (para "Ney" × "Nagy", "Gomez" × "Gómez"). */
function distanciaEdicao(a: string, b: string): number {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++)
      atual[j] = Math.min(
        ant[j] + 1,
        atual[j - 1] + 1,
        ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    ant = atual;
  }
  return ant[b.length];
}

/** Dois nomes lidos a menos disto (milésimos da imagem) podem ser o mesmo jogador. */
const PERTO_NO_CAMPO = 80;

/**
 * As duas leituras da imagem podem deslocar o mesmo nome (o selo da nota entra na caixa da
 * linha: "M. Gómez" e "M. Gomez", "A. Nagy" e "BA Ney"). Perto no campo e com sobrenome parecido
 * é a mesma pessoa, fica o nome mais limpo. Se ainda passar de 11, junta o par mais próximo.
 */
function fundirLeiturasRepetidas<T extends { nome: string; a: number; b: number }>(xs: T[]): T[] {
  const r = [...xs];
  const sobrenome = (n: string) =>
    semAcento(n)
      .replace(/[^a-z ]/g, ' ')
      .trim()
      .split(/\s+/)
      .pop() ?? '';
  const longe = (p: T, q: T) => Math.hypot(p.a - q.a, p.b - q.b);
  const tirarPior = (i: number, j: number) => {
    if (qualidade(r[j].nome) > qualidade(r[i].nome)) r[i] = r[j];
    r.splice(j, 1);
  };
  for (let i = 0; i < r.length; i++)
    for (let j = r.length - 1; j > i; j--) {
      const [si, sj] = [sobrenome(r[i].nome), sobrenome(r[j].nome)];
      const parecido = Math.min(si.length, sj.length) >= 3 && distanciaEdicao(si, sj) <= 2;
      if (parecido && longe(r[i], r[j]) < PERTO_NO_CAMPO) tirarPior(i, j);
    }
  while (r.length > 11) {
    let par: [number, number] | null = null;
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++)
        if (!par || longe(r[i], r[j]) < longe(r[par[0]], r[par[1]])) par = [i, j];
    if (!par || longe(r[par[0]], r[par[1]]) >= PERTO_NO_CAMPO) break;
    tirarPior(par[0], par[1]);
  }
  return r;
}

/**
 * Formato com posição ("@x,y texto", milésimos da imagem) e as candidatas a linha do meio de
 * campo achadas na imagem (vale a que divide os nomes ao meio). Campo em pé (meio em y):
 * mandante em cima. Deitado (meio em x): à esquerda. O campo é simétrico: vai do meio até o
 * goleiro de cada lado; o que passar disso (placar, abas, "Técnicos") fica de fora.
 */
function lerPorPosicao(linhas: string[], jogo: NomesTimes): LeituraEscalacao {
  const avisos: string[] = [];
  const doCanto = (lado: string) =>
    linhas
      .filter((l) => l.startsWith(`${MARCA_GOLEIRO} ${lado} `))
      .map((l) => l.slice(MARCA_GOLEIRO.length + lado.length + 2));
  const goleiros = { esquerda: doCanto('esquerda'), direita: doCanto('direita') };
  const camisaDo = (l: 'esquerda' | 'direita') => {
    const c = linhas.find((x) => x.startsWith(`${MARCA_CAMISA} ${l} `))?.split(' ');
    return c ? { cor1: c[3], ...(c[4] ? { cor2: c[4] } : {}) } : undefined;
  };
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
      // "N.Ferrares" → "N. Ferrares"; "19B.Duarte" (camisa grudada na inicial) → "19 B. Duarte"
      const nome = nomeDeJogador(
        trecho
          .replace(/^(\d{1,2})(?=[A-ZÀ-Ú]\.)/, '$1 ')
          .replace(/([A-ZÀ-Ú]\.)(?=[A-ZÀ-Ú])/g, '$1 '),
      );
      if (!nome) continue;
      const xi = x + (k - (trechos.length - 1) / 2) * 60;
      // duas leituras da mesma imagem: o mesmo lugar é o mesmo jogador; fica o nome mais limpo
      const igual = nomes.findIndex((i) => Math.abs(i.y - y) < 20 && Math.abs(i.x - xi) < 45);
      if (igual < 0) nomes.push({ nome, x: xi, y });
      else if (qualidade(nome) > qualidade(nomes[igual].nome)) nomes[igual] = { nome, x: xi, y };
    }
  }
  // campo deitado (SofaScore): as duas formações ("3-4-2-1   4-2-3-1") ficam lado a lado logo
  // acima do campo; o que estiver acima delas é cabeçalho da página (abas, "Hoje", filtros) e
  // atrapalharia a escolha da linha do meio. A mesma faixa tem o nome de cada time: digitado
  // diferente no jogo ("Atlético PR" × "Athletico"), ele viraria jogador
  const ys = formacoes.map((f) => f.y);
  const ladoALado = formacoes.length >= 2 && Math.max(...ys) - Math.min(...ys) < 30;
  if (ladoALado) {
    const topo = Math.max(...ys) + 45;
    nomes.splice(0, nomes.length, ...nomes.filter((i) => i.y > topo));
    for (const c of candidatas) if (c.eixo === 'y' && c.pos <= topo) c.forca = 0;
  }
  // as duas formações ficam centradas na linha do meio: isso vale mais que contar nomes, porque
  // o print da página inteira tem a coluna lateral ("Troféus", "Onde assistir") à esquerda
  const xsForm = formacoes.map((f) => f.x);
  const meioForm = ladoALado ? (Math.min(...xsForm) + Math.max(...xsForm)) / 2 : null;
  const pelaFormacao =
    meioForm === null
      ? undefined
      : candidatas
          .filter((c) => c.eixo === 'x' && Math.abs(c.pos - meioForm) < 25)
          .sort((p, q) => Math.abs(p.pos - meioForm) - Math.abs(q.pos - meioForm))[0];
  // a linha do meio é a candidata forte que divide os nomes ao meio (a divisória do cabeçalho
  // deixa quase todos de um lado só)
  const coord = (i: { x: number; y: number }, eixo: 'x' | 'y') => (eixo === 'y' ? i.y : i.x);
  const nota = (c: (typeof candidatas)[number]) => {
    const antes = nomes.filter((i) => coord(i, c.eixo) < c.pos).length;
    return Math.min(antes, nomes.length - antes) * c.forca;
  };
  const melhor =
    pelaFormacao ??
    candidatas.reduce<(typeof candidatas)[number] | undefined>(
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
  // posição no campo do site: profundidade = distância do meio (o mais fundo dos dois times
  // vira a linha do gol), lateral = faixa ocupada pelos jogadores
  const emCampo = itens.filter(noCampo);
  const fundo = Math.max(1, ...emCampo.map((i) => Math.abs(i.a - meio)));
  const bMin = Math.min(...emCampo.map((i) => i.b));
  const bMax = Math.max(...emCampo.map((i) => i.b));
  const lado = (lidos: typeof itens, doGol: 1 | -1, ehAntes: boolean): LadoEscalacao => {
    const xs = fundirLeiturasRepetidas(lidos.filter(noCampo));
    const titulares = cortarExcesso([...new Set(ordenar(xs, doGol))]);
    const doLado = xs.filter(noCampo).filter((i) => titulares.includes(i.nome));
    const dist = doLado.map((i) => Math.abs(i.a - meio));
    const lida = formacoes.find((f) => coord(f, eixo) < meio === ehAntes)?.f;
    const colunas = colunasDoCampo(dist);
    const pelasColunas = colunas.formacao;
    const goleiroLido = colunas.goleiro !== undefined ? doLado[colunas.goleiro].nome : undefined;
    // sem goleiro no campo lido: o do recorte do canto do gol (campo deitado) entra primeiro;
    // se assim passar de 11, o que sobra é lixo curto do OCR ("Ta" perto de um nome)
    const goleiro =
      eixo === 'x' && !goleiroLido
        ? goleiroDoCanto(goleiros[ehAntes ? 'esquerda' : 'direita'], [
            ...nomes.map((i) => i.nome),
            jogo.casa,
            jogo.fora,
          ])
        : undefined;
    const lista = goleiro
      ? cortarExcesso([goleiro, ...titulares])
      : goleiroLido
        ? [goleiroLido, ...titulares.filter((n) => n !== goleiroLido)]
        : titulares;
    return {
      titulares: lista,
      reservas: [],
      // as colunas do print valem mais que o número lido (o OCR troca 3 por 5)
      formacao: pelasColunas ?? (formacaoValida(lida) ? lida : undefined),
      cores: camisaDo(ehAntes ? 'esquerda' : 'direita'),
      posicoes: doLado
        .map((i, k) => {
          // profundidade da coluna (alinhada), não a do centro da linha lida
          const prof = colunas.alinhada[k] / fundo;
          // o goleiro fica no gol; os de linha vão até a entrada da área
          const x = k === colunas.goleiro ? 4 : 50 - 3 - prof * 33;
          return {
            nome: i.nome,
            x: Math.round((ehAntes ? x : 100 - x) * 10) / 10,
            y: Math.round((8 + ((i.b - bMin) / Math.max(1, bMax - bMin)) * 84) * 10) / 10,
          };
        })
        .filter((p) => lista.includes(p.nome))
        .concat(goleiro ? [{ nome: goleiro, x: ehAntes ? 4 : 96, y: 50 }] : []),
    };
  };
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
  // print de campo já traz o time inteiro: somar dois só cria jogadores repetidos; vale o mais
  // perto de 11 × 11 (empate: o primeiro)
  const deCampo = leituras.filter((l) => l.casa.posicoes?.length && l.fora.posicoes?.length);
  if (deCampo.length >= 2) {
    const erro = (l: LeituraEscalacao) =>
      Math.abs(l.casa.titulares.length - 11) + Math.abs(l.fora.titulares.length - 11);
    const melhor = deCampo.reduce((a, b) => (erro(b) < erro(a) ? b : a));
    leituras = [melhor, ...leituras.filter((l) => !deCampo.includes(l))];
  }
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
