// Close icon for tabs: the X from Zed's assets/icons/close.svg (Lucide, ISC license, see tests/fixtures/zed-centered/README.md).
// Lucide is Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT), and Lucide Contributors 2022.
const SVG = 'http://www.w3.org/2000/svg';

export function closeIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', 'M4.70581 4.5L11.294 11.5M11.294 4.5L4.70581 11.5');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('data-testid', 'tab-close-icon');
  svg.append(path);
  return svg;
}
