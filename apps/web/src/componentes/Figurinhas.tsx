import { useState } from 'react';
import {
  MAX_GALERIA,
  prepararFoto,
  prepararFundo,
  type Figurinhas as TipoFigurinhas,
} from '../figurinhas';
import { CAMISAS } from './Trio';

interface Props {
  figurinhas: TipoFigurinhas;
  setFigurinhas: (f: TipoFigurinhas) => void;
  galeria: string[];
  setGaleria: (g: string[]) => void;
}

/** Escolher as fotos do aparelho: rostos dos três jogadores e a galeria de fundo. */
export function EditorFigurinhas({ figurinhas, setFigurinhas, galeria, setGaleria }: Props) {
  const [erro, setErro] = useState<string | null>(null);

  async function trocarRosto(i: number, arquivo?: File) {
    if (!arquivo) return;
    try {
      const nova = [...figurinhas] as TipoFigurinhas;
      nova[i] = await prepararFoto(arquivo);
      setFigurinhas(nova);
      setErro(null);
    } catch {
      setErro('Não consegui abrir essa imagem. Tente outra (JPG ou PNG).');
    }
  }

  async function adicionarFundo(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    try {
      const novas = await Promise.all(
        [...arquivos].slice(0, MAX_GALERIA - galeria.length).map(prepararFundo),
      );
      setGaleria([...galeria, ...novas]);
      setErro(null);
    } catch {
      setErro('Não consegui abrir uma das imagens. Tente outra (JPG ou PNG).');
    }
  }

  return (
    <details className="caixa figurinhas">
      <summary>📸 Suas figurinhas (fotos do seu aparelho)</summary>
      <p className="dica">
        As fotos ficam guardadas só neste navegador: não vão para o site publicado nem para o
        GitHub. Em outro aparelho, escolha de novo.
      </p>
      <h4>Rosto de cada jogador da animação</h4>
      <div className="slots">
        {CAMISAS.map((c, i) => (
          <div key={c.nome} className="slot">
            <label className="foto-slot" style={{ borderColor: c.gola }}>
              {figurinhas[i] ? <img src={figurinhas[i]!} alt="" /> : <span>{c.numero}</span>}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void trocarRosto(i, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <div className="miudo">{c.nome}</div>
            {figurinhas[i] && (
              <button
                className="discreto mini"
                onClick={() => {
                  const nova = [...figurinhas] as TipoFigurinhas;
                  nova[i] = null;
                  setFigurinhas(nova);
                }}
              >
                tirar
              </button>
            )}
          </div>
        ))}
      </div>

      <h4>
        Galeria de fundo ({galeria.length}/{MAX_GALERIA})
      </h4>
      <div className="galeria-miniaturas">
        {galeria.map((f, i) => (
          <div key={i} className="miniatura" style={{ backgroundImage: `url(${f})` }}>
            <button
              className="mini"
              aria-label="tirar foto"
              onClick={() => setGaleria(galeria.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {galeria.length < MAX_GALERIA && (
          <label className="miniatura adicionar">
            +
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void adicionarFundo(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
      <p className="dica">As fotos da galeria trocam a cada 7 segundos, atrás do gramado.</p>
      {erro && <div className="caixa alerta">{erro}</div>}
    </details>
  );
}
