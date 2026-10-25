'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, Color, Euler, Float32BufferAttribute, Matrix4, MeshStandardMaterial, Quaternion, Vector3,
  type BufferGeometry, type InstancedMesh, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';

// Shared for the lazy scene's app lifetime. Callers opt out of R3F's recursive auto-disposal.
export const UNIT_BOX = new BoxGeometry(1, 1, 1);
const BASE_MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: OFFICE_LIGHTING.base.roughness });

function pieceMatrix(piece: FurniturePiece, matrix: Matrix4, position: Vector3, rotation: Quaternion, scale: Vector3) {
  return matrix.compose(position.set(...piece.at), rotation.setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0]))), scale.set(...piece.size));
}

/** Bake transforms and linear vertex colours once. No groups: one draw, one material. */
export function mergeBoxes(pieces: readonly FurniturePiece[]): BufferGeometry {
  if (!pieces.length) throw new RangeError('Static box batch must not be empty');
  const matrix = new Matrix4(), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
  const parts = pieces.map(piece => {
    const geometry = UNIT_BOX.clone().applyMatrix4(pieceMatrix(piece, matrix, position, rotation, scale));
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
