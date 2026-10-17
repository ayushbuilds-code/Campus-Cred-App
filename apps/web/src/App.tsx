import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Loading } from './components/ui';
import Layout from './components/Layout';
import Login from './pages/Login';
import Home from './pages/Home';
import Clubs from './pages/Clubs';
import ClubDetail from './pages/ClubDetail';
import ClubDays from './pages/ClubDays';
import ActivityPage from './pages/ActivityPage';
import RunClubDay from './pages/RunClubDay';
import CheckIn from './pages/CheckIn';
import Events from './pages/Events';
import EventPage from './pages/EventPage';
import Certificates from './pages/Certificates';
import Verify from './pages/Verify';
import Transcript from './pages/Transcript';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Budget from './pages/Budget';
import DutyLeave from './pages/DutyLeave';
import Notifications from './pages/Notifications';
import Admin from './pages/Admin';

function Protected({ children }: { children: JSX.Element }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/verify/:id" element={<Verify />} />
      <Route path="/run/:id" element={<Protected><RunClubDay /></Protected>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="clubs" element={<Clubs />} />
        <Route path="clubs/:id" element={<ClubDetail />} />
        <Route path="club-days" element={<ClubDays />} />
        <Route path="activities/:id" element={<ActivityPage />} />
        <Route path="checkin" element={<CheckIn />} />
        <Route path="events" element={<Events />} />
        <Route path="events/:id" element={<EventPage />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="transcript" element={<Transcript />} />
        <Route path="transcript/:id" element={<Transcript />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="budget" element={<Budget />} />
        <Route path="duty-leave" element={<DutyLeave />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
