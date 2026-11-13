import { rollupDotClass, rollupDotStyles, sectionRollups } from "./rollups";
import type { AreaSections, EntityState } from "./sections";
import { areaHash, BUBBLE_CARD_TYPE } from "./tags";

export interface ButtonConfigInput {
  areaId: string;
  name: string;
  icon: string;
  sections: AreaSections;
  states?: Record<string, EntityState | undefined>;
}

export function buildButtonConfig(input: ButtonConfigInput): Record<string, unknown> {
  const hash = areaHash(input.areaId);
  const navigate = {
    action: "navigate",
    navigation_path: hash,
  };
  const rollups = sectionRollups(input.sections, input.states ?? {});
  const subButtons = rollups.map((rollup) => ({
    icon: "mdi:circle",
    show_name: false,
    show_icon: true,
    show_background: false,
    css_class: rollupDotClass(rollup),
    tap_action: navigate,
    hold_action: { action: "none" },
    double_tap_action: { action: "none" },
  }));

  const config: Record<string, unknown> = {
    type: BUBBLE_CARD_TYPE,
    card_type: "button",
    button_type: "name",
    name: input.name,
    icon: input.icon,
    tap_action: navigate,
    button_action: {
      tap_action: navigate,
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
    },
    sub_button: subButtons,
  };
  if (rollups.length > 0) config.styles = rollupDotStyles(rollups);
  return config;
}
