export function extractSceneStateFromWorldPayload(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.scene && typeof payload.scene === 'object') return payload.scene;
    if (payload.objects) {
        return {
            objects: payload.objects,
            lights: payload.lights || {},
        };
    }
    return null;
}
