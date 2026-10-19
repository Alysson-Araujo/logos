/**
 * Fundo da tela de login: o mapa vetorial do frame `Login · mapa` (880×900).
 *
 * As cores aqui são **literais de propósito**: o mapa é a "imagem" da tela, não
 * superfície de interface. Ele é o mesmo nos dois temas (como uma foto seria),
 * e é o degradê por cima que se ajusta ao tema. Um mapa que mudasse de tom a
 * cada tema deixaria de parecer um mapa.
 *
 * Tudo é `aria-hidden` e `pointer-events-none`: é decoração, e nada nela é
 * clicável — o leitor de tela não deve anunciar nem o chip nem o rótulo.
 */
export function LoginMap() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
      <svg
        viewBox="0 0 880 900"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        role="presentation"
      >
        <rect width="880" height="900" fill="#2a3a2c" />

        {/* vias secundárias: a malha fina que dá a leitura de "cidade" */}
        <g fill="none" stroke="#4b5c48" strokeWidth={5} strokeLinecap="round">
          <path d="M-30 250 L300 285 L620 210 L910 260" />
          <path d="M-30 430 L260 470 L520 420 L910 480" />
          <path d="M-30 640 L240 600 L560 660 L910 620" />
          <path d="M-30 820 L320 780 L640 850 L910 810" />
          <path d="M120 -30 L160 300 L90 620 L150 930" />
          <path d="M420 -30 L470 260 L400 560 L460 930" />
          <path d="M700 -30 L660 280 L730 600 L690 930" />
        </g>

        {/* arteriais: mais grossas, é por onde a rota corre */}
        <g fill="none" stroke="#63775c" strokeWidth={13} strokeLinecap="round">
          <path d="M-40 700 C180 640,300 520,470 430 S760 260,920 190" />
          <path d="M300 -40 C330 220,250 420,300 620 S380 830,360 940" />
        </g>

        {/* a rota: brilho por baixo, linha por cima — o "rail" do GPS */}
        <path
          d="M-40 700 C180 640,300 520,470 430 S760 260,920 190"
          fill="none"
          stroke="#2f6fed"
          strokeOpacity={0.2}
          strokeWidth={24}
          strokeLinecap="round"
        />
        <path
          d="M-40 700 C180 640,300 520,470 430 S760 260,920 190"
          fill="none"
          stroke="#5b9bff"
          strokeWidth={7}
          strokeLinecap="round"
        />

        <circle cx={248} cy={562} r={5.5} fill="#0d141d" stroke="#5b9bff" strokeWidth={2.5} />
        <circle cx={700} cy={306} r={5.5} fill="#0d141d" stroke="#5b9bff" strokeWidth={2.5} />

        {/* pino de posição */}
        <circle cx={470} cy={430} r={34} fill="#5b9bff" fillOpacity={0.16} />
        <circle cx={470} cy={430} r={13} fill="#5b9bff" stroke="#ffffff" strokeWidth={3} />
        <circle cx={470} cy={430} r={4} fill="#ffffff" />
      </svg>

      <span className="absolute left-[496px] top-[446px] font-mono text-2xs tracking-[0.4px] text-[#9fb0bd]">
        BR-116 · km 212
      </span>

      {/* chip de status: diz que o dado é vivo, sem parecer um incidente aberto */}
      <div className="absolute left-[500px] top-[360px] inline-flex items-center gap-1.5 rounded-sm border border-[#2a3542] bg-[#0e1620]/95 px-2.5 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
        <span className="text-2xs leading-none tracking-[0.6px] text-[#9fb0bd]">
          operação em tempo real
        </span>
      </div>
    </div>
  );
}
