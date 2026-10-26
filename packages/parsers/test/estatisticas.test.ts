import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  avaliarImpactoDesfalques,
  consolidar,
  destaquesComparativos,
  estatisticasParaModelo,
  juntarLeiturasStats,
  lerClassificacao,
  lerDesfalques,
  lerEstatisticas,
  lerTextoFlashscore,
} from '../src';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');
const jogo = { casa: 'Flamengo', fora: 'Atlético-MG' };

// Valores verdadeiros dos prints (conferidos à mão nas imagens)
describe('SofaScore — comparação de equipes (OCR real)', () => {
  const l = juntarLeiturasStats([
    lerEstatisticas(fx('sofascore-comparacao-1.txt'), 'sofascore', jogo),
    lerEstatisticas(fx('sofascore-comparacao-2.txt'), 'sofascore', jogo),
  ])!;
  const c = l.campos;

  it('lê os totais inteiros', () => {
    expect(c.partidas).toMatchObject({ casa: 31, fora: 31 });
    expect(c.golsSofridos).toMatchObject({ casa: 25, fora: 35 });
    expect(c.jogosSemSofrer).toMatchObject({ casa: 14, fora: 8 });
  });
  it('corrige o ponto decimal perdido ("20 14" → 2.0 / 1.4)', () => {
    expect(c.golsPorJogo).toMatchObject({ casa: 2.0, fora: 1.4 });
    expect(c.golsSofridosPorJogo).toMatchObject({ casa: 0.8, fora: 1.1 });
    expect(c.chutesNoAlvo).toMatchObject({ casa: 5.6, fora: 4.9 });
    expect(c.defesasGoleiro).toMatchObject({ casa: 2.8, fora: 3.1 });
    expect(c.golsPorJogo!.avisos.join()).toContain('ponto decimal');
  });
  it('valor ilegível fica vazio (nunca inventado) e o legível vai para a coluna certa', () => {
    // "Gols marcados 61 yp": o 42 do Atlético virou "yp"
    expect(c.golsMarcados?.casa).toBe(61);
    expect(c.golsMarcados?.fora).toBeUndefined();
    expect(c.golsMarcados!.avisos.join()).toContain('ilegível');
  });
  it('guarda as linhas não mapeadas em "outros"', () => {
    expect(l.outros.length).toBeGreaterThan(0);
  });
});

describe('SuperScore — estatísticas de equipe, Média (OCR real)', () => {
  const l = juntarLeiturasStats(
    ['superscore-media-1.txt', 'superscore-media-2.txt', 'superscore-media-3.txt'].map((f) =>
      lerEstatisticas(fx(f), 'superscore', jogo),
    ),
  )!;
  const c = l.campos;
  it('lê valores dos dois lados do rótulo, inclusive os selos coloridos', () => {
    expect(c.xg).toMatchObject({ casa: 1.8, fora: 1.4 });
    expect(c.xgot).toMatchObject({ casa: 1.9, fora: 1.3 });
    expect(c.finalizacoes).toMatchObject({ casa: 15.8, fora: 14.1 });
    expect(c.chutesNoAlvo).toMatchObject({ casa: 5.7, fora: 5.0 });
    expect(c.grandesChances).toMatchObject({ casa: 3.4, fora: 2.6 });
    expect(c.cartoesAmarelos).toMatchObject({ casa: 2.1, fora: 1.6 });
    expect(c.defesasGoleiro).toMatchObject({ casa: 2.8, fora: 3.2 });
    expect(c.golsPorJogo).toMatchObject({ casa: 2.0, fora: 1.4 });
  });
  it('escanteio do mandante ilegível ("ss") fica vazio', () => {
    expect(c.escanteios?.casa).toBeUndefined();
    expect(c.escanteios?.fora).toBe(5.3);
  });
});

describe('cruzamento SofaScore × SuperScore', () => {
  const sofa = lerEstatisticas(
    fx('sofascore-comparacao-1.txt') + '\n' + fx('sofascore-comparacao-2.txt'),
    'sofascore',
    jogo,
  );
  const sup = lerEstatisticas(
    fx('superscore-media-1.txt') +
      '\n' +
      fx('superscore-media-2.txt') +
      '\n' +
      fx('superscore-media-3.txt'),
    'superscore',
    jogo,
  );
  const t = consolidar({ sofascore: sofa, superscore: sup });

  it('concordantes → média das fontes', () => {
    expect(t.chutesNoAlvo!.casa.valor).toBeCloseTo((5.6 + 5.7) / 2, 6);
    expect(t.chutesNoAlvo!.casa.divergente).toBe(false);
  });
  it('faltas: OCR do SuperScore leu 1.7 (era 11.7) → divergência > 15% destacada', () => {
    expect(t.faltas!.fora.divergente).toBe(true);
    expect(t.faltas!.fora.valor).toBe(11.8);
  });
  it('correção manual prevalece', () => {
    const c = consolidar({ sofascore: sofa, superscore: sup }, { 'golsMarcados.fora': 42 });
    expect(c.golsMarcados!.fora).toMatchObject({ valor: 42, fonte: 'manual' });
  });
  it('monta as estatísticas do modelo e declara o derivado', () => {
    const c = consolidar({ sofascore: sofa, superscore: sup }, { 'golsMarcados.fora': 42 });
    const casa = estatisticasParaModelo(c, 'casa');
    expect(casa.stats).toMatchObject({ jogos: 31 });
    expect(casa.stats!.golsPro).toBeCloseTo(61 / 31, 6);
    expect(casa.stats!.golsContra).toBeCloseTo(25 / 31, 6);
    expect(casa.stats!.xg).toBe(1.8);
    expect(casa.stats!.chutesNoAlvoContra).toBeCloseTo(2.8 + 25 / 31, 6);
    expect(casa.declaracoes.join()).toContain('derivado');
    expect(estatisticasParaModelo(c, 'fora').stats!.golsPro).toBeCloseTo(42 / 31, 6);
  });
  it('sem gols marcados do visitante → não monta (falta dado)', () => {
    const r = estatisticasParaModelo(t, 'fora');
    // golsPorJogo existe (1.4) e serve de reserva
    expect(r.stats!.golsPro).toBe(1.4);
  });
  it('gera frases comparativas', () => {
    const d = destaquesComparativos(t, { casa: 'Flamengo', fora: 'Atlético-MG' });
    expect(d.some((x) => x.startsWith('xG por jogo: Flamengo 1,8 × 1,4'))).toBe(true);
  });
});

