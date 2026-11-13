import { stripRoomName } from "./names";
import { pictureBackgroundStyles } from "./picture";
import { popupChromeStyles } from "./popup-chrome";
import { readViewportWidth, rowColumns, type LineMeasure } from "./row-width";
import { rollupLabel, sectionColor, sectionIcon, sectionRollups, sectionTitle, type RollupId } from "./rollups";
import type { AreaSections, EntityState } from "./sections";
import { areaHash, BUBBLE_CARD_TYPE, mushroomCardType } from "./tags";

const FULL = { columns: 12 };
const UNAVAILABLE = "Unavailable";

export interface PopupLayout {
  viewportWidth?: number;
  measure?: LineMeasure;
  formatEntityState?: (state: EntityState, sample?: string) => string;
}

interface RowLayout {
  viewportWidth: number;
  measure?: LineMeasure;
  formatEntityState?: PopupLayout["formatEntityState"];
}
const LIGHT_ROW = "custom:area-card-light-row";
const SECTION_TITLE = "custom:area-card-section-title";
const STATUS_HEADING = {
  title: "Status",
  icon: "mdi:list-status",
  color: "var(--primary-text-color)",
};

export function buildPopupConfig(
  areaId: string,
  name: string,
  icon: string,
  sections: AreaSections,
  states: Record<string, EntityState> = {},
  picture?: string | null,
  disabledAutomations: ReadonlySet<string> = new Set(),
  layout?: PopupLayout,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    type: BUBBLE_CARD_TYPE,
    card_type: "pop-up",
    hash: areaHash(areaId),
    name,
    icon,
    bg_blur: 15,
    background_update: true,
    cards: buildPopupCards(sections, states, name, disabledAutomations, layout),
  };
  config.styles = popupChromeStyles(picture ? pictureBackgroundStyles(picture, "popup") : undefined);
  return config;
}

export function buildPopupCards(
  sections: AreaSections,
  states: Record<string, EntityState> = {},
  roomName = "",
  disabledAutomations: ReadonlySet<string> = new Set(),
  layout?: PopupLayout,
): Record<string, unknown>[] {
  const rows = resolveLayout(layout);
  const cards: Record<string, unknown>[] = [];
  const add = (id: RollupId | "status", body: Record<string, unknown>[]) => {
    if (body.length === 0) return;
    cards.push(titleCard(id), ...body);
  };

  const rollups = sectionRollups(sections, states, disabledAutomations);
  add(
    "status",
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
    "climate",
    sections.climate.map((entity) => entityCard(entity, states, roomName, rows)),
  );

  add(
    "lights",
    sections.lights.map((entity) =>
      withLedDot(lightCard(entity, states[entity], states, roomName, rows, Boolean(sections.lightLeds[entity])), sections.lightLeds[entity]),
    ),
  );

  add(
    "media",
    sections.mediaPlayers.map((entity) =>
      named(
        {
          type: "media-control",
          entity,
          grid_options: FULL,
        },
        entity,
        states,
        roomName,
      ),
    ),
  );

  add(
    "switches",
    sections.switches.map((entity) =>
      entityCard(entity, states, roomName, rows, {
        tap_action: { action: "toggle" },
        hold_action: { action: "more-info" },
      }),
    ),
  );

  add(
    "occupancy",
    sections.occupancy.map((item) => occupancyCard(item.entityId, states, roomName, rows, item.pressureEntityId)),
  );

  add(
    "openings",
    sections.openings.map((entity) =>
      entity.startsWith("cover.")
        ? named(
            {
              type: mushroomCardType("cover-card"),
              entity,
              show_position_control: true,
              show_buttons_control: true,
              grid_options: gridFor(rows, entityTitle(entity, states, roomName), entitySecondaries(states[entity], rows)),
            },
            entity,
            states,
            roomName,
          )
        : entityCard(entity, states, roomName, rows),
    ),
  );

  add(
    "satellites",
    sections.satellites.map((item) =>
      satelliteCard(item.entityId, states, roomName, rows, item.ledEntityId, item.alarmEntityId),
    ),
  );

  const helperCards = [
    ...sections.selects.map((entity) =>
      named(
        {
          type: mushroomCardType("select-card"),
          entity,
          grid_options: gridFor(rows, entityTitle(entity, states, roomName), selectSecondaries(states[entity], rows)),
        },
        entity,
        states,
        roomName,
      ),
    ),
    ...sections.helpers.map((entity) => entityCard(entity, states, roomName, rows)),
  ];
  add("helpers", helperCards);

  add(
    "automations",
    sections.automations.map((entity) =>
      automationCard(entity, states, roomName, rows, disabledAutomations.has(entity)),
    ),
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
  layout: RowLayout,
  led = false,
): Record<string, unknown> {
  const title = entityTitle(entity, states, roomName);
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
        grid_options: gridFor(layout, title, entitySecondaries(state, layout), led),
      },
      entity,
      states,
      roomName,
    );
  }
  // The light card binds one action to the whole row. The template card splits
  // icon tap from the rest of the row and still renders a Mushroom row.
  // Its secondary is the raw state title, so "Unavailable" is the longest line.
  return {
    type: mushroomCardType("template-card"),
    entity,
    entity_id: entity,
    primary: title,
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
    grid_options: gridFor(layout, title, [UNAVAILABLE], led),
  };
}

