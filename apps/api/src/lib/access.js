import { HttpError, forbidden } from './util.js';

// Central permission and data-isolation rules.
export function createAccess(db) {
  const qClub = db.prepare('SELECT * FROM clubs WHERE id=?');
  const qMem = db.prepare("SELECT * FROM memberships WHERE user_id=? AND club_id=? AND status='active'");
  const qAnyMem = db.prepare('SELECT * FROM memberships WHERE user_id=? AND club_id=?');
  const isLeader = (m) => !!m && (m.position === 'president' || m.position === 'vice_president');

  const isSuperAdmin = (u) => u.system_role === 'super_admin' || u.system_role === 'admin';
  const isCampusAdmin = (u, c) => (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') && (c ? u.campus_id === c.campus_id : true);
  const isAdvisorForClub = (u, c) => {
    if (u.system_role !== 'faculty_advisor' && u.system_role !== 'advisor') return false;
    if (c.advisor_id === u.id) return true;
    const assigned = db.prepare('SELECT 1 FROM faculty_advisor_assignments WHERE club_id=? AND user_id=?').get(c.id, u.id);
    return !!assigned;
  };

  const a = {
    club(id) {
      const c = qClub.get(id);
      if (!c) throw new HttpError(404, 'Club not found');
      return c;
    },
    membership: (uid, cid) => qMem.get(uid, cid),
    anyMembership: (uid, cid) => qAnyMem.get(uid, cid),
    isCoordinator: (u, cid) => isLeader(qMem.get(u.id, cid)),
    isTreasurer: (u, cid) => qMem.get(u.id, cid)?.position === 'treasurer',
    isSuperAdmin,
    isAdmin: isSuperAdmin,
    isCampusAdmin,
    isCampusManager: isCampusAdmin,
    isAdvisor: isAdvisorForClub,
    isMember: (u, c) => !!qMem.get(u.id, c.id),

    // Staff oversight check
    isStaff(u, c) {
      return isSuperAdmin(u) || isCampusAdmin(u, c) || isAdvisorForClub(u, c);
    },

    // Strict campus isolation: user can only access their campus unless Super Admin
    canAccessCampus(u, campusId) {
      if (isSuperAdmin(u)) return true;
      return Number(u.campus_id) === Number(campusId);
    },

    // Strict club data isolation: students only access their own club
    canAccessClub(u, c) {
      if (isSuperAdmin(u)) return true;
      if (!a.canAccessCampus(u, c.campus_id)) return false;
      if (isCampusAdmin(u, c)) return true;
      if (isAdvisorForClub(u, c)) return true;
      return a.isMember(u, c);
    },

    canRun: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || a.isCoordinator(u, c.id),
    canManageClub: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || a.isCoordinator(u, c.id),
    canReviewPlan: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || isAdvisorForClub(u, c),
    canEvaluate: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || isAdvisorForClub(u, c) || a.isCoordinator(u, c.id),

    // Internal club data (e.g. join requests, private notes)
    canViewClubData: (u, c) => a.isStaff(u, c) || a.isCoordinator(u, c.id),

    // Member list isolation: students only see members of clubs they actively belong to!
    canViewMembers: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || isAdvisorForClub(u, c) || a.isMember(u, c),

    // Budget permissions
    canCreateBudget: (u, c) => isSuperAdmin(u) || a.isCoordinator(u, c.id) || a.isTreasurer(u, c.id),
    canAdvisorApproveBudget: (u, c) => isSuperAdmin(u) || isAdvisorForClub(u, c) || isCampusAdmin(u, c),
    canCollegeApproveBudget: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c),
    canViewBudget: (u, c) => isSuperAdmin(u) || isCampusAdmin(u, c) || isAdvisorForClub(u, c) || a.isMember(u, c),

    canCreateEvent: (u) => isSuperAdmin(u) || (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') || !!db.prepare("SELECT 1 FROM memberships WHERE user_id=? AND status='active' AND position IN ('president','vice_president')").get(u.id),

    require(ok, msg) { if (!ok) throw forbidden(msg); },

    // Return the list of club IDs visible to this user
    visibleClubIds(u, requestedCampusId = null) {
      if (isSuperAdmin(u)) {
        if (requestedCampusId) {
          return db.prepare('SELECT id FROM clubs WHERE is_test=0 AND campus_id=?').all(requestedCampusId).map((r) => r.id);
        }
        return db.prepare('SELECT id FROM clubs WHERE is_test=0').all().map((r) => r.id);
      }
      if (u.system_role === 'campus_admin' || u.system_role === 'campus_manager') {
        return db.prepare('SELECT id FROM clubs WHERE campus_id=? AND is_test=0').all(u.campus_id).map((r) => r.id);
      }
      if (u.system_role === 'faculty_advisor' || u.system_role === 'advisor') {
        return db.prepare(`SELECT DISTINCT c.id FROM clubs c
          LEFT JOIN faculty_advisor_assignments fa ON fa.club_id=c.id
          WHERE c.is_test=0 AND (c.advisor_id=? OR fa.user_id=?)`).all(u.id, u.id).map((r) => r.id);
      }
      // Student / Club Member: STRICT isolation to ONLY clubs they belong to!
      return db.prepare(`SELECT m.club_id id FROM memberships m JOIN clubs c ON c.id=m.club_id
        WHERE m.user_id=? AND m.status='active' AND c.is_test=0`).all(u.id).map((r) => r.id);
    },
  };
  return a;
}
