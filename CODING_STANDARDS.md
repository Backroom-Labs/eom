# Coding standards

These are review-time judgement calls that tooling can't check. Apply every rule to every diff; each breach is a finding.

## 1. Glossary terms in code

Identifiers, log messages and comments use `GLOSSARY.md` terms in their glossary sense, and steer clear of each term's _Avoid_ words. A name that reuses a glossary term for something else is a finding.
Example: `ota_session` (#39) clashed with the glossary's **Session**, which means one stretch of use recorded by the app.

## 2. Native test suite layout

A new suite under `test/` has `unit_under_test.c`, which includes the source under test, and `test_main.c`. When it needs fakes, they go in `fakes.c` and `fakes.h`.
Example: `test/test_control_command` (with fakes) and `test/test_ota_rx` (without).

## 3. Comments

A comment is one or two plain lines saying why the code is the way it is. Leave the what to the code, and keep notes to yourself out of the diff.
