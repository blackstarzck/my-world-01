import layout from './data/layout.json';

export type LightRoom = 'C0' | 'R1' | 'R2' | 'R3' | 'R4';
// This order is shared by the React light tree and material shader masks.
// Three preserves traversal order among area lights (none casts a shadow).
export const areaLightRooms: LightRoom[] = [
  ...layout.rooms.flatMap(r => [r.id, r.id, r.id] as LightRoom[]),
  'R1', 'R1', 'R1', 'C0', 'R4', 'R4',
];

export function materialLightRoom(environmentURL: unknown): LightRoom | null {
  if (environmentURL === '/environment/i-v3/gallery-interior.hdr') return 'C0';
  const match = typeof environmentURL === 'string' && environmentURL.match(/\/gallery-(c0|r[1-4])\.hdr$/);
  return match ? match[1].toUpperCase() as LightRoom : null;
}
