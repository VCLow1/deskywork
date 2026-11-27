// components/common/Money.jsx — Composant unique d'affichage monétaire DeskyWork (DT, 3 décimales, virgule, espace insécable)
import React from 'react';
import { formatDT, formatPriceOrFree } from '../../utils/format';

export default function Money({
  amount,
  showTaxType = null,
  taxType = null,
  suffix = true,
  zeroLabel = null,
  unit = '',
  className = '',
  style = undefined,
}) {
  const effectiveTax = showTaxType || taxType;
  const text = zeroLabel
    ? formatPriceOrFree(amount, { zeroLabel, suffix, showTaxType: effectiveTax, unit })
    : `${formatDT(amount, { suffix, showTaxType: effectiveTax })}${unit ? ` ${unit}` : ''}`;

  return (
    <span className={`tabular-nums whitespace-nowrap ${className}`} style={style}>
      {text}
    </span>
  );
}
