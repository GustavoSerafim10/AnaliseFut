/**
 * Identidade estruturada das casas de apostas.
 *
 * - operatorId: a empresa por trás. Controla a INDEPENDÊNCIA do consenso (R2), a contagem de
 *   casas e a classificação das referências. Duas marcas do mesmo operador são uma fonte só.
 * - brandId: a marca. Duas marcas do mesmo operador podem ter preços próprios.
 * - productType: o produto. Controla particularidades de preço (comissão da Exchange).
 * - displayName: nome de exibição. O nome ORIGINAL do print nunca se perde (`original`).
 *
 * Sem associação especulativa: só o que está no registro (e foi confirmado) é unificado. Casa
 * desconhecida fica "não mapeada": conta como operador próprio e gera aviso.
 */

export type TipoProduto = 'sportsbook' | 'exchange' | 'desconhecido';

export interface IdentidadeCasa {
  operatorId: string;
  brandId: string;
  productType: TipoProduto;
  displayName: string;
  /** nomes aceitos (comparados sem acento, espaço, pontuação e domínio) */
  aliases: string[];
  /** o nome sozinho não diz o produto: este foi assumido (conservador) e vira aviso */
  produtoAssumido?: boolean;
}

/** Comissão da Betfair Exchange sobre o lucro. Só a Exchange paga; o Sportsbook nunca. */
export const COMISSAO_BETFAIR = 0.065;

/**
 * Registro. Operador sem grupo confirmado = a própria marca (nada é presumido).
 * Confirmado pelo usuário: Betsul e CasaDeApostas são o mesmo operador (CDA GAMING LTDA);
 * Betfair Exchange e Sportsbook são o mesmo operador. Superbet × BetSuper: NÃO unificar.
 */
export const REGISTRO_CASAS: IdentidadeCasa[] = [
  {
    operatorId: '1win',
    brandId: '1win',
    productType: 'sportsbook',
    displayName: '1win',
    aliases: ['1win'],
  },
  {
    operatorId: 'cda-gaming',
    brandId: 'betsul',
    productType: 'sportsbook',
    displayName: 'Betsul',
    aliases: ['betsul'],
  },
  {
    operatorId: 'cda-gaming',
    brandId: 'casadeapostas',
    productType: 'sportsbook',
    displayName: 'CasaDeApostas',
    aliases: ['casadeapostas'],
  },
  {
    operatorId: 'bet365',
    brandId: 'bet365',
    productType: 'sportsbook',
    displayName: 'Bet365',
    aliases: ['bet365', 'bet365 br'],
  },
  {
    operatorId: 'superbet',
    brandId: 'superbet',
    productType: 'sportsbook',
    displayName: 'Superbet',
    aliases: ['superbet'],
  },
  {
    operatorId: 'betsuper',
    brandId: 'betsuper',
    productType: 'sportsbook',
    displayName: 'BetSuper',
    aliases: ['betsuper'],
  },
  {
    operatorId: 'betano',
    brandId: 'betano',
    productType: 'sportsbook',
    displayName: 'Betano',
    aliases: ['betano'],
  },
  {
    operatorId: 'pinnacle',
    brandId: 'pinnacle',
    productType: 'sportsbook',
    displayName: 'Pinnacle',
    aliases: ['pinnacle'],
  },
  {
    operatorId: 'betfair',
    brandId: 'betfair',
    productType: 'exchange',
    displayName: 'Betfair Exchange',
    aliases: ['betfair exchange', 'exchange betfair'],
  },
  {
    // "Betfair" sozinho: assume Exchange (a referência que o usuário usa); com isso a comissão
    // entra, o que só deixa o EV mais conservador. O sportsbook precisa ser escrito.
    operatorId: 'betfair',
    brandId: 'betfair',
    productType: 'exchange',
    displayName: 'Betfair Exchange',
    aliases: ['betfair'],
    produtoAssumido: true,
  },
  {
    operatorId: 'betfair',
    brandId: 'betfair',
    productType: 'sportsbook',
    displayName: 'Betfair Sportsbook',
    aliases: ['betfair sportsbook', 'sportsbook betfair'],
  },
  {
    operatorId: 'playon',
    brandId: 'playon',
    productType: 'sportsbook',
    displayName: 'PlayOn',
    aliases: ['playon'],
  },
  {
    operatorId: '99play',
    brandId: '99play',
    productType: 'sportsbook',
    displayName: '99Play',
    aliases: ['99play'],
  },
  {
    operatorId: 'futamina',
    brandId: 'futamina',
    productType: 'sportsbook',
    displayName: 'Futamina',
    aliases: ['futamina'],
  },
  {
    operatorId: 'jogou',
    brandId: 'jogou',
    productType: 'sportsbook',
    displayName: 'Jogou',
    aliases: ['jogou'],
  },
  {
    operatorId: 'sorteganha',
    brandId: 'sorteganha',
    productType: 'sportsbook',
    displayName: 'SorteGanha',
    aliases: ['sorteganha'],
  },
];

