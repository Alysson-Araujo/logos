/**
 * Verifica o tamanho do bundle depois do build.
 *
 * **Por que isto existe.** O `deploy-aws.yml` publica a cada merge na `main`, e
 * nada no caminho olha o tamanho do que foi publicado. Uma dependência pesada
 * entra num PR de rotina, o bundle dobra, e ninguém percebe até alguém abrir a
 * tela numa rede ruim — que é exatamente a condição de quem usa isto: um centro
 * de controle com TV ligada e internet que não é confiável.
 *
 * **Por que gzip, e não o tamanho do arquivo.** O que trafega é o comprimido. Um
 * bundle de 250 kB que comprime para 72 kB chega ao navegador como 72 kB; olhar
 * o cru mediria a coisa errada e assustaria sem motivo.
 *
 * **O orçamento é teto, não meta.** Ele existe para pegar salto, não para
 * impedir crescimento: o número tem folga sobre o valor medido, e subir o teto é
 * uma decisão consciente que aparece no diff — que é o ponto.
 */

import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIRETORIO = 'dist/assets';

/**
 * Teto por tipo de arquivo, em bytes.
 *
 * **Calibrado sobre o build real, e não no chute.** O app faz code-splitting,
 * então o total é a soma dos chunks:
 *
 *     browser-*.js   299 kB   biblioteca do mapa (tela de login, PR #148)
 *     index-*.js     255 kB   a aplicação
 *     react-*.js     140 kB
 *     radix-*.js     126 kB
 *     query-*.js      66 kB
 *
 * O teto anterior (320 kB) foi medido antes do mapa existir e passou a acusar um
 * crescimento **legítimo**. O número de hoje é o medido mais ~13% de folga:
 * espaço para crescer, mas não para dobrar.
 *
 * Se este teto for atingido, a pergunta certa não é "como aumento o teto" e sim
 * "o que entrou" — a resposta está no `vite build`, que imprime o tamanho por
 * chunk.
 */
const ORCAMENTO = {
  '.js': { cru: 1000 * 1024, gzip: 310 * 1024 },
  '.css': { cru: 60 * 1024, gzip: 18 * 1024 },
};

function arquivosDoTipo(extensao) {
  return readdirSync(DIRETORIO)
    .filter((nome) => nome.endsWith(extensao))
    .map((nome) => join(DIRETORIO, nome));
}

function kB(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

if (!statSync(DIRETORIO, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`  ${DIRETORIO} não existe. Rode o build antes.`);
  process.exit(1);
}

let estourou = false;

for (const [extensao, teto] of Object.entries(ORCAMENTO)) {
  const arquivos = arquivosDoTipo(extensao);
  if (arquivos.length === 0) continue;

  let cru = 0;
  let comprimido = 0;
  for (const arquivo of arquivos) {
    const conteudo = readFileSync(arquivo);
    cru += conteudo.byteLength;
    comprimido += gzipSync(conteudo, { level: 9 }).byteLength;
  }

  const passou = cru <= teto.cru && comprimido <= teto.gzip;
  if (!passou) estourou = true;

  const marca = passou ? '✓' : '✗';
  console.log(
    `  ${marca} ${extensao.padEnd(5)} ${kB(cru).padStart(10)} cru ` +
      `(${kB(teto.cru)} de teto) · ${kB(comprimido).padStart(9)} gzip ` +
      `(${kB(teto.gzip)} de teto)`,
  );
}

if (estourou) {
  console.error(
    '\n  O bundle passou do teto. Se o crescimento é justificado, suba o teto em\n' +
      '  scripts/verifica-bundle.mjs — e diga no PR por que vale a pena.',
  );
  process.exit(1);
}

console.log('\n  bundle dentro do orçamento.');
