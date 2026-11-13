import type { AreaSections, EntityState } from "./sections";
import { areaHash, BUBBLE_CARD_TYPE, mushroomCardType } from "./tags";

const FULL = { columns: 12 };

export function buildPopupConfig(
  areaId: string,
  name: string,
  icon: string,
  sections: AreaSections,
  states: Record<string, EntityState> = {},
): Record<string, unknown> {
  return {
    type: BUBBLE_CARD_TYPE,
    card_type: "pop-up",
    hash: areaHash(areaId),
    name,
    icon,
    bg_blur: 15,
    background_update: true,
    cards: buildPopupCards(sections, states),
  };
}

export function buildPopupCards(
  sections: AreaSections,
  states: Record<string, EntityState> = {},
): Record<string, unknown>[] {
  const cards: Record<string, unknown>[] = [];
  const add = (title: string, body: Record<string, unknown>[]) => {
    if (body.length === 0) return;
    cards.push(titleCard(title), ...body);
  };

  add(
    "Status",
    sections.status.length
      ? [
          {
            type: mushroomCardType("chips-card"),
            alignment: "start",
            grid_options: FULL,
            chips: sections.status.map((entity) => ({ type: "entity", entity })),
          },
        ]
      : [],
  );

  add(
    "Lights",
    sections.lights.map((entity) => lightCard(entity, states[entity])),
  );

  add(
    "Media players",
    sections.mediaPlayers.map((entity) => ({
      type: mushroomCardType("media-player-card"),
      entity,
      use_media_info: true,
      show_volume_level: true,
      media_controls: ["on_off", "shuffle", "previous", "play_pause_stop", "next", "repeat"],
      volume_controls: ["volume_mute", "volume_set", "volume_buttons"],
      grid_options: FULL,
    })),
  );

  add(
    "Switches",
    sections.switches.map((entity) => ({
      type: mushroomCardType("entity-card"),
      entity,
      tap_action: { action: "toggle" },
      hold_action: { action: "more-info" },
      grid_options: FULL,
    })),
  );

  add(
    "Occupancy",
    sections.occupancy.map((item) => occupancyCard(item.entityId, item.pressureEntityId)),
  );

  add(
    "Doors and windows",
    sections.openings.map((entity) =>
      entity.startsWith("cover.")
        ? {
            type: mushroomCardType("cover-card"),
            entity,
            show_position_control: true,
            show_buttons_control: true,
            grid_options: FULL,
          }
        : {
            type: mushroomCardType("entity-card"),
            entity,
            grid_options: FULL,
          },
    ),
  );

  add(
    "Voice satellites",
    sections.satellites.map((item) => satelliteCard(item.entityId, item.ledEntityId)),
  );

  const helperCards = [
    ...sections.selects.map((entity) => ({
      type: mushroomCardType("select-card"),
      entity,
      grid_options: FULL,
    })),
    ...sections.helpers.map((entity) => ({
      type: mushroomCardType("entity-card"),
      entity,
      grid_options: FULL,
    })),
  ];
  add("Helpers", helperCards);

  add(
    "Automations",
    sections.automations.map((entity) => ({
      type: mushroomCardType("template-card"),
      entity,
      primary: `{{ state_attr('${entity}', 'friendly_name') }}`,
      secondary: `{% set lt = state_attr('${entity}', 'last_triggered') %}{{ relative_time(lt) + ' ago' if lt else 'Never triggered' }}`,
      icon: "mdi:flash",
      icon_color: `{{ 'green' if is_state('${entity}', 'on') else 'grey' }}`,
      tap_action: { action: "more-info" },
      hold_action: {
        action: "perform-action",
        perform_action: "automation.toggle",
        target: { entity_id: entity },
      },
      double_tap_action: { action: "none" },
      grid_options: FULL,
    })),
  );

  return cards;
}

