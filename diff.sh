#!/bin/bash

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT" || exit 1

shopt -s extglob globstar nullglob 2>/dev/null

EXCLUDES=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -x|--exclude)
      shift
      if [[ $# -eq 0 ]]; then
        echo "error: -x/--exclude requires at least one pattern" >&2
        exit 1
      fi
      while [[ $# -gt 0 && "$1" != -* ]]; do
        EXCLUDES+=("$1")
        shift
      done
      ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [-x|--exclude <pattern>...] ...

  -x, --exclude   Omit one or more paths/globs from tracked and untracked diffs.
                  Accepts multiple patterns until the next flag, e.g.:
                    $(basename "$0") -x '*.csv' uv.lock 'data/**'

  Note: in zsh, quote glob patterns or run with 'setopt +o nomatch',
  otherwise zsh aborts before the script ever runs when a glob has no matches.
EOF
      exit 0
      ;;
    *)
      echo "error: unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

has_glob() {
  [[ "$1" == *[\*\?\[]* ]]
}

GIT_DIFF_PATHSPECS=(.)
for ex in "${EXCLUDES[@]}"; do
  if has_glob "$ex"; then
    GIT_DIFF_PATHSPECS+=(":(exclude,glob)$ex" ":(exclude,glob)**/$ex")
  else
    GIT_DIFF_PATHSPECS+=(":(exclude)$ex")
  fi
done

is_excluded() {
  local file="$1" base
  base="$(basename "$file")"
  local ex
  for ex in "${EXCLUDES[@]}"; do
    [[ "$file" == "$ex" ]] && return 0
    [[ "$base" == "$ex" ]] && return 0
    if has_glob "$ex"; then
      # shellcheck disable=SC2053
      [[ "$file" == $ex ]] && return 0
      # shellcheck disable=SC2053
      [[ "$base" == $ex ]] && return 0
    fi
  done
  return 1
}

echo "=== Modified tracked files ==="
if [[ ${#EXCLUDES[@]} -eq 0 ]]; then
  git diff
else
  git diff -- "${GIT_DIFF_PATHSPECS[@]}"
fi

echo -e "\n=== Untracked file diffs ==="
while IFS= read -r -d '' file; do
  if is_excluded "$file"; then
    continue
  fi
  echo -e "\n--- $file ---"
  git diff --no-index /dev/null "$file"
done < <(git ls-files -z --others --exclude-standard)