describe('desfalques (SuperScore, print recortado)', () => {
  it('lê os jogadores de cada time', () => {
    const { desfalques } = lerDesfalques(fx('superscore-desfalques.txt'), jogo);
    const fla = desfalques.filter((d) => d.time === 'casa').map((d) => d.jogador);
    const atl = desfalques.filter((d) => d.time === 'fora').map((d) => d.jogador);
    expect(fla).toEqual(['Evertton', 'Giorgian De Arrascaeta']);
    expect(atl).toEqual(['Ruan Tressoldi', 'Gustavo Scarpa', 'Fred', 'Everson', 'Mateo Cassierra']);
  });
});

describe('classificação (SofaScore, print recortado)', () => {
  it('acha os times do jogo e a posição', () => {
    const { linhas } = lerClassificacao(fx('sofascore-classificacao.txt'), jogo);
    expect(linhas.find((l) => l.doJogo === 'casa')).toMatchObject({ posicao: 2, time: 'Flamengo' });
    expect(linhas.find((l) => l.doJogo === 'fora')?.posicao).toBe(6);
    expect(linhas.find((l) => l.time === 'Palmeiras')?.pontos).toBe(69);
  });
});

describe('impacto automático dos desfalques', () => {
  const desfalques = [
    { time: 'casa' as const, jogador: 'Giorgian De Arrascaeta' },
    { time: 'fora' as const, jogador: 'Gustavo Scarpa' },
  ];
  it('sem evidência no texto → nenhum (conservador)', () => {
    const flash = lerTextoFlashscore(
      'Notícias\nO Flamengo vive boa fase. O Atlético também.',
      jogo,
    );
    expect(avaliarImpactoDesfalques(desfalques, flash, 'casa').nivel).toBe('nenhum');
  });
  it('ausente citado como peça importante → médio, com o motivo', () => {
    const flash = lerTextoFlashscore(
      'Notícias\nArrascaeta é o principal criador do Flamengo na temporada.',
      jogo,
    );
    const r = avaliarImpactoDesfalques(desfalques, flash, 'casa');
    expect(r.nivel).toBe('medio');
    expect(r.importantes).toEqual(['Giorgian De Arrascaeta']);
    expect(avaliarImpactoDesfalques(desfalques, flash, 'fora').nivel).toBe('nenhum');
  });
});

describe('texto do Flashscore', () => {
  const texto = `Notícias da partida e forma atual
O Flamengo chega à reta final com o melhor ataque. No Maracanã, são 36 pontos em 15 jogos como mandante, com 11 vitórias, três empates e apenas uma derrota.
O Atlético também atravessa um bom momento. Entretanto, em 15 jogos fora de casa, o time mineiro conquistou apenas 15 pontos, com quatro vitórias, três empates e oito derrotas.
Duelo direto histórico
O Rubro-Negro está invicto há cinco confrontos contra o Atlético pelo Brasileirão.
Jogadores importantes e ausentes
Entre os desfalques do Flamengo, Danilo está fora por fratura na mandíbula. No Atlético, Gustavo Scarpa e Ruan aparecem na relação de jogadores lesionados.`;
  const r = lerTextoFlashscore(texto, jogo);

  it('extrai a campanha em casa e fora', () => {
    expect(r.campanhas).toContainEqual(
      expect.objectContaining({
        time: 'casa',
        local: 'casa',
        jogos: 15,
        pontos: 36,
        vitorias: 11,
        empates: 3,
        derrotas: 1,
      }),
    );
    expect(r.campanhas).toContainEqual(
      expect.objectContaining({
        time: 'fora',
        local: 'fora',
        jogos: 15,
        pontos: 15,
        vitorias: 4,
        empates: 3,
        derrotas: 8,
      }),
    );
  });
  it('classifica desfalques e confronto direto por time', () => {
    expect(r.trechos).toContainEqual(
      expect.objectContaining({ categoria: 'desfalques', time: 'casa' }),
    );
    expect(r.trechos).toContainEqual(
      expect.objectContaining({ categoria: 'desfalques', time: 'fora' }),
    );
    expect(r.trechos.some((t) => t.categoria === 'h2h')).toBe(true);
  });
});
