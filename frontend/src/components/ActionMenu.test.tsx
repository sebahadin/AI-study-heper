import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ActionMenu } from './ActionMenu';
import { ItemActions } from './ItemActions';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } });
});
describe('quiet management menus', () => {
  it('supports keyboard navigation and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ActionMenu label="More actions for My note" items={[{ label: 'Edit note', to: '/notes/one/edit' }, { label: 'Remove note', onSelect: vi.fn(), danger: true }]} /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: 'More actions for My note' });
    expect(screen.queryByRole('menuitem', { name: 'Remove note' })).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Edit note' })).toHaveFocus();
    await user.keyboard('{ArrowDown}'); expect(screen.getByRole('menuitem', { name: 'Remove note' })).toHaveFocus();
    await user.keyboard('{Home}'); expect(screen.getByRole('menuitem', { name: 'Edit note' })).toHaveFocus();
    await user.keyboard('{Escape}'); expect(screen.queryByRole('menu')).toBeNull(); expect(trigger).toHaveFocus();
  });
  it('dismisses when clicking outside without stealing focus', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><ActionMenu label="More actions" items={[{ label: 'Edit', to: '/edit' }]} /><button>Outside</button></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull(); expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
  });
  it('keeps deletion behind explicit confirmation and allows canceling', async () => {
    const user = userEvent.setup(); const deleted = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    render(<MemoryRouter><ItemActions title="Study note" kind="note" editTo="/notes/one/edit" deletePath="/notes/one" onDeleted={deleted} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: 'More actions for Study note' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove note' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Study note'); expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More actions for Study note' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove note' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    expect(fetch).toHaveBeenCalledWith('/api/notes/one', expect.objectContaining({ method: 'DELETE' }));
    expect(deleted).toHaveBeenCalledTimes(1);
  });
});
