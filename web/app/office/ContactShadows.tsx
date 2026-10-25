'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Mesh, MeshBasicMaterial, MeshDepthMaterial, PlaneGeometry, ShaderMaterial, WebGLRenderTarget,
  type Group, type Object3D, type OrthographicCamera } from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { CONTACT_DYNAMIC_LAYER, type OfficeLighting } from '../../lib/office/lighting';

const BAKE_FRAMES = 2;

/**
 * Marks a subtree as moving, so the contact shadow redraws it every frame instead of baking it. Groups are marked
 * (the static bake hides a marked root with everything under it); of the meshes, only shadow casters join the
 * per-frame pass, so a bear's eyes and muzzle do not cost a draw each.
 */
export function markContactDynamic(root: Object3D | null) {
  root?.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || mesh.castShadow) node.layers.enable(CONTACT_DYNAMIC_LAYER);
  });
}

/**
 * Wraps scene pieces that move (avatars, doors, carried folders). They keep layer 0, so cameras, shadows and raycasts
 * still see them; the extra layer only routes them into the per-frame contact pass. Re-marks on every render so
 * children mounted with the wrapper's parent are covered.
 */
export function ContactDynamic({ children, name }: { children: ReactNode; name?: string }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => { markContactDynamic(ref.current); });
  return <group ref={ref} name={name}>{children}</group>;
}

/**
 * Drop-in for drei's ContactShadows (same depth/blur recipe and look) split into two passes. The static pass (walls,
 * furniture, the shared box batch) renders once and again only when its inputs change (`version`, the camera, a
 * restored context). The dynamic pass renders every frame but only CONTACT_DYNAMIC_LAYER, so moving Play does not
 * resubmit the whole floor (about 230 draw calls) on each frame. One plane shows the darker of the two maps.
 */
export function OfficeContactShadows({ config, version }: { config: OfficeLighting['contactShadows']; version: string }) {
  const { position, near, far, scale: [width, height], resolution, blur, opacity, color } = config;
  const scene = useThree(state => state.scene);
  const gl = useThree(state => state.gl);
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const group = useRef<Group>(null);
  const shadowCamera = useRef<OrthographicCamera>(null);
  // Frames left to bake the static map. Two: drei's shared <Instances> writes its matrices in its own useFrame,
  // which can run after this one on the first frame.
  const dirty = useRef(BAKE_FRAMES);
  const parts = useMemo(() => {
    const target = () => {
      const rt = new WebGLRenderTarget(resolution, resolution);
      rt.texture.generateMipmaps = false;
      return rt;
    };
    const fixed = target(), moving = target(), scratch = target();
    const plane = new PlaneGeometry(width, height).rotateX(Math.PI / 2);
    const blurPlane = new Mesh(plane);
    // Both passes' cameras must see the blur quad.
    blurPlane.layers.enable(CONTACT_DYNAMIC_LAYER);
    const depth = new MeshDepthMaterial();
    depth.depthTest = depth.depthWrite = false;
    depth.onBeforeCompile = shader => {
      shader.uniforms.ucolor = { value: new Color(color) };
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'uniform vec3 ucolor;\nvoid main() {')
        .replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );');
    };
    const horizontal = new ShaderMaterial(HorizontalBlurShader);
    const vertical = new ShaderMaterial(VerticalBlurShader);
    horizontal.depthTest = vertical.depthTest = false;
    const display = new MeshBasicMaterial({ map: fixed.texture, transparent: true, opacity, depthWrite: false });
    display.onBeforeCompile = shader => {
      shader.uniforms.movingMap = { value: moving.texture };
      shader.fragmentShader = 'uniform sampler2D movingMap;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        vec4 movingDiffuseColor = texture2D( movingMap, vMapUv );
        if ( movingDiffuseColor.a > sampledDiffuseColor.a ) sampledDiffuseColor = movingDiffuseColor;
        diffuseColor *= sampledDiffuseColor;`);
    };
    display.customProgramCacheKey = () => 'office-contact-shadow-two-pass-v1';
    return { fixed, moving, scratch, plane, blurPlane, depth, horizontal, vertical, display };
  }, [width, height, resolution, color, opacity]);
  useEffect(() => () => {
    const { fixed, moving, scratch, plane, depth, horizontal, vertical, display } = parts;
    [fixed, moving, scratch, plane, depth, horizontal, vertical, display].forEach(item => item.dispose());
  }, [parts]);
  // Static inputs changed (rooms, baked art, overview vs first person walls): bake again on the next frame.
  useEffect(() => { dirty.current = BAKE_FRAMES; invalidate(); }, [version, camera, parts, invalidate]);
  useEffect(() => {
    const canvas = gl.domElement;
    const restored = () => { dirty.current = BAKE_FRAMES; };
    canvas.addEventListener('webglcontextrestored', restored);
    return () => canvas.removeEventListener('webglcontextrestored', restored);
  }, [gl]);

  useFrame(() => {
    const cam = shadowCamera.current;
    if (!cam || !group.current) return;
    const { fixed, moving, scratch, blurPlane, depth, horizontal, vertical } = parts;
    const blurInto = (target: WebGLRenderTarget, amount: number) => {
      blurPlane.visible = true;
      blurPlane.material = horizontal;
      horizontal.uniforms.tDiffuse!.value = target.texture;
      horizontal.uniforms.h!.value = amount / 256;
      gl.setRenderTarget(scratch);
      gl.render(blurPlane, cam);
      blurPlane.material = vertical;
      vertical.uniforms.tDiffuse!.value = scratch.texture;
      vertical.uniforms.v!.value = amount / 256;
      gl.setRenderTarget(target);
      gl.render(blurPlane, cam);
      blurPlane.visible = false;
    };
    const pass = (target: WebGLRenderTarget) => {
      gl.setRenderTarget(target);
      gl.render(scene, cam);
      blurInto(target, blur);
      blurInto(target, blur * 0.4);
    };
    const background = scene.background, override = scene.overrideMaterial;
    group.current.visible = false;
    scene.background = null;
    scene.overrideMaterial = depth;
    if (dirty.current > 0) {
      dirty.current--;
      if (dirty.current > 0) invalidate();
      // Moving pieces stay out of the baked map; they are drawn by the per-frame pass below.
      const hidden: Object3D[] = [];
      scene.traverse(node => { if (node.visible && node.layers.isEnabled(CONTACT_DYNAMIC_LAYER) && node !== blurPlane) { node.visible = false; hidden.push(node); } });
      cam.layers.set(0);
      pass(fixed);
      hidden.forEach(node => { node.visible = true; });
    }
    cam.layers.set(CONTACT_DYNAMIC_LAYER);
    pass(moving);
    gl.setRenderTarget(null);
    scene.overrideMaterial = override;
    scene.background = background;
    group.current.visible = true;
  });

  return <group ref={group} position={position} rotation-x={Math.PI / 2} name='office:contact-shadows'>
    <mesh geometry={parts.plane} material={parts.display} scale={[1, -1, 1]} rotation={[-Math.PI / 2, 0, 0]} dispose={null} />
    <orthographicCamera ref={shadowCamera} args={[-width / 2, width / 2, height / 2, -height / 2, near, far]} />
  </group>;
}
