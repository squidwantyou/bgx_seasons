import { useEffect, useState } from 'react';
import { cachedMe, loadMe, type Me } from '../lib/api';

export function useMe(): { me: Me | null; setMe: (me: Me) => void; failed: boolean } {
  const [me, setMeState] = useState<Me | null>(cachedMe());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadMe()
      .then((user) => {
        if (alive) setMeState(user);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return {
    me,
    failed,
    setMe: (user: Me) => setMeState(user),
  };
}
