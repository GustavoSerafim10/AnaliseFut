import { describe, expect, it } from 'vitest';
import {
  bolasDoCampo,
  coresDaTabela,
  corDeBrilho,
  corDoTexto,
  luminancia,
  resolverCores,
} from '../src/coresTimes';

describe('cores pela tabela de clubes', () => {
  it.each([
    ['Milan', '#e30613'],
    ['AC Milan', '#e30613'],
    ['Milão', '#e30613'],
    ['Ferencváros', '#0a8f3e'],
    ['Ferencvárosi Torna Club', '#0a8f3e'],
    ['Flamengo', '#d0101c'],
    ['CR Flamengo', '#d0101c'],
    ['São Paulo', '#d0101c'],
  ])('%s', (nome, cor) => expect(coresDaTabela(nome)?.[0]).toBe(cor));

  it('nomes parecidos não se confundem', () => {
    expect(coresDaTabela('Inter de Milão')).toEqual(coresDaTabela('Inter'));
    expect(coresDaTabela('Internacional')).not.toEqual(coresDaTabela('Inter'));
    expect(coresDaTabela('Manchester City')).not.toEqual(coresDaTabela('Manchester United'));
    expect(coresDaTabela('Atlético Madrid')).not.toEqual(coresDaTabela('Atlético MG'));
    expect(coresDaTabela('Independiente del Valle')).not.toEqual(coresDaTabela('Independiente'));
  });

  it('time fora da tabela não recebe cor de outro', () => {
    expect(coresDaTabela('Clube Inventado')).toBeNull();
  });
});

describe('ordem das fontes', () => {
  const camisa = { cor1: '#123456', cor2: '#abcdef' };
  const minha = { cor1: '#111111', cor2: '#222222' };
  it('sua escolha > tabela > print > neutra', () => {
    expect(resolverCores('Milan', minha, camisa).origem).toBe('manual');
    expect(resolverCores('Milan', undefined, camisa).origem).toBe('tabela');
    expect(resolverCores('Clube Inventado', undefined, camisa)).toMatchObject({
      origem: 'print',
      cor1: '#123456',
    });
    expect(resolverCores('Clube Inventado').origem).toBe('neutra');
  });
});

describe('legibilidade no fundo escuro', () => {
  it('time preto brilha com a 2ª cor', () => {
    expect(corDeBrilho({ cor1: '#0b0b0d', cor2: '#f8fafc' })).toBe('#f8fafc');
    expect(luminancia(corDeBrilho({ cor1: '#034694', cor2: '#f8fafc' }))).toBeGreaterThan(0.1);
  });
  it('letras do escudo contrastam com o fundo', () => {
    expect(corDoTexto({ cor1: '#0b0b0d', cor2: '#f8fafc' })).toBe('#f8fafc');
    expect(corDoTexto({ cor1: '#fde100', cor2: '#fff176' })).toBe('#0b0b0d');
  });
});

describe('bolinhas do campo', () => {
  const r = (n: string) => resolverCores(n);
  it('cada time com a sua camisa', () => {
    const b = bolasDoCampo(r('Palmeiras'), r('Chelsea'));
    expect(b.casa.fundo).toBe('#006437');
    expect(b.fora.fundo).toBe('#034694');
  });
  it('listras viram listras', () => {
    expect(bolasDoCampo(r('Milan'), r('Chelsea')).casa.fundo).toContain(
      'repeating-linear-gradient',
    );
  });
  it('cores parecidas: o visitante vai de reserva lisa e os dois se distinguem', () => {
    const b = bolasDoCampo(r('Flamengo'), r('Athletico'));
    expect(b.casa.fundo).toContain('#d0101c');
    expect(b.fora.fundo).toBe('#0b0b0d');
    const branco = bolasDoCampo(r('Liverpool'), r('Arsenal'));
    expect(branco.fora.fundo).toBe('#f8fafc');
  });
});
