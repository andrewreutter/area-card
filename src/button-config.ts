import { pictureBackgroundStyles } from "./picture";
import { emptyRollupDotClass, ROLLUP_ORDER, rollupDotClass, rollupDotStyles, sectionRollups, type RollupId } from "./rollups";
import type { AreaSections, EntityState } from "./sections";
import { areaHash, BUBBLE_CARD_TYPE } from "./tags";

export interface ButtonConfigInput {
  areaId: string;
  name: string;
  icon: string;
  sections: AreaSections;
  states?: Record<string, EntityState | undefined>;
  /** Ordered list of section ids to include as dot sub-buttons. Defaults to all slots (ROLLUP_ORDER). */
  dotSlots?: readonly RollupId[];
  picture?: string | null;
  unavailable?: boolean;
}

/** Same treatment Bubble applies to a button whose entity is unavailable. */
const UNAVAILABLE_BUTTON_STYLES = [
  "ha-card {",
  "  opacity: 0.5 !important;",
  "}",
  ".bubble-wrapper {",
  "  cursor: not-allowed;",
  "}",
  ".bubble-buttons-container {",
  "  display: none;",
  "}",
].join("\n");

export function buildButtonConfig(input: ButtonConfigInput): Record<string, unknown> {
  const hash = areaHash(input.areaId);
  const navigate = {
    action: "navigate",
    navigation_path: hash,
  };
  const rollups = sectionRollups(input.sections, input.states ?? {});
  const byId = new Map(rollups.map((rollup) => [rollup.id, rollup]));
  const slots = input.dotSlots ?? ROLLUP_ORDER;
  const subButtons = slots.map((id) => {
    const rollup = byId.get(id);
    if (!rollup) {
      return {
        icon: "mdi:circle",
        show_name: false,
        show_icon: true,
        show_background: false,
        css_class: emptyRollupDotClass(id),
        tap_action: { action: "none" },
        hold_action: { action: "none" },
        double_tap_action: { action: "none" },
      };
    }
    return {
      icon: "mdi:circle",
      show_name: false,
      show_icon: true,
      show_background: false,
      css_class: rollupDotClass(rollup),
      tap_action: navigate,
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
    };
  });

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
    styles: buttonStyles(rollups, input.picture, input.unavailable),
  };
  return config;
}

function buttonStyles(
  rollups: ReturnType<typeof sectionRollups>,
  picture: string | null | undefined,
  unavailable: boolean | undefined,
): string {
  const parts = [rollupDotStyles(rollups)];
  if (picture) parts.push(pictureBackgroundStyles(picture, "button"));
  if (unavailable) parts.push(UNAVAILABLE_BUTTON_STYLES);
  return parts.join("\n");
}
