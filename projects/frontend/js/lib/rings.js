// Distance rings around a hovered calendar cell: 0 is the cell itself, 1..maxRing are the
// surrounding cells by distance in cell pitches (<=1.5, <=2.5, <=3.5), null is out of range.
// The panel uses them to blur and dim the surroundings while the hovered cell grows.
export function rings(origin, items, pitch, maxRing = 3) {
  return items.map(item => {
    const distance = Math.hypot(item.x - origin.x, item.y - origin.y) / pitch;
    if (!Number.isFinite(distance)) return null;
    if (distance < 0.01) return 0;
    const ring = Math.max(1, Math.ceil(distance - 0.5));
    return ring <= maxRing ? ring : null;
  });
}
