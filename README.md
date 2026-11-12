# Area Card

A [HACS](https://hacs.xyz/) Lovelace card for one Home Assistant area. Pick the area. The card reads the area name and icon, opens a `#area-<area_id>` popup, and fills that popup from the entities assigned to the area.

```yaml
type: custom:area-card
area: office_of_drew
```

The visual editor has one required field, the area. There is no name, icon, hash, light, or visibility option on the card. Floor visibility stays on the Lovelace card's own Visibility tab.

The button and the popup are the same card. The lights sub-button toggles every light in the area except hidden, diagnostic, config, and satellite LEDs. It is hidden when none remain. The occupancy sub-button highlights when an occupancy, motion, presence, chair, or bed entity in the area is on, and opens the same popup.

## Private Bubble Card and Mushroom

This card always runs the copies shipped with it:

- [Bubble Card](https://github.com/Clooos/Bubble-Card) v3.4.3 (MIT)
- [Mushroom](https://github.com/piitaya/lovelace-mushroom) v5.2.3 (Apache-2.0)

Those copies are loaded from `vendor/` next to `area-card.js`, or from the same directory when HACS installs the release assets side by side. Their custom elements are prefixed (`area-card-bubble`, `area-card-mushroom-*`) so a HACS install of Bubble Card or Mushroom cannot change this card, and the card picker does not gain a second set of those cards.

License texts are in `LICENSES/`.

## Install

Add `https://github.com/andrewreutter/area-card` in HACS as a Lovelace plugin (category `plugin`) and download the latest release. HACS registers the `area-card.js` resource. The release also includes `area-card-bubble.js` and `area-card-mushroom.js`, which the card loads at runtime.
