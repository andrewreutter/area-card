import { stripRoomName } from "./names";
import { rollupLabel, sectionRollups, sectionTitle } from "./rollups";
import type { AreaSections, EntityState } from "./sections";
import { areaHash, BUBBLE_CARD_TYPE, mushroomCardType } from "./tags";

const FULL = { columns: 12 };
const LIGHT_ROW = "custom:area-card-light-row";

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
    cards: buildPopupCards(sections, states, name),
  };
}

export function buildPopupCards(
  sections: AreaSections,
  states: Record<string, EntityState> = {},
  roomName = "",
): Record<string, unknown>[] {
  const cards: Record<string, unknown>[] = [];
  const add = (title: string, body: Record<string, unknown>[]) => {
    if (body.length === 0) return;
    cards.push(titleCard(title), ...body);
  };

  const rollups = sectionRollups(sections, states);
  add(
    "Status",
    rollups.length
      ? [
          {
            type: mushroomCardType("chips-card"),
            alignment: "start",
            grid_options: FULL,
            chips: rollups.map((rollup) => ({
              type: "template",
              icon: rollup.icon,
              icon_color: rollup.iconColor,
              content: rollupLabel(rollup),
              tap_action: { action: "none" },
              hold_action: { action: "none" },
              double_tap_action: { action: "none" },
            })),
          },
        ]
      : [],
  );

  add(
    sectionTitle("climate"),
    sections.climate.map((entity) => entityCard(entity, states, roomName)),
  );

  add(
    sectionTitle("lights"),
    sections.lights.map((entity) => withLedDot(lightCard(entity, states[entity], states, roomName), sections.lightLeds[entity])),
  );

  add(
    sectionTitle("media"),
    sections.mediaPlayers.map((entity) => ({
      ...named(
        {
          type: mushroomCardType("media-player-card"),
          entity,
          use_media_info: true,
          show_volume_level: true,
          media_controls: ["on_off", "shuffle", "previous", "play_pause_stop", "next", "repeat"],
          volume_controls: ["volume_mute", "volume_set", "volume_buttons"],
          grid_options: FULL,
        },
        entity,
        states,
        roomName,
      ),
    })),
  );

  add(
    sectionTitle("switches"),
    sections.switches.map((entity) =>
      entityCard(entity, states, roomName, {
        tap_action: { action: "toggle" },
        hold_action: { action: "more-info" },
      }),
    ),
  );

  add(
    sectionTitle("occupancy"),
    sections.occupancy.map((item) => occupancyCard(item.entityId, states, roomName, item.pressureEntityId)),
  );

  add(
    sectionTitle("openings"),
    sections.openings.map((entity) =>
      entity.startsWith("cover.")
        ? named(
            {
              type: mushroomCardType("cover-card"),
              entity,
              show_position_control: true,
              show_buttons_control: true,
              grid_options: FULL,
            },
            entity,
            states,
            roomName,
          )
        : entityCard(entity, states, roomName),
    ),
  );

  add(
    sectionTitle("satellites"),
    sections.satellites.map((item) => satelliteCard(item.entityId, states, roomName, item.ledEntityId, item.alarmEntityId)),
  );

  const helperCards = [
    ...sections.selects.map((entity) =>
      named(
        {
          type: mushroomCardType("select-card"),
          entity,
          grid_options: FULL,
        },
        entity,
        states,
        roomName,
      ),
    ),
    ...sections.helpers.map((entity) => entityCard(entity, states, roomName)),
  ];
  add(sectionTitle("helpers"), helperCards);

  add(
    sectionTitle("automations"),
    sections.automations.map((entity) => automationCard(entity, states, roomName)),
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

function lightCard(
  entity: string,
  state: EntityState | undefined,
  states: Record<string, EntityState>,
  roomName: string,
): Record<string, unknown> {
  if (lightExposesControls(state)) {
    return named(
      {
        type: mushroomCardType("light-card"),
        entity,
        use_light_color: true,
        show_brightness_control: true,
        show_color_temp_control: true,
        show_color_control: true,
        collapsible_controls: true,
        grid_options: FULL,
      },
      entity,
      states,
      roomName,
    );
  }
  // The light card binds one action to the whole row. The template card splits
  // icon tap from the rest of the row and still renders a Mushroom row.
  return {
    type: mushroomCardType("template-card"),
    entity,
    entity_id: entity,
    primary: entityTitle(entity, states, roomName),
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

function withLedDot(card: Record<string, unknown>, ledEntityId?: string): Record<string, unknown> {
  if (!ledEntityId) return card;
  return {
    type: LIGHT_ROW,
    led_entity: ledEntityId,
    card,
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

function entityCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return named(
    {
      type: mushroomCardType("entity-card"),
      entity,
      grid_options: FULL,
      ...extra,
    },
    entity,
    states,
    roomName,
  );
}

function occupancyCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  pressureId?: string,
): Record<string, unknown> {
  const pressure = pressureId
    ? `{% set p = '${pressureId}' %}{% if states(p) not in ['unknown', 'unavailable', 'none', ''] %} · {{ states(p) }}{% set unit = state_attr(p, 'unit_of_measurement') %}{% if unit %} {{ unit }}{% endif %}{% endif %}`
    : "";
  return {
    type: mushroomCardType("template-card"),
    entity,
    primary: entityTitle(entity, states, roomName),
    secondary: `{{ states('${entity}') | title }}${pressure}`,
    icon: `{{ state_attr('${entity}', 'icon') or 'mdi:motion-sensor' }}`,
    icon_color: `{{ 'amber' if is_state('${entity}', 'on') else 'grey' }}`,
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    grid_options: FULL,
  };
}

function satelliteCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  ledId?: string,
  alarmId?: string,
): Record<string, unknown> {
  const led = ledId
    ? ` · LED: {{ states('${ledId}') | title }}{% if is_state('${ledId}', 'on') and state_attr('${ledId}', 'brightness') %} ({{ (state_attr('${ledId}', 'brightness') / 2.55) | round }}%){% endif %}`
    : "";
  const alarm = alarmId ? ` · Alarm: {{ 'On' if is_state('${alarmId}', 'on') else 'Off' }}` : "";
  const card: Record<string, unknown> = {
    type: mushroomCardType("template-card"),
    entity,
    primary: entityTitle(entity, states, roomName),
    secondary: `{{ states('${entity}') | title }}${led}${alarm}`,
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

function automationCard(entity: string, states: Record<string, EntityState>, roomName: string): Record<string, unknown> {
  return {
    type: mushroomCardType("template-card"),
    entity,
    primary: entityTitle(entity, states, roomName),
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
  };
}

function named(
  card: Record<string, unknown>,
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
): Record<string, unknown> {
  const title = entityTitle(entity, states, roomName);
  if (!title.startsWith("{{")) card.name = title;
  return card;
}

function entityTitle(entity: string, states: Record<string, EntityState>, roomName: string): string {
  const raw = states[entity]?.attributes?.friendly_name;
  if (typeof raw !== "string" || raw.trim() === "") {
    return `{{ state_attr('${entity}', 'friendly_name') }}`;
  }
  return stripRoomName(raw, roomName);
}
