import MessagesPanel from '../components/MessagesPanel';
import { Card, PageHeader } from '../components/ui';
import { useAuth } from '../auth';

export default function Messages() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title={user.role === 'technician' ? 'Feedback' : 'Issues & feedback'} sub={user.role === 'admin' ? 'Reply to customers and technicians and mark items resolved.' : user.role === 'user' ? 'Report a problem with a token or certificate, or tell us how we did.' : 'Share feedback with the administrator about a token or the process.'} />
      <Card><MessagesPanel full /></Card>
    </>
  );
}
