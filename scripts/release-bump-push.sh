#!/usr/bin/env bash
# Uso (release-on-merge.yml): bash scripts/release-bump-push.sh <patch|minor|major|beta> <versão esperada>
#
# Sobe a versão (scripts/release.mjs: package.json, CHANGELOG, commit e tag) e empurra o commit e a
# tag para a main de uma vez. Se a main andou (outra PR mergeada no meio) e o push for recusado,
# refaz tudo em cima da main nova, até 3 vezes. Assim a versão sempre sai da main de agora, e rodar
# o workflow de novo também funciona (antes ele reusava o commit antigo e falhava de novo).
set -euo pipefail

kind="${1:?uso: release-bump-push.sh <patch|minor|major|beta> <versão esperada>}"
expected="${2:?uso: release-bump-push.sh <patch|minor|major|beta> <versão esperada>}"
tag="v$expected"

for attempt in 1 2 3; do
  git fetch --quiet origin main
  git checkout --quiet -B main origin/main
  git tag -d "$tag" >/dev/null 2>&1 || true # sobra de uma tentativa recusada

  node scripts/release.mjs "$kind"
  actual="$(node -p "require('./package.json').version")"
  if [ "$actual" != "$expected" ]; then
    echo "::error::A versão mudou desde o plano (esperada $expected, saiu $actual). Confira o package.json da main."
    exit 1
  fi

  if git push --atomic origin main "refs/tags/$tag"; then
    echo "Versão $expected enviada para a main (tentativa $attempt)."
    exit 0
  fi
  echo "::warning::O push foi recusado (a main mudou durante o release). Tentando de novo ($attempt/3)."
done

echo "::error::Não consegui enviar a versão $expected depois de 3 tentativas. Rode o workflow de novo ou lance à mão."
exit 1
