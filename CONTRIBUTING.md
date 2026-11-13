# Contributing to Helpmeet: Area Card

Thanks for helping. Bug reports, wording fixes, and pull requests are all welcome.

## Reporting bugs

Open an [issue](https://github.com/Helpmeeters/area-card/issues/new/choose) using the bug report form. The most useful things to include are:

- Your Home Assistant version, and whether it's a beta.
- The Area Card version, from HACS.
- The browser you use.
- The card YAML, and which card it is: Area Card, Floor Card, or Floors Card.
- What the card showed, and what you expected.

## Development setup

You need Node.js.

```bash
npm install
npm test
npm run build
```

`npm test` runs the card's tests. `npm run build` writes `dist/area-card.js`, `dist/area-card-bubble.js`, and `dist/area-card-mushroom.js`.

## Pull requests

- Keep changes focused. One fix or feature per pull request.
- Add or update tests for any behavior change, and make sure `npm test` passes.
- Popup section order, dot slots, and room-name stripping are specified in the [README](README.md). Read it before changing how sections, rollups, or popup cards behave.
- Update the README when user-facing behavior changes.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
