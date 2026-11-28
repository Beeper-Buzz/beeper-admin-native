import type { AdminTreeNode } from '@instincts/spree-domain';
import { useRef, useState } from 'react';
import { Animated, type LayoutChangeEvent, PanResponder, type PanResponderInstance } from 'react-native';
import { flatten, insertIndex, type Placement, projectDrop, subtreeIds } from './tree-ops';

/** Points per level of nesting, for rows and for dragging sideways to indent or outdent. */
export const INDENT = 20;

export interface DropPreview {
  /** Where the line is drawn, in the rows' coordinates. */
  y: number;
  depth: number;
  placement: Placement | null;
}

/**
 * Drag to reorder with React Native's own PanResponder and Animated (no native module beyond what
 * the app already ships). Pressing a row's handle lifts it; dragging up or down picks the gap it
 * drops into, sideways picks the depth (one level per INDENT points), and letting go moves it.
 * The rows report their layout so the drop point can be worked out from the finger.
 */
export function useTreeDrag(nodes: readonly AdminTreeNode[], onDrop: (id: string, at: Placement) => void) {
  const layouts = useRef(new Map<string, { y: number; height: number }>());
  const dy = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState<string | null>(null);
  const [preview, setPreview] = useState<DropPreview | null>(null);
  const state = useRef({ nodes, onDrop, last: '' });
  state.current.nodes = nodes;
  state.current.onDrop = onDrop;

  const previewFor = (id: string, moveY: number, moveX: number): DropPreview => {
    const tree = state.current.nodes;
    const at = insertIndex(tree, id, layouts.current, moveY);
    const delta = Math.round(moveX / INDENT);
    const placement = projectDrop(tree, id, at, delta);
    const flat = flatten(tree);
    const me = flat.find((f) => f.id === id);
    const lifted = me ? subtreeIds(me.node) : new Set<string>();
    const rest = flat.filter((f) => !lifted.has(f.id));
    const below = rest[at] ? layouts.current.get(rest[at].id) : undefined;
    const last = rest[rest.length - 1];
    const lastBox = last ? layouts.current.get(last.id) : undefined;
    const y = below ? below.y : lastBox ? lastBox.y + lastBox.height : 0;
    const parentDepth = placement?.parentId
      ? (flat.find((f) => f.id === placement.parentId)?.depth ?? -1)
      : -1;
    return { y, depth: placement ? parentDepth + 1 : (me?.depth ?? 0), placement };
  };

  const handlers = useRef(new Map<string, PanResponderInstance>());
  /** The pan handlers for one row's drag handle. */
  const handleFor = (id: string): PanResponderInstance => {
    const existing = handlers.current.get(id);
    if (existing) return existing;
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        dy.setValue(0);
        state.current.last = '';
        setDragging(id);
        setPreview(null);
      },
      onPanResponderMove: (_e, g) => {
        dy.setValue(g.dy);
        const next = previewFor(id, g.dy, g.dx);
        const key = `${next.y}:${next.depth}:${next.placement?.parentId}:${next.placement?.position}`;
        if (key !== state.current.last) {
          state.current.last = key;
          setPreview(next);
        }
      },
      onPanResponderRelease: (_e, g) => {
        const { placement } = previewFor(id, g.dy, g.dx);
        dy.setValue(0);
        setDragging(null);
        setPreview(null);
        if (placement) state.current.onDrop(id, placement);
      },
      onPanResponderTerminate: () => {
        dy.setValue(0);
        setDragging(null);
        setPreview(null);
      },
    });
    handlers.current.set(id, responder);
    return responder;
  };

  const onRowLayout = (id: string) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    layouts.current.set(id, { y, height });
  };

  return { dragging, dy, preview, handleFor, onRowLayout };
}
