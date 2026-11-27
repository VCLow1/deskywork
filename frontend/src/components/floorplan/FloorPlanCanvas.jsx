// components/floorplan/FloorPlanCanvas.jsx — Moteur SVG interactif pur React (Dark/Light, Zoom, Drag/Resize, Tooltips)
import React, { useRef, useState, useCallback } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { getFloorPlanPalette, getItemTypeMeta } from './floorPlanConstants';

function snap(value, grid = 20) {
  const g = Math.max(1, Number(grid) || 20);
  return Math.round(value / g) * g;
}

function FurnitureSvg({ item, color }) {
  const w = item.width || 72;
  const h = item.height || 52;
  const f = color.furniture || 'rgba(100,116,139,0.25)';
  const s = color.stroke || '#64748b';

  if (item.item_type === 'desk' || item.item_type === 'quiet_desk') {
    const chairR = Math.min(w, h) * 0.14;
    return (
      <g pointerEvents="none">
        {item.item_type === 'quiet_desk' && (
          <path
            d={`M 6 ${h * 0.65} L 6 6 L ${w - 6} 6 L ${w - 6} ${h * 0.65}`}
            fill="none"
            stroke={s}
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.75}
          />
        )}
        {/* Surface bureau */}
        <rect x={10} y={10} width={Math.max(12, w - 20)} height={Math.max(10, h * 0.42)} rx={4} fill={f} />
        {/* Chaise */}
        <circle cx={w / 2} cy={h - chairR - 4} r={chairR} fill={f} stroke={s} strokeWidth={1} opacity={0.85} />
      </g>
    );
  }

  if (item.item_type === 'private_office') {
    const deskW = Math.min(w * 0.52, 130);
    const deskH = Math.min(h * 0.24, 52);
    return (
      <g pointerEvents="none">
        <rect
          x={(w - deskW) / 2}
          y={h * 0.24}
          width={deskW}
          height={deskH}
          rx={6}
          fill={f}
          stroke={s}
          strokeWidth={1}
          opacity={0.65}
        />
        <circle cx={w / 2} cy={h * 0.16} r={9} fill={f} />
        <circle cx={w * 0.36} cy={h * 0.24 + deskH + 14} r={7} fill={f} />
        <circle cx={w * 0.64} cy={h * 0.24 + deskH + 14} r={7} fill={f} />
      </g>
    );
  }

  if (item.item_type === 'meeting_room') {
    const tw = w * 0.56;
    const th = h * 0.42;
    const tx = (w - tw) / 2;
    const ty = (h - th) / 2;
    const chairsTop = [0.25, 0.5, 0.75].map((p) => ({ cx: tx + tw * p, cy: ty - 11 }));
    const chairsBottom = [0.25, 0.5, 0.75].map((p) => ({ cx: tx + tw * p, cy: ty + th + 11 }));
    return (
      <g pointerEvents="none">
        <rect x={tx} y={ty} width={tw} height={th} rx={Math.min(tw, th) * 0.35} fill={f} stroke={s} strokeWidth={1.2} opacity={0.7} />
        {[...chairsTop, ...chairsBottom].map((c, idx) => (
          <circle key={idx} cx={c.cx} cy={c.cy} r={6.5} fill={f} />
        ))}
        <circle cx={tx - 12} cy={h / 2} r={6.5} fill={f} />
        <circle cx={tx + tw + 12} cy={h / 2} r={6.5} fill={f} />
      </g>
    );
  }

  if (item.item_type === 'training_room') {
    return (
      <g pointerEvents="none">
        {/* Tableau / Écran */}
        <rect x={w * 0.2} y={10} width={w * 0.6} height={6} rx={3} fill={s} opacity={0.55} />
        {/* Rangées */}
        {[0.32, 0.56].map((ry, rIdx) => (
          <g key={rIdx}>
            <rect x={w * 0.14} y={h * ry} width={w * 0.3} height={14} rx={3} fill={f} />
            <rect x={w * 0.56} y={h * ry} width={w * 0.3} height={14} rx={3} fill={f} />
          </g>
        ))}
      </g>
    );
  }

  if (item.item_type === 'event_space') {
    return (
      <g pointerEvents="none">
        <path
          d={`M ${w * 0.2} 14 Q ${w / 2} 34 ${w * 0.8} 14`}
          fill="none"
          stroke={s}
          strokeWidth={2}
          opacity={0.5}
        />
        {[0.35, 0.55, 0.75].map((ry, idx) => (
          <rect key={idx} x={w * 0.16} y={h * ry} width={w * 0.68} height={8} rx={4} fill={f} />
        ))}
      </g>
    );
  }

  return null;
}

