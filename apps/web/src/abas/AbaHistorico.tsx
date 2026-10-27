import { NOMES_ESTRATEGIA, type Estrategia, type ParPlacar, type TravasBanca } from '@pe/engine';
import { useState } from 'react';
import { dec, isoLocal, num, pct, type Rascunho } from '../estado';
import {
  apurar,
  balanco,
  calibracao,
  clvDe,
  exportarJson,
  importarJson,
  marco,
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
  bancaInicial: number | null;
  setBancaInicial: (v: number | null) => void;
  travas: TravasBanca | null;
}

function LinhaBalanco({ titulo, b, dica }: { titulo: string; b: Balanco; dica?: string }) {
  return (
    <div className="caixa">
      <h3>{titulo}</h3>
      {b.apuradas === 0 && b.nClv === 0 ? (
        <p className="miudo">Nada apurado ainda: registre o placar e o fechamento abaixo.</p>
      ) : (
        <dl className="numeros">
          <dt>CLV médio</dt>
          <dd className={(b.clvMedio ?? 0) > 0 ? 'positivo' : 'negativo'}>
            {b.nClv ? `${pct(b.clvMedio)} (${b.nClv} com fechamento)` : '—'}
          </dd>
          <dt>Resultado</dt>
          <dd>
            {b.apuradas
              ? `${b.unidades >= 0 ? '+' : ''}${dec(b.unidades)} un. em ${b.apuradas} (ROI ${pct(b.roi)})`
              : '—'}
          </dd>
          <dt>Acerto real × previsto</dt>
          <dd>{b.apuradas ? `${pct(b.taxaAcerto)} × ${pct(b.pMedia)}` : '—'}</dd>
        </dl>
      )}
      {dica && <p className="dica">{dica}</p>}
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
    outros: (r?.fechamentoOutros ?? []).join(' '),
  });
  const campo = (k: keyof typeof v, rotulo: string, dica?: string) => (
    <label>
      {rotulo}
      <input
        inputMode="decimal"
        value={v[k]}
        placeholder={dica}
        onChange={(x) => setV({ ...v, [k]: x.target.value })}
      />
    </label>
  );
  const placar = par(v.casa, v.fora);
  const [casa, fora] = e.resumo.jogo.split(' × ');
  const outros = v.outros
    .split(/[\s;]+/)
    .map((x) => num(x))
    .filter((x): x is number => x !== undefined && x > 1);
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
      {campo('fechamento', 'Fechamento da referência (lado apostado)', 'ex.: 1.85')}
      {campo('outros', 'Fechamento dos outros lados', 'ex.: 2.05 (ou 3.4 5.2)')}
      <div className="linha-acoes">
        <button
          className="primario"
          disabled={!placar && num(v.fechamento) === undefined}
          onClick={() =>
            onSalvar({
              casa: placar?.casa ?? Number.NaN,
              fora: placar?.fora ?? Number.NaN,
              intervalo: par(v.htCasa, v.htFora),
              escanteios: par(v.escCasa, v.escFora),
              cartoes: par(v.carCasa, v.carFora),
              oddFechamento: num(v.fechamento),
              fechamentoOutros: outros.length ? outros : undefined,
              registradoEm: isoLocal(new Date()),
            })
          }
        >
          Salvar
        </button>
        {r && (
          <button className="discreto" onClick={() => onSalvar(undefined)}>
            Apagar resultado
          </button>
        )}
      </div>
      <p className="dica">
        O fechamento é a odd da Pinnacle/Betfair (ou do consenso) logo antes do jogo. Com os outros
        lados, o CLV sai contra o preço justo, sem margem.
      </p>
    </div>
  );
}