function withLedDot(card: Record<string, unknown>, ledEntityId?: string): Record<string, unknown> {
  if (!ledEntityId) return card;
  return {
    type: LIGHT_ROW,
    led_entity: ledEntityId,
    card,
    grid_options: card.grid_options ?? FULL,
  };
}

function titleCard(id: RollupId | "status"): Record<string, unknown> {
  const heading = id === "status"
    ? STATUS_HEADING
    : { title: sectionTitle(id), icon: sectionIcon(id), color: sectionColor(id) };
  return {
    type: SECTION_TITLE,
    title: heading.title,
    icon: heading.icon,
    color: heading.color,
    grid_options: FULL,
  };
}

function entityCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  layout: RowLayout,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return named(
    {
      type: mushroomCardType("entity-card"),
      entity,
      ...extra,
      grid_options: gridFor(layout, entityTitle(entity, states, roomName), entitySecondaries(states[entity], layout)),
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
  layout: RowLayout,
  pressureId?: string,
): Record<string, unknown> {
  const title = entityTitle(entity, states, roomName);
  const pressure = pressureId
    ? `{% set p = '${pressureId}' %}{% if states(p) not in ['unknown', 'unavailable', 'none', ''] %} · {{ states(p) }}{% set unit = state_attr(p, 'unit_of_measurement') %}{% if unit %} {{ unit }}{% endif %}{% endif %}`
    : "";
  return {
    type: mushroomCardType("template-card"),
    entity,
    primary: title,
    secondary: `{{ states('${entity}') | title }}${pressure}`,
    icon: `{{ state_attr('${entity}', 'icon') or 'mdi:motion-sensor' }}`,
    icon_color: `{{ 'amber' if is_state('${entity}', 'on') else 'grey' }}`,
    tap_action: { action: "more-info" },
    hold_action: { action: "none" },
    grid_options: gridFor(layout, title, occupancySecondaries(pressureId ? states[pressureId] : undefined)),
  };
}

function satelliteCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  layout: RowLayout,
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
    grid_options: gridFor(layout, entityTitle(entity, states, roomName), satelliteSecondaries(Boolean(ledId), Boolean(alarmId))),
  };
  if (ledId) {
    card.badge_icon = `{{ 'mdi:led-on' if is_state('${ledId}', 'on') else 'mdi:led-off' }}`;
    card.badge_color = `{{ 'amber' if is_state('${ledId}', 'on') else 'grey' }}`;
  }
  return card;
}

