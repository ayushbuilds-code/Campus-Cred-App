import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export type Campus = { id: number; name: string; code?: string; city: string; state?: string };

type Me = {
  user: any;
  campus: Campus | null;
  all_campuses?: Campus[];
  memberships: any[];
  advisor_clubs: any[];
  unread: number;
};

type AuthCtx = {
  me: Me | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  role: string;
  isSuperAdmin: boolean;
  isCampusAdmin: boolean;
  isAdvisor: boolean;
  isTreasurer: boolean;
  isStudent: boolean;
  isLead: boolean;
  isStaff: boolean;
  positionLabel: string;
  leadClubIds: number[];
  treasurerClubIds: number[];
  selectedCampusId: number | null;
  setSelectedCampusId: (id: number | null) => void;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [selectedCampusId, setSelectedCampusIdState] = useState<number | null>(() => {
    const saved = localStorage.getItem('cc_selected_campus');
    return saved ? Number(saved) : null;
  });

  const setSelectedCampusId = useCallback((id: number | null) => {
    setSelectedCampusIdState(id);
    if (id != null) {
      localStorage.setItem('cc_selected_campus', String(id));
    } else {
      localStorage.removeItem('cc_selected_campus');
    }
    window.dispatchEvent(new CustomEvent('cc:campus_changed', { detail: id }));
  }, []);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await api<Me>('/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener('cc:logout', out);
    return () => window.removeEventListener('cc:logout', out);
  }, []);

  const value = useMemo<AuthCtx>(() => {
    const active = (me?.memberships || []).filter((m) => m.status === 'active');
    const lead = active.filter((m) => m.position === 'president' || m.position === 'vice_president');
    const treasurers = active.filter((m) => m.position === 'treasurer');
    const rawRole = me?.user?.system_role || '';

    // Normalize roles
    const isSuperAdmin = rawRole === 'super_admin' || rawRole === 'admin';
    const isCampusAdmin = rawRole === 'campus_admin' || rawRole === 'campus_manager';
    const isAdvisor = rawRole === 'faculty_advisor' || rawRole === 'advisor';
    const isTreasurer = treasurers.length > 0;
    const isStudent = rawRole === 'student';

    let role = rawRole;
    if (isSuperAdmin) role = 'super_admin';
    else if (isCampusAdmin) role = 'campus_admin';
    else if (isAdvisor) role = 'faculty_advisor';

    const order = ['president', 'vice_president', 'treasurer', 'member'];
    const top = [...active].sort((a, b) => order.indexOf(a.position) - order.indexOf(b.position))[0];

    let positionLabel = 'Student';
    if (isSuperAdmin) positionLabel = 'Super Admin (All Campuses)';
    else if (isCampusAdmin) positionLabel = `Campus Admin · ${me?.campus?.name || 'Campus'}`;
    else if (isAdvisor) positionLabel = `Faculty Advisor · ${me?.campus?.name || 'Campus'}`;
    else if (top) {
      const posMap: Record<string, string> = {
        president: 'Club President',
        vice_president: 'Vice President',
        treasurer: 'Club Treasurer',
        member: 'Club Member',
      };
      positionLabel = `${posMap[top.position] || 'Member'} · ${top.club_name}`;
    }

    return {
      me,
      loading,
      refresh,
      role,
      isSuperAdmin,
      isCampusAdmin,
      isAdvisor,
      isTreasurer,
      isStudent,
      isLead: lead.length > 0,
      isStaff: isSuperAdmin || isCampusAdmin || isAdvisor,
      leadClubIds: lead.map((m) => m.club_id),
      treasurerClubIds: treasurers.map((m) => m.club_id),
      positionLabel,
      login: async (t: string) => {
        setToken(t);
        setLoading(true);
        await refresh();
      },
      logout: () => {
        setToken(null);
        setMe(null);
      },
      selectedCampusId: isSuperAdmin ? selectedCampusId : (me?.user?.campus_id ?? null),
      setSelectedCampusId,
    };
  }, [me, loading, refresh, selectedCampusId, setSelectedCampusId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
