/**
 * Leitores de contexto: desfalques (SuperScore, print recortado), classificação (SofaScore,
 * print recortado) e o texto de análise do Flashscore. Tudo vira SUGESTÃO para o usuário;
 * nada disso altera o λ sozinho.
 */
import type { NomesTimes, Time } from '@pe/engine';
import { MARCA_TABELA } from './tabelaOcr';
import { semAcento } from './texto';
import { reconhecerTime, similaridadeTime, tokensDoNome } from './times';

/** Times citados num trecho, pelas palavras marcantes do nome (4+ letras). */
export function timesMencionados(texto: string, jogo: NomesTimes): Time[] {
  const palavras = semAcento(texto)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/);
  const cita = (nome: string) => {
    const marcas = tokensDoNome(nome).filter((t) => t.length >= 4);
    return palavras.some((p) => marcas.some((m) => similaridadeTime(p, m) === 1));
  };
  return (['casa', 'fora'] as const).filter((t) => cita(jogo[t]));
}

// ---------- desfalques ----------

export interface Desfalque {
  time: Time;
  jogador: string;
  situacao?: string;
}

const SITUACOES = /lesionad|suspens|duvid|machucad|contundid|afastad|incert|convocad/;
const TITULO_DESFALQUES = /ausentes|desfalques/;