const LIGHT_CONTROL_MODES = new Set([
  "brightness",
  "color_temp",
  "hs",
  "xy",
  "rgb",
  "rgbw",
  "rgbww",
  "white",
]);

/** True when Mushroom's light card would show a brightness, color, or color-temp control. */
export function lightExposesControls(state: EntityState | undefined): boolean {
  const modes = state?.attributes?.supported_color_modes;
  if (!Array.isArray(modes)) return false;
  return modes.some((mode) => typeof mode === "string" && LIGHT_CONTROL_MODES.has(mode));
}

function lightCard(entity: string, state: EntityState | undefined): Record<string, unknown> {
  if (lightExposesControls(state)) {
    return {
      type: mushroomCardType("light-card"),
      entity,
      use_light_color: true,
      show_brightness_control: true,
      show_color_temp_control: true,
      show_color_control: true,
      collapsible_controls: true,
      grid_options: FULL,
    };
  }
  // The light card binds one action to the whole row. The template card splits
  // icon tap from the rest of the row and still renders a Mushroom row.
  return {
    type: mushroomCardType("template-card"),
    entity,
    entity_id: entity,
    primary: `{{ state_attr('${entity}', 'friendly_name') }}`,
    secondary: `{{ states('${entity}') | title }}`,
    icon: `{{ state_attr('${entity}', 'icon') or 'mdi:lightbulb' }}`,
    icon_color: `{{ 'amber' if is_state('${entity}', 'on') else 'grey' }}`,
    tap_action: { action: "more-info" },
    hold_action: { action: "more-info" },
    double_tap_action: { action: "none" },
    icon_tap_action: {
      action: "perform-action",
      perform_action: "light.toggle",
      target: { entity_id: entity },
    },
    icon_hold_action: { action: "more-info" },
    icon_double_tap_action: { action: "none" },
    grid_options: FULL,
  };
}

function titleCard(title: string): Record<string, unknown> {
  return {
    type: mushroomCardType("title-card"),
    title,
    grid_options: FULL,
  };
}

function occupancyCard(entity: string, pressureId?: string): Record<string, unknown> {
  const pressure = pressureId
    ? `{% set p = '${pressureId}' %}{% if states(p) not in ['unknown', 'unavailable', 'none', ''] %} · {{ states(p) }}{% set unit = state_attr(p, 'unit_of_measurement') %}{% if unit %} {{ unit }}{% endif %}{% endif %}`
    : "";
  return {
    type: mushroomCardType("template-card"),
    entity,
    primary: `{{ state_attr('${entity}', 'friendly_name') }}`,
    secondary: `{{ states('${entity}') | title }}${pressure}`,
    icon: `{{ state_attr('${entity}', 'icon') or 'mdi:motion-sensor' }}`,
    icon_color: `{{ 'amber' if is_state('${entity}', 'on') else 'grey' }}`,
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    grid_options: FULL,
  };
}

function satelliteCard(entity: string, ledId?: string): Record<string, unknown> {
  const led = ledId
    ? `{% set led = '${ledId}' %} · LED: {{ states(led) | title }}{% if is_state(led, 'on') and state_attr(led, 'brightness') %} ({{ (state_attr(led, 'brightness') / 2.55) | round }}%){% endif %}`
    : "";
  const card: Record<string, unknown> = {
    type: mushroomCardType("template-card"),
    entity,
    primary: `{{ state_attr('${entity}', 'friendly_name') }}`,
    secondary: `{{ states('${entity}') | title }}${led}`,
    icon: "mdi:tablet-dashboard",
    icon_color: `{{ 'blue' if is_state('${entity}', 'idle') else 'green' }}`,
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    grid_options: FULL,
  };
  if (ledId) {
    card.badge_icon = `{{ 'mdi:led-on' if is_state('${ledId}', 'on') else 'mdi:led-off' }}`;
    card.badge_color = `{{ 'amber' if is_state('${ledId}', 'on') else 'grey' }}`;
  }
  return card;
}
