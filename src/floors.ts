import type { AreaEntry, ClassifierHass } from "./sections";

export function floorDisplay(
  hass: ClassifierHass,
  floorId: string,
): { name: string; icon: string | null } {
  const floor = hass.floors?.[floorId];
  const icon = floor?.icon;
  return {
    name: floor?.name || floorId,
    icon: icon ? icon : null,
  };
}

export interface AreaRef {
  areaId: string;
  name: string;
}

export function areasOnFloor(hass: ClassifierHass, floorId: string): AreaRef[] {
  if (!hass.areas) return [];
  return (Object.entries(hass.areas) as [string, AreaEntry][])
    .filter(([, area]) => area?.floor_id === floorId)
    .map(([areaId, area]) => ({ areaId, name: area?.name || areaId }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.areaId.localeCompare(b.areaId));
}
