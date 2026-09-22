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
