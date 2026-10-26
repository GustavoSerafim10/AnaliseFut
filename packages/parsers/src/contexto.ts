/**
 * Leitores de contexto: desfalques (SuperScore, print recortado), classificação (SofaScore,
 * print recortado) e o texto de análise do Flashscore. Tudo vira SUGESTÃO para o usuário;
 * nada disso altera o λ sozinho.
 */
import type { NomesTimes, Time } from '@pe/engine';
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

const SITUACOES = /lesionad|suspens|duvida|machucad|contundid|afastad/;

export function lerDesfalques(
  texto: string,
  jogo: NomesTimes,
): { desfalques: Desfalque[]; avisos: string[] } {
  const desfalques: Desfalque[] = [];
  const avisos: string[] = [];
  let atual: Time | null = null;
  for (const bruta of texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const t = semAcento(bruta);
    if (/ausentes|possivel 11|desfalques/.test(t)) continue;
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
    if (SITUACOES.test(t) && desfalques.length) {
      desfalques[desfalques.length - 1].situacao = bruta;
      continue;
    }
    // nome: começa na primeira palavra "Maiúscula + 2 letras"; antes disso é lixo (ícones, camisa)
    const partes = bruta.split(/\s+/).map((p) => p.replace(/[^A-Za-zÀ-ú.'-]/g, ''));
    const ini = partes.findIndex((p) => /^[A-ZÀ-Ú][a-zà-ú]{2,}/.test(p));
    const nome =
      ini < 0
        ? ''
        : partes
            .slice(ini)
            .filter((p) => /[A-Za-zÀ-ú]/.test(p))
            .join(' ')
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

export interface LinhaClassificacao {
  posicao: number;
  time: string;
  pontos?: number;
  doJogo?: Time;
  bruto: string;
}

export function lerClassificacao(
  texto: string,
  jogo: NomesTimes,
): { linhas: LinhaClassificacao[]; avisos: string[] } {
  const linhas: LinhaClassificacao[] = [];
  const avisos: string[] = [];
  for (const bruto of texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const m = /^(\d{1,2})\b\s*(.*)$/.exec(bruto);
    if (!m) continue;
    const posicao = Number(m[1]);
    const resto = m[2].split(/\s+/);
    const nome: string[] = [];
    for (const tok of resto) {
      if (/^\d/.test(tok) || /^[+-]\d/.test(tok)) break;
      const limpo = tok.replace(/[^A-Za-zÀ-ú-]/g, '');
      if (limpo.length >= 3 && !/^[A-Z]{2,3}$/.test(limpo)) nome.push(limpo);
    }
    if (!nome.length || posicao < 1 || posicao > 30) continue;
    const nums = bruto.match(/\b\d{1,3}\b/g)?.map(Number) ?? [];
    const pontos = nums.length > 2 ? nums[nums.length - 1] : undefined;
    const time = nome.join(' ');
    linhas.push({ posicao, time, pontos, doJogo: reconhecerTime(time, jogo) ?? undefined, bruto });
  }
  for (let i = 1; i < linhas.length; i++) {
    const a = linhas[i - 1].pontos;
    const b = linhas[i].pontos;
    if (a !== undefined && b !== undefined && b > a)
      avisos.push(`pontos fora de ordem perto de "${linhas[i].time}" (${b} > ${a}): conferir`);
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
