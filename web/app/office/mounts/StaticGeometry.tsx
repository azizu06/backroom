'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { BoxGeometry, Color, Euler, Float32BufferAttribute, Matrix4, MeshStandardMaterial, Quaternion, Vector3,
  type BufferGeometry, type InstancedMesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';

// Shared for the lazy scene's app lifetime. Callers opt out of R3F's recursive auto-disposal.
export const UNIT_BOX = new BoxGeometry(1, 1, 1);
const BASE_MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: OFFICE_LIGHTING.base.roughness });

/**
 * Small static dressing (wall shelves, tabletop objects, decals) lives on this layer so the floor's
 * contact-shadow pass, which re-renders layer 0 on every animated frame, skips it (Outdoors uses layer 2
 * the same way). Mounts tag their subtree and enable the layer on the active camera.
 */
export const DETAIL_LAYER = 3;
export function useDetailLayer(root: RefObject<Object3D | null>, key: unknown = null) {
  const camera = useThree(state => state.camera);
  useLayoutEffect(() => {
    root.current?.traverse(node => node.layers.set(DETAIL_LAYER));
    camera.layers.enable(DETAIL_LAYER);
  }, [root, camera, key]);
}

function pieceMatrix(piece: FurniturePiece, matrix: Matrix4, position: Vector3, rotation: Quaternion, scale: Vector3) {
  return matrix.compose(position.set(...piece.at), rotation.setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0]))), scale.set(...piece.size));
}

/**
 * Bake transforms and linear vertex colours once. No groups: one draw, one material. `unitFor` picks each
 * piece's unit-bounds primitive (default the unit box); every primitive must share the box's attributes.
 */
export function mergeBoxes<P extends FurniturePiece>(pieces: readonly P[], unitFor: (piece: P) => BufferGeometry = () => UNIT_BOX): BufferGeometry {
  if (!pieces.length) throw new RangeError('Static box batch must not be empty');
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  const parts = pieces.map(piece => {
    const geometry = unitFor(piece).clone().applyMatrix4(pieceMatrix(piece, matrix, position, rotation, scale));
    const color = new Color(piece.color);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    return geometry;
  });
  const merged = mergeGeometries(parts, false)!;
  parts.forEach(part => part.dispose());
  merged.computeBoundingSphere();
  return merged;
}

export function StaticBoxes({ pieces, material = BASE_MATERIAL, castShadow = true, receiveShadow = true }: {
  pieces: readonly FurniturePiece[]; material?: Material; castShadow?: boolean; receiveShadow?: boolean;
}) {
  const geometry = useMemo(() => mergeBoxes(pieces), [pieces]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} material={material} castShadow={castShadow} receiveShadow={receiveShadow} matrixAutoUpdate={false} dispose={null} />;
}

/** Static instance buffers are uploaded only when the layout changes, with no useFrame subscription. */
export function StaticInstances({ pieces, geometry, material, castShadow = true, receiveShadow = true }: {
  pieces: readonly FurniturePiece[]; geometry: BufferGeometry; material: Material; castShadow?: boolean; receiveShadow?: boolean;
}) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const current = mesh.current;
    // dispose=null protects shared geometry/material, but each batch owns its instance buffers.
    return () => current?.dispose();
  }, [geometry, material, pieces.length]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3(), color = new Color();
    pieces.forEach((piece, i) => {
      mesh.current!.setMatrixAt(i, pieceMatrix(piece, matrix, position, rotation, scale));
      mesh.current!.setColorAt(i, color.set(piece.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [pieces, geometry, material]);
  return <instancedMesh ref={mesh} args={[geometry, material, pieces.length]} castShadow={castShadow} receiveShadow={receiveShadow}
    matrixAutoUpdate={false} dispose={null} />;
}
