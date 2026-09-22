# Contributing to Storybench

Thanks for your interest in Storybench. It is a small, early-stage project, and
the notes below describe how to build it, test it, and get a change merged.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug or request a feature with the [issue templates](https://github.com/jedbjorn/storybench/issues/new/choose).
- Open a pull request from a fork.
- Improve documentation, tests, or the browser UI.

For anything larger than a focused fix, open an issue first so the approach can
be agreed before you invest time in it.

## Development setup

Storybench targets Node.js 24 or newer. From a clean clone:

```sh
npm ci
npm test
npm run lint
```

- `npm test` runs the Node test suite.
- `npm run lint` rebuilds the browser editor bundle and syntax-checks the
  declared server, browser, CLI and runtime entry points.

Run both before you open a pull request; CI runs the same commands on every
push and pull request.

Development commands do not install or start the user service. Exercise
installer and lifecycle work only with disposable XDG paths, data, ports and a
namespaced unit. Because `systemd --user` reads units only from its own
configuration directory, a disposable `XDG_CONFIG_HOME` needs
`STORYBENCH_UNIT_DIR` set to a directory the live manager searches (for example
`$XDG_RUNTIME_DIR/systemd/user`), plus `STORYBENCH_UNIT_NAME` for the
namespaced unit.

See [README.md](README.md) for the full install, lifecycle and architecture
description.

## Branches and pull requests

- Branch from `main` with a `type/short-description` name, where `type` is one
  of `feat`, `fix`, `chore`, or `docs`.
- Keep one logical change per branch and per pull request.
- Write a concise, factual commit message in the imperative mood.
- Open the pull request against `main` and describe what changed and how you
  verified it (commands you ran, results you saw).
- Keep pull requests focused; split unrelated changes into separate ones.

## The merge gate

`main` is protected and is the source of truth for the project.

- A pull request and a passing `test` / `node` status check are required.
- **Only the repository admin merges to `main`.** Contributors and anyone
  working from a fork never push directly to `main`; that is enforced by a
  branch ruleset, not just a convention.
- Forks are yours to use freely — branch, experiment and commit there without
  restriction. The protected action is merging into the upstream repository.
- A change may be declined or asked to change; please keep the discussion
  civil and technical.

## Licensing

Storybench is released under the [MIT License](LICENSE). By submitting a pull
request you agree that your contribution is licensed under the same terms.

## Credits

Storybench is built with [Subfloor](https://github.com/jedbjorn/subfloor), an
open-source meta-harness for running coding agents against a repository.
