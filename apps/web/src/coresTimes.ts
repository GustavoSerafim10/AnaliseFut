/**
 * Cores de cada time no topo da análise. Ordem: a sua escolha (salva por time) → escudo colado →
 * tabela de clubes → camisa lida no print da escalação → cor neutra com aviso para escolher.
 * A tabela só vale contra o escudo se combinar com ele (nome parecido não é o mesmo clube:
 * Botafogo × Botafogo-SP), e aí fica ela, que tem as listras e a 2ª cor certas.
 */
import { useSyncExternalStore } from 'react';
import { semAcento, tokensDoNome } from '@pe/parsers';

export type Padrao = 'liso' | 'listras' | 'faixa';
export type OrigemCor = 'manual' | 'escudo' | 'tabela' | 'print' | 'neutra';

export interface CoresTime {
  cor1: string;
  cor2: string;
  padrao: Padrao;
  origem: OrigemCor;
}

type Entrada = [string, string, Padrao?];

const P = '#0b0b0d';
const B = '#f8fafc';

/** chave = palavras do nome (sem acento). Vale a chave mais longa contida no nome do time. */
const CLUBES: Record<string, Entrada> = {
  // Brasil
  flamengo: ['#d0101c', P, 'listras'],
  palmeiras: ['#006437', B],
  corinthians: [P, B],
  'sao paulo': ['#d0101c', P, 'faixa'],
  santos: [B, P],
  vasco: [P, B, 'faixa'],
  botafogo: [P, B, 'listras'],
  fluminense: ['#870a28', '#00613c', 'listras'],
  gremio: ['#0d80bf', P, 'listras'],
  internacional: ['#d0101c', B],
  'atletico mg': [P, B, 'listras'],
  'atletico mineiro': [P, B, 'listras'],
  cruzeiro: ['#0a3a92', B],
  athletico: ['#d0101c', P, 'listras'],
  'atletico pr': ['#d0101c', P, 'listras'],
  'atletico paranaense': ['#d0101c', P, 'listras'],
  bahia: ['#0060ae', '#d0101c', 'faixa'],
  fortaleza: ['#0d3b8c', '#d0101c', 'listras'],
  ceara: [P, B, 'listras'],
  sport: ['#d0101c', P, 'listras'],
  vitoria: ['#d0101c', P, 'listras'],
  bragantino: [B, '#d0101c'],
  juventude: ['#00783e', B, 'listras'],
  mirassol: ['#f7d417', '#00783e'],
  remo: ['#0a2a66', B],
  paysandu: ['#0b7fc4', B, 'listras'],
  coritiba: ['#00643c', B],
  goias: ['#00783e', B],
  'atletico go': ['#d0101c', P, 'listras'],
  'atletico goianiense': ['#d0101c', P, 'listras'],
  cuiaba: ['#00783e', '#f7d417'],
  criciuma: ['#f7d417', P, 'listras'],
  'america mg': ['#00783e', P],
  avai: ['#0060ae', B, 'listras'],
  chapecoense: ['#00843d', B],
  figueirense: [P, B, 'listras'],
  'ponte preta': [P, B, 'listras'],
  guarani: ['#00783e', B],
  novorizontino: ['#f7d417', P],
  'vila nova': ['#d0101c', B],
  nautico: ['#d0101c', B, 'listras'],
  'santa cruz': ['#d0101c', P, 'listras'],
  'botafogo sp': ['#d0101c', P, 'listras'],
  'botafogo pb': [P, B, 'listras'],
  londrina: ['#2595d1', B],
  operario: [P, B, 'listras'],
  crb: ['#d0101c', B, 'listras'],
  csa: ['#0a3a92', B],
  abc: [P, B],
  'america rn': ['#d0101c', B],
  athletic: [P, B],
  'volta redonda': ['#f7d417', P],
  ferroviaria: ['#7b1e2b', B],
  amazonas: ['#f7d417', P],
  ituano: ['#d0101c', P, 'listras'],
  tombense: ['#d0101c', B],
  'sampaio correa': ['#f7d417', '#d0101c'],
  brusque: ['#f7d417', '#00783e'],
  ypiranga: ['#f7d417', P],
  confianca: ['#0060ae', B],
  'sao bernardo': ['#f7d417', P],
  caxias: ['#7b1e2b', B],
  // Inglaterra
  arsenal: ['#ef0107', B],
  'aston villa': ['#670e36', '#95bfe5'],
  bournemouth: ['#d0101c', P, 'listras'],
  brentford: ['#d0101c', B, 'listras'],
  brighton: ['#0057b8', B, 'listras'],
  burnley: ['#6c1d45', '#99d6ea'],
  chelsea: ['#034694', B],
  'crystal palace': ['#1b458f', '#c4122e', 'listras'],
  everton: ['#003399', B],
  fulham: [B, P],
  leeds: [B, '#1d428a'],
  leicester: ['#003090', B],
  liverpool: ['#c8102e', B],
  'manchester city': ['#6cabdd', B],
  'manchester united': ['#da291c', P],
  newcastle: [P, B, 'listras'],
  'nottingham forest': ['#dd0000', B],
  sunderland: ['#eb172b', B, 'listras'],
  tottenham: [B, '#132257'],
  'west ham': ['#7a263a', '#1bb1e7'],
  wolverhampton: ['#fdb913', P],
  wolves: ['#fdb913', P],
  // Espanha
  'real madrid': [B, '#febe10'],
  barcelona: ['#a50044', '#004d98', 'listras'],
  'atletico madrid': ['#cb3524', B, 'listras'],
  sevilla: [B, '#d0101c'],
  betis: ['#00954c', B, 'listras'],
  'real sociedad': ['#0067b1', B, 'listras'],
  villarreal: ['#ffe667', '#005187'],
  valencia: [B, '#ee7f1a'],
  'athletic bilbao': ['#ee2523', B, 'listras'],
  celta: ['#8ac3ee', '#d0101c'],
  girona: ['#d0101c', B, 'listras'],
  osasuna: ['#d0101c', '#0a346f'],
  getafe: ['#005999', B],
  mallorca: ['#d0101c', P],
  espanyol: ['#007fc8', B, 'listras'],
  // Itália
  milan: ['#e30613', P, 'listras'],
  'inter milan': ['#0068a8', P, 'listras'],
  inter: ['#0068a8', P, 'listras'],
  internazionale: ['#0068a8', P, 'listras'],
  juventus: [B, P, 'listras'],
  napoli: ['#12a0d7', B],
  roma: ['#8e1f2f', '#f0bc42'],
  lazio: ['#87d8f7', B],
  atalanta: ['#1e71b8', P, 'listras'],
  fiorentina: ['#482e92', B],
  bologna: ['#a21c26', '#1a2f48', 'listras'],
  torino: ['#8a1e03', B],
  genoa: ['#ad0b21', '#001d4a'],
  lecce: ['#f7d417', '#d0101c', 'listras'],
  frosinone: ['#f7d417', '#0060ae'],
  sassuolo: ['#00a650', P, 'listras'],
  udinese: [B, P, 'listras'],
  cagliari: ['#a21c26', '#002350'],
  parma: [B, P],
  como: ['#00387b', B],
  verona: ['#002f6c', '#f7d417'],
  // Alemanha
  bayern: ['#dc052d', B],
  dortmund: ['#fde100', P],
  leverkusen: ['#e32221', P],
  leipzig: [B, '#dd0741'],
  stuttgart: [B, '#e32219'],
  frankfurt: ['#e1000f', P],
  wolfsburg: ['#65b32e', B],
  freiburg: ['#d0101c', P],
  gladbach: [B, P],
  monchengladbach: [B, P],
  'union berlin': ['#eb1923', B],
  hoffenheim: ['#1961b5', B],
  mainz: ['#c3141e', B],
  // França
  psg: ['#004170', '#da291c'],
  'paris saint germain': ['#004170', '#da291c'],
  marseille: [B, '#2faee0'],
  monaco: ['#e2001a', B],
  lyon: [B, '#da001a'],
  lille: ['#e01e13', '#0a2a66'],
  nice: ['#d0101c', P, 'listras'],
  rennes: ['#e13327', P],
  lens: ['#d0101c', '#f7d417'],
  // Portugal, Holanda, Bélgica
  benfica: ['#e30613', B],
  porto: ['#00428c', B, 'listras'],
  sporting: ['#00793f', B, 'listras'],
  braga: ['#d0101c', B],
  ajax: [B, '#d2122e', 'faixa'],
  psv: ['#e30613', B, 'listras'],
  feyenoord: ['#d0101c', B],
  'az alkmaar': ['#d0101c', B],
  brugge: ['#0a4ea2', P, 'listras'],
  anderlecht: ['#4c2a85', B],
  genk: ['#0057a8', B],
  // Outros da Europa
  celtic: ['#018749', B, 'listras'],
  rangers: ['#1b458f', B],
  galatasaray: ['#a90432', '#fdb912', 'listras'],
  fenerbahce: ['#0a2a66', '#f7d417', 'listras'],
  besiktas: [P, B, 'listras'],
  trabzonspor: ['#7b1e3a', '#3fb2e8'],
  olympiacos: ['#d0101c', B, 'listras'],
  panathinaikos: ['#00843d', B],
  paok: [P, B, 'listras'],
  aek: ['#f7d417', P],
  ferencvaros: ['#0a8f3e', B, 'listras'],
  ferencvarosi: ['#0a8f3e', B, 'listras'],
  'dinamo zagreb': ['#0a4ea2', B],
  'crvena zvezda': ['#d0101c', B, 'listras'],
  'estrela vermelha': ['#d0101c', B, 'listras'],
  partizan: [P, B, 'listras'],
  'slavia praga': ['#d0101c', B],
  'sparta praga': ['#7b1e2b', '#f7d417'],
  salzburg: [B, '#d0101c'],
  sturm: [P, B, 'listras'],
  'young boys': ['#f7d417', P],
  basel: ['#d0101c', '#0a2a66'],
  shakhtar: ['#f47b20', P, 'listras'],
  'dynamo kyiv': [B, '#0057a8'],
  copenhagen: [B, '#0a2a66'],
  midtjylland: ['#d0101c', P],
  bodo: ['#f7d417', P],
  malmo: ['#6cabdd', B],
  // América do Sul
  'boca juniors': ['#0a3a7a', '#f7d417'],
  'river plate': [B, '#d0101c', 'faixa'],
  racing: ['#6cabdd', B, 'listras'],
  independiente: ['#d0101c', B],
  'san lorenzo': ['#0a2a66', '#d0101c', 'listras'],
  estudiantes: ['#d0101c', B, 'listras'],
  penarol: [P, '#f7d417', 'listras'],
  nacional: [B, '#0a2a66'],
  'colo colo': [B, P],
  'atletico nacional': ['#00843d', B, 'listras'],
  ldu: [B, '#0a2a66'],
  'independiente del valle': ['#0a2a66', P, 'listras'],
};

