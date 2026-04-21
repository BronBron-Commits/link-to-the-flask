export function createEnemyHealthBarPrimitive(enemyHealthBars, dummy, documentObj = document) {
    if (!dummy || enemyHealthBars.has(dummy)) return;

    const container = documentObj.createElement('div');
    container.style.position = 'fixed';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '5000';
    container.style.left = '-300px';
    container.style.top = '-300px';
    container.style.transform = 'translateX(-50%)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '2px';

    const nameEl = documentObj.createElement('div');
    nameEl.textContent = dummy.userData.name || 'Enemy';
    nameEl.style.fontSize = '11px';
    nameEl.style.fontFamily = 'Consolas, monospace';
    nameEl.style.color = '#ffcccc';
    nameEl.style.textShadow = '0 1px 5px #000, 0 0 8px rgba(0,0,0,0.9)';
    nameEl.style.letterSpacing = '0.5px';
    nameEl.style.whiteSpace = 'nowrap';
    container.appendChild(nameEl);

    const track = documentObj.createElement('div');
    track.style.width = '80px';
    track.style.height = '7px';
    track.style.borderRadius = '4px';
    track.style.background = 'rgba(0,0,0,0.75)';
    track.style.border = '1px solid rgba(255,200,200,0.3)';
    track.style.position = 'relative';
    track.style.overflow = 'hidden';

    const lagFill = documentObj.createElement('div');
    lagFill.style.position = 'absolute';
    lagFill.style.left = '0';
    lagFill.style.top = '0';
    lagFill.style.height = '100%';
    lagFill.style.width = '100%';
    lagFill.style.background = '#cc2222';
    lagFill.style.borderRadius = '4px';
    track.appendChild(lagFill);

    const hpFill = documentObj.createElement('div');
    hpFill.style.position = 'absolute';
    hpFill.style.left = '0';
    hpFill.style.top = '0';
    hpFill.style.height = '100%';
    hpFill.style.width = '100%';
    hpFill.style.background = '#44ff66';
    hpFill.style.borderRadius = '4px';
    hpFill.style.transition = 'width 0.35s cubic-bezier(0.2,0.9,0.3,1)';
    track.appendChild(hpFill);

    container.appendChild(track);
    documentObj.body.appendChild(container);

    enemyHealthBars.set(dummy, { container, hpFill, lagFill, nameEl, lagValue: 1.0 });
}

export function removeEnemyHealthBarPrimitive(enemyHealthBars, dummy) {
    const bar = enemyHealthBars.get(dummy);
    if (!bar) return;
    if (bar.container.parentNode) bar.container.parentNode.removeChild(bar.container);
    enemyHealthBars.delete(dummy);
}

export function createPlayerHeadHealthBarPrimitive(playerHeadHealthBars, actorKey, name = 'Player', documentObj = document) {
    if (!actorKey || playerHeadHealthBars.has(actorKey)) return;

    const container = documentObj.createElement('div');
    container.style.position = 'fixed';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '5000';
    container.style.left = '-300px';
    container.style.top = '-300px';
    container.style.transform = 'translateX(-50%)';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.gap = '2px';

    const nameEl = documentObj.createElement('div');
    nameEl.textContent = name;
    nameEl.style.fontSize = '11px';
    nameEl.style.fontFamily = 'Consolas, monospace';
    nameEl.style.color = '#c7e6ff';
    nameEl.style.textShadow = '0 1px 5px #000, 0 0 8px rgba(0,0,0,0.9)';
    nameEl.style.letterSpacing = '0.5px';
    nameEl.style.whiteSpace = 'nowrap';
    container.appendChild(nameEl);

    const track = documentObj.createElement('div');
    track.style.width = '80px';
    track.style.height = '7px';
    track.style.borderRadius = '4px';
    track.style.background = 'rgba(0,0,0,0.75)';
    track.style.border = '1px solid rgba(150,210,255,0.35)';
    track.style.position = 'relative';
    track.style.overflow = 'hidden';

    const lagFill = documentObj.createElement('div');
    lagFill.style.position = 'absolute';
    lagFill.style.left = '0';
    lagFill.style.top = '0';
    lagFill.style.height = '100%';
    lagFill.style.width = '100%';
    lagFill.style.background = '#2a4f7a';
    lagFill.style.borderRadius = '4px';
    track.appendChild(lagFill);

    const hpFill = documentObj.createElement('div');
    hpFill.style.position = 'absolute';
    hpFill.style.left = '0';
    hpFill.style.top = '0';
    hpFill.style.height = '100%';
    hpFill.style.width = '100%';
    hpFill.style.background = '#44ff66';
    hpFill.style.borderRadius = '4px';
    hpFill.style.transition = 'width 0.35s cubic-bezier(0.2,0.9,0.3,1)';
    track.appendChild(hpFill);

    container.appendChild(track);
    documentObj.body.appendChild(container);

    playerHeadHealthBars.set(actorKey, { container, hpFill, lagFill, nameEl, lagValue: 1.0 });
}

export function removePlayerHeadHealthBarPrimitive(playerHeadHealthBars, actorKey) {
    if (!actorKey) return;
    const bar = playerHeadHealthBars.get(actorKey);
    if (!bar) return;
    if (bar.container.parentNode) bar.container.parentNode.removeChild(bar.container);
    playerHeadHealthBars.delete(actorKey);
}

export function updateSingleHeadHealthBarPrimitive(bar, hp, maxHp) {
    if (!bar) return;
    const safeMax = Math.max(1, Number(maxHp) || 1);
    const safeHp = Math.max(0, Math.min(safeMax, Number(hp) || 0));
    const hpFrac = safeHp / safeMax;
    bar.hpFill.style.width = `${hpFrac * 100}%`;
    bar.hpFill.style.background = hpFrac > 0.6 ? '#44ff66' : hpFrac > 0.3 ? '#ffcc00' : '#ff4444';
    if (bar.lagValue > hpFrac) {
        bar.lagValue = Math.max(hpFrac, bar.lagValue - 0.006);
    } else {
        bar.lagValue = hpFrac;
    }
    bar.lagFill.style.width = `${bar.lagValue * 100}%`;
}

export function attachTargetSelectionRingPrimitive(target, THREERef) {
    if (!target || target.userData.selectionRing) return;
    const geo = new THREERef.RingGeometry(0.58, 0.82, 36);
    const mat = new THREERef.MeshBasicMaterial({
        color: 0xffcc00,
        transparent: true,
        opacity: 0.85,
        side: THREERef.DoubleSide,
        depthWrite: false,
    });
    const ring = new THREERef.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.98;
    ring.renderOrder = 22;
    target.add(ring);
    target.userData.selectionRing = ring;
}

export function removeTargetSelectionRingPrimitive(target) {
    if (!target || !target.userData.selectionRing) return;
    target.remove(target.userData.selectionRing);
    target.userData.selectionRing.geometry.dispose();
    target.userData.selectionRing.material.dispose();
    target.userData.selectionRing = null;
}