function automationCard(
  entity: string,
  states: Record<string, EntityState>,
  roomName: string,
  layout: RowLayout,
  disabled = false,
): Record<string, unknown> {
  return {
    type: mushroomCardType("template-card"),
    entity,
    primary: entityTitle(entity, states, roomName),
    secondary: disabled
      ? "Disabled"
      : `{% set lt = state_attr('${entity}', 'last_triggered') %}{{ relative_time(lt) + ' ago' if lt else 'Never triggered' }}`,
    icon: disabled ? "mdi:flash-off" : "mdi:flash",
    icon_color: disabled ? "grey" : `{{ 'green' if is_state('${entity}', 'on') else 'grey' }}`,
    tap_action: { action: "more-info" },
    hold_action: {
      action: "perform-action",
      perform_action: "automation.toggle",
      target: { entity_id: entity },
    },
    double_tap_action: { action: "none" },
    grid_options: gridFor(layout, entityTitle(entity, states, roomName), [disabled ? "Disabled" : "Never triggered"]),
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

export function entityTitle(entity: string, states: Record<string, EntityState>, roomName: string): string {
  const raw = states[entity]?.attributes?.friendly_name;
  if (typeof raw !== "string" || raw.trim() === "") {
    return `{{ state_attr('${entity}', 'friendly_name') }}`;
  }
  return stripRoomName(raw, roomName);
}

function resolveLayout(layout?: PopupLayout): RowLayout {
  const viewportWidth = layout?.viewportWidth && layout.viewportWidth > 0 ? layout.viewportWidth : readViewportWidth();
  return {
    viewportWidth,
    measure: layout?.measure,
    formatEntityState: layout?.formatEntityState,
  };
}

function gridFor(
  layout: RowLayout,
  primary: string,
  secondaries: readonly string[],
  led = false,
): { columns: number } {
  return rowColumns(primary, secondaries, layout.viewportWidth, { led, measure: layout.measure });
}

function entitySecondaries(state: EntityState | undefined, layout: RowLayout): string[] {
  const lines = [displayedState(state, "unavailable", layout)];
  const current = currentStateLine(state, layout);
  if (current) lines.push(current);
  return lines;
}

function selectSecondaries(state: EntityState | undefined, layout: RowLayout): string[] {
  const lines = entitySecondaries(state, layout);
  const options = state?.attributes?.options;
  if (!Array.isArray(options)) return lines;
  for (const option of options) {
    if (typeof option === "string" && option.trim() !== "") lines.push(option);
  }
  return lines;
}

function occupancySecondaries(pressure: EntityState | undefined): string[] {
  if (!pressure) return [UNAVAILABLE];
  const raw = pressure.state;
  if (!raw || raw === "unknown" || raw === "unavailable" || raw === "none") return [UNAVAILABLE];
  const unit = pressure.attributes?.unit_of_measurement;
  const value = widenNumericText(raw);
  const suffix = typeof unit === "string" && unit !== "" ? `${value} ${unit}` : value;
  return [UNAVAILABLE, `${UNAVAILABLE} · ${suffix}`];
}

function satelliteSecondaries(led: boolean, alarm: boolean): string[] {
  const parts = [UNAVAILABLE];
  if (led) parts.push("LED: Unavailable");
  if (alarm) parts.push("Alarm: Off");
  return [parts.join(" · ")];
}

function displayedState(state: EntityState | undefined, sample: string, layout: RowLayout): string {
  const format = layout.formatEntityState;
  if (format && state) {
    try {
      const text = format(state, sample);
      if (typeof text === "string" && text.trim() !== "") return text.trim();
    } catch {
      // Fall through to the English word the card shows when formatting is unavailable.
    }
  }
  return sample === "unavailable" ? UNAVAILABLE : sample;
}

function currentStateLine(state: EntityState | undefined, layout: RowLayout): string | undefined {
  if (!state) return undefined;
  const format = layout.formatEntityState;
  if (format) {
    try {
      const text = format(state);
      if (typeof text === "string" && text.trim() !== "") return widenNumericText(text.trim());
    } catch {
      // Use the raw state below.
    }
  }
  return widenNumericText(rawWithUnit(state));
}

function rawWithUnit(state: EntityState): string {
  const unit = state.attributes?.unit_of_measurement;
  const raw = state.state ?? "";
  if (typeof unit === "string" && unit !== "" && raw !== "unknown" && raw !== "unavailable" && raw !== "") {
    return `${raw} ${unit}`;
  }
  return raw;
}

/** One extra digit, so a value that grows from 9.9 to 10.0 still fits. */
function widenNumericText(value: string): string {
  return value.replace(/-?\d+(?:\.\d+)?/, (match) => {
    const sign = match.startsWith("-") ? "-" : "";
    return `${sign}0${match.slice(sign.length)}`;
  });
}