export interface CasaResolvida {
  /** o nome exatamente como veio do print (auditoria) */
  original: string;
  operatorId: string;
  brandId: string;
  productType: TipoProduto;
  displayName: string;
  mapeada: boolean;
  produtoAssumido: boolean;
  /** fonte de preço: marca + produto (Exchange e Sportsbook têm preços diferentes) */
  chaveFonte: string;
  /** referência afiada: Pinnacle, ou Betfair EXCHANGE (o sportsbook não é referência) */
  afiada: boolean;
}

/** minúsculas, sem acento, sem domínio (.com, .bet.br...), só letras e números */
export function normalizarNomeCasa(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(com\.br|bet\.br|com|bet|br|io|net)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

const INDICE = new Map<string, IdentidadeCasa>();
for (const c of REGISTRO_CASAS)
  for (const a of [...c.aliases, ...(c.produtoAssumido ? [] : [c.displayName])])
    INDICE.set(normalizarNomeCasa(a), c);

const cache = new Map<string, CasaResolvida>();

export function resolverCasa(nome: string): CasaResolvida {
  const achado = cache.get(nome);
  if (achado) return achado;
  const norm = normalizarNomeCasa(nome);
  const id = INDICE.get(norm);
  const r: CasaResolvida = id
    ? {
        original: nome,
        operatorId: id.operatorId,
        brandId: id.brandId,
        productType: id.productType,
        displayName: id.displayName,
        mapeada: true,
        produtoAssumido: !!id.produtoAssumido,
        chaveFonte: `${id.brandId}|${id.productType}`,
        afiada:
          id.operatorId === 'pinnacle' ||
          (id.operatorId === 'betfair' && id.productType === 'exchange'),
      }
    : {
        original: nome,
        operatorId: `nao-mapeada:${norm}`,
        brandId: `nao-mapeada:${norm}`,
        productType: 'desconhecido',
        displayName: nome.trim(),
        mapeada: false,
        produtoAssumido: false,
        chaveFonte: `nao-mapeada:${norm}`,
        afiada: false,
      };
  cache.set(nome, r);
  return r;
}

/** Comissão que sai do lucro nesta casa: só na Betfair Exchange, nunca por semelhança de nome. */
export function comissaoDaCasa(casa: string): number {
  const r = resolverCasa(casa);
  return r.operatorId === 'betfair' && r.productType === 'exchange' ? COMISSAO_BETFAIR : 0;
}

/** Agrupa por operador: marcas e produtos do mesmo operador são UMA fonte independente. */
export function agruparPorOperador<T extends { casa: string }>(itens: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const i of itens) {
    const op = resolverCasa(i.casa).operatorId;
    m.set(op, [...(m.get(op) ?? []), i]);
  }
  return m;
}

/** Um nome original por operador (o primeiro visto), na ordem de aparição. */
export function operadoresDistintos(nomes: string[]): CasaResolvida[] {
  const vistos = new Map<string, CasaResolvida>();
  for (const n of nomes) {
    const r = resolverCasa(n.trim());
    if (!vistos.has(r.operatorId)) vistos.set(r.operatorId, { ...r, original: n.trim() });
  }
  return [...vistos.values()];
}

export const contarOperadores = (nomes: string[]) => operadoresDistintos(nomes).length;

/** Avisos de identidade: casa não mapeada e produto assumido. Um por casa. */
export function avisosDeCasas(nomes: string[]): string[] {
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const n of nomes) {
    const r = resolverCasa(n.trim());
    if (vistos.has(r.chaveFonte)) continue;
    vistos.add(r.chaveFonte);
    if (!r.mapeada)
      avisos.push(
        `casa "${n.trim()}" não mapeada: conta como operador próprio, sem associação a outras. Se for a mesma de outra casa colada, o consenso está inflado`,
      );
    else if (r.produtoAssumido)
      avisos.push(
        `"${n.trim()}": produto não informado, assumida Exchange (comissão de ${COMISSAO_BETFAIR * 100}% aplicada). Escreva "Betfair Sportsbook" se for o sportsbook`,
      );
  }
  return avisos;
}