const tabela = Object.entries(CLUBES)
  .map(([chave, e]) => ({ tokens: tokensDoNome(chave), e }))
  .sort((a, b) => b.tokens.length - a.tokens.length);

/** Cores da tabela pelo nome: exige a palavra inteira ("Inter" não pega "Internacional"). */
export function coresDaTabela(nome: string): Entrada | null {
  const nomeT = tokensDoNome(nome);
  return tabela.find((c) => c.tokens.every((t) => nomeT.includes(t)))?.e ?? null;
}

const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

const parecidas = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90;
};

/** Luminância relativa, 0 a 1. */
export function luminancia(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function misturar(c: string, alvo: string, t: number): string {
  const a = rgb(c);
  const b = rgb(alvo);
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Cor do brilho e da borda: precisa aparecer no fundo escuro (time preto usa a 2ª cor). */
export function corDeBrilho(c: { cor1: string; cor2: string }): string {
  const base = [c.cor1, c.cor2].find((x) => luminancia(x) >= 0.05 && luminancia(x) < 0.85);
  if (!base) return luminancia(c.cor1) >= 0.05 ? c.cor1 : c.cor2;
  let v = base;
  for (let i = 0; i < 4 && luminancia(v) < 0.14; i++) v = misturar(v, '#ffffff', 0.2);
  return v;
}

/** Letras do escudo: a 2ª cor quando dá para ler, senão preto ou branco. */
export function corDoTexto(c: { cor1: string; cor2: string }): string {
  const contraste = (a: string, b: string) => {
    const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  if (contraste(c.cor1, c.cor2) >= 4.5) return c.cor2;
  return luminancia(c.cor1) > 0.4 ? '#0b0b0d' : '#f8fafc';
}

const CHAVE = 'pe-cores-times';
type Escolhas = Record<string, { cor1: string; cor2: string }>;

const chaveDoTime = (nome: string) => semAcento(nome).trim();

function lerEscolhas(): Escolhas {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Escolhas;
  } catch {
    return {};
  }
}

export function salvarCores(nome: string, cores: { cor1: string; cor2: string } | null): void {
  const e = lerEscolhas();
  if (cores) e[chaveDoTime(nome)] = cores;
  else delete e[chaveDoTime(nome)];
  localStorage.setItem(CHAVE, JSON.stringify(e));
  avisarMudanca();
}

let versao = 0;
const avisarMudanca = () => {
  versao++;
  window.dispatchEvent(new Event(CHAVE));
};

/** Redesenha quem usa as cores quando uma escolha muda (topo e campo ficam iguais). */
export function useCoresEscolhidas(): void {
  useSyncExternalStore(
    (avisar) => {
      window.addEventListener(CHAVE, avisar);
      return () => window.removeEventListener(CHAVE, avisar);
    },
    () => versao,
  );
}

const CHAVE_ESCUDOS = 'pe-escudos-times';

export interface EscudoSalvo {
  imagem: string;
  cor1?: string;
  cor2?: string;
}

function lerEscudos(): Record<string, EscudoSalvo> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_ESCUDOS) ?? '{}') as Record<string, EscudoSalvo>;
  } catch {
    return {};
  }
}