export function lerDesfalques(
  texto: string,
  jogo: NomesTimes,
): { desfalques: Desfalque[]; avisos: string[] } {
  const desfalques: Desfalque[] = [];
  const avisos: string[] = [];
  let atual: Time | null = null;
  const todas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // print da página inteira: o que vem antes de "Jogadores ausentes" é cabeçalho (placar, abas)
  const iTitulo = todas.findIndex((l) => TITULO_DESFALQUES.test(semAcento(l)));
  for (const bruta of iTitulo >= 0 ? todas.slice(iTitulo) : todas) {
    const t = semAcento(bruta);
    if (/ausentes|possivel 1|desfalques/.test(t)) continue;
    // cabeçalho de time: "Flamengo >" (linha curta com o nome do time)
    const timeLinha = reconhecerTime(bruta.replace(/[>›»]/g, ''), jogo);
    if (
      timeLinha &&
      bruta
        .replace(/[^A-Za-zÀ-ú ]/g, '')
        .trim()
        .split(/\s+/).length <= 3 &&
      /[>›»]|^\S+( \S+)?$/.test(bruta)
    ) {
      atual = timeLinha;
      continue;
    }
    // "Lesionado" / "Duvidoso": situação do jogador de cima, nunca um jogador
    if (SITUACOES.test(t) && bruta.split(/\s+/).length <= 3) {
      if (desfalques.length) desfalques[desfalques.length - 1].situacao = bruta;
      continue;
    }
    // nome: começa na primeira palavra "Maiúscula + 2 letras"; antes disso é lixo (ícones, camisa)
    const partes = bruta.split(/\s+/).map((p) => p.replace(/[^A-Za-zÀ-ú.'-]/g, ''));
    // "Ze Ivaldo": palavra de 2 letras só conta seguida de outro nome
    const ini = partes.findIndex(
      (p, i) =>
        /^[A-ZÀ-Ú][a-zà-ú]{2,}/.test(p) ||
        (/^[A-ZÀ-Ú][a-zà-ú]$/.test(p) && /^[A-ZÀ-Ú][a-zà-ú]{2,}/.test(partes[i + 1] ?? '')),
    );
    const nome =
      ini < 0
        ? ''
        : partes
            .slice(ini)
            .filter((p) => /[A-Za-zÀ-ú]/.test(p))
            .join(' ')
            // letra solta no fim é ícone lido como texto ("Neido O")
            .replace(/(\s+[A-Za-zÀ-ú])+$/, '')
            .trim();
    if (!nome || !/^[A-ZÀ-Ú]/.test(nome)) continue;
    if (!atual) {
      avisos.push(`"${nome}": não sei de qual time é (faltou o cabeçalho do time no print)`);
      continue;
    }
    desfalques.push({ time: atual, jogador: nome });
  }
  return { desfalques, avisos };
}

// ---------- classificação ----------

export type CampoClassificacao =
  'jogos' | 'vitorias' | 'empates' | 'derrotas' | 'gols' | 'saldo' | 'pontos';
export type ResultadoForma = 'V' | 'E' | 'D';

export interface LinhaClassificacao {
  posicao: number;
  time: string;
  jogos?: number;
  vitorias?: number;
  empates?: number;
  derrotas?: number;
  golsPro?: number;
  golsContra?: number;
  saldo?: number;
  pontos?: number;
  /** últimos jogos na ordem do print (esquerda → direita), pela cor dos selos */
  forma?: ResultadoForma[];
  /** zona da tabela (Libertadores, rebaixamento...) com a cor da faixa no print */
  zona?: { nome: string; cor: string };
  /** ilegíveis no print, repostos pela conta (J = V + E + D, Pts = 3V + E, SG = GP − GC) */
  calculados: CampoClassificacao[];
  /** lidos, mas não fecham com as contas: conferir no print */
  conferir: CampoClassificacao[];
  doJogo?: Time;
  bruto: string;
}

/** o que o print deu para uma linha, antes das contas */
interface Lidos {
  J?: number;
  V?: number;
  E?: number;
  D?: number;
  Pts?: number;
  SG?: number;
  /** "64:27", ou "6427" quando os dois-pontos somem */
  gols?: string;
  GP?: number;
  GC?: number;
}

const CAMPOS_TABELA = ['J', 'V', 'E', 'D', 'SG', 'Gols', 'GP', 'GC', 'Pts'];
const ROTULO_CAMPO: Record<CampoClassificacao, string> = {
  jogos: 'J',
  vitorias: 'V',
  empates: 'E',
  derrotas: 'D',
  gols: 'gols',
  saldo: 'saldo',
  pontos: 'pontos',
};

const inteiro = (s: string | undefined) => {
  const t = s?.replace(/\s+/g, '');
  return t && /^[+-]?\d{1,3}$/.test(t) ? Number(t) : undefined;
};

/** "J 32 · V 21 · Forma VEVVV" (depois da MARCA_TABELA) → campo → valor */
function camposDaTabela(extra: string): Map<string, string> {
  const campos = new Map<string, string>();
  for (const parte of extra.split(' · ')) {
    const [k, ...v] = parte.trim().split(/\s+/);
    if (k) campos.set(k, v.join(' '));
  }
  return campos;
}

/** Nome padrão da zona pelo título ou legenda do print; null se não for uma zona conhecida. */
export function nomeDaZona(texto: string): string | null {
  const t = semAcento(texto);
  const previa = /qualifica|preliminar|\bpre\b|pre-|play-?off/.test(t);
  if (/libertadores/.test(t)) return previa ? 'Pré-Libertadores' : 'Libertadores';
  if (/sul.?americana|sudamericana/.test(t)) return 'Sul-Americana';
  if (/champions/.test(t)) return previa ? 'Champions (qualificação)' : 'Champions League';
  if (/conference/.test(t)) return previa ? 'Conference (qualificação)' : 'Conference League';
  if (/liga europa|europa league|uefa europa/.test(t))
    return previa ? 'Liga Europa (qualificação)' : 'Liga Europa';
  if (/rebaix|relegat|descenso|despromo/.test(t))
    return /play-?off/.test(t) ? 'Playoff de rebaixamento' : 'Rebaixamento';
  if (/acesso|promotion|promocao|subida/.test(t))
    return /play-?off/.test(t) ? 'Playoff de acesso' : 'Acesso';
  return null;
}

/**
 * V, E e D que mais concordam com o que foi lido, com J = V + E + D e Pts = 3V + E (pontos
 * pesam mais). Campo que não sai único (duas soluções igualmente boas) fica sem valor.
 */
function fecharCampanha(l: Lidos): Pick<Lidos, 'J' | 'V' | 'E' | 'D' | 'Pts'> {
  let melhor = 0;
  let solucoes: [number, number, number | undefined][] = [];
  for (let v = 0; v <= 60; v++)
    for (let e = 0; e <= 60; e++) {
      const ds = new Set<number | undefined>();
      if (l.D !== undefined) ds.add(l.D);
      if (l.J !== undefined && l.J - v - e >= 0) ds.add(l.J - v - e);
      if (!ds.size) ds.add(undefined);
      for (const d of ds) {
        const s =
          (v === l.V ? 2 : 0) +
          (e === l.E ? 2 : 0) +
          (d !== undefined && d === l.D ? 2 : 0) +
          (d !== undefined && v + e + d === l.J ? 2 : 0) +
          (3 * v + e === l.Pts ? 3 : 0);
        if (s > melhor) [melhor, solucoes] = [s, []];
        if (s && s === melhor) solucoes.push([v, e, d]);
      }
    }
  const unico = (f: (s: [number, number, number | undefined]) => number | undefined) => {
    const vs = new Set(solucoes.map(f));
    const [v] = vs;
    return vs.size === 1 ? v : undefined;
  };
  return {
    V: unico((s) => s[0]),
    E: unico((s) => s[1]),
    D: unico((s) => s[2]),
    J: unico((s) => (s[2] === undefined ? undefined : s[0] + s[1] + s[2])),
    Pts: unico((s) => 3 * s[0] + s[1]),
  };
}

/**
 * Gols pró e contra + saldo. Sem os dois-pontos ("5146") o saldo diz onde partir; saldo sem o
 * sinal ("34" com 32:66) é corrigido pelos gols.
 */
function fecharGols(l: Lidos): {
  golsPro?: number;
  golsContra?: number;
  saldo?: number;
  calculados: CampoClassificacao[];
  conferir: CampoClassificacao[];
} {
  const g = l.gols?.replace(/[\s.,;]+/g, '') ?? '';
  let candidatos: [number, number][] = [];
  let seguro: [number, number] | undefined;
  if (l.GP !== undefined && l.GC !== undefined) seguro = [l.GP, l.GC];
  else if (/^\d{1,3}:\d{1,3}$/.test(g)) seguro = g.split(':').map(Number) as [number, number];
  else if (/^\d{2,6}$/.test(g)) {
    for (let k = 1; k < g.length; k++) {
      const [a, b] = [g.slice(0, k), g.slice(k)];
      if (/^0\d/.test(a) || /^0\d/.test(b) || Number(a) > 199 || Number(b) > 199) continue;
      candidatos.push([Number(a), Number(b)]);
    }
    // sem saldo, só parte sozinho ao meio ("6427" → 64:27)
    if (g.length % 2 === 0) seguro = candidatos.find(([a]) => String(a).length === g.length / 2);
  }
  if (seguro) candidatos = [seguro];
  const sg = l.SG;
  if (sg !== undefined) {
    const certo = candidatos.filter(([a, b]) => a - b === sg);
    if (certo.length === 1)
      return {
        golsPro: certo[0][0],
        golsContra: certo[0][1],
        saldo: sg,
        calculados: [],
        conferir: [],
      };
    const semSinal = candidatos.filter(([a, b]) => a - b === -sg);
    if (semSinal.length === 1)
      return {
        golsPro: semSinal[0][0],
        golsContra: semSinal[0][1],
        saldo: -sg,
        calculados: ['saldo'],
        conferir: [],
      };
    if (!seguro) return { saldo: sg, calculados: [], conferir: g ? ['gols'] : [] };
    return {
      golsPro: seguro[0],
      golsContra: seguro[1],
      saldo: sg,
      calculados: [],
      conferir: ['gols', 'saldo'],
    };
  }
  if (!seguro) return { calculados: [], conferir: g ? ['gols'] : [] };
  return {
    golsPro: seguro[0],
    golsContra: seguro[1],
    saldo: seguro[0] - seguro[1],
    calculados: ['saldo'],
    conferir: [],
  };
}

/**
 * Leitura sem as colunas (texto corrido): J = V + E + D marca as colunas; os pontos valem se
 * baterem com 3V + E; gols e saldo depois de J V E D, em qualquer ordem.
 */
function lerDosTokens(resto: string[]): Lidos {
  const numericos = resto.flatMap((t, i) =>
    /^[+-]?\d{1,3}$/.test(t) ? [{ n: Number(t), i }] : [],
  );
  const nums = numericos.map((x) => x.n);
  const iJ = nums.findIndex(
    (n, i) => i + 3 < nums.length && n > 0 && n === nums[i + 1] + nums[i + 2] + nums[i + 3],
  );
  if (iJ < 0) return nums.length >= 3 ? { Pts: nums[nums.length - 1] } : {};
  const [J, V, E, D] = nums.slice(iJ, iJ + 4);
  const depois = resto.slice(numericos[iJ + 3].i + 1).map((t) => t.replace(/[.,;]+$/, ''));
  const sg = depois.find((t) => /^[+-]\d{1,3}$/.test(t));
  return {
    J,
    V,
    E,
    D,
    Pts: nums.slice(iJ + 4).includes(3 * V + E) ? 3 * V + E : undefined,
    gols: depois.find((t) => /^\d{1,3}:\d{1,3}$|^\d{4}$/.test(t)),
    SG: sg === undefined ? undefined : Number(sg),
  };
}

const rgb = (cor: string) => [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
const distanciaCor = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

export function lerClassificacao(
  texto: string,
  jogo: NomesTimes,
): { linhas: LinhaClassificacao[]; avisos: string[] } {
  const brutas: {
    posicao: number;
    time: string;
    bruto: string;
    tabela?: Lidos;
    tokens: Lidos;
    forma?: ResultadoForma[];
    cor?: string;
  }[] = [];
  /** títulos e legendas de zona; antes = índice da primeira linha da tabela depois deles */
  const zonas: { nome: string; cor?: string; antes: number }[] = [];
  for (const bruto of texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const [cru, extra = ''] = bruto.split(MARCA_TABELA);
    const campos = camposDaTabela(extra);
    if (campos.has('Colunas')) continue;
    const m = /^(\d{1,3})\b\.?\s*(.*)$/.exec(cru);
    const lida = m ? Number(m[1]) : undefined;
    const tokens = (m ? m[2] : cru).split(/\s+/);
    // nome: da primeira palavra de 3+ letras até o primeiro número (escudo lido como "7" ou "£3"
    // antes do nome não corta a linha)
    const nome: string[] = [];
    let fimNome = 0;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^[+-]?\d/.test(tok)) {
        if (nome.length) break;
        continue;
      }
      const limpo = tok.replace(/[^A-Za-zÀ-ú-]/g, '');
      if (limpo.length >= 3 && !/^[A-Z]{2,3}$/.test(limpo)) {
        nome.push(limpo);
        fimNome = i + 1;
      }
    }
    if (!nome.length) continue;
    const doTexto = lerDosTokens(tokens.slice(fimNome));
    const temTabela = CAMPOS_TABELA.some((k) => campos.has(k));
    // título de zona ("Taça Sul Americana", "Rebaixamento") ou legenda (Flashscore): sem números
    if (!temTabela && !Object.keys(doTexto).length) {
      const zona = nomeDaZona(cru) ?? (campos.has('Zona') && !m ? nome.join(' ') : null);
      if (zona) zonas.push({ nome: zona, cor: campos.get('Zona'), antes: brutas.length });
      continue;
    }
    // posição: a lida, se seguir a sequência (pode pular linhas perdidas no OCR); senão a
    // seguinte à anterior (OCR "171" no 11, "4" no 14, linha sem número)
    const anterior = brutas[brutas.length - 1]?.posicao ?? 0;
    const posicao =
      lida !== undefined && lida > anterior && lida <= anterior + 3 ? lida : anterior + 1;
    if (posicao < 1 || posicao > 30) continue;
    const forma = campos.get('Forma');
    brutas.push({
      posicao,
      time: nome.join(' '),
      bruto: cru,
      tabela: temTabela
        ? {
            J: inteiro(campos.get('J')),
            V: inteiro(campos.get('V')),
            E: inteiro(campos.get('E')),
            D: inteiro(campos.get('D')),
            Pts: inteiro(campos.get('Pts')),
            SG: inteiro(campos.get('SG')),
            gols: campos.get('Gols'),
            GP: inteiro(campos.get('GP')),
            GC: inteiro(campos.get('GC')),
          }
        : undefined,
      tokens: doTexto,
      forma: forma && /^[VED]{3,}$/.test(forma) ? (forma.split('') as ResultadoForma[]) : undefined,
      cor: campos.get('Zona'),
    });
  }

  // colunas lidas uma a uma só valem se as contas fecharem na maioria das linhas completas
  // (cabeçalho trocado daria colunas trocadas): senão, a leitura do texto corrido
  const completas = brutas.flatMap((b) => {
    const t = b.tabela;
    return t && [t.J, t.V, t.E, t.D, t.Pts].every((v) => v !== undefined)
      ? [t as Required<Lidos>]
      : [];
  });
  const fecham = completas.filter((t) => t.J === t.V + t.E + t.D && t.Pts === 3 * t.V + t.E);
  const colunasValem = completas.length < 3 || fecham.length >= completas.length * 0.4;

  const linhas: LinhaClassificacao[] = brutas.map((b) => {
    const lido = b.tabela && colunasValem ? b.tabela : b.tokens;
    const c = fecharCampanha(lido);
    const g = fecharGols(lido);
    const calculados: CampoClassificacao[] = [...g.calculados];
    const conferir: CampoClassificacao[] = [...g.conferir];
    const valor = (k: 'J' | 'V' | 'E' | 'D' | 'Pts', campo: CampoClassificacao) => {
      if (c[k] === undefined) {
        // sem solução única: fica o lido, para conferir
        if (lido[k] !== undefined) conferir.push(campo);
        return lido[k];
      }
      if (c[k] !== lido[k]) calculados.push(campo);
      return c[k];
    };
    return {
      posicao: b.posicao,
      time: b.time,
      jogos: valor('J', 'jogos'),
      vitorias: valor('V', 'vitorias'),
      empates: valor('E', 'empates'),
      derrotas: valor('D', 'derrotas'),
      golsPro: g.golsPro,
      golsContra: g.golsContra,
      saldo: g.saldo,
      pontos: valor('Pts', 'pontos'),
      forma: b.forma,
      calculados,
      conferir,
      doJogo: reconhecerTime(b.time, jogo) ?? undefined,
      bruto: b.bruto,
    };
  });

  // zona pela cor da faixa: o título de zona sem cor própria (a faixa começa logo abaixo
  // dele) fica com a cor da primeira linha da zona; vale o título mais perto acima da linha
  for (const z of zonas) z.cor ??= brutas[z.antes]?.cor;
  brutas.forEach((b, k) => {
    const cor = b.cor;
    if (!cor) return;
    const mesmaCor = zonas.filter((z) => z.cor && distanciaCor(z.cor, cor) < 60);
    const z = mesmaCor.filter((x) => x.antes <= k).pop() ?? mesmaCor.find((x) => x.antes > k);
    linhas[k].zona = { nome: z?.nome ?? '', cor };
  });

  const avisos: string[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const a = linhas[i - 1].pontos;
    const b = linhas[i].pontos;
    if (a !== undefined && b !== undefined && b > a)
      avisos.push(`pontos fora de ordem perto de "${linhas[i].time}" (${b} > ${a}): conferir`);
  }
  const lista = (cs: CampoClassificacao[]) => cs.map((c) => ROTULO_CAMPO[c]).join(', ');
  for (const l of linhas.filter((x) => x.doJogo)) {
    if (l.calculados.length)
      avisos.push(
        `${l.time}: ${lista(l.calculados)} ilegível no print, saiu da conta (J = V + E + D, Pts = 3V + E, SG = GP − GC)`,
      );
    if (l.conferir.length)
      avisos.push(`${l.time}: ${lista(l.conferir)} não fecha com as contas: conferir no print`);
  }
  if (!linhas.some((l) => l.doJogo))
    avisos.push('os times do jogo não foram encontrados na tabela');
  return { linhas, avisos };
}

// ---------- texto do Flashscore ----------

export type CategoriaTrecho = 'desfalques' | 'casa_fora' | 'h2h' | 'forma' | 'destaque' | 'geral';

export interface Trecho {
  categoria: CategoriaTrecho;
  time?: Time;
  texto: string;
}

export interface Campanha {
  time: Time;
  local: 'casa' | 'fora';
  jogos?: number;
  pontos?: number;
  vitorias?: number;
  empates?: number;
  derrotas?: number;
  trecho: string;
}

export interface LeituraFlashscore {
  trechos: Trecho[];
  campanhas: Campanha[];
}

const NUMEROS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  nenhuma: 0,
};
const numero = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMEROS[semAcento(s)]);

