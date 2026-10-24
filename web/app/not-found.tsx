import { RouteState } from '../components/RouteState';

export const metadata = { title: 'Page not found · Backroom' };
export default function NotFound() {
  return <RouteState status="404 · Not found" title="This room is not on the floor plan.">
    <p>The link may be old or mistyped.</p>
    <p>Nothing was changed. Agent decisions only happen through the office and are recorded on the audit wall.</p>
  </RouteState>;
}
