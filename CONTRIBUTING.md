# Contributing

Thanks for looking. A few honest words before you invest time.

## What this project is

Hauser is a reference implementation: a design system, a documented current
architecture, and a working smart home interface built for one specific home. It
is published so others can read it, run it, and take ideas from it — not as a
product with a roadmap driven by user requests.

It is maintained by one person in their spare time. **Response times are
unpredictable and may be measured in weeks.** That is not indifference; it is
capacity. If that does not work for you, forking is genuinely a good option and
the license exists to make it easy.

## What is welcome

- **Bug reports** with enough detail to reproduce.
- **Questions about how something works.** If the docs did not answer it, that
  is useful signal by itself.
- **Small, focused pull requests** — a fix, a clarification, a rough edge
  smoothed over.
- **Ports and adaptations.** If you build something on top of this, I would
  genuinely like to see it.

## What is unlikely to be merged

- Large refactors or architecture changes. The current boundaries are documented
  in `docs/00-architecture.md`; open an issue before changing them.
- New integrations with services I cannot test against.
- Build tooling swaps, dependency additions for their own sake, or changes that
  add abstraction for hypothetical future needs.
- Anything that regresses the performance budget in
  `docs/03-performance-budget.md`. That budget is the point of the project.

## Before you open a pull request

```bash
cd app
npm install
npm run check     # svelte-check / TypeScript
npm run build     # must succeed
```

Keep the diff focused. Match the surrounding style rather than introducing your
own. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## Language

The interface ships in six languages; the message catalogues live in
`app/messages/`. Public documentation and contributor-facing prose are in
English. Existing inline code comments may still be German. Issues may be
opened in either German or English.

## Licensing of contributions

There is no CLA. By opening a pull request you agree that your contribution is
licensed under the MIT license in [LICENSE](LICENSE), and any images you
contribute under the terms in [ASSETS-LICENSE.md](ASSETS-LICENSE.md).

## Conduct

Be decent to people. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
