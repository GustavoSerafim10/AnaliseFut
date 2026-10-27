import { clv, type ParPlacar } from '@pe/engine';
import { useState } from 'react';
import { dec, isoLocal, num, pct, type Rascunho } from '../estado';
import {
  apurar,
  balanco,
  exportarJson,
  importarJson,
  type Balanco,
  type EntradaHistorico,
} from '../historico';

const CLASSE: Record<string, string> = {
  BET: 'bet',
  WATCHLIST: 'watch',
  INVESTIGAR: 'investigar',
};

interface Props {
  historico: EntradaHistorico[];
  setHistorico: (h: EntradaHistorico[]) => void;
  abrir: (r: Rascunho) => void;
}

function LinhaBalanco({ titulo, b, dica }: { titulo: string; b: Balanco; dica: string }) {
  return (
    <div className="caixa">
      <h3>{titulo}</h3>
      {b.apuradas === 0 ? (
        <p className="miudo">Nenhuma apurada ainda: registre o placar dos jogos abaixo.</p>
      ) : (
        <dl className="numeros">
          <dt>Apuradas</dt>
          <dd>{b.apuradas}</dd>
          <dt>Resultado</dt>
          <dd className={b.unidades >= 0 ? 'positivo' : 'negativo'}>
            {b.unidades >= 0 ? '+' : ''}
            {dec(b.unidades)} un. (ROI {pct(b.roi)})
          </dd>
          <dt>Acerto real × previsto</dt>
          <dd>
            {pct(b.taxaAcerto)} × {pct(b.pMedia)}
          </dd>
          <dt>CLV médio</dt>
          <dd>{b.nClv ? `${pct(b.clvMedio)} (${b.nClv} com odd de fechamento)` : '—'}</dd>
        </dl>
      )}
      <p className="dica">{dica}</p>
    </div>
  );
}

function par(c: string, f: string): ParPlacar | undefined {
  const a = num(c);
  const b = num(f);
  return a === undefined || b === undefined ? undefined : { casa: a, fora: b };
}

function FormResultado({
  e,
  onSalvar,
}: {
  e: EntradaHistorico;
  onSalvar: (r: EntradaHistorico['resultado']) => void;
}) {
  const r = e.resultado;
  const s = (x?: number) => (x === undefined ? '' : String(x));
  const [v, setV] = useState({
    casa: s(r?.casa),
    fora: s(r?.fora),
    htCasa: s(r?.intervalo?.casa),
    htFora: s(r?.intervalo?.fora),
    escCasa: s(r?.escanteios?.casa),
    escFora: s(r?.escanteios?.fora),
    carCasa: s(r?.cartoes?.casa),
    carFora: s(r?.cartoes?.fora),
    fechamento: s(r?.oddFechamento),
  });
  const campo = (k: keyof typeof v, rotulo: string) => (
    <label>
      {rotulo}
      <input
        inputMode="decimal"
        value={v[k]}
        onChange={(x) => setV({ ...v, [k]: x.target.value })}
      />
    </label>
  );
  const placar = par(v.casa, v.fora);
  const [casa, fora] = e.resumo.jogo.split(' × ');
  return (
    <div className="grade2">
      {campo('casa', `Gols ${casa}`)}
      {campo('fora', `Gols ${fora}`)}
      {campo('htCasa', `Intervalo ${casa}`)}
      {campo('htFora', `Intervalo ${fora}`)}
      {campo('escCasa', `Escanteios ${casa}`)}
      {campo('escFora', `Escanteios ${fora}`)}
      {campo('carCasa', `Amarelos ${casa}`)}
      {campo('carFora', `Amarelos ${fora}`)}
      {campo('fechamento', 'Odd de fechamento da entrada')}
      <div className="linha-acoes">
        <button
          className="primario"
          disabled={!placar}
          onClick={() =>
            placar &&
            onSalvar({
              ...placar,
              intervalo: par(v.htCasa, v.htFora),
              escanteios: par(v.escCasa, v.escFora),
              cartoes: par(v.carCasa, v.carFora),
              oddFechamento: num(v.fechamento),
              registradoEm: isoLocal(new Date()),
            })
          }
        >
          Salvar resultado
        </button>
        {r && (
          <button className="discreto" onClick={() => onSalvar(undefined)}>
            Apagar resultado
          </button>
        )}
      </div>
    </div>
  );
}

