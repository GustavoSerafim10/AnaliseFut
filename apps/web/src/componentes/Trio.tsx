/**
 * Homenagem sem imagem de ninguém: as cores das camisas do trio.
 * R10 com a canarinho, Ney com a 11 do Barça e Messi com a 10 da Argentina.
 */
interface Camisa {
  nome: string;
  numero: string;
  /** listras verticais [cor A, cor B]; uma cor = lisa */
  cores: [string] | [string, string];
  gola: string;
  corNumero: string;
}

export const CAMISAS: Camisa[] = [
  { nome: 'R10', numero: '10', cores: ['#ffd60a'], gola: '#009c3b', corNumero: '#009c3b' },
  {
    nome: 'NEY',
    numero: '11',
    cores: ['#a50044', '#004d98'],
    gola: '#edbb00',
    corNumero: '#edbb00',
  },
  {
    nome: 'MESSI',
    numero: '10',
    cores: ['#ffffff', '#75aadb'],
    gola: '#1b2a4a',
    corNumero: '#1b2a4a',
  },
];