function categoriaDoTitulo(t: string): CategoriaTrecho | null {
  if (/duelo|confronto|retrospecto|h2h/.test(t)) return 'h2h';
  if (/ausente|desfalque|jogadores/.test(t)) return 'desfalques';
  if (/estatistica|destaque/.test(t)) return 'destaque';
  if (/forma|noticia/.test(t)) return 'forma';
  return null;
}

function categoriaDaFrase(t: string, padrao: CategoriaTrecho): CategoriaTrecho {
  if (/desfalque|lesionad|lesao|fora por|se recupera|suspens|duvida|fratura|vetad/.test(t))
    return 'desfalques';
  if (/mandante|em casa|fora de casa|como visitante|no maracana|seus dominios/.test(t))
    return 'casa_fora';
  if (/confrontos?|encontros|retrospecto|diante d[oa]|contra o /.test(t) && padrao !== 'destaque')
    return 'h2h';
  return padrao;
}

export function lerTextoFlashscore(texto: string, jogo: NomesTimes): LeituraFlashscore {
  const trechos: Trecho[] = [];
  const campanhas: Campanha[] = [];
  let categoria: CategoriaTrecho = 'geral';

  for (const paragrafo of texto
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const tp = semAcento(paragrafo);
    // título de seção: linha curta sem ponto final
    if (paragrafo.length < 80 && !/[.!?]$/.test(paragrafo)) {
      categoria = categoriaDoTitulo(tp) ?? categoria;
      continue;
    }
    let timeDoParagrafo: Time | undefined;
    const frases = paragrafo.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú"“])/);
    for (const frase of frases) {
      const t = semAcento(frase);
      const citados = timesMencionados(frase, jogo);
      if (citados.length === 1) timeDoParagrafo = citados[0];
      const time =
        citados.length === 1 ? citados[0] : citados.length === 0 ? timeDoParagrafo : undefined;
      const cat = categoriaDaFrase(t, categoria);
      trechos.push({ categoria: cat, time, texto: frase });

      if (cat === 'casa_fora' && time) {
        const ved =
          /(\d+|\w+) vitorias?,\s*(\d+|\w+) empates? e (?:apenas )?(\d+|\w+) derrotas?/.exec(t);
        const pts = /(\d+) pontos/.exec(t);
        const jogos = /(\d+) jogos/.exec(t);
        if (ved || pts) {
          campanhas.push({
            time,
            local: /fora de casa|visitante/.test(t) ? 'fora' : 'casa',
            jogos: jogos ? Number(jogos[1]) : undefined,
            pontos: pts ? Number(pts[1]) : undefined,
            vitorias: ved ? numero(ved[1]) : undefined,
            empates: ved ? numero(ved[2]) : undefined,
            derrotas: ved ? numero(ved[3]) : undefined,
            trecho: frase,
          });
        }
      }
    }
  }
  return { trechos, campanhas };
}

