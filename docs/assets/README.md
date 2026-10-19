# Assets da documentação

Prints, GIFs e diagramas usados na documentação. As imagens referenciadas pelo
[`README.md`](../../README.md) são capturas reais da aplicação publicada, em
1440 × 900 e tema claro (salvo indicação em contrário).

| Arquivo                | O que mostra                                                                    |
| ---------------------- | ------------------------------------------------------------------------------- |
| `login.png`            | Tela de login com a credencial de demonstração preenchida e a caixa de acesso   |
| `triagem.png`          | Triagem: KPIs por status, filtros e a fila ordenada por prioridade              |
| `drawer-detalhe.png`   | Drawer de detalhe: transições, consumo do prazo e a decomposição do score       |
| `novo-incidente.png`   | Registro de incidente com as sugestões de placa da frota abertas                |
| `contas-de-acesso.png` | Administração de contas por convite (papel `ADMIN`)                             |
| `triagem-escuro.png`   | A mesma triagem em tema escuro                                                  |
| `triagem-mobile.png`   | A mesma triagem em 390 × 844 (o print sai em 2×, para não ficar borrado no HiDPI) |

## Regerar

```bash
node scripts/captura.mjs                 # todas
node scripts/captura.mjs triagem login   # só as nomeadas
```

O script usa `playwright-core` com o **Edge já instalado no sistema**
(`channel: 'msedge'`) — não baixa navegador. A URL padrão é a da aplicação
publicada; `LOGOS_APP_URL` aponta para outro ambiente:

```bash
LOGOS_APP_URL=http://localhost:5173 node scripts/captura.mjs
```

Cada PNG fica abaixo de ~400 KB para não engordar o repositório. Se uma captura
nova passar disso, revise o enquadramento antes de commitar o arquivo.
