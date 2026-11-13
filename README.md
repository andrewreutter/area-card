# Area Card

A [HACS](https://hacs.xyz/) Lovelace card for one Home Assistant area. Pick the area. The card reads the area name and icon, opens a `#area-<area_id>` popup, and fills that popup from the entities assigned to the area. The card also reads the area picture and uses it as the background of the button and the popup. The popup photo fits the dialog width and sits at the top.

When the area has device entities and every one of them is unavailable, the collapsed button uses the same half-opacity treatment as a Bubble button whose entity is unavailable. The card stays on screen. Input booleans, input selects, timers, and template helpers that are not device entities are ignored. An area with no device entities, or with at least one available device entity, stays at full opacity. An automation that cannot trigger because every trigger depends on an unavailable device does not count as an available entity.

```yaml
type: custom:area-card
area: office_of_drew
```

The visual editor has one required field, the area, and an optional multi-select "Hide sections". There is no name, icon, hash, light, or visibility option on the card. Floor visibility stays on the Lovelace card's own Visibility tab.

Sections can be hidden from both the collapsed dots and the popup:

```yaml
type: custom:area-card
area: office_of_drew
hide_sections:
  - media
  - satellites
```

Valid section ids are: `climate`, `lights`, `media`, `switches`, `occupancy`, `openings`, `satellites`, `helpers`, `automations`. A hidden section is fully removed — not left as an invisible spacer — so the dot row is only as wide as the visible sections. `climate` is still a valid `hide_sections` id. Hiding it removes the subtitle and the popup section. It no longer changes the dot-row width.

The button and the popup are the same card. The collapsed button keeps one dot slot for every section except climate, in that fixed order, so stacked rooms line up. Climate is a subtitle under the room name. Each remaining dot is 22px and shows that section's icon: filled when the section is active, a hollow ring when the section is present but nothing is active, and invisible when the section is absent. The popup heading for a section uses the same icon to the left of the title. The Status heading uses a list icon. Tapping the button or a visible dot opens the popup. Empty sections stay out of the popup.

Status lists those rollups, such as `Lights 1/4 On`. Temperature and humidity sensors are cards under Climate. The collapsed button repeats those card titles and states on one line under the room name, separated by ` · `. A room with no climate sensors has no subtitle. Entities that belong to a kiosk satellite stay on the one Satellites card.

On/off lights toggle from the icon; the rest of the row opens more-info. Dimmable lights keep the Mushroom light card. A `switch.*_led` on the same device is a dot on the right of that light and toggles only the LED. Entity titles in the popup drop a leading room name. The popup header and the collapsed button keep the full room name. The popup header title has no fill. The header has a gear to the left of close which opens that area's settings page (`/config/areas/area/<area id>`). Automations assigned to the area, and automations whose name contains the room name, are listed under Automations. An automation is disabled when every trigger depends on an unavailable device, so a time, sun, or other trigger that can still fire keeps it enabled. A disabled automation stays in the list and does not count as on. The automations tooltip and status chip read `Automations 2/3 on, 0, disabled`, and `Automations 1, disabled` when none are on or off. Disabled automations are not part of the fraction. The popup row shows Disabled.

## Floor Card

A collapsible floor header. Clicking the header collapses or expands the card. When expanded, one Area Card is shown for each area assigned to the floor, sorted alphabetically, including areas whose devices are unavailable. The open or closed state is stored in the browser under `area-card-floor-expanded:<floor id>` and restored on the next visit. A floor with no stored value starts expanded. localStorage is already separate for each Home Assistant host.

The header is a section title: the floor name, a rule, a row of dots, and a collapse control. Its icon comes from the floor registry. A floor with no icon shows no icon.

The header dots sit just left of the collapse control and use the same slots as the area cards, so there is no climate column. A dot is filled when any area has that section active, a hollow ring when the section is present but nothing is active, and invisible when no area draws it. The tooltip adds the area counts, such as `Lights 3/12 On`. Area cards on the floor shift their dots left by the width of the collapse control so each column lines up with the header. On a narrow header the floor name stays whole and dots leave from the left, so the columns that remain still line up.

```yaml
type: custom:floor-card
floor: downstairs
```

The visual editor has one required field, the floor.

The Floor Card automatically hides sections that have no entities on any area of the floor. This keeps the dot row only as wide as the floor actually uses. A section present in even one area stays visible in all area cards on that floor so the dots still line up. Climate sensors still count toward section presence, so the Climate popup section stays, and they do not draw a dot. The collapsed area card shows them as a subtitle. Helper selects and timers still count toward presence and still do not draw a dot; the helpers slot remains.

## Floors Card

One Floor Card for every floor in Home Assistant, in the floor registry's order. Dragging floors into a new order in Home Assistant changes this card. A floor with no areas still shows its header. When Home Assistant has no floors, the card says "No floors".

```yaml
type: custom:floors-card
```

The visual editor has no fields. The card reads the floors from Home Assistant.

## Private Bubble Card and Mushroom

This card always runs the copies shipped with it:

- [Bubble Card](https://github.com/Clooos/Bubble-Card) v3.4.3 (MIT)
- [Mushroom](https://github.com/piitaya/lovelace-mushroom) v5.2.3 (Apache-2.0)

Those copies are loaded from `vendor/` next to `area-card.js`, or from the same directory when HACS installs the release assets side by side. Their custom elements are prefixed (`area-card-bubble`, `area-card-mushroom-*`) so a HACS install of Bubble Card or Mushroom cannot change this card, and the card picker does not gain a second set of those cards.

License texts are in `LICENSES/`.

## Install

Add `https://github.com/andrewreutter/area-card` in HACS as a Lovelace plugin (category `plugin`) and download the latest release. HACS registers the `area-card.js` resource. The release also includes `area-card-bubble.js` and `area-card-mushroom.js`, which the card loads at runtime.
