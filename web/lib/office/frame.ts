/**
 * Bridge for on-demand 3D frames. The scene module (lazy-loaded, owns three/fiber)
 * registers fiber\x27s global invalidate; Office can request a frame without importing
 * the WebGL runtime. Before the scene loads there is no Canvas root, so a request is a no-op.
 */
let requester: (() => void) | null = null;

export function registerSceneFrameRequester(request: () => void) {
  requester = request;
}

export function requestSceneFrame() {
  requester?.();
}