/** Fica salvo por time neste navegador: volta sozinho no próximo jogo dele. */
export function salvarEscudo(nome: string, escudo: EscudoSalvo | null): boolean {
  const e = lerEscudos();
  if (escudo) e[chaveDoTime(nome)] = escudo;
  else delete e[chaveDoTime(nome)];
  try {
    localStorage.setItem(CHAVE_ESCUDOS, JSON.stringify(e));
  } catch {
    return false;
  }
  avisarMudanca();
  return true;
}

export const escudoDoTime = (nome: string): EscudoSalvo | undefined =>
  lerEscudos()[chaveDoTime(nome)];

/** Monta as cores sem navegador: `escolha` é o que está salvo para o time. */
export function resolverCores(
  nome: string,
  escolha?: { cor1: string; cor2: string },
  camisa?: { cor1: string; cor2?: string },
  escudo?: { cor1?: string; cor2?: string },
): CoresTime {
  const padraoTabela = coresDaTabela(nome);
  if (escolha) return { ...escolha, padrao: padraoTabela?.[2] ?? 'liso', origem: 'manual' };
  const doEscudo = escudo?.cor1;
  const tabelaCombina =
    !!padraoTabela &&
    (!doEscudo || parecidas(doEscudo, padraoTabela[0]) || parecidas(doEscudo, padraoTabela[1]));
  if (doEscudo && !tabelaCombina) {
    const cor2 = escudo.cor2 ?? (luminancia(doEscudo) > 0.5 ? '#0b0b0d' : '#f8fafc');
    return { cor1: doEscudo, cor2, padrao: 'liso', origem: 'escudo' };
  }
  if (padraoTabela) {
    const [cor1, cor2, padrao = 'liso'] = padraoTabela;
    return { cor1, cor2, padrao, origem: 'tabela' };
  }
  if (camisa) {
    const cor2 = camisa.cor2 ?? (luminancia(camisa.cor1) > 0.5 ? '#0b0b0d' : '#f8fafc');
    return { cor1: camisa.cor1, cor2, padrao: 'liso', origem: 'print' };
  }
  return { cor1: '#475569', cor2: '#e2e8f0', padrao: 'liso', origem: 'neutra' };
}

