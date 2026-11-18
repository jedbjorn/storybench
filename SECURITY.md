# Security Policy

## Supported versions

Storybench is early-stage software. Security fixes are applied to the latest
`main` and to the most recent release only. Older commits and releases are not
supported.

| Version        | Supported |
|----------------|-----------|
| Latest `main`  | Yes       |
| Latest release | Yes       |
| Older releases | No        |

## Reporting a vulnerability

Please do not report security issues in public issues, discussions, or pull
requests.

Preferred: use GitHub's private vulnerability reporting on this repository
(**Security** tab -> **Report a vulnerability**). If that form is not
available, contact the maintainer through the GitHub profile at
<https://github.com/jedbjorn>.

Please include:

- what the issue is and where it lives (file, command, or endpoint);
- steps to reproduce it, or a proof of concept;
- the impact you believe it has;
- any suggested fix, if you have one.

## Reports prepared by the production agent

The production agent can prepare an issue for this repository when you ask it
to (see the README). It never prepares a security problem as a public issue; it
points you to the private advisory form above.

What that feature sends and where:

- The app makes unauthenticated read requests to GitHub's public API with
  search words or an issue number. Storybench holds no GitHub credential and
  writes nothing to GitHub.
- A prepared report is stored in your installation's database with its
  production and conversation, and is removed with them. Its text reaches
  GitHub only inside the address your own browser opens, and becomes public
  only when you press Submit.
- The destination repository is fixed in the app's package metadata. No chat
  message, tool input or production content can change it.
- A report containing the provider credential passed to that agent request is
  refused. This screens that one credential only: read the form before you
  submit, because everything in it becomes public.
- Text the agent reads back from an issue is public content written by anyone.
  The agent treats it as information, never as instruction.

## What to expect

- We aim to acknowledge a report within a few days.
- We will investigate, keep you updated on progress, and credit you in the fix
  unless you ask us not to.
- Please give us a reasonable window to release a fix before any public
  disclosure.

## Handling secrets

Storybench reuses your host logins at `~/.codex/auth.json` and
`~/.claude/.credentials.json`. Never paste credentials, tokens, or an
environment dump into a bug report, issue, or pull request. If you believe a
credential has been exposed, rotate it with the provider first.
