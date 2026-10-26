# Galastri Disable DocBlocks Highlights

Extensão pessoal para VS Code que deixa DocBlocks e outros comentários de
documentação com a mesma aparência dos comentários comuns do tema ativo.

Não é necessário escolher cores nem editar o `settings.json`. A extensão lê o
tema atual, inclusive seus arquivos de herança e personalizações de comentários,
e aplica essa aparência automaticamente. Ao trocar de tema, a aparência acompanha.

## Instalação

1. Abra a aba **Actions** deste repositório.
2. Abra a execução mais recente de **Build Galastri Disable DocBlocks Highlights**.
3. Em **Artifacts**, baixe `galastri-disable-docblocks-highlights-vsix`.
4. Extraia o ZIP e localize `galastri-disable-docblocks-highlights.vsix`.
5. No VS Code, abra **Extensions → … → Install from VSIX…** e selecione o arquivo.

A extensão já inicia habilitada. Se o VS Code solicitar, recarregue a janela.
O Action roda em pushes na `main`, pull requests e pelo botão **Run workflow**.
Ele verifica o JavaScript, executa verificações pequenas e empacota o `.vsix` no
Windows, seguindo a estrutura do Action do Galastri Ataula.

## Linguagens e comportamento

- Descobre as gramáticas das linguagens instaladas, sem uma lista fixa de PHP,
  JavaScript, TypeScript ou outras linguagens.
- Usa os tokens reais dessas gramáticas para reconhecer os comentários. Não
  procura `/** ... */` no código com uma expressão regular.
- Uniformiza o conteúdo dos comentários, incluindo tags como `@param`, tipos,
  exemplos de código e marcações XML. Isso também remove destaques internos de
  comentários comuns, por exemplo `TODO`, quando produzidos pela gramática.
- Reconhece docstrings quando a gramática as identifica com escopos `docstring`
  ou `documentation` e as apresenta como comentários comuns.
- Mantém a sintaxe, o conteúdo dos arquivos, o IntelliSense e as configurações de
  cores intactos. O efeito é uma decoração visual removida ao desabilitar a extensão.
- Processa a área visível e mantém o estado das linhas anteriores para reconhecer
  corretamente comentários de várias linhas. Reaproveita esse estado até haver edição.

O suporte depende de a gramática instalada identificar comentários ou docstrings
como tais. Linguagens sem gramática TextMate, documentação classificada como texto
comum ou strings sem marcação de docstring não podem ser reconhecidas com segurança.
Outras extensões que aplicam suas próprias decorações também podem interferir.

## Controles

Na paleta de comandos (`Ctrl+Shift+P`):

**Galastri DocBlocks: Toggle Highlights Suppression**

Nas configurações:

| Configuração | Padrão | Efeito |
| --- | --- | --- |
| `disableDocblocksHighlights.enabled` | `true` | Habilita ou desabilita o efeito. |
| `disableDocblocksHighlights.excludedLanguages` | `[]` | Ignora os IDs de linguagem informados. |

Problemas de leitura de tema ou gramática aparecem em **Output → Galastri DocBlocks**.

## Desenvolvimento

Requer Node.js 22.

```bash
npm ci
npm run check
npm test
npm run package:vsix
```

O pacote final fica em `dist/galastri-disable-docblocks-highlights.vsix`.
Nenhuma publicação no Marketplace é feita pelo Action.