export function AbaHistorico({
  historico,
  setHistorico,
  abrir,
  bancaInicial,
  setBancaInicial,
  travas,
}: Props) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'alerta'; texto: string } | null>(null);
  const [json, setJson] = useState('');
  const bets = historico.filter((e) => e.resumo.decisao === 'BET');
  const comEntrada = historico.filter((e) => e.resumo.entrada);
  const cal = calibracao(historico);

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
        Salve cada análise na aba Análise. Depois do jogo, registre o placar e o fechamento da
        referência: o <strong>CLV</strong> diz se há vantagem muito antes do lucro. Nunca julgue por
        green/red. O histórico fica neste aparelho: exporte para backup ou para o celular.
      </p>

      <div className="caixa">
        <h3>Banca separada</h3>
        <label>
          Banca inicial (R$), definida uma vez
          <input
            inputMode="decimal"
            defaultValue={bancaInicial ?? ''}
            onBlur={(x) => setBancaInicial(num(x.target.value) ?? null)}
          />
        </label>
        {travas ? (
          <>
            <dl className="numeros">
              <dt>Banca atual</dt>
              <dd>R$ {dec(travas.bancaAtual)}</dd>
              <dt>Drawdown</dt>
              <dd className={travas.drawdown >= 0.2 ? 'negativo' : ''}>
                {pct(travas.drawdown)} (pico R$ {dec(travas.pico)})
              </dd>
              <dt>Apostado hoje</dt>
              <dd>{pct(travas.expostoHoje)} de 6%</dd>
            </dl>
            {travas.motivos.length > 0 && (
              <div className="caixa alerta">
                <ul>
                  {travas.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="dica">
              A stake de cada análise é calculada sobre a banca atual (encolhe sozinha nas perdas).
              Travas: drawdown 20% → Kelly pela metade; 30% → pausa de 7 dias; 5 perdas no dia →
              encerrar o dia. Nunca recarregar para recuperar perda.
            </p>
          </>
        ) : (
          <p className="miudo">
            Defina a banca para ligar as travas automáticas e ver a stake em R$.
          </p>
        )}
      </div>

      <LinhaBalanco
        titulo={`Apostas (BET): ${bets.length}`}
        b={balanco(bets)}
        dica="1 unidade por aposta. CLV positivo = você pega odds melhores que o fechamento justo."
      />
      {(['S1', 'S2', 'S3', 'S4'] as Estrategia[]).map((s) => {
        const daS = bets.filter((e) => e.resumo.entrada?.estrategia === s);
        if (!daS.length) return null;
        const b = balanco(daS);
        return (
          <LinhaBalanco
            key={s}
            titulo={`${NOMES_ESTRATEGIA[s]}: ${daS.length}`}
            b={b}
            dica={marco(b)}
          />
        );
      })}
      <LinhaBalanco
        titulo={`Todas as melhores entradas, no papel: ${comEntrada.length}`}
        b={balanco(comEntrada)}
        dica="Inclui WATCHLIST, INVESTIGAR e NO BET como se tivessem sido apostadas: mostra se os gates estão barrando entradas boas ou ruins."
      />
      <div className="caixa">
        <h3>Modelo × mercado (Brier, {cal.jogos} jogos)</h3>
        {cal.brier1x2 || cal.brierOU ? (
          <dl className="numeros">
            {cal.brier1x2 && (
              <>
                <dt>1X2</dt>
                <dd>
                  modelo {cal.brier1x2.modelo.toFixed(3)} × mercado{' '}
                  {cal.brier1x2.mercado.toFixed(3)}
                </dd>
              </>
            )}
            {cal.brierOU && (
              <>
                <dt>Over/Under 2.5</dt>
                <dd>
                  modelo {cal.brierOU.modelo.toFixed(3)} × mercado {cal.brierOU.mercado.toFixed(3)}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="miudo">Registre placares de jogos analisados (inclusive NO BET).</p>
        )}
        <p className="dica">
          Menor = melhor. Se o modelo não ganhar do mercado em ~100 jogos, reduzir o peso dele.
        </p>
      </div>

      {historico.length === 0 && <p>Nenhuma análise salva ainda.</p>}
      {historico.map((e) => {
        const ap = apurar(e);
        const ent = e.resumo.entrada;
        const c = clvDe(e);
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
                {ap && ` · ${e.resultado!.casa}–${e.resultado!.fora}`}
                {ap?.ok && ` · ${ap.rotulo} (${ap.lucro >= 0 ? '+' : ''}${dec(ap.lucro)} un.)`}
                {c !== null && ` · CLV ${pct(c)}`}
              </span>
            </summary>
            {ent ? (
              <p>
                Entrada: <strong>{ent.descricao}</strong> @ {ent.odd} ({ent.casa}) · EV{' '}
                {pct(ent.ev)}
                {ent.nivel && ` · ${ent.nivel}`}
                {ent.estrategia && ` · ${ent.estrategia}`}
                {ent.oddMinima !== undefined && ` · odd mínima ${dec(ent.oddMinima)}`}
                {ent.stake !== undefined &&
                  ` · stake ${pct(ent.stake, 2)}${ent.stakeValor !== undefined ? ` (R$ ${dec(ent.stakeValor)})` : ''}`}
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
            <h4>Resultado e fechamento</h4>
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
            <p className="miudo">
              Salva em {e.salvoEm.slice(0, 16).replace('T', ' ')} · protocolo{' '}
              {e.resumo.protocolo ?? 'V3.3'}
            </p>
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
