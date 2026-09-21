#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'storybench installer: %s\n' "$1" >&2
  exit 1
}

if [[ ${1-} == --help || ${1-} == -h ]]; then
  cat <<'EOF'
Usage: ./install.sh

Install the exact commit from this clean private checkout for the current Linux user.
The installer uses XDG locations, never sudo, never edits shell startup files, and does
not start Storybench. Host requirements: Node 24+, Git, Docker and systemd --user.
EOF
  exit 0
fi
[[ $# -eq 0 ]] || fail "this bootstrap takes no options (run ./install.sh --help)"
[[ $(id -u) -ne 0 ]] || fail "refusing to install as root; run this as the account that will use Storybench"
[[ $(uname -s) == Linux ]] || fail "unsupported platform $(uname -s); this release supports Linux with systemd --user"

for command in node npm git docker systemctl tar df; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required and was not found on PATH"
done
NODE_VERSION=$(node --version 2>/dev/null) || fail "Node.js could not be executed"
NODE_MAJOR=${NODE_VERSION#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
[[ $NODE_MAJOR =~ ^[0-9]+$ && $NODE_MAJOR -ge 24 ]] || fail "Node.js 24 or newer is required (found $NODE_VERSION)"

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
TOP=$(git -C "$SOURCE" rev-parse --show-toplevel 2>/dev/null) || fail "$SOURCE is not a Git checkout"
[[ $(cd -- "$TOP" && pwd -P) == "$SOURCE" ]] || fail "install.sh must be run from the root of its Git checkout"
[[ -z $(git -C "$SOURCE" status --porcelain --untracked-files=all) ]] || fail "the checkout is not clean; commit, stash or remove every tracked and untracked change"
COMMIT=$(git -C "$SOURCE" rev-parse HEAD) || fail "cannot resolve the checked-out commit"
[[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || fail "Git returned an invalid commit identity"
REMOTE=$(git -C "$SOURCE" remote get-url origin 2>/dev/null) || fail "the checkout has no configured origin remote"
[[ -n $REMOTE ]] || fail "the checkout's origin URL is empty"
REF=$(git -C "$SOURCE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [[ -z $REF ]]; then
  REF=$(git -C "$SOURCE" describe --all --exact-match HEAD 2>/dev/null || printf 'commit/%s' "$COMMIT")
fi

DOCKER_VERSION=$(docker info --format '{{.ServerVersion}}' 2>/dev/null) || fail "Docker is not usable by this user; start/configure the user-accessible daemon and retry (do not use sudo)"
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null) || fail "Docker did not report its image-store location"
[[ -n $DOCKER_VERSION ]] || fail "Docker did not report a server version"
systemctl --user show-environment >/dev/null 2>&1 || fail "systemd --user is unavailable; run from a normal login session with a user manager"
[[ -n ${XDG_RUNTIME_DIR-} && ${XDG_RUNTIME_DIR:0:1} == / && -d $XDG_RUNTIME_DIR && -w $XDG_RUNTIME_DIR ]] || fail "XDG_RUNTIME_DIR must name a writable absolute directory from the active user session"

HOME_DIR=${HOME-}
[[ -n $HOME_DIR && ${HOME_DIR:0:1} == / && -d $HOME_DIR && -w $HOME_DIR ]] || fail "HOME must name a writable absolute directory owned by this user"
for variable in XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME; do
  value=${!variable-}
  [[ -z $value || ${value:0:1} == / ]] || fail "$variable must be an absolute path when set"
done
MIN_FREE_KB=${STORYBENCH_MIN_FREE_KB:-5242880}
[[ $MIN_FREE_KB =~ ^[0-9]+$ && $MIN_FREE_KB -gt 0 ]] || fail "STORYBENCH_MIN_FREE_KB must be a positive integer"
for target in "${XDG_CONFIG_HOME:-$HOME_DIR/.config}" "${XDG_DATA_HOME:-$HOME_DIR/.local/share}" "${XDG_STATE_HOME:-$HOME_DIR/.local/state}" "$HOME_DIR/.local/bin"; do
  candidate=$target
  while [[ ! -e $candidate ]]; do candidate=$(dirname -- "$candidate"); done
  [[ -d $candidate && -w $candidate && -O $candidate ]] || fail "$target cannot be created in a writable directory owned by this user"
done
for target in "${XDG_DATA_HOME:-$HOME_DIR/.local/share}" "$DOCKER_ROOT"; do
  candidate=$target
  while [[ ! -e $candidate ]]; do candidate=$(dirname -- "$candidate"); done
  FREE_KB=$(df -Pk "$candidate" 2>/dev/null | awk 'NR==2 {print $4}')
  [[ $FREE_KB =~ ^[0-9]+$ && $FREE_KB -ge $MIN_FREE_KB ]] || fail "insufficient free space for $target (need at least $((MIN_FREE_KB / 1024)) MiB)"
done

printf 'Storybench installer preflight passed.\n'
printf '  source: %s\n  commit: %s\n  ref: %s\n' "$SOURCE" "$COMMIT" "$REF"
exec node "$SOURCE/bin/storybench.mjs" __install \
  --source "$SOURCE" --commit "$COMMIT" --remote "$REMOTE" --ref "$REF" --docker-version "$DOCKER_VERSION"
