// components/floorplan/FloorPlanEditor.jsx — Éditeur SVG 2D côté Gérant (/admin/espaces?tab=plan)
import React, { useState, useEffect, useCallback } from 'react';
import { floorPlansApi } from '../../services/api';
import { useTheme } from '../../context/ThemeContext';
import FloorPlanCanvas from './FloorPlanCanvas';
import { ITEM_TYPES, STRUCTURE_TYPES, getItemTypeMeta } from './floorPlanConstants';
import { formatDT } from '../../utils/format';

function makeLocalId(prefix = 'tmp') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default function FloorPlanEditor({ espaces = [], showToast, showError }) {
  const { dark } = useTheme();
  const [plans, setPlans] = useState([]);
  const [activePlanId, setActivePlanId] = useState(null);
  const [draftPlan, setDraftPlan] = useState(null);
  const [selectedTarget, setSelectedTarget] = useState(null); // { kind: 'item'|'element', id }
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadPlans = useCallback(async (preferredId = null) => {
    try {
      setLoading(true);
      const res = await floorPlansApi.list();
      const list = res.floor_plans || [];
      setPlans(list);
      const next = (preferredId && list.find((p) => p.id === preferredId)) || list[0] || null;
      setActivePlanId(next?.id || null);
      setDraftPlan(next ? JSON.parse(JSON.stringify(next)) : null);
      setSelectedTarget(null);
      setDirty(false);
    } catch (e) {
      showError?.(e.message || 'Impossible de charger les plans 2D.');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const selectPlan = (planId) => {
    if (dirty && !window.confirm('Vous avez des modifications non enregistrées. Changer de plan quand même ?')) {
      return;
    }
    const found = plans.find((p) => p.id === planId);
    setActivePlanId(planId);
    setDraftPlan(found ? JSON.parse(JSON.stringify(found)) : null);
    setSelectedTarget(null);
    setDirty(false);
  };

  const handleCreatePlan = async () => {
    const name = window.prompt('Nom du nouveau plan (ex : Étage 1, Open Space...) :', `Plan ${plans.length + 1}`);
    if (!name || !name.trim()) return;
    try {
      setSaving(true);
      const defaultElements = [
        { id: makeLocalId('el'), type: 'wall', label: '', x: 20, y: 20, width: 1160, height: 12, rotation: 0 },
        { id: makeLocalId('el'), type: 'wall', label: '', x: 20, y: 728, width: 1160, height: 12, rotation: 0 },
        { id: makeLocalId('el'), type: 'wall', label: '', x: 20, y: 20, width: 12, height: 720, rotation: 0 },
        { id: makeLocalId('el'), type: 'wall', label: '', x: 1168, y: 20, width: 12, height: 720, rotation: 0 },
        { id: makeLocalId('el'), type: 'door', label: 'Entrée', x: 80, y: 700, width: 80, height: 40, rotation: 0 },
      ];
      const res = await floorPlansApi.create({
        name: name.trim(),
        width: 1200,
        height: 760,
        grid_size: 20,
        elements_json: defaultElements,
        items: [],
        is_active: true,
        ordre: plans.length,
      });
      showToast?.(`Plan « ${res.floor_plan.name} » créé.`);
      await loadPlans(res.floor_plan.id);
    } catch (e) {
      showError?.(e.message || 'Erreur lors de la création du plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!draftPlan) return;
    if (!window.confirm(`Supprimer définitivement le plan « ${draftPlan.name} » ?`)) return;
    try {
      setSaving(true);
      await floorPlansApi.delete(draftPlan.id);
      showToast?.(`Plan « ${draftPlan.name} » supprimé.`);
      await loadPlans();
    } catch (e) {
      showError?.(e.message || 'Impossible de supprimer le plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePlan = async () => {
    if (!draftPlan) return;
    try {
      setSaving(true);
      const res = await floorPlansApi.update(draftPlan.id, {
        name: draftPlan.name,
        width: Number(draftPlan.width) || 1200,
        height: Number(draftPlan.height) || 760,
        grid_size: Number(draftPlan.grid_size) || 20,
        background_image_url: draftPlan.background_image_url || null,
        is_active: draftPlan.is_active !== false,
        elements_json: draftPlan.elements_json || [],
        items: draftPlan.items || [],
      });
      setPlans((prev) => prev.map((p) => (p.id === draftPlan.id ? res.floor_plan : p)));
      setDraftPlan(JSON.parse(JSON.stringify(res.floor_plan)));
      setDirty(false);
      showToast?.('Plan interactif enregistré en base.');
    } catch (e) {
      showError?.(e.message || 'Erreur lors de l’enregistrement du plan.');
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (updater) => {
    setDraftPlan((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  };

  const nextLabelForType = (type, currentItems) => {
    const meta = getItemTypeMeta(type);
    const sameType = currentItems.filter((it) => it.item_type === type);
    const idx = sameType.length + 1;
    return `${meta.prefix}-${String(idx).padStart(2, '0')}`;
  };

  const pickSuggestedSpace = (itemType) => {
    const meta = getItemTypeMeta(itemType);
    const match = espaces.find((e) => meta.suggestedSpaceTypes.includes(e.type));
    return match?.id || (espaces[0]?.id || null);
  };

  const handleAddItem = (itemType) => {
    if (!draftPlan) return;
    const meta = getItemTypeMeta(itemType);
    const offset = ((draftPlan.items?.length || 0) % 6) * 20;
    const newItem = {
      id: makeLocalId('item'),
      floor_plan_id: draftPlan.id,
      space_id: pickSuggestedSpace(itemType),
      label: nextLabelForType(itemType, draftPlan.items || []),
      item_type: itemType,
      x: 100 + offset,
      y: 100 + offset,
      width: meta.defaultW,
      height: meta.defaultH,
      rotation: 0,
      status: 'active',
      metadata: {},
    };
    updateDraft((p) => ({ ...p, items: [...(p.items || []), newItem] }));
    setSelectedTarget({ kind: 'item', id: newItem.id });
  };

  const handleAddDeskCluster = () => {
    if (!draftPlan) return;
    const existingCount = (draftPlan.items || []).filter((i) => i.item_type === 'desk').length;
    const islandNum = Math.floor(existingCount / 4) + 1;
    const baseX = 120 + ((islandNum - 1) % 3) * 240;
    const baseY = 120;
    const spaceId = pickSuggestedSpace('desk');
    const created = [
      { dx: 0, dy: 0, n: 1 },
      { dx: 100, dy: 0, n: 2 },
      { dx: 0, dy: 80, n: 3 },
      { dx: 100, dy: 80, n: 4 },
    ].map(({ dx, dy, n }) => ({
      id: makeLocalId('item'),
      floor_plan_id: draftPlan.id,
      space_id: spaceId,
      label: `A${islandNum}-0${n}`,
      item_type: 'desk',
      x: baseX + dx,
      y: baseY + dy,
      width: 80,
      height: 56,
      rotation: 0,
      status: 'active',
      metadata: {},
    }));
    updateDraft((p) => ({ ...p, items: [...(p.items || []), ...created] }));
    setSelectedTarget({ kind: 'item', id: created[0].id });
  };

  const handleAddStructure = (structType) => {
    if (!draftPlan) return;
    const meta = STRUCTURE_TYPES.find((s) => s.value === structType) || STRUCTURE_TYPES[0];
    const newEl = {
      id: makeLocalId('el'),
      type: structType,
      label: structType === 'zone' ? 'Nouvelle zone' : structType === 'door' ? 'Porte' : '',
      x: 80,
      y: 80,
      width: meta.defaultW,
      height: meta.defaultH,
      rotation: 0,
    };
    updateDraft((p) => ({ ...p, elements_json: [...(p.elements_json || []), newEl] }));
    setSelectedTarget({ kind: 'element', id: newEl.id });
  };

  const handleMoveTarget = (kind, id, { x, y }) => {
    updateDraft((p) => {
      if (kind === 'item') {
        return { ...p, items: (p.items || []).map((it) => (it.id === id ? { ...it, x, y } : it)) };
      }
      return { ...p, elements_json: (p.elements_json || []).map((el) => (el.id === id ? { ...el, x, y } : el)) };
    });
  };

  const handleResizeTarget = (kind, id, { width, height }) => {
    updateDraft((p) => {
      if (kind === 'item') {
        return { ...p, items: (p.items || []).map((it) => (it.id === id ? { ...it, width, height } : it)) };
      }
      return { ...p, elements_json: (p.elements_json || []).map((el) => (el.id === id ? { ...el, width, height } : el)) };
    });
  };

  const selectedObj = (() => {
    if (!draftPlan || !selectedTarget) return null;
    if (selectedTarget.kind === 'item') {
      return (draftPlan.items || []).find((i) => i.id === selectedTarget.id) || null;
    }
    return (draftPlan.elements_json || []).find((e) => e.id === selectedTarget.id) || null;
  })();

  const updateSelected = (patch) => {
    if (!selectedTarget || !selectedObj) return;
    updateDraft((p) => {
      if (selectedTarget.kind === 'item') {
        return {
          ...p,
          items: (p.items || []).map((it) => (it.id === selectedTarget.id ? { ...it, ...patch } : it)),
        };
      }
      return {
        ...p,
        elements_json: (p.elements_json || []).map((el) => (el.id === selectedTarget.id ? { ...el, ...patch } : el)),
      };
    });
  };

  const rotateSelected = useCallback(() => {
    if (!selectedTarget || !selectedObj) return;
    const nextRot = ((selectedObj.rotation || 0) + 90) % 360;
    updateSelected({
      rotation: nextRot,
      width: selectedObj.height,
      height: selectedObj.width,
    });
  }, [selectedTarget, selectedObj]);

  const duplicateSelected = () => {
    if (!selectedTarget || !selectedObj || !draftPlan) return;
    const copy = {
      ...selectedObj,
      id: makeLocalId(selectedTarget.kind),
      x: Math.min((draftPlan.width || 1200) - 40, (selectedObj.x || 0) + (draftPlan.grid_size || 20)),
      y: Math.min((draftPlan.height || 760) - 40, (selectedObj.y || 0) + (draftPlan.grid_size || 20)),
      ...(selectedTarget.kind === 'item' ? { label: `${selectedObj.label}-bis` } : {}),
    };
    updateDraft((p) =>
      selectedTarget.kind === 'item'
        ? { ...p, items: [...(p.items || []), copy] }
        : { ...p, elements_json: [...(p.elements_json || []), copy] }
    );
    setSelectedTarget({ kind: selectedTarget.kind, id: copy.id });
  };

  const deleteSelected = useCallback(() => {
    if (!selectedTarget) return;
    updateDraft((p) =>
      selectedTarget.kind === 'item'
        ? { ...p, items: (p.items || []).filter((it) => it.id !== selectedTarget.id) }
        : { ...p, elements_json: (p.elements_json || []).filter((el) => el.id !== selectedTarget.id) }
    );
    setSelectedTarget(null);
  }, [selectedTarget]);

  // Raccourcis clavier (Suppr, R pour pivoter)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (!selectedTarget) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        rotateSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTarget, deleteSelected, rotateSelected]);

  const unlinkedCount = (draftPlan?.items || []).filter((i) => !i.space_id).length;

  const cardCls = `rounded-2xl border p-4 ${
    dark ? 'bg-[#1b1a18] border-white/10 text-white' : 'bg-white border-outline-variant/20 text-primary'
  }`;
  const inputSm = `w-full px-3 py-2 rounded-xl border text-xs outline-none transition-all ${
    dark
      ? 'bg-[#141311] border-white/15 text-white focus:border-secondary'
      : 'bg-white border-outline-variant/30 text-primary focus:border-secondary'
  }`;

  if (loading) {
    return (
      <div className={cardCls}>
        <div className="h-96 animate-pulse rounded-xl bg-slate-200/40" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barre supérieure : sélecteur de plan + sauvegarde */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {plans.length > 0 && (
              <select
                value={activePlanId || ''}
                onChange={(e) => selectPlan(e.target.value)}
                className={`px-3.5 py-2 rounded-xl border text-sm font-bold outline-none ${
                  dark ? 'bg-[#141311] border-white/15 text-white' : 'bg-slate-50 border-outline-variant/30 text-primary'
                }`}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.is_active === false ? '(Masqué)' : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleCreatePlan}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-secondary/40 text-secondary font-bold text-xs hover:bg-secondary/10 transition"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add</span>
              Nouveau plan
            </button>
            {draftPlan && (
              <button
                type="button"
                onClick={handleDeletePlan}
                disabled={saving}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-red-500 hover:bg-red-500/10 transition"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                Supprimer
              </button>
            )}
          </div>

          {draftPlan && (
            <div className="flex items-center gap-3">
              {dirty && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-600 text-[11px] font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Modifications non enregistrées
                </span>
              )}
              <button
                type="button"
                onClick={handleSavePlan}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-secondary text-white font-bold text-xs sm:text-sm hover:bg-secondary/90 disabled:opacity-50 shadow-sm"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>save</span>
                {saving ? 'Enregistrement…' : 'Enregistrer le plan'}
              </button>
            </div>
          )}
        </div>

        {/* Propriétés globales du plan */}
        {draftPlan && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-outline-variant/15">
            <div className="col-span-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Nom du plan</label>
              <input
                value={draftPlan.name || ''}
                onChange={(e) => updateDraft((p) => ({ ...p, name: e.target.value }))}
                className={inputSm}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Largeur × Hauteur (px)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={400}
                  max={4000}
                  step={20}
                  value={draftPlan.width || 1200}
                  onChange={(e) => updateDraft((p) => ({ ...p, width: Number(e.target.value) || 1200 }))}
                  className={inputSm}
                />
                <span className="text-xs opacity-50">×</span>
                <input
                  type="number"
                  min={300}
                  max={3000}
                  step={20}
                  value={draftPlan.height || 760}
                  onChange={(e) => updateDraft((p) => ({ ...p, height: Number(e.target.value) || 760 }))}
                  className={inputSm}
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Grille (px)</label>
              <select
                value={draftPlan.grid_size || 20}
                onChange={(e) => updateDraft((p) => ({ ...p, grid_size: Number(e.target.value) }))}
                className={inputSm}
              >
                {[10, 20, 25, 40].map((g) => (
                  <option key={g} value={g}>{g} px</option>
                ))}
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={draftPlan.is_active !== false}
                  onChange={(e) => updateDraft((p) => ({ ...p, is_active: e.target.checked }))}
                />
                Visible clients (actif)
              </label>
            </div>
          </div>
        )}
      </div>

      {!draftPlan ? (
        <div className={`${cardCls} text-center py-14`}>
          <span className="material-symbols-outlined text-secondary/60 block mb-3" style={{ fontSize: 52 }}>map</span>
          <h3 className="font-sora font-bold text-lg mb-2">Aucun plan interactif 2D configuré</h3>
          <p className="text-sm opacity-75 max-w-md mx-auto mb-6">
            Dessinez votre espace (murs, zones, bureaux, îlots de postes) et liez chaque emplacement à vos espaces existants.
          </p>
          <button
            type="button"
            onClick={handleCreatePlan}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-secondary text-white rounded-xl font-bold text-sm hover:bg-secondary/90"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add</span>
            Créer mon premier plan 2D
          </button>
        </div>
      ) : (
        <>
          {/* Palette outils */}
          <div className={cardCls}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1.5">
                  Éléments de structure
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {STRUCTURE_TYPES.map((st) => (
                    <button
                      key={st.value}
                      type="button"
                      onClick={() => handleAddStructure(st.value)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition ${
                        dark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-secondary" style={{ fontSize: 15 }}>{st.icon}</span>
                      + {st.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1.5">
                  Éléments réservables (glisser & lier)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleAddDeskCluster}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-secondary/10 border border-secondary/30 text-secondary text-xs font-bold hover:bg-secondary/15 transition"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>grid_view</span>
                    + Îlot 4 postes
                  </button>
                  {ITEM_TYPES.map((it) => (
                    <button
                      key={it.value}
                      type="button"
                      onClick={() => handleAddItem(it.value)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition ${
                        dark ? 'border-white/15 hover:bg-white/10' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="material-symbols-outlined text-secondary" style={{ fontSize: 15 }}>{it.icon}</span>
                      + {it.shortLabel}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {unlinkedCount > 0 && (
              <div className="mt-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
                <span>
                  {unlinkedCount} emplacement{unlinkedCount > 1 ? 's' : ''} n&apos;est pas encore associé à un espace de « Mes Espaces » (cliquez dessus pour l&apos;associer).
                </span>
              </div>
            )}
          </div>

          {/* Zone principale : Canvas SVG + Inspecteur latéral */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
            <FloorPlanCanvas
              plan={draftPlan}
              mode="editor"
              selectedTarget={selectedTarget}
              onSelectTarget={(target) => setSelectedTarget(target ? { kind: target.kind, id: target.id } : null)}
              onMoveTarget={handleMoveTarget}
              onResizeTarget={handleResizeTarget}
            />

            {/* Inspecteur latéral */}
            <div className={`${cardCls} space-y-4`}>
              <div className="flex items-center justify-between border-b border-outline-variant/15 pb-3">
                <h3 className="font-sora font-bold text-sm flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary" style={{ fontSize: 18 }}>tune</span>
                  Propriétés sélectionnées
                </h3>
                {selectedObj && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={rotateSelected}
                      title="Pivoter 90° (R)"
                      className="p-1.5 rounded-lg hover:bg-secondary/10 text-secondary"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>rotate_90_degrees_cw</span>
                    </button>
                    <button
                      type="button"
                      onClick={duplicateSelected}
                      title="Dupliquer"
                      className="p-1.5 rounded-lg hover:bg-secondary/10 text-secondary"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>content_copy</span>
                    </button>
                    <button
                      type="button"
                      onClick={deleteSelected}
                      title="Supprimer (Suppr)"
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>delete</span>
                    </button>
                  </div>
                )}
              </div>

              {!selectedObj ? (
                <div className="text-xs opacity-70 space-y-2 py-4">
                  <p>Cliquez sur un poste, une salle, une zone ou un mur sur le plan pour modifier ses propriétés.</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Glissez-déposez pour déplacer (magnétisme grille)</li>
                    <li>Tirez le carré orange en bas à droite pour redimensionner</li>
                    <li>Touches <strong>R</strong> (pivoter 90°) / <strong>Suppr</strong> (effacer)</li>
                  </ul>
                </div>
              ) : selectedTarget?.kind === 'item' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">
                      Identifiant court * (ex : A1-01, Salle Prestige)
                    </label>
                    <input
                      value={selectedObj.label || ''}
                      onChange={(e) => updateSelected({ label: e.target.value })}
                      className={inputSm}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">
                      Espace officiel associé (Mes Espaces)
                    </label>
                    <select
                      value={selectedObj.space_id || ''}
                      onChange={(e) => updateSelected({ space_id: e.target.value || null })}
                      className={inputSm}
                    >
                      <option value="">— Non associé (non réservable) —</option>
                      {espaces.map((esp) => (
                        <option key={esp.id} value={esp.id}>
                          {esp.nom} ({formatDT(esp.tarif_horaire)}/h)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Type visuel</label>
                    <select
                      value={selectedObj.item_type || 'desk'}
                      onChange={(e) => updateSelected({ item_type: e.target.value })}
                      className={inputSm}
                    >
                      {ITEM_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">X / Y</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          value={selectedObj.x || 0}
                          onChange={(e) => updateSelected({ x: Number(e.target.value) || 0 })}
                          className={inputSm}
                        />
                        <input
                          type="number"
                          value={selectedObj.y || 0}
                          onChange={(e) => updateSelected({ y: Number(e.target.value) || 0 })}
                          className={inputSm}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Largeur / Hauteur</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          min={24}
                          value={selectedObj.width || 72}
                          onChange={(e) => updateSelected({ width: Math.max(24, Number(e.target.value) || 72) })}
                          className={inputSm}
                        />
                        <input
                          type="number"
                          min={24}
                          value={selectedObj.height || 52}
                          onChange={(e) => updateSelected({ height: Math.max(24, Number(e.target.value) || 52) })}
                          className={inputSm}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-outline-variant/15 flex items-center justify-between">
                    <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedObj.status === 'maintenance'}
                        onChange={(e) => updateSelected({ status: e.target.checked ? 'maintenance' : 'active' })}
                      />
                      En maintenance (gris rayé)
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider opacity-70">
                    Élément : {STRUCTURE_TYPES.find((s) => s.value === selectedObj.type)?.label || selectedObj.type}
                  </p>
                  {(selectedObj.type === 'zone' || selectedObj.type === 'door') && (
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Libellé</label>
                      <input
                        value={selectedObj.label || ''}
                        onChange={(e) => updateSelected({ label: e.target.value })}
                        className={inputSm}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">X / Y</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          value={selectedObj.x || 0}
                          onChange={(e) => updateSelected({ x: Number(e.target.value) || 0 })}
                          className={inputSm}
                        />
                        <input
                          type="number"
                          value={selectedObj.y || 0}
                          onChange={(e) => updateSelected({ y: Number(e.target.value) || 0 })}
                          className={inputSm}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1">Largeur / Hauteur</label>
                      <div className="flex gap-1">
                        <input
                          type="number"
                          min={4}
                          value={selectedObj.width || 40}
                          onChange={(e) => updateSelected({ width: Math.max(4, Number(e.target.value) || 40) })}
                          className={inputSm}
                        />
                        <input
                          type="number"
                          min={4}
                          value={selectedObj.height || 40}
                          onChange={(e) => updateSelected({ height: Math.max(4, Number(e.target.value) || 40) })}
                          className={inputSm}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
