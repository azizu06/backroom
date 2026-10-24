'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Screen-reader and test hook for text drawn into a canvas texture. Created and removed imperatively next to the
 * canvas, never through a drei `Html` portal, whose React-owned container is detached while the view switches and
 * throws on `removeChild`.
 */
export function useSceneTextNode(testId: string, text: string) {
  const host = useThree(state => state.gl.domElement.parentElement);
  useEffect(() => {
    if (!host) return;
    const node = document.createElement('span');
    node.className = 'visually-hidden';
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', text);
    node.dataset.testid = testId;
    node.textContent = text;
    host.appendChild(node);
    return () => node.remove();
  }, [host, testId, text]);
}
