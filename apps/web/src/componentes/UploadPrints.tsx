import { useState } from 'react';
import { isoLocal, pct, type Leitura } from '../estado';
import { lerImagem } from '../ocr';

interface Props {
  rotulo: string;
  dica?: string;
  leituras: Leitura[];
  desabilitado?: boolean;
  onLido: (l: Leitura) => void;
  onRemover: (indice: number) => void;
}

/** Envia vários prints de uma vez; lê um por um e mostra o texto lido de cada. */
export function UploadPrints({ rotulo, dica, leituras, desabilitado, onLido, onRemover }: Props) {
  const [fila, setFila] = useState<{
    atual: string;
    feitos: number;
    total: number;
    p: number;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const lista = Array.from(arquivos);
    setErro(null);
    for (let i = 0; i < lista.length; i++) {
      const arq = lista[i];
      setFila({ atual: arq.name, feitos: i, total: lista.length, p: 0 });
      try {
        const texto = await lerImagem(arq, (p) =>
          setFila({ atual: arq.name, feitos: i, total: lista.length, p }),
        );
        onLido({ arquivo: arq.name, texto, capturadoEm: isoLocal(new Date(arq.lastModified)) });
      } catch (e) {
        setErro(`Falha ao ler ${arq.name}: ${(e as Error).message}`);
      }
    }
    setFila(null);
  }

  return (
    <div className="upload-bloco">
      <label className="upload">
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={desabilitado || !!fila}
          onChange={(e) => {
            void aoEscolher(e.target.files);
            e.target.value = '';
          }}
        />
        <span>📷 {rotulo}</span>
      </label>
      {dica && <p className="dica">{dica}</p>}
      {fila && (
        <div className="caixa">
          Lendo {fila.feitos + 1} de {fila.total}: {fila.atual}… {pct(fila.p, 0)}
          <progress value={(fila.feitos + fila.p) / fila.total} max={1} />
        </div>
      )}
      {erro && <div className="caixa alerta">{erro}</div>}
      {leituras.length > 0 && (
        <ul className="lista-prints">
          {leituras.map((l, i) => (
            <li key={`${l.arquivo}-${i}`}>
              <details>
                <summary>{l.arquivo}</summary>
                <pre>{l.texto}</pre>
              </details>
              <button
                className="perigo mini"
                onClick={() => onRemover(i)}
                aria-label={`remover ${l.arquivo}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
