import { Compass } from 'lucide-react';
import { Button, EmptyState } from '../../components/ui/index.js';

export default function NotFound() {
  return (
    <div className="section">
      <EmptyState icon={Compass} title="Page not found" message="The page you are looking for does not exist or has moved." action={<Button to="/">Back to home</Button>} />
    </div>
  );
}
