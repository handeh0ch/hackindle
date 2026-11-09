// Pure placement for the hover tooltip: centred above the target, flipped below when
// there is no room, kept inside the viewport. The arrow offset keeps pointing at the target.
export function placeTip({ anchor, tip, viewport, gap = 8, margin = 8 }) {
  const centre = anchor.left + anchor.width / 2;
  const left = Math.max(margin, Math.min(centre - tip.width / 2, viewport.width - tip.width - margin));
  const above = anchor.top - tip.height - gap;
  const placement = above >= margin ? 'above' : 'below';
  const top = placement === 'above' ? above : anchor.top + anchor.height + gap;
  const arrow = Math.max(12, Math.min(centre - left, tip.width - 12));
  return { left, top, placement, arrow };
}
