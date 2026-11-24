/**
 * Camada tática do fundo (tema "broadcast + HUD"): linhas de campo e radar em esmeralda nas
 * bases, vetores de passe, trajetórias pontilhadas e nós em ciano (esquerda) e laranja (direita).
 * Pura decoração: fixa, sem clique, sem dado — nada aqui representa um jogo real.
 */

/** nós de um "mapa de passes": [x, y, raio] */
const NOS_CIANO: [number, number, number][] = [
  [92, 250, 5],
  [176, 318, 4],
  [128, 420, 6],
  [228, 470, 4],
  [70, 560, 4],
];
const NOS_LARANJA: [number, number, number][] = [
  [1352, 240, 5],
  [1262, 330, 4],
  [1318, 430, 6],
  [1208, 482, 4],
  [1380, 566, 4],
];

export function OverlayTatico() {
  return (
    <svg
      className="overlay-tatico"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <marker
          id="ot-seta-c"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="#38bdf8" />
        </marker>
        <marker
          id="ot-seta-l"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 Z" fill="#f97316" />
        </marker>
        <radialGradient id="ot-calor-c">
          <stop offset="0" stopColor="#38bdf8" stopOpacity=".55" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ot-calor-l">
          <stop offset="0" stopColor="#f97316" stopOpacity=".55" />
          <stop offset="1" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* base esquerda: grande área, arco da área e arcos de radar (esmeralda) */}
      <g className="ot-campo" stroke="#10b981" fill="none" strokeWidth="1.5">
        <path d="M0 640 H210 V900" />
        <path d="M0 730 H96 V900" />
        <path d="M210 712 A86 86 0 0 1 210 828" />
        <circle cx="0" cy="900" r="330" strokeDasharray="2 8" />
        <circle cx="0" cy="900" r="420" strokeOpacity=".6" />
        <path d="M0 470 L330 900" strokeOpacity=".45" />
      </g>
      {/* base direita, espelhada */}
      <g className="ot-campo" stroke="#10b981" fill="none" strokeWidth="1.5">
        <path d="M1440 640 H1230 V900" />
        <path d="M1440 730 H1344 V900" />
        <path d="M1230 712 A86 86 0 0 0 1230 828" />
        <circle cx="1440" cy="900" r="330" strokeDasharray="2 8" />
        <circle cx="1440" cy="900" r="420" strokeOpacity=".6" />
        <path d="M1440 470 L1110 900" strokeOpacity=".45" />
      </g>

      {/* lateral esquerda: mapa de passes em ciano */}
      <g stroke="#38bdf8" fill="none" strokeWidth="1.6">
        <circle cx="128" cy="420" r="70" fill="url(#ot-calor-c)" stroke="none" />
        <path d="M92 250 L170 312" markerEnd="url(#ot-seta-c)" />
        <path d="M176 318 Q200 380 136 414" markerEnd="url(#ot-seta-c)" />
        <path d="M128 420 L222 466" markerEnd="url(#ot-seta-c)" />
        <path d="M70 560 Q40 470 120 426" strokeDasharray="4 6" markerEnd="url(#ot-seta-c)" />
        <path d="M228 470 Q330 520 300 640" strokeDasharray="3 7" strokeOpacity=".7" />
        {NOS_CIANO.map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#05111f" />
        ))}
      </g>

      {/* lateral direita: vetores e mapa de calor em laranja */}
      <g stroke="#f97316" fill="none" strokeWidth="1.6">
        <circle cx="1318" cy="430" r="70" fill="url(#ot-calor-l)" stroke="none" />
        <path d="M1352 240 L1268 324" markerEnd="url(#ot-seta-l)" />
        <path d="M1262 330 Q1236 392 1310 424" markerEnd="url(#ot-seta-l)" />
        <path d="M1318 430 L1214 478" markerEnd="url(#ot-seta-l)" />
        <path d="M1380 566 Q1410 480 1326 436" strokeDasharray="4 6" markerEnd="url(#ot-seta-l)" />
        <path d="M1208 482 Q1110 540 1140 650" strokeDasharray="3 7" strokeOpacity=".7" />
        {NOS_LARANJA.map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#1a0b03" />
        ))}
      </g>

      {/* radar no alto à direita: anéis e um polígono de perfil */}
      <g className="ot-radar" fill="none" strokeWidth="1.2" transform="translate(1300 150)">
        {[28, 52, 76].map((r) => (
          <circle key={r} r={r} stroke="#38bdf8" strokeOpacity=".5" />
        ))}
        <path d="M0 -76 V76 M-76 0 H76" stroke="#38bdf8" strokeOpacity=".35" />
        <path
          d="M0 -58 L44 -14 L30 40 L-22 50 L-50 -6 Z"
          stroke="#10b981"
          fill="#10b981"
          fillOpacity=".12"
        />
        <path d="M0 0 L54 -54" stroke="#f97316" strokeWidth="2" />
      </g>
    </svg>
  );
}
