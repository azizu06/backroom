'use client';

import { Component, type ReactNode } from 'react';
import { boundaryStateForProps, reportViewFailure, type BoundaryState } from '../../lib/office/view';

/** Contains a render failure to its own region; a changed `resetKey` retries the children. */
export class ViewBoundary extends Component<{ name: string; children: ReactNode; fallback: ReactNode; onFailure?: () => void; resetKey?: unknown }, BoundaryState> {
  state: BoundaryState = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: BoundaryState) { return boundaryStateForProps(props.resetKey, state); }
  componentDidCatch(error: unknown) { reportViewFailure(this.props.name, error, this.props.onFailure); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
