const fs = require('fs');
const path = require('path');

function createThreeStub() {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
  }

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }
  }

  class Plane {
    constructor(normal = new Vector3(0, 1, 0), constant = 0) {
      this.normal = normal;
      this.constant = constant;
    }
  }

  class Raycaster {
    constructor() {
      this._hits = [];
      this._planeHit = null;
      this.ray = {
        intersectPlane: (_plane, out) => {
          if (!this._planeHit) return null;
          out.set(this._planeHit.x, this._planeHit.y, this._planeHit.z);
          return out;
        },
      };
      Raycaster.lastInstance = this;
    }

    setFromCamera() {}

    intersectObjects() {
      return this._hits;
    }
  }
  Raycaster.lastInstance = null;

  class BoxGeometry {
    dispose() {}
  }

  class MeshStandardMaterial {
    constructor() {
      this.color = {
        setHex: () => {},
      };
    }

    dispose() {}
  }

  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.userData = {};
      this.position = new Vector3();
      this.rotation = { y: 0 };
      this.scale = { y: 1 };
    }
  }

  return {
    Vector2,
    Vector3,
    Plane,
    Raycaster,
    BoxGeometry,
    MeshStandardMaterial,
    Mesh,
  };
}

function loadNamedExport(filePath, exportName, injections) {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/import\s+\*\s+as\s+THREE\s+from\s+'\.\/three\.module\.js';\s*/g, '');
  source = source.replace(`export function ${exportName}`, `function ${exportName}`);

  const argNames = Object.keys(injections);
  const argValues = Object.values(injections);
  const wrapped = `${source}\nreturn { ${exportName} };`;
  const factory = new Function(...argNames, wrapped);
  return factory(...argValues)[exportName];
}

describe('Map3D interaction bridge simulation', () => {
  test('snapshot -> controls input -> runtime intents flow', () => {
    const THREE = createThreeStub();
    const runtimePath = path.resolve(__dirname, '../../static/map3d_runtime.js');
    const controlsPath = path.resolve(__dirname, '../../static/map3d_controls.js');

    const createMap3dRuntime = loadNamedExport(runtimePath, 'createMap3dRuntime', { THREE });
    const createMap3dControls = loadNamedExport(controlsPath, 'createMap3dControls', { THREE });

    const scene = {
      added: [],
      removed: [],
      add(obj) { this.added.push(obj); },
      remove(obj) { this.removed.push(obj); },
    };

    const domElement = {
      handlers: {},
      addEventListener(type, handler) {
        this.handlers[type] = handler;
      },
      removeEventListener(type) {
        delete this.handlers[type];
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 100, height: 100 };
      },
    };

    const runtime = createMap3dRuntime({
      scene,
      camera: {},
      renderer: { domElement },
    });

    const controls = createMap3dControls({
      camera: {},
      renderer: { domElement },
      getActorHitObjects: () => runtime.getActorHitObjects(),
      getInputFlags: () => runtime.getInputFlags(),
      emitIntent: (type, payload) => runtime.emitIntent(type, payload),
    });

    const intents = [];
    runtime.onIntent((intent) => intents.push(intent));

    controls.start();

    runtime.applySnapshot({
      actors: [
        { id: 'p1', team: 'player', hp: 20, maxHp: 20, position: { x: -2, y: 0.7, z: 0 }, rotation: { y: 0 } },
        { id: 'e1', team: 'enemy', hp: 12, maxHp: 12, position: { x: 2, y: 0.7, z: 1 }, rotation: { y: 0 } },
      ],
      canMove: true,
      canAttack: true,
      canEndTurn: true,
    });

    const ray = THREE.Raycaster.lastInstance;
    const actorObjects = runtime.getActorHitObjects();
    const enemy = actorObjects.find((obj) => obj.userData && obj.userData.actorId === 'e1');
    ray._hits = [{ object: enemy }];

    domElement.handlers.pointerdown({ clientX: 10, clientY: 10 });

    ray._hits = [];
    ray._planeHit = { x: 5, y: 0, z: -3 };
    domElement.handlers.pointerdown({ clientX: 30, clientY: 20 });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));

    const intentTypes = intents.map((i) => i.type);
    expect(intentTypes).toEqual(
      expect.arrayContaining(['select-target', 'attack', 'move', 'move-relative', 'end-turn'])
    );

    controls.stop();
  });
});