export function coresDoTime(nome: string, camisa?: { cor1: string; cor2?: string }): CoresTime {
  return resolverCores(nome, lerEscolhas()[chaveDoTime(nome)], camisa, escudoDoTime(nome));
}

export interface BolaNoCampo {
  fundo: string;
  texto: string;
  contorno: string;
  rotulo: string;
}

function bola(c: CoresTime, cor1: string, cor2: string): BolaNoCampo {
  const rotulo = corDeBrilho({ cor1, cor2 });
  if (c.padrao === 'listras')
    return {
      fundo: `repeating-linear-gradient(90deg, ${cor1} 0 25%, ${cor2} 25% 50%)`,
      texto: '#f8fafc',
      contorno: '3px',
      rotulo,
    };
  if (c.padrao === 'faixa')
    return {
      fundo: `linear-gradient(135deg, ${cor1} 36%, ${cor2} 36% 64%, ${cor1} 64%)`,
      texto: '#f8fafc',
      contorno: '3px',
      rotulo,
    };
  return { fundo: cor1, texto: corDoTexto({ cor1, cor2 }), contorno: '0', rotulo };
}

/**
 * Bolinhas do campo com a camisa de cada time. Cores parecidas (Flamengo × Athletico): o visitante
 * joga de "camisa reserva", lisa na 2ª cor, ou branca se ela também for parecida.
 */
export function bolasDoCampo(
  casa: CoresTime,
  fora: CoresTime,
): { casa: BolaNoCampo; fora: BolaNoCampo } {
  const bolaCasa = bola(casa, casa.cor1, casa.cor2);
  if (!parecidas(casa.cor1, fora.cor1))
    return { casa: bolaCasa, fora: bola(fora, fora.cor1, fora.cor2) };
  const reserva = !parecidas(casa.cor1, fora.cor2)
    ? fora.cor2
    : parecidas(casa.cor1, '#f8fafc')
      ? '#0b0b0d'
      : '#f8fafc';
  return {
    casa: bolaCasa,
    fora: bola({ ...fora, padrao: 'liso' }, reserva, fora.cor1),
  };
}
