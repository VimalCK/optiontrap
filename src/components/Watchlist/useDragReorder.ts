import { useEffect, useRef, useState, type DragEvent } from 'react';
import { moveItem, sameOrder } from './watchlistRows';

/**
 * Drag to reorder: pressing a row's handle arms that row (only it is draggable), the rows move as it passes
 * over them, and on drop `save` stores the new order; if it fails the old order is put back.
 */
export function useDragReorder<T extends { id: string }>(input: {
  items: T[];
  setItems: (update: T[] | ((prev: T[]) => T[])) => void;
  save: (items: T[]) => Promise<void>;
  onSaveFailed: (err: unknown) => void;
}) {
  const { items, setItems, save, onSaveFailed } = input;
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const startOrderRef = useRef<T[] | null>(null);

  // Releasing a handle without dragging disarms its row.
  useEffect(() => {
    if (!armedId || draggingId) return;
    const disarm = () => setArmedId(null);
    window.addEventListener('mouseup', disarm);
    return () => window.removeEventListener('mouseup', disarm);
  }, [armedId, draggingId]);

  const finishDrag = async () => {
    const before = startOrderRef.current;
    startOrderRef.current = null;
    setDraggingId(null);
    setArmedId(null);
    if (!before || sameOrder(items, before)) return;
    try {
      await save(items);
    } catch (err) {
      setItems(before);
      onSaveFailed(err);
    }
  };

  const rowProps = (item: T, dragLabel: string) => ({
    draggable: armedId === item.id,
    onDragStart: (e: DragEvent) => {
      startOrderRef.current = items;
      setDraggingId(item.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragLabel);
    },
    onDragOver: (e: DragEvent) => {
      if (!draggingId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingId !== item.id) setItems((prev) => moveItem(prev, draggingId, item.id));
    },
    onDrop: (e: DragEvent) => e.preventDefault(),
    onDragEnd: finishDrag,
  });

  return { draggingId, armRow: setArmedId, rowProps };
}
