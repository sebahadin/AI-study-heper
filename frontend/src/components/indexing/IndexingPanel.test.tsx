import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexingPanel } from './IndexingPanel';

afterEach(() => vi.useRealTimers());
describe('Owned indexing feedback', () => {
  it('polls to ready and shows missing text pages without moving the reader', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ indexing: { status: ++calls === 1 ? 'queued' : 'ready', error: null, pagesWithoutText: calls === 1 ? [] : [2] } })));
    render(<IndexingPanel kind="documents" id="doc" />);
    await act(async () => {});
    expect(screen.getByRole('status')).toHaveTextContent('Queued');
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
    expect(screen.getByText(/Page 2 has no extractable text/)).toBeVisible();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(calls).toBe(2);
  });
  it('keeps one poll in flight when the server is slow', async () => {
    vi.useFakeTimers();
    let resolve!: (response: Response) => void;
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1
      ? Promise.resolve(Response.json({ indexing: { status: 'queued', error: null } }))
      : new Promise<Response>(done => { resolve = done; })));
    render(<IndexingPanel kind="documents" id="doc" />);
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(9000));
    expect(calls).toBe(2);
    await act(async () => resolve(Response.json({ indexing: { status: 'ready', error: null } })));
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
  });
  it('retries failed indexing using an empty owned API request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input, init) => Response.json({ indexing: { status: init?.method === 'POST' ? 'queued' : 'failed', error: { code: 'index_unavailable', message: 'Search is temporarily unavailable.' } } })));
    const user = userEvent.setup(); render(<IndexingPanel kind="notes" id="note" />);
    expect(await screen.findByText('Search is temporarily unavailable.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry indexing' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Queued');
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/notes/note/indexing/retry');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({});
  });
  it('ignores stale responses when navigation changes the material', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn((input) => String(input).includes('/old/') ? new Promise<Response>(done => { resolve = done; }) : Promise.resolve(Response.json({ indexing: { status: 'ready', error: null } }))));
    const view = render(<IndexingPanel kind="notes" id="old" />);
    view.rerender(<IndexingPanel kind="notes" id="new" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Ready');
    await act(async () => resolve(Response.json({ indexing: { status: 'failed', error: null } })));
    expect(screen.getByRole('status')).toHaveTextContent('Ready');
  });
});
