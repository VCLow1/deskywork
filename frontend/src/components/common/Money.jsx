// components/common/Money.jsx — Composant unique d'affichage monétaire DeskyWork (DT, 3 décimales, virgule, espace insécable)
import React from 'react';
import { formatDT } from '../../utils/format';

export default function Money({
  amount,
  showTaxType = null,
  suffix = true,
  className = '',
}) {
  return (
    <span className={`tabular-nums whitespace-nowrap ${className}`}>
      {formatDT(amount, { suffix, showTaxType })}
    </span>
  );
}
