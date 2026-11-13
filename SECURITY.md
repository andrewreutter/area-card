# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub's [private vulnerability reporting](https://github.com/Helpmeeters/area-card/security/advisories/new) instead.

Include what you found, how to reproduce it, and what an attacker could do with it. You should get a reply within a week.

## What's in scope

Area Card runs in the browser as part of a Home Assistant dashboard, with the signed-in user's permissions. Issues that are especially relevant:

- Area names, entity names, or pictures rendered so that markup in them runs as script.
- The card loading a script other than `area-card.js`, `area-card-bubble.js`, and `area-card-mushroom.js` from its own directory.
- A control in the popup changing an entity the card should not be showing for that area.
