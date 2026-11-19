import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../services/api';

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    setError('');
    setLoading(Boolean(path));
    if (!path) { setData(null); return; }
    api<T>(path)
      .then((value) => { if (active) { setData(value); } })
      .catch((reason) => { if (active) { setError(errorMessage(reason)); } })
      .finally(() => { if (active) { setLoading(false); } });
    return () => { active = false; };
  }, [path, revision]);
  return { data, loading, error, reload };
}