export function AbaHistorico({ historico, setHistorico, abrir }: Props) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const [json, setJson] = useState('');
  const bets = historico.filter((e) => e.resumo.decisao === 'BET');
  const comEntrada = historico.filter((e) => e.resumo.entrada);

  const mudar = (id: string, m: Partial<EntradaHistorico>) =>
    setHistorico(historico.map((e) => (e.id === id ? { ...e, ...m } : e)));

  function baixar() {
    const blob = new Blob([exportarJson(historico)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historico-analises-${isoLocal(new Date()).slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importar(texto: string) {
    const r = importarJson(texto, historico);
    if ('erro' in r) return setMsg({ tipo: 'alerta', texto: r.erro });
    setHistorico(r.lista);
    setMsg({ tipo: 'ok', texto: `${r.novas} análise(s) nova(s) importada(s).` });
    setJson('');
  }

  return (
    <section className="passo">
      <h2>Histórico</h2>
      <p className="dica">
        Salve cada análise na aba Análise. Depois do jogo, registre o placar aqui: o motor apura a
        aposta com as mesmas regras de liquidação. O histórico fica neste aparelho; use exportar /
        importar para levar ao celular ou guardar um backup.
      </p>

      <LinhaBalanco
        titulo={`Apostas (BET): ${bets.length}`}
        b={balanco(bets)}
        dica="1 unidade por aposta. Acerto real perto do previsto = motor calibrado; CLV positivo = você pega odds melhores que as de fechamento."
      />
      <LinhaBalanco
        titulo={`Todas as melhores entradas, no papel: ${comEntrada.length}`}
        b={balanco(comEntrada)}
        dica="Inclui WATCHLIST, INVESTIGAR e NO BET como se tivessem sido apostadas: mostra se os portões estão barrando entradas boas ou ruins."
      />

      {historico.length === 0 && <p>Nenhuma análise salva ainda.</p>}
      {historico.map((e) => {
        const ap = apurar(e);
        const ent = e.resumo.entrada;
        const fech = e.resultado?.oddFechamento;
        return (
          <details key={e.id} className="caixa">
            <summary>
              <span className={`selo ${CLASSE[e.resumo.decisao ?? ''] ?? 'nobet'}`}>
                {e.resumo.rotulo}
              </span>{' '}
              <strong>{e.resumo.jogo}</strong>{' '}
              <span className="miudo">
                {e.resumo.inicio.slice(0, 10).split('-').reverse().join('/')}
                {e.resumo.competicao && ` · ${e.resumo.competicao}`}
                {e.resultado && ` · ${e.resultado.casa}–${e.resultado.fora}`}
                {ap?.ok && ` · ${ap.rotulo} (${ap.lucro >= 0 ? '+' : ''}${dec(ap.lucro)} un.)`}
              </span>
            </summary>
            {ent ? (
              <p>
                Entrada: <strong>{ent.descricao}</strong> @ {ent.odd} ({ent.casa}) · EV{' '}
                {pct(ent.ev)}
                {ent.oddMinima !== undefined && ` · odd mínima ${dec(ent.oddMinima)}`}
                {ent.stake !== undefined && ` · stake ${pct(ent.stake, 2)} da banca`}
                {fech !== undefined && ` · CLV ${pct(clv(ent.odd, fech))}`}
              </p>
            ) : (
              <p className="miudo">Sem entrada candidata.</p>
            )}
            <ul className="miudo">
              {e.resumo.motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            {ap && !ap.ok && <div className="caixa alerta">Apuração: {ap.falta}</div>}
            <h4>Resultado do jogo</h4>
            <FormResultado
              key={e.resultado?.registradoEm ?? 'novo'}
              e={e}
              onSalvar={(resultado) => mudar(e.id, { resultado })}
            />
            <div className="linha-acoes">
              <button onClick={() => abrir(e.rascunho)}>Abrir a análise</button>
              <button
                className="perigo mini"
                onClick={() =>
                  confirm(`Apagar ${e.resumo.jogo} do histórico?`) &&
                  setHistorico(historico.filter((x) => x.id !== e.id))
                }
              >
                apagar
              </button>
            </div>
            <p className="miudo">Salva em {e.salvoEm.slice(0, 16).replace('T', ' ')}</p>
          </details>
        );
      })}

      <h3>Backup</h3>
      <div className="linha-acoes">
        <button onClick={baixar} disabled={!historico.length}>
          ⬇️ Exportar JSON
        </button>
        <label className="botao">
          ⬆️ Importar arquivo
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (x) => {
              const f = x.target.files?.[0];
              if (f) importar(await f.text());
              x.target.value = '';
            }}
          />
        </label>
      </div>
      <details>
        <summary>Colar JSON</summary>
        <textarea rows={4} value={json} onChange={(x) => setJson(x.target.value)} />
        <button onClick={() => importar(json)} disabled={!json.trim()}>
          Importar
        </button>
      </details>
      {msg && <div className={`caixa ${msg.tipo}`}>{msg.texto}</div>}
    </section>
  );
}