export default function FloorPlanCanvas({
  plan,
  mode = 'booking', // 'editor' | 'live' | 'booking'
  selectedTarget = null, // { kind: 'item' | 'element', id: string } | string (item id)
  onSelectTarget = null,
  onMoveTarget = null, // (kind, id, { x, y })
  onResizeTarget = null, // (kind, id, { width, height })
  renderTooltipContent = null,
  minHeight = 460,
}) {
  const { dark } = useTheme();
  const palette = getFloorPlanPalette(dark);
  const svgRef = useRef(null);
  const wrapRef = useRef(null);

  const [zoom, setZoom] = useState(1);
  const [dragState, setDragState] = useState(null);
  const [hoverInfo, setHoverInfo] = useState(null);

  const width = Number(plan?.width) || 1200;
  const height = Number(plan?.height) || 760;
  const gridSize = Number(plan?.grid_size) || 20;
  const elements = Array.isArray(plan?.elements_json) ? plan.elements_json : [];
  const items = Array.isArray(plan?.items) ? plan.items : [];

  const normalizedSelection = typeof selectedTarget === 'string'
    ? { kind: 'item', id: selectedTarget }
    : selectedTarget;

  const clientToSvg = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const mapped = pt.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  }, []);

  const handlePointerDownItem = (e, kind, target) => {
    e.stopPropagation();
    if (onSelectTarget) {
      onSelectTarget({ kind, id: target.id, data: target });
    }
    if (mode !== 'editor') return;
    const pt = clientToSvg(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragState({
      action: 'move',
      kind,
      id: target.id,
      startSvgX: pt.x,
      startSvgY: pt.y,
      origX: Number(target.x) || 0,
      origY: Number(target.y) || 0,
    });
  };

  const handlePointerDownResize = (e, kind, target) => {
    e.stopPropagation();
    if (mode !== 'editor') return;
    const pt = clientToSvg(e.clientX, e.clientY);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragState({
      action: 'resize',
      kind,
      id: target.id,
      startSvgX: pt.x,
      startSvgY: pt.y,
      origW: Number(target.width) || 60,
      origH: Number(target.height) || 40,
      origX: Number(target.x) || 0,
      origY: Number(target.y) || 0,
    });
  };

  const handleSvgPointerMove = (e) => {
    if (!dragState || mode !== 'editor') return;
    const pt = clientToSvg(e.clientX, e.clientY);
    const dx = pt.x - dragState.startSvgX;
    const dy = pt.y - dragState.startSvgY;

    if (dragState.action === 'move' && onMoveTarget) {
      const nextX = Math.max(0, Math.min(width - 20, snap(dragState.origX + dx, gridSize)));
      const nextY = Math.max(0, Math.min(height - 20, snap(dragState.origY + dy, gridSize)));
      onMoveTarget(dragState.kind, dragState.id, { x: nextX, y: nextY });
    } else if (dragState.action === 'resize' && onResizeTarget) {
      const minDim = dragState.kind === 'element' ? 8 : 30;
      const nextW = Math.max(minDim, Math.min(width - dragState.origX, snap(dragState.origW + dx, gridSize)));
      const nextH = Math.max(minDim, Math.min(height - dragState.origY, snap(dragState.origH + dy, gridSize)));
      onResizeTarget(dragState.kind, dragState.id, { width: nextW, height: nextH });
    }
  };

  const handleSvgPointerUp = () => {
    if (dragState) setDragState(null);
  };

  const updateHover = (e, item) => {
    if (mode === 'editor') return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = Math.min(rect.width - 240, Math.max(12, e.clientX - rect.left + 14));
    const y = Math.min(rect.height - 96, Math.max(12, e.clientY - rect.top - 10));
    setHoverInfo({ item, x, y });
  };

  const getItemColors = (item) => {
    if (mode === 'editor') {
      if (item.status === 'maintenance') return palette.statuses.maintenance;
      if (item.status === 'unavailable') return palette.statuses.unavailable;
      return item.space_id ? palette.statuses.free : palette.unlinked;
    }
    const key = item.live_status
      || (item.status === 'maintenance' ? 'maintenance' : item.status === 'unavailable' ? 'unavailable' : 'free');
    return palette.statuses[key] || palette.statuses.free;
  };

  // Rendu zones d'abord, puis murs/cloisons/portes, puis items réservables au premier plan
  const zoneElements = elements.filter((el) => el.type === 'zone');
  const wallElements = elements.filter((el) => el.type !== 'zone');

  return (
    <div
      ref={wrapRef}
      className="relative rounded-2xl border overflow-hidden select-none"
      style={{
        backgroundColor: palette.canvasBg,
        borderColor: dark ? 'rgba(255,255,255,0.1)' : '#e2e8f0',
      }}
    >
      {/* Barre contrôles Zoom */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b text-xs"
        style={{
          backgroundColor: palette.boardBg,
          borderColor: dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0',
          color: palette.textMuted,
        }}
      >
        <div className="flex items-center gap-2 font-semibold" style={{ color: palette.textPrimary }}>
          <span className="material-symbols-outlined text-[#f95d00]" style={{ fontSize: 17 }}>layers</span>
          <span>{plan?.name || 'Plan 2D'}</span>
          <span className="text-xs font-normal opacity-70">
            ({items.length} emplacement{items.length > 1 ? 's' : ''})
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.15).toFixed(2))))}
            className="px-2 py-1 rounded-lg border text-xs font-bold hover:opacity-80"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.14)' : '#cbd5e1', color: palette.textPrimary }}
            title="Dézoomer"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="px-2.5 py-1 rounded-lg border text-xs font-semibold hover:opacity-80"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.14)' : '#cbd5e1', color: palette.textPrimary }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.15).toFixed(2))))}
            className="px-2 py-1 rounded-lg border text-xs font-bold hover:opacity-80"
            style={{ borderColor: dark ? 'rgba(255,255,255,0.14)' : '#cbd5e1', color: palette.textPrimary }}
            title="Zoomer"
          >
            +
          </button>
        </div>
      </div>

      {/* Zone SVG responsive & scrollable */}
      <div
        className="overflow-auto touch-pan-x touch-pan-y"
        style={{ maxHeight: '72vh', minHeight }}
      >
        <div
          className="p-3 sm:p-4 mx-auto"
          style={{ width: `${Math.round(zoom * 100)}%`, minWidth: 560 }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto block rounded-xl shadow-sm"
            style={{ backgroundColor: palette.boardBg }}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
            onClick={() => {
              if (mode === 'editor' && onSelectTarget) onSelectTarget(null);
            }}
          >
            <defs>
              {/* Grille */}
              <pattern id="fp-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                <path
                  d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                  fill="none"
                  stroke={palette.gridStroke}
                  strokeWidth="1"
                />
              </pattern>

              {/* Motifs hachurés maintenance & indisponibilité */}
              <pattern id="fp-hatch-light" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="#e2e8f0" />
                <line x1="0" y1="0" x2="0" y2="10" stroke="#94a3b8" strokeWidth="3.5" />
              </pattern>
              <pattern id="fp-hatch-dark" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="#292524" />
                <line x1="0" y1="0" x2="0" y2="10" stroke="#57534e" strokeWidth="3.5" />
              </pattern>
              <pattern id="fp-hatch-unavailable-light" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="#fef3c7" />
                <line x1="0" y1="0" x2="0" y2="10" stroke="#f59e0b" strokeWidth="3" />
              </pattern>
              <pattern id="fp-hatch-unavailable-dark" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                <rect width="10" height="10" fill="#3b2f16" />
                <line x1="0" y1="0" x2="0" y2="10" stroke="#d97706" strokeWidth="3" />
              </pattern>
            </defs>

            {/* Fond + Image optionnelle + Grille */}
            <rect x="0" y="0" width={width} height={height} fill={palette.boardBg} rx="12" />
            {plan?.background_image_url && (
              <image
                href={plan.background_image_url}
                x="0"
                y="0"
                width={width}
                height={height}
                preserveAspectRatio="xMidYMid meet"
                opacity={dark ? 0.35 : 0.45}
              />
            )}
            <rect x="0" y="0" width={width} height={height} fill="url(#fp-grid)" rx="12" pointerEvents="none" />

            {/* 1. Zones décoratives */}
            {zoneElements.map((el) => {
              const isSelected = normalizedSelection?.kind === 'element' && normalizedSelection?.id === el.id;
              const cx = el.x + el.width / 2;
              const cy = el.y + el.height / 2;
              return (
                <g
                  key={el.id}
                  transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0} ${el.width / 2} ${el.height / 2})`}
                  style={{ cursor: mode === 'editor' ? 'move' : 'default' }}
                  onPointerDown={(e) => mode === 'editor' && handlePointerDownItem(e, 'element', el)}
                  onClick={(e) => mode === 'editor' && e.stopPropagation()}
                >
                  <rect
                    width={el.width}
                    height={el.height}
                    rx={12}
                    fill={palette.zoneFill}
                    stroke={isSelected ? '#f95d00' : palette.zoneStroke}
                    strokeWidth={isSelected ? 2.5 : 1.2}
                    strokeDasharray={isSelected ? '6 3' : '4 4'}
                  />
                  {el.label && (
                    <text
                      x={14}
                      y={22}
                      fill={palette.zoneText}
                      fontSize="12"
                      fontWeight="700"
                      letterSpacing="0.06em"
                      style={{ textTransform: 'uppercase', pointerEvents: 'none' }}
                    >
                      {el.label}
                    </text>
                  )}
                  {mode === 'editor' && isSelected && (
                    <rect
                      x={el.width - 10}
                      y={el.height - 10}
                      width={14}
                      height={14}
                      rx={3}
                      fill="#f95d00"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(e) => handlePointerDownResize(e, 'element', el)}
                    />
                  )}
                  <title>{el.label || 'Zone'}</title>
                </g>
              );
            })}

            {/* 2. Murs, cloisons & portes */}
            {wallElements.map((el) => {
              const isSelected = normalizedSelection?.kind === 'element' && normalizedSelection?.id === el.id;
              return (
                <g
                  key={el.id}
                  transform={`translate(${el.x}, ${el.y}) rotate(${el.rotation || 0} ${el.width / 2} ${el.height / 2})`}
                  style={{ cursor: mode === 'editor' ? 'move' : 'default' }}
                  onPointerDown={(e) => mode === 'editor' && handlePointerDownItem(e, 'element', el)}
                  onClick={(e) => mode === 'editor' && e.stopPropagation()}
                >
                  {el.type === 'wall' && (
                    <rect
                      width={el.width}
                      height={el.height}
                      rx={3}
                      fill={palette.wallFill}
                      stroke={isSelected ? '#f95d00' : 'none'}
                      strokeWidth={isSelected ? 2 : 0}
                    />
                  )}
                  {el.type === 'partition' && (
                    <rect
                      width={el.width}
                      height={el.height}
                      rx={2}
                      fill={palette.partitionFill}
                      fillOpacity={0.45}
                      stroke={isSelected ? '#f95d00' : palette.partitionFill}
                      strokeWidth={isSelected ? 2 : 1}
                      strokeDasharray="6 4"
                    />
                  )}
                  {el.type === 'door' && (
                    <g>
                      <rect width={el.width} height={el.height} fill="transparent" />
                      <line
                        x1={0}
                        y1={el.height * 0.7}
                        x2={el.width}
                        y2={el.height * 0.7}
                        stroke={isSelected ? '#f95d00' : palette.doorStroke}
                        strokeWidth={3}
                      />
                      <path
                        d={`M 4 ${el.height * 0.7} A ${el.width * 0.65} ${el.width * 0.65} 0 0 1 ${el.width * 0.7} 4`}
                        fill="none"
                        stroke={isSelected ? '#f95d00' : palette.doorStroke}
                        strokeWidth={1.6}
                        strokeDasharray="4 3"
                      />
                      {el.label && (
                        <text
                          x={el.width / 2}
                          y={el.height * 0.6}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight="700"
                          fill={palette.doorStroke}
                          pointerEvents="none"
                        >
                          {el.label}
                        </text>
                      )}
                    </g>
                  )}
                  {mode === 'editor' && isSelected && (
                    <rect
                      x={el.width - 8}
                      y={el.height - 8}
                      width={12}
                      height={12}
                      rx={3}
                      fill="#f95d00"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(e) => handlePointerDownResize(e, 'element', el)}
                    />
                  )}
                </g>
              );
            })}

            {/* 3. Postes et salles réservables */}
            {items.map((item) => {
              const isSelected = normalizedSelection?.kind === 'item' && normalizedSelection?.id === item.id;
              const colors = getItemColors(item);
              const isSmall = (item.width || 72) < 120;
              const isClickable = mode === 'editor' || mode === 'live' || item.bookable !== false;
              const isOvertime = item.live_status === 'overtime';

              return (
                <g
                  key={item.id}
                  transform={`translate(${item.x}, ${item.y}) rotate(${item.rotation || 0} ${item.width / 2} ${item.height / 2})`}
                  style={{
                    cursor: mode === 'editor' ? 'move' : isClickable ? 'pointer' : 'not-allowed',
                    opacity: mode === 'booking' && item.live_status === 'occupied' ? 0.88 : 1,
                  }}
                  onPointerDown={(e) => handlePointerDownItem(e, 'item', item)}
                  onPointerEnter={(e) => updateHover(e, item)}
                  onPointerMove={(e) => updateHover(e, item)}
                  onPointerLeave={() => setHoverInfo(null)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Halo de sélection */}
                  {isSelected && (
                    <rect
                      x={-4}
                      y={-4}
                      width={item.width + 8}
                      height={item.height + 8}
                      rx={13}
                      fill="none"
                      stroke="#f95d00"
                      strokeWidth={2.5}
                    />
                  )}

                  {/* Cadre principal */}
                  <rect
                    width={item.width}
                    height={item.height}
                    rx={10}
                    fill={colors.fill}
                    stroke={isSelected ? '#f95d00' : colors.stroke}
                    strokeWidth={isSelected ? 2.5 : 1.8}
                  />

                  {/* Dessin mobilier intérieur */}
                  <FurnitureSvg item={item} color={colors} />

                  {/* Pastille d'état en direct */}
                  <circle
                    cx={item.width - 10}
                    cy={10}
                    r={isOvertime ? 5 : 4}
                    fill={colors.dot}
                  />
                  {isOvertime && mode === 'live' && (
                    <circle
                      cx={item.width - 10}
                      cy={10}
                      r={8}
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth={1.5}
                      opacity={0.7}
                    >
                      <animate attributeName="r" values="5;10;5" dur="1.6s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.8;0.1;0.8" dur="1.6s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Étiquette courte */}
                  <text
                    x={item.width / 2}
                    y={isSmall ? item.height / 2 + 4 : item.height - 14}
                    textAnchor="middle"
                    fill={colors.text}
                    fontSize={isSmall ? 11.5 : 13}
                    fontWeight="800"
                    fontFamily="Sora, Inter, sans-serif"
                    pointerEvents="none"
                  >
                    {item.label}
                  </text>

                  {/* Nom de l'espace officiel sur les grandes salles */}
                  {!isSmall && item.space_name && (
                    <text
                      x={item.width / 2}
                      y={22}
                      textAnchor="middle"
                      fill={colors.text}
                      fontSize={10}
                      fontWeight="600"
                      opacity={0.82}
                      pointerEvents="none"
                    >
                      {item.space_name.length > 26 ? `${item.space_name.slice(0, 24)}…` : item.space_name}
                    </text>
                  )}

                  {/* Poignée redimensionnement (éditeur) */}
                  {mode === 'editor' && isSelected && (
                    <rect
                      x={item.width - 10}
                      y={item.height - 10}
                      width={14}
                      height={14}
                      rx={4}
                      fill="#f95d00"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      style={{ cursor: 'nwse-resize' }}
                      onPointerDown={(e) => handlePointerDownResize(e, 'item', item)}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Tooltip flottante propre (Mode Live / Booking) */}
      {hoverInfo && mode !== 'editor' && (
        <div
          className="pointer-events-none absolute z-30 rounded-xl px-3.5 py-2.5 text-xs shadow-xl border backdrop-blur-md"
          style={{
            left: hoverInfo.x,
            top: hoverInfo.y,
            maxWidth: 265,
            backgroundColor: dark ? 'rgba(20, 19, 17, 0.95)' : 'rgba(255, 255, 255, 0.96)',
            borderColor: dark ? 'rgba(255,255,255,0.14)' : '#e2e8f0',
            color: palette.textPrimary,
          }}
        >
          {renderTooltipContent ? (
            renderTooltipContent(hoverInfo.item)
          ) : (
            <div>
              <p className="font-bold">
                {getItemTypeMeta(hoverInfo.item.item_type).shortLabel} · {hoverInfo.item.label}
              </p>
              <p className="opacity-75 mt-0.5">{hoverInfo.item.status_label || 'Libre'}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

