import type { AreaSections } from "./sections";
import { areaHash } from "./tags";

export interface ButtonConfigInput {
  areaId: string;
  name: string;
  icon: string;
  sections: AreaSections;
  lightRepresentative?: string;
  occupancyRepresentative?: string;
}

export function buildButtonConfig(input: ButtonConfigInput): Record<string, unknown> {
  const hash = areaHash(input.areaId);
  const navigate = {
    action: "navigate",
    navigation_path: hash,
  };
  const subButtons: Record<string, unknown>[] = [];

  const occupancyButton: Record<string, unknown> = {
    icon: "mdi:account",
    show_name: false,
    show_icon: true,
    show_background: true,
    tap_action: navigate,
    hold_action: { action: "none" },
    double_tap_action: { action: "none" },
  };
  if (input.occupancyRepresentative) occupancyButton.entity = input.occupancyRepresentative;
  subButtons.push(occupancyButton);

  if (input.sections.lights.length > 0) {
    const lightButton: Record<string, unknown> = {
      icon: "mdi:lightbulb",
      show_name: false,
      show_icon: true,
      show_background: true,
      tap_action: {
        action: "perform-action",
        perform_action: "light.toggle",
        target: { entity_id: input.sections.lights },
      },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
    };
    if (input.lightRepresentative) lightButton.entity = input.lightRepresentative;
    subButtons.push(lightButton);
  }

  return {
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
}
