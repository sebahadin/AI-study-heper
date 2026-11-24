import { useState } from 'react';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { ConfirmDialog } from './DeleteButton';

export function ItemActions({ title, kind, editTo, deletePath, onDeleted, description, extra = [] }: { title: string; kind: 'book' | 'note' | 'flashcard' | 'course'; editTo?: string; deletePath?: string; onDeleted?: () => void; description?: string; extra?: MenuAction[] }) {
  const [confirm, setConfirm] = useState(false);
  const items: MenuAction[] = [
    ...(editTo ? [{ label: `Edit ${kind}`, icon: 'edit' as const, to: editTo }] : []),
    ...extra,
    ...(deletePath && onDeleted ? [{ label: `Remove ${kind}`, icon: 'trash' as const, danger: true, onSelect: () => setConfirm(true) }] : []),
  ];
  return <><ActionMenu label={`More actions for ${title}`} items={items} />{confirm && deletePath && onDeleted && <ConfirmDialog title={title} path={deletePath} description={description} onDeleted={onDeleted} onClose={() => setConfirm(false)} />}</>;
}