// ---------- impacto dos desfalques (sugestão automática) ----------

export type NivelImpacto = 'nenhum' | 'medio' | 'alto';

export interface ImpactoSugerido {
  nivel: NivelImpacto;
  importantes: string[];
  motivo: string;
}

const IMPORTANTE =
  /principa|artilheir|destaque|lider|titular|melhor|importante|craque|camisa 10|capitao/;

/**
 * Só sobe o impacto com evidência no texto: um jogador ausente citado pelo Flashscore como
 * principal/artilheiro/destaque/titular. Sem evidência → nenhum (o modelo fica perto do mercado).
 */
export function avaliarImpactoDesfalques(
  desfalques: Desfalque[],
  flash: LeituraFlashscore | null,
  time: Time,
): ImpactoSugerido {
  const doTime = desfalques.filter((d) => d.time === time);
  if (!doTime.length)
    return { nivel: 'nenhum', importantes: [], motivo: 'nenhum desfalque informado' };
  const frases = (flash?.trechos ?? []).filter((t) => IMPORTANTE.test(semAcento(t.texto)));
  const importantes = doTime
    .filter((d) => {
      const sobrenomes = semAcento(d.jogador)
        .split(/\s+/)
        .filter((p) => p.length >= 4);
      return frases.some((f) => sobrenomes.some((s) => semAcento(f.texto).includes(s)));
    })
    .map((d) => d.jogador);
  if (!importantes.length) {
    return {
      nivel: 'nenhum',
      importantes,
      motivo: `${doTime.length} desfalque(s), nenhum citado como peça importante no texto do Flashscore: sem ajuste (conservador)`,
    };
  }
  return {
    nivel: importantes.length >= 2 ? 'alto' : 'medio',
    importantes,
    motivo: `citado(s) como peça importante no Flashscore: ${importantes.join(', ')}`,
  };
}
