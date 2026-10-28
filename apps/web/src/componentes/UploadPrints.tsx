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

/** Nome legível para um print colado (a área de transferência entrega só "image.png"). */
function nomeColado(tipo: string, n: number): string {
  const h = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  const ext = tipo.split('/')[1] ?? 'png';
  return `print-colado-${h}${n > 0 ? `-${n + 1}` : ''}.${ext}`;
}

/** Pega só as imagens de uma lista de arquivos (colagem ou arrastar e soltar). */
function soImagens(arquivos: Iterable<File>): File[] {
  return Array.from(arquivos)
    .filter((a) => a.type.startsWith('image/'))
    .map((a, i) =>
      a.name && a.name !== 'image.png' ? a : new File([a], nomeColado(a.type, i), { type: a.type }),
    );
}

/**
 * Envia vários prints de uma vez; lê um por um e mostra o texto lido de cada.
 * Aceita escolher arquivos, colar (clique na área ou Ctrl+V com ela em foco) e arrastar.
 */
export function UploadPrints({ rotulo, dica, leituras, desabilitado, onLido, onRemover }: Props) {
  const [fila, setFila] = useState<{
    atual: string;
    feitos: number;
    total: number;
    p: number;
  } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const ocupado = desabilitado || !!fila;

  async function aoEscolher(arquivos: Iterable<File> | null) {
    if (!arquivos || ocupado) return;
    const lista = soImagens(arquivos);
    if (!lista.length) return;
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

  /** Clique em "Colar print": lê a imagem da área de transferência. */
  async function colarDaAreaDeTransferencia() {
    if (ocupado) return;
    if (!navigator.clipboard?.read) {
      setErro(
        'Este navegador não deixa ler a área de transferência pelo clique — clique na área e aperte Ctrl+V.',
      );
      return;
    }
    try {
      const itens = await navigator.clipboard.read();
      const arquivos: File[] = [];
      for (const item of itens) {
        const tipo = item.types.find((t) => t.startsWith('image/'));
        if (tipo)
          arquivos.push(
            new File([await item.getType(tipo)], nomeColado(tipo, arquivos.length), { type: tipo }),
          );
      }
      if (!arquivos.length) {
        setErro(
          'Nenhuma imagem na área de transferência. Tire o print (Win+Shift+S) e clique de novo.',
        );
        return;
      }
      await aoEscolher(arquivos);
    } catch {
      setErro('Sem permissão para ler a área de transferência — clique na área e aperte Ctrl+V.');
    }
  }

  return (
    <div className="upload-bloco">
      <div
        className={`upload-linha${arrastando ? ' arrastando' : ''}`}
        onPaste={(e) => {
          const arquivos = soImagens(e.clipboardData.files);
          if (arquivos.length) {
            e.preventDefault();
            void aoEscolher(arquivos);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void aoEscolher(e.dataTransfer.files);
        }}
      >
        <button
          type="button"
          className="upload-colar"
          disabled={ocupado}
          onClick={() => void colarDaAreaDeTransferencia()}
          title="Tire o print (Win+Shift+S) e clique aqui — ou clique e aperte Ctrl+V"
        >
          📋 Colar print <small>clique ou Ctrl+V · {rotulo.replace(/^Enviar /, '')}</small>
        </button>
        <label className="upload">
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={ocupado}
            onChange={(e) => {
              void aoEscolher(e.target.files);
              e.target.value = '';
            }}
          />
          <span>📁 Arquivos</span>
        </label>
      </div>
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
