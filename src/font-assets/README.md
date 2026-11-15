# Bundled font assets

Twenty additional families, each with unmodified static regular (400) and bold
(700) TrueType files. No font service, package install or network connection is
needed at runtime. Browser previews and graphics use the same files.

`sources.json` records the immutable Google Fonts repository commit, source URL,
original filenames and SHA-256 of each font. Each family directory retains its
original `OFL.txt` with copyright and redistribution terms. These font licences
apply independently of Storybench's source-code licence.

Keep original files and notices together when updating a family. Deck exports
copy only the selected families and their notices into the offline bundle.

The six pre-existing system families keep their existing package paths. Their
redistribution notices are retained for offline deck exports:

- DejaVu: https://github.com/dejavu-fonts/dejavu-fonts/blob/9b5d1b2ffeec20c7b46aa89c0223d783c02762cf/LICENSE
- Liberation: https://github.com/liberationfonts/liberation-fonts/blob/49e1358e4017577429c9f8c39a3e6e879093264e/LICENSE
