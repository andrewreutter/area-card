# Area Card

A [HACS](https://hacs.xyz/) Lovelace card for one Home Assistant area. Pick the area. The card reads the area name and icon, opens a `#area-<area_id>` popup, and fills that popup from the entities assigned to the area.

```yaml
type: custom:area-card
area: office_of_drew
```

The visual editor has one required field, the area. There is no name, icon, hash, light, or visibility option on the card. Floor visibility stays on the Lovelace card's own Visibility tab.

The button and the popup are the same card. The collapsed button keeps one dot slot for every section, in a fixed order, so stacked rooms line up. A slot is filled when that section is active, a hollow ring when the section is present but nothing is active, and invisible when the section is absent. Tapping the button or a visible dot opens the popup. Empty sections stay out of the popup.

Status lists those rollups, such as `Lights 1/4 On`. Temperature and humidity sensors are cards under Climate. Entities that belong to a kiosk satellite stay on the one Satellites card.

On/off lights toggle from the icon; the rest of the row opens more-info. Dimmable lights keep the Mushroom light card. A `switch.*_led` on the same device is a dot on the right of that light and toggles only the LED. Entity titles in the popup drop a leading room name. The popup header and the collapsed button keep the full room name. Automations assigned to the area, and automations whose name contains the room name, are listed under Automations.

## Floor Card

A collapsible floor header. Clicking the header collapses or expands the card. When expanded, one Area Card is shown for each area assigned to the floor, sorted alphabetically.

The header is a section title: the floor name, a rule, and a collapse control. Its icon comes from the floor registry. A floor with no icon shows no icon.

```yaml
type: custom:floor-card
floor: downstairs
```

The visual editor has one required field, the floor.

## Private Bubble Card and Mushroom

This card always runs the copies shipped with it:

- [Bubble Card](https://github.com/Clooos/Bubble-Card) v3.4.3 (MIT)
- [Mushroom](https://github.com/piitaya/lovelace-mushroom) v5.2.3 (Apache-2.0)

Those copies are loaded from `vendor/` next to `area-card.js`, or from the same directory when HACS installs the release assets side by side. Their custom elements are prefixed (`area-card-bubble`, `area-card-mushroom-*`) so a HACS install of Bubble Card or Mushroom cannot change this card, and the card picker does not gain a second set of those cards.

License texts are in `LICENSES/`.

## Install

Add `https://github.com/andrewreutter/area-card` in HACS as a Lovelace plugin (category `plugin`) and download the latest release. HACS registers the `area-card.js` resource. The release also includes `area-card-bubble.js` and `area-card-mushroom.js`, which the card loads at runtime.
