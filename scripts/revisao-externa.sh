#!/usr/bin/env bash
# Roda a revisão externa (Codex ou Gemini) de um head já publicado, com as
# duas proteções do /entregar:
#   1. worktree descartável no sha pedido, removido no fim;
#   2. ambiente por lista de permissão: o revisor não herda variável nenhuma
#      além das listadas em PERMITIDAS.
#
# Uso:
#   scripts/revisao-externa.sh codex  <sha> <arquivo-de-saída> "<foco>"
#   scripts/revisao-externa.sh gemini <sha> <arquivo-de-saída> "<foco>"
#   scripts/revisao-externa.sh gemini <sha> <arquivo-de-saída> "<foco>" <arquivo>...
#
# Com arquivos no fim, revisa só o diff deles (revisão em partes). Serve para
# o Gemini no Windows: o plugin passa o diff inteiro na linha de comando, que
# não aceita mais que ~32 mil caracteres; acima disso ele volta vazio.
#
# Só leitura: usa adversarial-review dos dois plugins. Nunca delegate.
set -euo pipefail

revisor="${1:?revisor: codex ou gemini}"
sha="${2:?sha completo do head do PR}"
saida="${3:?arquivo de saída}"
foco="${4:?foco da revisão}"
shift 4
arquivos=("$@") # opcional: revisa só o diff destes arquivos (revisão em partes)

# Só o que node, git, codex e agy precisam para rodar e autenticar no Windows.
# codex autentica por ~/.codex/auth.json e agy pelo Gerenciador de Credenciais:
# nenhum dos dois precisa de token em variável de ambiente.
PERMITIDAS=(PATH PATHEXT SYSTEMROOT COMSPEC USERPROFILE HOME APPDATA LOCALAPPDATA TEMP TMP)

ambiente_minimo() {
  local args=() v
  for v in "${PERMITIDAS[@]}"; do
    [ -n "${!v+x}" ] && args+=("$v=${!v}")
  done
  env -i "${args[@]}" "$@"
}

# Versões fixas dos plugins. A do Antigravity é a auditada: não troque sem
# nova auditoria. Se a versão instalada for outra, o script para.
VERSAO_CODEX=1.0.6
VERSAO_ANTIGRAVITY=0.3.0

plugin() { # plugin <marketplace> <nome> <versão> -> pasta dessa versão
  local d="$HOME/.claude/plugins/cache/$1/$2/$3"
  [ -d "$d" ] || { echo "plugin $2 $3 não está instalado em $d" >&2; exit 1; }
  printf '%s' "$d"
}

raiz=$(git rev-parse --show-toplevel)
git -C "$raiz" fetch --quiet origin
sha=$(git -C "$raiz" rev-parse --verify "$sha^{commit}")
if [ -z "$(git -C "$raiz" branch -r --points-at "$sha")" ]; then
  echo "o sha $sha não é o head de nenhuma branch publicada em origin" >&2
  exit 1
fi

rev="$(dirname "$raiz")/honorteam-revisao-${sha:0:12}"
[ -e "$rev" ] && { echo "já existe $rev: remova antes" >&2; exit 1; }
git -C "$raiz" worktree add --quiet --detach "$rev" "$sha"

limpa() {
  # O plugin do Codex deixa um app-server vivo com a pasta aberta; no Windows
  # isso impede a remoção. Pede o encerramento pelo próprio plugin primeiro.
  if [ "$revisor" = codex ]; then
    ( cd "$rev" 2>/dev/null && printf '{"cwd":"%s"}' "$(pwd -W 2>/dev/null || pwd)" |
        ambiente_minimo node "$(plugin openai-codex codex "$VERSAO_CODEX")/scripts/session-lifecycle-hook.mjs" SessionEnd ) \
      >/dev/null 2>&1 || true
  fi
  local i
  for i in 1 2 3 4 5; do
    git -C "$raiz" worktree remove --force "$rev" >/dev/null 2>&1 || true
    rm -rf "$rev" 2>/dev/null || true
    [ -e "$rev" ] || break
    sleep 2
  done
  git -C "$raiz" worktree prune
  if [ -e "$rev" ]; then
    echo "ATENÇÃO: não consegui remover $rev" >&2
  fi
}
trap limpa EXIT

base=origin/main
if [ "${#arquivos[@]}" -gt 0 ]; then
  # Revisão em partes: dentro do worktree descartável, monta dois commits
  # soltos. O primeiro é o head com os arquivos do grupo voltados à versão
  # da base; o segundo devolve esses arquivos à versão do head. O diff entre
  # os dois é só o grupo, e a árvore final é idêntica à do head revisado.
  mb=$(git -C "$rev" merge-base origin/main "$sha")
  commit() { git -C "$rev" -c user.name=revisao -c user.email=revisao@local commit --quiet --no-verify --allow-empty -m "$1"; }
  restaura() { # restaura <commit> <arquivo>
    if git -C "$rev" cat-file -e "$1:$2" 2>/dev/null; then
      git -C "$rev" checkout --quiet "$1" -- "$2"
    else
      git -C "$rev" rm --quiet --force --ignore-unmatch -- "$2"
    fi
  }
  for f in "${arquivos[@]}"; do restaura "$mb" "$f"; done
  commit "base da parte"
  base=$(git -C "$rev" rev-parse HEAD)
  for f in "${arquivos[@]}"; do restaura "$sha" "$f"; done
  commit "parte"
  if [ "$(git -C "$rev" rev-parse 'HEAD^{tree}')" != "$(git -C "$rev" rev-parse "$sha^{tree}")" ]; then
    echo "a árvore da parte difere da do head: abortando" >&2
    exit 1
  fi
fi

case "$revisor" in
  codex)
    ( cd "$rev" && ambiente_minimo node \
        "$(plugin openai-codex codex "$VERSAO_CODEX")/scripts/codex-companion.mjs" adversarial-review \
        --wait --base "$base" --scope branch "$foco" ) > "$saida"
    ;;
  gemini)
    ( cd "$rev" && ambiente_minimo node \
        "$(plugin dpa-antigravity antigravity "$VERSAO_ANTIGRAVITY")/scripts/antigravity.mjs" adversarial-review \
        --wait --base "$base" "$foco" ) > "$saida"
    ;;
  *)
    echo "revisor desconhecido: $revisor" >&2
    exit 1
    ;;
esac

if [ -n "$(git -C "$rev" status --porcelain)" ]; then
  echo "ATENÇÃO: o revisor alterou arquivos no worktree descartável:" >&2
  git -C "$rev" status --short >&2
fi
